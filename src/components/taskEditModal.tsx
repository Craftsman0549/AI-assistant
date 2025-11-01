import React, { useEffect, useState } from 'react'
import type { TaskWithMeta as Task, TaskPriority } from '@/types/task'

type Props = {
  open: boolean
  task: Task | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}

const TaskEditModal: React.FC<Props> = ({ open, task, onClose, onSaved }) => {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !task) return
    setTitle(task.title || '')
    setNote(task.note || '')
    setPriority(task.priority || 'normal')
    // 初期値はローカル入力用にdatetime-local形式へ
    setDue(task.due ? new Date(task.due).toISOString().slice(0, 16) : '')
    setError(null)
  }, [open, task])

  if (!open || !task) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError(null)
    try {
      const body: any = {
        title: title.trim(),
        note: note.trim(),
        priority,
      }
      if (due === '') body.due = null
      else body.due = new Date(due).toISOString()

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error || '更新に失敗しました')
      }
      await onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const clearDue = () => setDue('')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[520px] max-w-[92vw] bg-white rounded-lg shadow-xl p-5">
        <h2 className="font-semibold text-lg mb-3">タスクを編集</h2>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">タイトル</label>
            <input
              className="w-full rounded border px-2 py-1"
              placeholder="タイトル（必須）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">備考</label>
            <textarea
              className="w-full rounded border px-2 py-1"
              placeholder="備考（任意）"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-700 mb-1">期限</label>
              <input
                type="datetime-local"
                className="w-full rounded border px-2 py-1"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="h-9 px-2 rounded border text-sm"
              onClick={clearDue}
            >
              期限をクリア
            </button>
            <div>
              <label className="block text-sm text-gray-700 mb-1">優先度</label>
              <select
                className="w-28 rounded border px-2 py-1"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
                <option value="urgent">至急</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="px-3 py-1 rounded border" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="submit"
              className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading || !title.trim()}
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TaskEditModal
