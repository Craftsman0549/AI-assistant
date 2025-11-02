/* eslint-disable prettier/prettier */
import type { NextApiRequest } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseWithToken } from '@/lib/supabaseClient'
import { DEFAULT_LOCAL_USER_ID } from '@/lib/tasksRepo'

export class UnauthorizedError extends Error {
  status = 401

  constructor(message = 'unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export interface ApiAuthContext {
  userId: string
  client?: SupabaseClient | null
}

const normalizeHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

export const resolveApiAuth = async (req: NextApiRequest): Promise<ApiAuthContext> => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const supabase = createServerSupabaseWithToken(token)
  if (supabase) {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      throw new UnauthorizedError(error?.message || 'unauthorized')
    }
    return { userId: data.user.id, client: supabase }
  }

  const fallback = normalizeHeaderValue(req.headers['x-user-id'])?.trim()
  if (fallback) {
    return { userId: fallback, client: null }
  }

  return { userId: DEFAULT_LOCAL_USER_ID, client: null }
}
