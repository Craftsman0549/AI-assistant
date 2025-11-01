import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksService } from '@/lib/tasksService'
import { createServerSupabaseWithToken } from '@/lib/supabaseClient'
import type { CreateTaskInput, TaskWithMeta, Task } from '@/types/task'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const sb = createServerSupabaseWithToken(token)
    if (req.method === 'GET') {
      const { status, q } = req.query
      const data = await tasksService.listWithMeta({
        status: typeof status === 'string' ? (status as any) : undefined,
        q: typeof q === 'string' ? q : undefined,
      }, sb)
      res.status(200).json({ tasks: data as TaskWithMeta[] })
      return
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as CreateTaskInput
      if (!body || typeof body.title !== 'string' || !body.title.trim()) {
        res.status(400).json({ error: 'title is required' })
        return
      }
      const created: Task = await tasksService.create({
        title: body.title,
        note: body.note,
        due: body.due,
        priority: body.priority,
      }, sb)
      res.status(201).json({ task: created })
      return
    }

    res.setHeader('Allow', 'GET, POST')
    res.status(405).end('Method Not Allowed')
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal error' })
  }
}
