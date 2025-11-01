/* eslint-disable prettier/prettier */
import type { Task, CreateTaskInput, UpdateTaskInput, TaskStatus, TaskPriority, TaskWithMeta } from '@/types/task'
import { tasksRepo } from '@/lib/tasksRepo'
import { createServerSupabase } from '@/lib/supabaseClient'
import type { SupabaseClient } from '@supabase/supabase-js'

const useSupabase = () => process.env.USE_SUPABASE === 'true' && !!process.env.NEXT_PUBLIC_SUPABASE_URL

// --- Supabase implementations ---
const sb = (client?: SupabaseClient | null) => client || createServerSupabase()

const sbList = async (params: { q?: string; status?: TaskStatus }, clientOverride?: SupabaseClient | null): Promise<Task[]> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.list(params as any)
  let query = client.from('tasks').select('*').order('updatedAt', { ascending: false })
  if (params.status) query = query.eq('status', params.status)
  if (params.q) query = query.or(`title.ilike.%${params.q}%,note.ilike.%${params.q}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as Task[]
}

const sbGet = async (id: string, clientOverride?: SupabaseClient | null): Promise<Task | undefined> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.get(id)
  const { data, error } = await client.from('tasks').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as Task
}

const nowISO = () => new Date().toISOString()

const sbCreate = async (input: CreateTaskInput, clientOverride?: SupabaseClient | null): Promise<Task> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.create(input)
  const row: Partial<Task> = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    note: input.note ?? null as any,
    status: 'todo',
    priority: (input.priority || 'normal') as TaskPriority,
    due: input.due ? new Date(input.due).toISOString() : null as any,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  const { data, error } = await client.from('tasks').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as Task
}

const sbUpdate = async (id: string, patch: UpdateTaskInput, clientOverride?: SupabaseClient | null): Promise<Task> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.update(id, patch)
  const upd: any = { updatedAt: nowISO() }
  if (patch.title !== undefined) upd.title = patch.title
  if (patch.note !== undefined) upd.note = patch.note
  if (patch.status !== undefined) upd.status = patch.status
  if (patch.priority !== undefined) upd.priority = patch.priority
  if (patch.due === null) upd.due = null
  if (typeof patch.due === 'string') upd.due = new Date(patch.due).toISOString()
  const { data, error } = await client.from('tasks').update(upd).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as Task
}

const sbDelete = async (id: string, clientOverride?: SupabaseClient | null): Promise<void> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.delete(id)
  const { error } = await client.from('tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

const sbComplete = async (id: string, clientOverride?: SupabaseClient | null): Promise<Task> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.complete(id)
  // stop active session first
  await sbStopWork(client)
  return await sbUpdate(id, { status: 'done' }, client)
}

const sbStartWork = async (taskId: string, clientOverride?: SupabaseClient | null) => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.startWork(taskId)
  await sbStopWork(client)
  const row = { id: crypto.randomUUID(), taskId, startAt: nowISO(), endAt: null as any }
  const { error } = await client.from('work_sessions').insert(row)
  if (error) throw new Error(error.message)
  try { await sbUpdate(taskId, { status: 'in_progress' }, client) } catch {}
  return row
}

const sbStopWork = async (clientOverride?: SupabaseClient | null) => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.stopWork()
  const { data, error } = await client.from('work_sessions').select('*').is('endAt', null).limit(1).single()
  if (error && error.code !== 'PGRST116') { // no rows found
    throw new Error(error.message)
  }
  if (!data) return undefined
  const ended = { ...data, endAt: nowISO() }
  const { error: upErr } = await client.from('work_sessions').update({ endAt: ended.endAt }).eq('id', data.id)
  if (upErr) throw new Error(upErr.message)
  return ended
}

const sbGetTaskTotalSeconds = async (taskId: string, clientOverride?: SupabaseClient | null): Promise<number> => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.getTaskTotalSeconds(taskId)
  const { data, error } = await client
    .from('work_sessions')
    .select('startAt,endAt')
    .eq('taskId', taskId)
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

const sbListWithMeta = async (params: { q?: string; status?: TaskStatus }, clientOverride?: SupabaseClient | null): Promise<TaskWithMeta[]> => {
  if (!useSupabase()) return tasksRepo.listWithMeta(params as any)
  const items = await sbList(params, clientOverride)
  // compute totals
  const totals: Record<string, number> = {}
  for (const t of items) totals[t.id] = await sbGetTaskTotalSeconds(t.id, clientOverride)
  // active session
  const client = sb(clientOverride)!
  const { data } = await client.from('work_sessions').select('taskId').is('endAt', null).limit(1)
  const activeTaskId = data && data[0]?.taskId
  return items.map((t) => ({ ...t, totalSeconds: totals[t.id] || 0, isActive: activeTaskId ? activeTaskId === t.id : false }))
}

const sbGetSummary = async (fromISO: string, toISO: string, clientOverride?: SupabaseClient | null) => {
  const client = sb(clientOverride)
  if (!client) return tasksRepo.getSummary(fromISO, toISO)
  const { data: sessions, error } = await client
    .from('work_sessions')
    .select('id,taskId,startAt,endAt')
    .lt('startAt', toISO)
    .gt('endAt', fromISO)
  if (error) throw new Error(error.message)
  const now = Date.now()
  const byTask: Record<string, { totalSeconds: number; sessionCount: number; lastWorkedAt: string }> = {}
  let totalSeconds = 0
  for (const s of sessions || []) {
    const start = Math.max(new Date((s as any).startAt).getTime(), new Date(fromISO).getTime())
    const rawEnd = (s as any).endAt ? new Date((s as any).endAt).getTime() : now
    const end = Math.min(rawEnd, new Date(toISO).getTime())
    const sec = end > start ? Math.floor((end - start) / 1000) : 0
    totalSeconds += sec
    const tid = (s as any).taskId as string
    if (!byTask[tid]) byTask[tid] = { totalSeconds: 0, sessionCount: 0, lastWorkedAt: (s as any).endAt || new Date().toISOString() }
    byTask[tid].totalSeconds += sec
    byTask[tid].sessionCount += 1
    const latest = byTask[tid].lastWorkedAt
    if (new Date((s as any).endAt || (s as any).startAt).getTime() > new Date(latest).getTime()) {
      byTask[tid].lastWorkedAt = (s as any).endAt || (s as any).startAt
    }
  }
  const { data: tasks } = await client.from('tasks').select('id,title')
  const byTaskArray = Object.entries(byTask).map(([taskId, v]) => {
    const t = (tasks || []).find((x: any) => x.id === taskId)
    return { id: taskId, title: t?.title || '(削除済みタスク)', totalSeconds: v.totalSeconds, sessionCount: v.sessionCount, lastWorkedAt: v.lastWorkedAt }
  }).sort((a, b) => b.totalSeconds - a.totalSeconds)
  const { data: doneRows } = await client
    .from('tasks')
    .select('id', { count: 'estimated' as any })
    .eq('status', 'done')
    .gte('updatedAt', fromISO)
    .lt('updatedAt', toISO)
  const completedCount = (doneRows as any)?.length || 0
  // days split
  const from = new Date(fromISO)
  const to = new Date(toISO)
  const dayStart = new Date(from); dayStart.setHours(0,0,0,0)
  const days: Array<{ date: string; seconds: number }> = []
  for (let d = new Date(dayStart); d < to; d.setDate(d.getDate() + 1)) {
    const start = new Date(d)
    const end = new Date(d); end.setDate(end.getDate() + 1)
    let secSum = 0
    for (const s of sessions || []) {
      const sStart = Math.max(new Date((s as any).startAt).getTime(), start.getTime())
      const sEnd = Math.min(((s as any).endAt ? new Date((s as any).endAt).getTime() : now), end.getTime())
      if (sEnd > sStart) secSum += Math.floor((sEnd - sStart) / 1000)
    }
    days.push({ date: new Date(start).toISOString(), seconds: secSum })
  }
  return { totalSeconds, byTask: byTaskArray, completedCount, days }
}

// --- Public API selecting backend ---
export const tasksService = {
  list: async (params: { q?: string; status?: TaskStatus } = {}, client?: SupabaseClient | null) =>
    useSupabase() ? sbList(params, client) : tasksRepo.list(params as any),
  listWithMeta: async (params: { q?: string; status?: TaskStatus } = {}, client?: SupabaseClient | null) =>
    useSupabase() ? sbListWithMeta(params, client) : tasksRepo.listWithMeta(params as any),
  get: async (id: string, client?: SupabaseClient | null) => useSupabase() ? sbGet(id, client) : tasksRepo.get(id),
  create: async (input: CreateTaskInput, client?: SupabaseClient | null) => useSupabase() ? sbCreate(input, client) : tasksRepo.create(input),
  update: async (id: string, patch: UpdateTaskInput, client?: SupabaseClient | null) => useSupabase() ? sbUpdate(id, patch, client) : tasksRepo.update(id, patch),
  delete: async (id: string, client?: SupabaseClient | null) => useSupabase() ? sbDelete(id, client) : tasksRepo.delete(id),
  complete: async (id: string, client?: SupabaseClient | null) => useSupabase() ? sbComplete(id, client) : tasksRepo.complete(id),
  startWork: async (id: string, client?: SupabaseClient | null) => useSupabase() ? sbStartWork(id, client) : tasksRepo.startWork(id),
  stopWork: async (client?: SupabaseClient | null) => useSupabase() ? sbStopWork(client) : tasksRepo.stopWork(),
  getSummary: async (fromISO: string, toISO: string, client?: SupabaseClient | null) => useSupabase() ? sbGetSummary(fromISO, toISO, client) : tasksRepo.getSummary(fromISO, toISO),
}
