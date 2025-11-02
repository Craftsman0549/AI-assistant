/* eslint-disable prettier/prettier */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserSupabase } from '@/lib/supabaseClient'

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const sb = createBrowserSupabase()

  const refreshUser = async () => {
    try {
      if (!sb) return
      const { data } = await sb.auth.getUser()
      setUserId(data.user?.id ?? null)
    } catch (e: any) {
      // ignore
    }
  }

  useEffect(() => {
    refreshUser()
    if (!sb) return
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      refreshUser()
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (!sb) throw new Error('Supabase client not configured')
      const { error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      setMessage('ログインしました。')
      setPassword('')
      await refreshUser()
    } catch (e: any) {
      setError(e?.message || 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const onSendMagicLink = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (!sb) throw new Error('Supabase client not configured')
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setMessage('マジックリンクを送信しました。メールを確認してください。')
    } catch (e: any) {
      setError(e?.message || '送信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const onLogout = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (!sb) throw new Error('Supabase client not configured')
      const { error } = await sb.auth.signOut()
      if (error) throw error
      setMessage('ログアウトしました。')
      await refreshUser()
    } catch (e: any) {
      setError(e?.message || 'ログアウトに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
        <h1 className="text-xl font-semibold mb-4">ログイン</h1>
        {userId ? (
          <div className="mb-4 text-sm text-gray-700">
            現在のユーザーID:{' '}
            <span className="font-mono break-all">{userId}</span>
          </div>
        ) : (
          <div className="mb-4 text-sm text-gray-700">未ログイン</div>
        )}

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
        {message && (
          <div className="mb-3 text-sm text-green-600">{message}</div>
        )}

        <form onSubmit={onPasswordLogin} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              className="w-full rounded border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">
              パスワード
            </label>
            <input
              type="password"
              className="w-full rounded border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded py-2 hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            パスワードでログイン
          </button>
        </form>

        <div className="mt-3">
          <button
            className="w-full rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            onClick={onSendMagicLink}
            disabled={loading || !email.trim()}
          >
            マジックリンクを送信
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ホームに戻る
          </Link>
          <button
            className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            onClick={onLogout}
            disabled={loading || !userId}
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
