import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// fetch che allega automaticamente il token della sessione corrente
// nell'header Authorization — le API route lo verificano per sapere
// chi sta chiamando (vedi app/lib/supabase-server.ts)
export async function authedFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(url, { ...options, headers })
}

export type UserRole = 'admin' | 'trader'
export interface Profile {
  id: string; email: string; full_name: string
  role: UserRole; created_at: string; created_by?: string
}
