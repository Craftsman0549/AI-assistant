import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { resolveApiAuth, UnauthorizedError } from '@/lib/apiAuth'
import type { UpdateTaskInput } from '@/types/task'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { id } = req.query
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const auth = await resolveApiAuth(req)

    if (req.method === 'PATCH') {
      const patch = (req.body || {}) as UpdateTaskInput
      const updated = await tasksService.update(id, patch, auth)
      res.status(200).json({ task: updated })
      return
    }

    if (req.method === 'DELETE') {
      await tasksService.delete(id, auth)
      res.status(204).end()
      return
    }

    res.setHeader('Allow', 'PATCH, DELETE')
    res.status(405).end('Method Not Allowed')
  } catch (e: any) {
    if (e instanceof UnauthorizedError) {
      res.status(401).json({ error: e.message })
      return
    }
    const msg = e?.message || 'internal error'
    const status = msg === 'not found' ? 404 : 500
    res.status(status).json({ error: msg })
  }
}
