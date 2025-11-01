/* eslint-disable prettier/prettier */
import React, { useEffect, useMemo, useState } from 'react'
import settingsStore from '@/features/stores/settings'

type RangeKey = 'today' | 'week' | 'month'

type SummaryItem = {
  id: string
  title: string
  totalSeconds: number
  sessionCount: number
  lastWorkedAt: string
}

type Summary = {
  range: RangeKey
  from: string
  to: string
  totalSeconds: number
  byTask: SummaryItem[]
  completedCount: number
  days?: { date: string; seconds: number }[]
}

const formatSeconds = (sec: number) => {
  if (!sec || sec <= 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

const toCSV = (s: Summary) => {
  const lines = [
    ['range', s.range],
    ['from', s.from],
    ['to', s.to],
    ['totalSeconds', String(s.totalSeconds)],
    ['completedCount', String(s.completedCount)],
    [],
    ['taskId', 'title', 'totalSeconds', 'sessionCount', 'lastWorkedAt'],
    ...s.byTask.map((t) => [t.id, t.title, String(t.totalSeconds), String(t.sessionCount), t.lastWorkedAt]),
  ]
  return lines
    .map((row) =>
      row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
    )
    .join('\n')
}

const ReviewModal = ({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) => {
  const [range, setRange] = useState<RangeKey>('today')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [weekStart, setWeekStart] = useState<'mon'|'sun'>('mon')
  const [aiText, setAiText] = useState<string>('')

  const fetchSummary = async (r: RangeKey) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('range', r)
      if (r === 'week') params.set('weekStart', weekStart)
      const res = await fetch(`/api/tasks/summary?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '取得に失敗しました')
      setSummary(data as Summary)
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    fetchSummary(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, range, weekStart])

  const csvHref = useMemo(() => {
    if (!summary) return ''
    const csv = toCSV(summary)
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
  }, [summary])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[720px] max-w-[96vw] bg-white rounded-lg shadow-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">振り返り</h2>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1 rounded border ${range === 'today' ? 'bg-gray-100' : ''}`}
              onClick={() => setRange('today')}
            >
              今日
            </button>
            <button
              className={`px-3 py-1 rounded border ${range === 'week' ? 'bg-gray-100' : ''}`}
              onClick={() => setRange('week')}
            >
              今週
            </button>
            <button
              className={`px-3 py-1 rounded border ${range === 'month' ? 'bg-gray-100' : ''}`}
              onClick={() => setRange('month')}
            >
              今月
            </button>
          </div>
        </div>

        {range === 'week' && (
          <div className="mb-2 text-sm flex items-center gap-2">
            <span className="text-gray-600">週の開始:</span>
            <button
              className={`px-2 py-0.5 rounded border ${weekStart === 'mon' ? 'bg-gray-100' : ''}`}
              onClick={() => setWeekStart('mon')}
            >
              月曜
            </button>
            <button
              className={`px-2 py-0.5 rounded border ${weekStart === 'sun' ? 'bg-gray-100' : ''}`}
              onClick={() => setWeekStart('sun')}
            >
              日曜
            </button>
          </div>
        )}

        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        {loading ? (
          <div className="text-sm text-gray-600">読み込み中...</div>
        ) : summary ? (
          <>
            <div className="mb-3">
              <div className="text-sm text-gray-600">
                期間: {new Date(summary.from).toLocaleString()} 〜{' '}
                {new Date(summary.to).toLocaleString()}
              </div>
              <div className="text-xl font-semibold">合計: {formatSeconds(summary.totalSeconds)}（完了 {summary.completedCount}件）</div>
            </div>
            {/* スパークライン（簡易棒グラフ） */}
            {summary.days && summary.days.length > 0 && (
              <div className="mb-3">
                <div className="text-sm text-gray-600 mb-1">日別推移</div>
                <div className="flex items-end gap-1 h-24 border rounded p-2">
                  {(() => {
                    const max = Math.max(...summary.days!.map((d) => d.seconds), 1)
                    return summary.days!.map((d) => (
                      <div key={d.date} className="bg-blue-500/70 w-2" style={{ height: `${Math.max(4, Math.round((d.seconds / max) * 88))}px` }} title={`${new Date(d.date).toLocaleDateString()} : ${formatSeconds(d.seconds)}`} />
                    ))
                  })()}
                </div>
              </div>
            )}

            <div className="max-h-72 overflow-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1 w-2/5">タスク</th>
                    <th className="text-right px-2 py-1">時間</th>
                    <th className="text-right px-2 py-1">回数</th>
                    <th className="text-left px-2 py-1">最終作業</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byTask.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="px-2 py-1 truncate" title={t.title}>{t.title}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{formatSeconds(t.totalSeconds)}</td>
                      <td className="px-2 py-1 text-right">{t.sessionCount}</td>
                      <td className="px-2 py-1">{new Date(t.lastWorkedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {summary.byTask.length === 0 && (
                    <tr>
                      <td className="px-2 py-4 text-center text-gray-600" colSpan={4}>記録がありません</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between mt-3">
              <a href={csvHref} download={`summary-${summary.range}.csv`} className="px-3 py-1 rounded border">CSVエクスポート</a>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1 rounded border"
                  onClick={async () => {
                    if (!summary) return
                    const ss = settingsStore.getState()
                    const system = `あなたは作業ログの要約アシスタントです。与えられた期間とタスク別の作業時間から、端的で分かりやすい日本語のダイジェスト（3〜6行）を作成してください。重複や冗長表現は避け、進捗のハイライト・課題・次の一歩を簡潔に含めてください。`;
                    const user = {
                      period: { from: summary.from, to: summary.to, range: summary.range },
                      totalSeconds: summary.totalSeconds,
                      completedCount: summary.completedCount,
                      byTask: summary.byTask,
                    }
                    const body = {
                      messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: JSON.stringify(user) },
                      ],
                      stream: false,
                      aiService: ss.selectAIService,
                      model: ss.selectAIModel,
                      localLlmUrl: ss.localLlmUrl,
                      azureEndpoint: ss.azureEndpoint,
                      temperature: ss.temperature ?? 1.0,
                      maxTokens: ss.maxTokens ?? 4096,
                    }
                    setAiText('')
                    const res = await fetch('/api/ai/vercel', { method: 'POST', body: JSON.stringify(body) })
                    const data = await res.json()
                    if (res.ok && data?.text) setAiText(data.text)
                    else setAiText(data?.error || '要約の生成に失敗しました')
                  }}
                >AI要約</button>
                <button className="px-3 py-1 rounded border" onClick={onClose}>閉じる</button>
              </div>
            </div>
            {aiText && (
              <div className="mt-3 p-3 border rounded bg-gray-50 whitespace-pre-wrap text-sm">{aiText}</div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default ReviewModal
