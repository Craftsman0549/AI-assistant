import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  TaskWithMeta as Task,
  TaskPriority,
  TaskStatus,
} from '@/types/task'
import settingsStore from '@/features/stores/settings'
import { speakMessageHandler } from '@/features/chat/handlers'
import TaskEditModal from '@/components/taskEditModal'

type CreateForm = {
  title: string
  note: string
  due: string
  priority: TaskPriority
}

const defaultForm: CreateForm = {
  title: '',
  note: '',
  due: '',
  priority: 'normal',
}

export const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm>(defaultForm)
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [editTask, setEditTask] = useState<Task | null>(null)
  const clientId = settingsStore((s) => s.clientId)
  const messageReceiverEnabled = settingsStore((s) => s.messageReceiverEnabled)
  const nudgeTimerRef = useRef<number | null>(null)
  const NUDGE_MINUTES = 15

  const filtered = useMemo(() => tasks, [tasks])

  const fetchTasks = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/tasks?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '取得に失敗しました')
      setTasks(data.tasks as Task[])
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    const timer = setInterval(fetchTasks, 10000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          note: form.note.trim() || undefined,
          due: form.due ? new Date(form.due).toISOString() : undefined,
          priority: form.priority,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '作成に失敗しました')
      setForm(defaultForm)
      await fetchTasks()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const onComplete = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/complete`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error || '更新に失敗しました')
      }
      // 作業停止メッセージ（完了）
      const t = tasks.find((x) => x.id === id)
      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current)
        nudgeTimerRef.current = null
      }
      if (t && clientId) {
        await sendDirectMessage(
          `作業「${t.title}」を完了しました。累計作業時間は${formatSeconds(t.totalSeconds)}です。お疲れさまでした！`
        )
      }
      await fetchTasks()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    }
  }

  const onStart = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/start`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error || '開始に失敗しました')
      }
      const t = tasks.find((x) => x.id === id)
      if (clientId && t) {
        await sendDirectMessage(
          `作業「${t.title}」を開始しました。${NUDGE_MINUTES}分ごとに進捗を確認します。がんばりましょう。`
        )
      }
      // 既存タイマーをクリアしてから再設定
      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current)
        nudgeTimerRef.current = null
      }
      if (clientId) {
        nudgeTimerRef.current = window.setInterval(
          () => {
            // アクティブタスクに対して声かけ
            const active = tasks.find((x) => x.isActive)
            const title = active?.title || '作業'
            sendDirectMessage(
              `進捗はいかがですか？「${title}」の作業を継続中です。必要なら、少し休憩しましょう。`
            )
          },
          NUDGE_MINUTES * 60 * 1000
        ) as unknown as number
      }
      await fetchTasks()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    }
  }

  const onStop = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/stop`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error || '停止に失敗しました')
      }
      const t = tasks.find((x) => x.id === id)
      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current)
        nudgeTimerRef.current = null
      }
      if (t && clientId) {
        await sendDirectMessage(
          `作業「${t.title}」を一旦停止しました。現在の累計は約${formatSeconds(
            t.totalSeconds
          )}です。再開するときは「作業開始」を押してください。`
        )
      }
      await fetchTasks()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    }
  }

  const formatSeconds = (sec?: number) => {
    if (!sec || sec <= 0) return '0m'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return h > 0 ? `${h}h${m}m` : `${m}m`
  }

  const sendDirectMessage = async (text: string) => {
    // MessageReceiver経由で喋る（有効時）
    if (clientId && messageReceiverEnabled) {
      try {
        await fetch(
          `/api/messages?clientId=${encodeURIComponent(clientId)}&type=direct_send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [text] }),
          }
        )
        return
      } catch (e) {
        // フォールバックへ
      }
    }
    // フォールバック: 直接TTSで発話
    try {
      await speakMessageHandler(text)
    } catch (e) {
      // noop
    }
  }

  

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const data = await res.json()
        throw new Error(data?.error || '削除に失敗しました')
      }
      await fetchTasks()
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    }
  }

  return (
    <div className="fixed right-6 bottom-32 md:bottom-28 z-[55] w-[420px] max-w-[90vw] bg-white/80 backdrop-blur rounded-lg shadow-lg border border-gray-200 p-4 text-gray-800">
      <h2 className="font-semibold text-lg mb-2">タスク</h2>
      <form onSubmit={onCreate} className="space-y-2 mb-3">
        <input
          className="w-full rounded border px-2 py-1"
          placeholder="タイトル（必須）"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <textarea
          className="w-full rounded border px-2 py-1"
          placeholder="備考"
          rows={2}
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
        <div className="flex gap-2">
          <input
            type="datetime-local"
            className="flex-1 rounded border px-2 py-1"
            value={form.due}
            onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
          />
          <select
            className="w-28 rounded border px-2 py-1"
            value={form.priority}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                priority: e.target.value as TaskPriority,
              }))
            }
          >
            <option value="low">低</option>
            <option value="normal">普通</option>
            <option value="high">高</option>
            <option value="urgent">至急</option>
          </select>
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded py-1 hover:bg-blue-700 disabled:opacity-50"
          disabled={loading || !form.title.trim()}
        >
          追加
        </button>
      </form>

      <div className="flex gap-2 items-center mb-2">
        <select
          className="rounded border px-2 py-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
        >
          <option value="all">すべて</option>
          <option value="todo">未着手</option>
          <option value="in_progress">進行中</option>
          <option value="done">完了</option>
          <option value="canceled">中止</option>
        </select>
        <input
          className="flex-1 rounded border px-2 py-1"
          placeholder="検索（タイトル/備考）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded border px-3 py-1 hover:bg-gray-100"
          onClick={() => fetchTasks()}
        >
          更新
        </button>
      </div>

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      {loading ? (
        <div className="text-sm text-gray-600">読み込み中...</div>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-auto">
          {filtered.map((t) => (
            <li key={t.id} className="rounded border px-2 py-1 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      t.priority === 'urgent'
                        ? 'bg-red-600'
                        : t.priority === 'high'
                          ? 'bg-orange-500'
                          : t.priority === 'low'
                            ? 'bg-gray-400'
                            : 'bg-blue-500'
                    }`}
                  />
                  <span
                    className={`font-medium ${
                      t.status === 'done' ? 'line-through text-gray-400' : ''
                    }`}
                  >
                    {t.title}
                  </span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-[11px] text-gray-500">
                    累計: {formatSeconds(t.totalSeconds)}
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                    onClick={() => setEditTask(t)}
                  >
                    編集
                  </button>
                  {t.isActive ? (
                    <button
                      className="text-xs px-2 py-1 rounded bg-yellow-600 text-white hover:bg-yellow-700"
                      onClick={() => onStop(t.id)}
                      >
                      停止
                    </button>
                  ) : (
                    <button
                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                      onClick={() => onStart(t.id)}
                    >
                      作業開始
                    </button>
                  )}
                  {t.status !== 'done' && (
                    <button
                      className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                      onClick={() => onComplete(t.id)}
                    >
                      完了
                    </button>
                  )}
                  <button
                    className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                    onClick={() => onDelete(t.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
              {(t.note || t.due) && (
                <div className="text-xs text-gray-600 mt-1">
                  {t.note && <div>{t.note}</div>}
                  {t.due && <div>期限: {new Date(t.due).toLocaleString()}</div>}
                </div>
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-sm text-gray-600">タスクはありません</li>
          )}
        </ul>
      )}
      <TaskEditModal
        open={!!editTask}
        task={editTask}
        onClose={() => setEditTask(null)}
        onSaved={async () => {
          await fetchTasks()
        }}
      />
    </div>
  )
}

export default TaskPanel
