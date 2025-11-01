import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { createServerSupabaseWithToken } from '@/lib/supabaseClient'
import type { UpdateTaskInput } from '@/types/task'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const sb = createServerSupabaseWithToken(token)

    if (req.method === 'PATCH') {
      const patch = (req.body || {}) as UpdateTaskInput
      const updated = await tasksService.update(id, patch, sb)
      res.status(200).json({ task: updated })
      return
    }

    if (req.method === 'DELETE') {
      await tasksService.delete(id, sb)
      res.status(204).end()
      return
    }

    res.setHeader('Allow', 'PATCH, DELETE')
    res.status(405).end('Method Not Allowed')
  } catch (e: any) {
    const msg = e?.message || 'internal error'
    const status = msg === 'not found' ? 404 : 500
    res.status(status).json({ error: msg })
  }
}
