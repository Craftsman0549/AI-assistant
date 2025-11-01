import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksRepo } from '@/lib/tasksRepo'
import type { UpdateTaskInput } from '@/types/task'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'invalid id' })
      return
    }

    if (req.method === 'PATCH') {
      const patch = (req.body || {}) as UpdateTaskInput
      const updated = tasksRepo.update(id, patch)
      res.status(200).json({ task: updated })
      return
    }

    if (req.method === 'DELETE') {
      tasksRepo.delete(id)
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
