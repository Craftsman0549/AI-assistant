import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksRepo } from '@/lib/tasksRepo'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const updated = tasksRepo.complete(id)
    res.status(200).json({ task: updated })
  } catch (e: any) {
    const msg = e?.message || 'internal error'
    const status = msg === 'not found' ? 404 : 500
    res.status(status).json({ error: msg })
  }
}
