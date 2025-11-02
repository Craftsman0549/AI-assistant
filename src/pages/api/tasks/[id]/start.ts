import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { resolveApiAuth, UnauthorizedError } from '@/lib/apiAuth'

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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      res.status(405).end('Method Not Allowed')
      return
    }
    const auth = await resolveApiAuth(req)
    const session = await tasksService.startWork(id, auth)
    res.status(200).json({ session })
  } catch (e: any) {
    if (e instanceof UnauthorizedError) {
      res.status(401).json({ error: e.message })
      return
    }
    res.status(500).json({ error: e?.message || 'internal error' })
  }
}
