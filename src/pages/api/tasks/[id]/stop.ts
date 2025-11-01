import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { createServerSupabaseWithToken } from '@/lib/supabaseClient'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      res.status(405).end('Method Not Allowed')
      return
    }
    // 現在は単一アクティブのみのためidは参照のみ
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const sb = createServerSupabaseWithToken(token)
    const ended = await tasksService.stopWork(sb)
    res.status(200).json({ session: ended })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal error' })
  }
}
