import type { NextApiRequest, NextApiResponse } from 'next'
import { tasksRepo } from '@/lib/tasksRepo'
import type { CreateTaskInput, TaskWithMeta, Task } from '@/types/task'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { status, q } = req.query
      const data = tasksRepo.listWithMeta({
        status: typeof status === 'string' ? (status as any) : undefined,
        q: typeof q === 'string' ? q : undefined,
      })
      res.status(200).json({ tasks: data as TaskWithMeta[] })
      return
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as CreateTaskInput
      if (!body || typeof body.title !== 'string' || !body.title.trim()) {
        res.status(400).json({ error: 'title is required' })
        return
      }
      const created: Task = tasksRepo.create({
        title: body.title,
        note: body.note,
        due: body.due,
        priority: body.priority,
      })
      res.status(201).json({ task: created })
      return
    }

    res.setHeader('Allow', 'GET, POST')
    res.status(405).end('Method Not Allowed')
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal error' })
  }
}
