/* eslint-disable prettier/prettier */
import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { createServerSupabaseWithToken } from '@/lib/supabaseClient'

function startOfTodayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeekISO(weekStart: 'mon'|'sun') {
  const d = new Date()
  const day = d.getDay() // 0: Sun ... 6: Sat
  const diff = weekStart === 'sun' ? 0 : (day + 6) % 7
  // set to start of week
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d.toISOString()
}

function startOfMonthISO() {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear(), d.getUTCMonth(), 1)
  // keep local 0:00 to align with other calcs
  const dl = new Date()
  dl.setFullYear(d.getFullYear(), d.getMonth(), 1)
  dl.setHours(0, 0, 0, 0)
  return dl.toISOString()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      res.status(405).end('Method Not Allowed')
      return
    }
    const range = (req.query.range as string) || 'today'
    const weekStartParam = (req.query.weekStart as string) === 'sun' ? 'sun' : 'mon'
    const to = new Date()
    const toISO = to.toISOString()
    let fromISO: string
    if (range === 'week') fromISO = startOfWeekISO(weekStartParam)
    else if (range === 'month') fromISO = startOfMonthISO()
    else fromISO = startOfTodayISO()

    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const sb = createServerSupabaseWithToken(token)
    const summary = await tasksService.getSummary(fromISO, toISO, sb)
    res.status(200).json({ range, from: fromISO, to: toISO, ...summary })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal error' })
  }
}
