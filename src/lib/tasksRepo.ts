import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskPriority,
  TaskStatus,
  TaskWithMeta,
} from '@/types/task'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'tasks.db')

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

ensureDir(DATA_DIR)

const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    due TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
  CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt);
  CREATE TABLE IF NOT EXISTS work_sessions (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    startAt TEXT NOT NULL,
    endAt TEXT,
    FOREIGN KEY(taskId) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ws_taskId ON work_sessions(taskId);
  CREATE INDEX IF NOT EXISTS idx_ws_endAt ON work_sessions(endAt);
`)

const VALID_STATUS: TaskStatus[] = ['todo', 'in_progress', 'done', 'canceled']
const VALID_PRIORITY: TaskPriority[] = ['low', 'normal', 'high', 'urgent']

function nowISO() {
  return new Date().toISOString()
}

export interface ListParams {
  status?: TaskStatus
  q?: string
}

export const tasksRepo = {
  list(params: ListParams = {}): Task[] {
    const where: string[] = []
    const bind: Record<string, unknown> = {}

    if (params.status) {
      where.push('status = @status')
      bind.status = params.status
    }
    if (params.q) {
      where.push('(title LIKE @q OR note LIKE @q)')
      bind.q = `%${params.q}%`
    }

    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY 
      CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
      COALESCE(due, '9999-12-31T23:59:59.999Z') ASC,
      updatedAt DESC`
    const stmt = db.prepare(sql)
    return stmt.all(bind) as Task[]
  },

  get(id: string): Task | undefined {
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?')
    return stmt.get(id) as Task | undefined
  },

  create(input: CreateTaskInput): Task {
    const id = randomUUID()
    const createdAt = nowISO()
    const updatedAt = createdAt
    const title = (input.title || '').trim()
    if (!title) throw new Error('title is required')
    const priority: TaskPriority =
      input.priority && VALID_PRIORITY.includes(input.priority)
        ? input.priority
        : 'normal'
    const status: TaskStatus = 'todo'
    const due = input.due ? new Date(input.due).toISOString() : null

    const stmt = db.prepare(
      'INSERT INTO tasks (id, title, note, status, priority, due, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    stmt.run(
      id,
      title,
      input.note ?? null,
      status,
      priority,
      due,
      createdAt,
      updatedAt
    )
    return this.get(id)!
  },

  update(id: string, patch: UpdateTaskInput): Task {
    const current = this.get(id)
    if (!current) throw new Error('not found')

    const next: Task = { ...current }
    if (typeof patch.title === 'string')
      next.title = patch.title.trim() || current.title
    if (typeof patch.note === 'string') next.note = patch.note
    if (
      typeof patch.priority === 'string' &&
      VALID_PRIORITY.includes(patch.priority)
    )
      next.priority = patch.priority
    if (typeof patch.status === 'string' && VALID_STATUS.includes(patch.status))
      next.status = patch.status
    if (patch.due === null) next.due = undefined
    else if (typeof patch.due === 'string')
      next.due = new Date(patch.due).toISOString()
    next.updatedAt = nowISO()

    const stmt = db.prepare(
      'UPDATE tasks SET title = ?, note = ?, status = ?, priority = ?, due = ?, updatedAt = ? WHERE id = ?'
    )
    stmt.run(
      next.title,
      next.note ?? null,
      next.status,
      next.priority,
      next.due ?? null,
      next.updatedAt,
      id
    )
    return this.get(id)!
  },

  complete(id: string): Task {
    // 自動でアクティブな作業を停止
    const active = this.getActiveSession()
    if (active && active.taskId === id) this.stopWork()
    return this.update(id, { status: 'done' })
  },

  delete(id: string): void {
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?')
    stmt.run(id)
  },

  // --- Work sessions ---
  getActiveSession():
    | { id: string; taskId: string; startAt: string; endAt?: string }
    | undefined {
    const stmt = db.prepare(
      'SELECT id, taskId, startAt, endAt FROM work_sessions WHERE endAt IS NULL LIMIT 1'
    )
    return stmt.get() as any
  },

  startWork(taskId: string) {
    // 既存のアクティブセッションがあれば終了
    const now = nowISO()
    const active = this.getActiveSession()
    if (active) {
      const endStmt = db.prepare(
        'UPDATE work_sessions SET endAt = ? WHERE id = ?'
      )
      endStmt.run(now, active.id)
    }
    const id = randomUUID()
    const stmt = db.prepare(
      'INSERT INTO work_sessions (id, taskId, startAt) VALUES (?, ?, ?)'
    )
    stmt.run(id, taskId, now)
    // ステータスを進行中へ
    try {
      this.update(taskId, { status: 'in_progress' })
    } catch {}
    return { id, taskId, startAt: now }
  },

  stopWork() {
    const active = this.getActiveSession()
    if (!active) return undefined
    const now = nowISO()
    const endStmt = db.prepare(
      'UPDATE work_sessions SET endAt = ? WHERE id = ?'
    )
    endStmt.run(now, active.id)
    return { ...active, endAt: now }
  },

  getTaskTotalSeconds(taskId: string): number {
    const stmt = db.prepare(
      'SELECT startAt, endAt FROM work_sessions WHERE taskId = ?'
    )
    const rows = stmt.all(taskId) as { startAt: string; endAt?: string }[]
    let total = 0
    const now = Date.now()
    for (const r of rows) {
      const start = new Date(r.startAt).getTime()
      const end = r.endAt ? new Date(r.endAt).getTime() : now
      if (!isNaN(start) && !isNaN(end) && end > start)
        total += Math.floor((end - start) / 1000)
    }
    return total
  },

  listWithMeta(params: ListParams = {}): TaskWithMeta[] {
    const tasks = this.list(params)
    const active = this.getActiveSession()
    return tasks.map((t) => ({
      ...t,
      isActive: active ? active.taskId === t.id : false,
      totalSeconds: this.getTaskTotalSeconds(t.id),
    }))
  },
}
