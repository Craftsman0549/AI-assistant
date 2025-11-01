/* eslint-disable prettier/prettier */
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const createBrowserSupabase = (): SupabaseClient | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    return createClient(url, anon)
  } catch {
    return null
  }
}

export const createServerSupabase = (): SupabaseClient | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !service) return null
  try {
    return createClient(url, service)
  } catch {
    return null
  }
}

export const createServerSupabaseWithToken = (token?: string): SupabaseClient | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon || !token) return null
  try {
    return createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  } catch {
    return null
  }
}
