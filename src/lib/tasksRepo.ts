/* eslint-disable prettier/prettier */
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

export const DEFAULT_LOCAL_USER_ID = 'local-default-user'

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_tasks_userId ON tasks(userId);
  CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(userId, status);
  CREATE TABLE IF NOT EXISTS work_sessions (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    userId TEXT NOT NULL,
    startAt TEXT NOT NULL,
    endAt TEXT,
    FOREIGN KEY(taskId) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ws_taskId ON work_sessions(taskId);
  CREATE INDEX IF NOT EXISTS idx_ws_endAt ON work_sessions(endAt);
  CREATE INDEX IF NOT EXISTS idx_ws_userId ON work_sessions(userId);
`)

function ensureColumn(table: string, column: string, definition: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
  }>
  if (info.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

ensureColumn(
  'tasks',
  'userId',
  `TEXT NOT NULL DEFAULT '${DEFAULT_LOCAL_USER_ID}'`
)
ensureColumn(
  'work_sessions',
  'userId',
  `TEXT NOT NULL DEFAULT '${DEFAULT_LOCAL_USER_ID}'`
)

db.exec(
  `UPDATE tasks SET userId = '${DEFAULT_LOCAL_USER_ID}' WHERE userId IS NULL OR userId = ''`
)
db.exec(`
  UPDATE work_sessions
  SET userId = COALESCE((SELECT userId FROM tasks WHERE tasks.id = work_sessions.taskId), '${DEFAULT_LOCAL_USER_ID}')
  WHERE userId IS NULL OR userId = ''
`)

const VALID_STATUS: TaskStatus[] = ['todo', 'in_progress', 'done', 'canceled']
const VALID_PRIORITY: TaskPriority[] = ['low', 'normal', 'high', 'urgent']

function nowISO() {
  return new Date().toISOString()
}

export interface ListParams {
  status?: TaskStatus
  q?: string
  userId: string
}

function ensureUserId(userId?: string): asserts userId is string {
  if (!userId) throw new Error('userId is required')
}

export const tasksRepo = {
  list(params: ListParams): Task[] {
    ensureUserId(params.userId)
    const where: string[] = ['userId = @userId']
    const bind: Record<string, unknown> = { userId: params.userId }

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

  get(id: string, userId: string): Task | undefined {
    ensureUserId(userId)
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ? AND userId = ?')
    return stmt.get(id, userId) as Task | undefined
  },

  create(input: CreateTaskInput, userId: string): Task {
    ensureUserId(userId)
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
      'INSERT INTO tasks (id, userId, title, note, status, priority, due, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    stmt.run(
      id,
      userId,
      title,
      input.note ?? null,
      status,
      priority,
      due,
      createdAt,
      updatedAt
    )
    return this.get(id, userId)!
  },

  update(id: string, patch: UpdateTaskInput, userId: string): Task {
    ensureUserId(userId)
    const current = this.get(id, userId)
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
      'UPDATE tasks SET title = ?, note = ?, status = ?, priority = ?, due = ?, updatedAt = ? WHERE id = ? AND userId = ?'
    )
    stmt.run(
      next.title,
      next.note ?? null,
      next.status,
      next.priority,
      next.due ?? null,
      next.updatedAt,
      id,
      userId
    )
    const updated = this.get(id, userId)
    if (!updated) throw new Error('not found')
    return updated
  },

  complete(id: string, userId: string): Task {
    ensureUserId(userId)
    // 自動でアクティブな作業を停止
    const active = this.getActiveSession(userId)
    if (active && active.taskId === id) this.stopWork(userId)
    return this.update(id, { status: 'done' }, userId)
  },

  delete(id: string, userId: string): void {
    ensureUserId(userId)
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ? AND userId = ?')
    const result = stmt.run(id, userId)
    if (!result || result.changes === 0) throw new Error('not found')
  },

  // --- Work sessions ---
  getActiveSession(
    userId: string
  ):
    | { id: string; taskId: string; startAt: string; endAt?: string }
    | undefined {
    ensureUserId(userId)
    const stmt = db.prepare(
      'SELECT id, taskId, startAt, endAt FROM work_sessions WHERE userId = ? AND endAt IS NULL LIMIT 1'
    )
    return stmt.get(userId) as any
  },

  startWork(taskId: string, userId: string) {
    ensureUserId(userId)
    const task = this.get(taskId, userId)
    if (!task) throw new Error('not found')
    // 既存のアクティブセッションがあれば終了
    const now = nowISO()
    const active = this.getActiveSession(userId)
    if (active) {
      const endStmt = db.prepare(
        'UPDATE work_sessions SET endAt = ? WHERE id = ? AND userId = ?'
      )
      endStmt.run(now, active.id, userId)
    }
    const id = randomUUID()
    const stmt = db.prepare(
      'INSERT INTO work_sessions (id, taskId, userId, startAt) VALUES (?, ?, ?, ?)'
    )
    stmt.run(id, taskId, userId, now)
    // ステータスを進行中へ
    try {
      this.update(taskId, { status: 'in_progress' }, userId)
    } catch {}
    return { id, taskId, userId, startAt: now }
  },

  stopWork(userId: string) {
    ensureUserId(userId)
    const active = this.getActiveSession(userId)
    if (!active) return undefined
    const now = nowISO()
    const endStmt = db.prepare(
      'UPDATE work_sessions SET endAt = ? WHERE id = ? AND userId = ?'
    )
    endStmt.run(now, active.id, userId)
    return { ...active, endAt: now }
  },

  getTaskTotalSeconds(taskId: string, userId: string): number {
    ensureUserId(userId)
    const stmt = db.prepare(
      'SELECT startAt, endAt FROM work_sessions WHERE taskId = ? AND userId = ?'
    )
    const rows = stmt.all(taskId, userId) as {
      startAt: string
      endAt?: string
    }[]
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

  listWithMeta(params: ListParams): TaskWithMeta[] {
    const tasks = this.list(params)
    const active = this.getActiveSession(params.userId)
    return tasks.map((t) => ({
      ...t,
      isActive: active ? active.taskId === t.id : false,
      totalSeconds: this.getTaskTotalSeconds(t.id, params.userId),
    }))
  },

  // --- Summary helpers ---
  listSessionsInRange(
    fromISO: string,
    toISO: string,
    userId: string
  ): Array<{
    id: string
    taskId: string
    startAt: string
    endAt?: string
  }> {
    ensureUserId(userId)
    const stmt = db.prepare(
      'SELECT id, taskId, startAt, endAt FROM work_sessions WHERE userId = @userId AND startAt < @to AND COALESCE(endAt, @to) > @from'
    )
    return stmt.all({ from: fromISO, to: toISO, userId }) as any
  },

  getSummary(fromISO: string, toISO: string, userId: string) {
    ensureUserId(userId)
    const sessions = this.listSessionsInRange(fromISO, toISO, userId)
    const now = Date.now()
    const byTask: Record<
      string,
      { totalSeconds: number; sessionCount: number; lastWorkedAt: string }
    > = {}
    let totalSeconds = 0
    for (const s of sessions) {
      const start = Math.max(
        new Date(s.startAt).getTime(),
        new Date(fromISO).getTime()
      )
      const rawEnd = s.endAt ? new Date(s.endAt).getTime() : now
      const end = Math.min(rawEnd, new Date(toISO).getTime())
      const sec = end > start ? Math.floor((end - start) / 1000) : 0
      totalSeconds += sec
      if (!byTask[s.taskId])
        byTask[s.taskId] = {
          totalSeconds: 0,
          sessionCount: 0,
          lastWorkedAt: s.endAt || new Date().toISOString(),
        }
      byTask[s.taskId].totalSeconds += sec
      byTask[s.taskId].sessionCount += 1
      const latest = byTask[s.taskId].lastWorkedAt
      if (
        new Date(s.endAt || s.startAt).getTime() > new Date(latest).getTime()
      ) {
        byTask[s.taskId].lastWorkedAt = s.endAt || s.startAt
      }
    }
    // attach titles
    const tasks = this.list({ userId })
    const byTaskArray = Object.entries(byTask).map(([taskId, v]) => {
      const t = tasks.find((x) => x.id === taskId)
      return {
        id: taskId,
        title: t?.title || '(削除済みタスク)',
        totalSeconds: v.totalSeconds,
        sessionCount: v.sessionCount,
        lastWorkedAt: v.lastWorkedAt,
      }
    })
    byTaskArray.sort((a, b) => b.totalSeconds - a.totalSeconds)

    // completed count (done updated within range)
    const stmtDone = db.prepare(
      "SELECT COUNT(1) as c FROM tasks WHERE userId = ? AND status = 'done' AND updatedAt >= ? AND updatedAt < ?"
    )
    const row: any = stmtDone.get(userId, fromISO, toISO)
    const completedCount = Number(row?.c || 0)

    // days breakdown (local days)
    const from = new Date(fromISO)
    const to = new Date(toISO)
    const dayStart = new Date(from)
    dayStart.setHours(0, 0, 0, 0)
    const days: Array<{ date: string; seconds: number }> = []
    for (let d = new Date(dayStart); d < to; d.setDate(d.getDate() + 1)) {
      const start = new Date(d)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      let secSum = 0
      for (const s of sessions) {
        const sStart = Math.max(new Date(s.startAt).getTime(), start.getTime())
        const sEnd = Math.min(
          s.endAt ? new Date(s.endAt).getTime() : now,
          end.getTime()
        )
        if (sEnd > sStart) secSum += Math.floor((sEnd - sStart) / 1000)
      }
      days.push({ date: new Date(start).toISOString(), seconds: secSum })
    }

    return { totalSeconds, byTask: byTaskArray, completedCount, days }
  },
}
