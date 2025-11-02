/* eslint-disable prettier/prettier */
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskStatus,
  TaskPriority,
  TaskWithMeta,
} from '@/types/task'
import { tasksRepo } from '@/lib/tasksRepo'
import { createServerSupabase } from '@/lib/supabaseClient'
import type { SupabaseClient } from '@supabase/supabase-js'

const shouldUseSupabase = () =>
  process.env.USE_SUPABASE === 'true' && !!process.env.NEXT_PUBLIC_SUPABASE_URL

export interface TaskServiceContext {
  userId: string
  client?: SupabaseClient | null
}

// --- Supabase implementations ---
const sb = (ctx?: TaskServiceContext) => ctx?.client || createServerSupabase()

const ensureContext = (ctx?: TaskServiceContext) => {
  if (!ctx || !ctx.userId) throw new Error('user context required')
  return { userId: ctx.userId, client: ctx.client ?? null }
}

const sbList = async (
  params: { q?: string; status?: TaskStatus },
  ctx?: TaskServiceContext
): Promise<Task[]> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.list({ ...(params as any), userId })
  let query = client
    .from('tasks')
    .select('*')
    .eq('userId', userId)
    .order('updatedAt', { ascending: false })
  if (params.status) query = query.eq('status', params.status)
  if (params.q)
    query = query.or(`title.ilike.%${params.q}%,note.ilike.%${params.q}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as Task[]
}

const sbGet = async (
  id: string,
  ctx?: TaskServiceContext
): Promise<Task | undefined> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.get(id, userId)
  const { data, error } = await client
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('userId', userId)
    .single()
  if (error) {
    if ((error as any).code === 'PGRST116') throw new Error('not found')
    throw new Error(error.message)
  }
  return data as Task
}

const nowISO = () => new Date().toISOString()

const sbCreate = async (
  input: CreateTaskInput,
  ctx?: TaskServiceContext
): Promise<Task> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.create(input, userId)
  const row: Partial<Task> = {
    id: crypto.randomUUID(),
    userId,
    title: input.title.trim(),
    note: input.note ?? (null as any),
    status: 'todo',
    priority: (input.priority || 'normal') as TaskPriority,
    due: input.due ? new Date(input.due).toISOString() : (null as any),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  const { data, error } = await client
    .from('tasks')
    .insert(row)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Task
}

const sbUpdate = async (
  id: string,
  patch: UpdateTaskInput,
  ctx?: TaskServiceContext
): Promise<Task> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.update(id, patch, userId)
  const upd: any = { updatedAt: nowISO() }
  if (patch.title !== undefined) upd.title = patch.title
  if (patch.note !== undefined) upd.note = patch.note
  if (patch.status !== undefined) upd.status = patch.status
  if (patch.priority !== undefined) upd.priority = patch.priority
  if (patch.due === null) upd.due = null
  if (typeof patch.due === 'string') upd.due = new Date(patch.due).toISOString()
  const { data, error } = await client
    .from('tasks')
    .update(upd)
    .eq('id', id)
    .eq('userId', userId)
    .select('*')
    .single()
  if (error) {
    if ((error as any).code === 'PGRST116') throw new Error('not found')
    throw new Error(error.message)
  }
  return data as Task
}

const sbDelete = async (
  id: string,
  ctx?: TaskServiceContext
): Promise<void> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.delete(id, userId)
  const { data, error } = await client
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('userId', userId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('not found')
}

const sbStopWork = async (ctx?: TaskServiceContext) => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.stopWork(userId)
  const { data, error } = await client
    .from('work_sessions')
    .select('*')
    .eq('userId', userId)
    .is('endAt', null)
    .limit(1)
    .single()
  if (error && (error as any).code !== 'PGRST116') {
    throw new Error(error.message)
  }
  if (!data) return undefined
  const ended = { ...data, endAt: nowISO() }
  const { error: upErr } = await client
    .from('work_sessions')
    .update({ endAt: ended.endAt })
    .eq('id', (data as any).id)
    .eq('userId', userId)
  if (upErr) throw new Error(upErr.message)
  return ended
}

const sbComplete = async (
  id: string,
  ctx?: TaskServiceContext
): Promise<Task> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.complete(id, userId)
  await sbStopWork(ctx)
  return await sbUpdate(id, { status: 'done' }, ctx)
}

const sbStartWork = async (taskId: string, ctx?: TaskServiceContext) => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.startWork(taskId, userId)
  await sbStopWork(ctx)
  await sbGet(taskId, ctx)
  const row = {
    id: crypto.randomUUID(),
    taskId,
    userId,
    startAt: nowISO(),
    endAt: null as any,
  }
  const { error } = await client.from('work_sessions').insert(row)
  if (error) throw new Error(error.message)
  try {
    await sbUpdate(taskId, { status: 'in_progress' }, ctx)
  } catch {}
  return row
}

const sbGetTaskTotalSeconds = async (
  taskId: string,
  ctx?: TaskServiceContext
): Promise<number> => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.getTaskTotalSeconds(taskId, userId)
  const { data, error } = await client
    .from('work_sessions')
    .select('startAt,endAt')
    .eq('taskId', taskId)
    .eq('userId', userId)
  if (error) throw new Error(error.message)
  const now = Date.now()
  let total = 0
  for (const r of data || []) {
    const s = new Date((r as any).startAt).getTime()
    const e = (r as any).endAt ? new Date((r as any).endAt).getTime() : now
    if (!isNaN(s) && !isNaN(e) && e > s) total += Math.floor((e - s) / 1000)
  }
  return total
}

const sbListWithMeta = async (
  params: { q?: string; status?: TaskStatus },
  ctx?: TaskServiceContext
): Promise<TaskWithMeta[]> => {
  const { userId } = ensureContext(ctx)
  if (!shouldUseSupabase())
    return tasksRepo.listWithMeta({ ...(params as any), userId })
  const items = await sbList(params, ctx)
  const totals: Record<string, number> = {}
  for (const t of items) totals[t.id] = await sbGetTaskTotalSeconds(t.id, ctx)
  const client = sb(ctx)
  if (!client) {
    return items.map((t) => ({
      ...t,
      totalSeconds: totals[t.id] || 0,
      isActive: false,
    }))
  }
  const { data } = await client
    .from('work_sessions')
    .select('taskId')
    .eq('userId', userId)
    .is('endAt', null)
    .limit(1)
  const activeTaskId = data && data[0]?.taskId
  return items.map((t) => ({
    ...t,
    totalSeconds: totals[t.id] || 0,
    isActive: activeTaskId ? activeTaskId === t.id : false,
  }))
}

const sbGetSummary = async (
  fromISO: string,
  toISO: string,
  ctx?: TaskServiceContext
) => {
  const { userId } = ensureContext(ctx)
  const client = sb(ctx)
  if (!client) return tasksRepo.getSummary(fromISO, toISO, userId)
  const { data: sessions, error } = await client
    .from('work_sessions')
    .select('id,taskId,startAt,endAt')
    .eq('userId', userId)
    .lt('startAt', toISO)
    .gt('endAt', fromISO)
  if (error) throw new Error(error.message)
  const now = Date.now()
  const byTask: Record<
    string,
    { totalSeconds: number; sessionCount: number; lastWorkedAt: string }
  > = {}
  let totalSeconds = 0
  for (const s of sessions || []) {
    const start = Math.max(
      new Date((s as any).startAt).getTime(),
      new Date(fromISO).getTime()
    )
    const rawEnd = (s as any).endAt ? new Date((s as any).endAt).getTime() : now
    const end = Math.min(rawEnd, new Date(toISO).getTime())
    const sec = end > start ? Math.floor((end - start) / 1000) : 0
    totalSeconds += sec
    const tid = (s as any).taskId as string
    if (!byTask[tid])
      byTask[tid] = {
        totalSeconds: 0,
        sessionCount: 0,
        lastWorkedAt: (s as any).endAt || new Date().toISOString(),
      }
    byTask[tid].totalSeconds += sec
    byTask[tid].sessionCount += 1
    const latest = byTask[tid].lastWorkedAt
    if (
      new Date((s as any).endAt || (s as any).startAt).getTime() >
      new Date(latest).getTime()
    ) {
      byTask[tid].lastWorkedAt = (s as any).endAt || (s as any).startAt
    }
  }
  const { data: tasks } = await client
    .from('tasks')
    .select('id,title')
    .eq('userId', userId)
  const byTaskArray = Object.entries(byTask)
    .map(([taskId, v]) => {
      const t = (tasks || []).find((x: any) => x.id === taskId)
      return {
        id: taskId,
        title: t?.title || '(削除済みタスク)',
        totalSeconds: v.totalSeconds,
        sessionCount: v.sessionCount,
        lastWorkedAt: v.lastWorkedAt,
      }
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
  const { data: doneRows } = await client
    .from('tasks')
    .select('id', { count: 'estimated' as any })
    .eq('userId', userId)
    .eq('status', 'done')
    .gte('updatedAt', fromISO)
    .lt('updatedAt', toISO)
  const completedCount = (doneRows as any)?.length || 0
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
    for (const s of sessions || []) {
      const sStart = Math.max(
        new Date((s as any).startAt).getTime(),
        start.getTime()
      )
      const sEnd = Math.min(
        (s as any).endAt ? new Date((s as any).endAt).getTime() : now,
        end.getTime()
      )
      if (sEnd > sStart) secSum += Math.floor((sEnd - sStart) / 1000)
    }
    days.push({ date: new Date(start).toISOString(), seconds: secSum })
  }
  return { totalSeconds, byTask: byTaskArray, completedCount, days }
}

// --- Public API selecting backend ---
export const tasksService = {
  list: async (
    params: { q?: string; status?: TaskStatus } = {},
    ctx?: TaskServiceContext
  ) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbList(params, ctx)
      : tasksRepo.list({ ...(params as any), userId })
  },
  listWithMeta: async (
    params: { q?: string; status?: TaskStatus } = {},
    ctx?: TaskServiceContext
  ) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbListWithMeta(params, ctx)
      : tasksRepo.listWithMeta({ ...(params as any), userId })
  },
  get: async (id: string, ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase() ? sbGet(id, ctx) : tasksRepo.get(id, userId)
  },
  create: async (input: CreateTaskInput, ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbCreate(input, ctx)
      : tasksRepo.create(input, userId)
  },
  update: async (
    id: string,
    patch: UpdateTaskInput,
    ctx?: TaskServiceContext
  ) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbUpdate(id, patch, ctx)
      : tasksRepo.update(id, patch, userId)
  },
  delete: async (id: string, ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbDelete(id, ctx)
      : tasksRepo.delete(id, userId)
  },
  complete: async (id: string, ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbComplete(id, ctx)
      : tasksRepo.complete(id, userId)
  },
  startWork: async (id: string, ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbStartWork(id, ctx)
      : tasksRepo.startWork(id, userId)
  },
  stopWork: async (ctx?: TaskServiceContext) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase() ? sbStopWork(ctx) : tasksRepo.stopWork(userId)
  },
  getSummary: async (
    fromISO: string,
    toISO: string,
    ctx?: TaskServiceContext
  ) => {
    const { userId } = ensureContext(ctx)
    return shouldUseSupabase()
      ? sbGetSummary(fromISO, toISO, ctx)
      : tasksRepo.getSummary(fromISO, toISO, userId)
  },
}
