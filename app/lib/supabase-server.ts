import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export interface AuthedUser { id: string; email: string; role: 'admin' | 'trader' }

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Verifica il token Bearer allegato dalla request (vedi authedFetch in app/lib/supabase.ts)
// e ritorna l'utente autenticato con il relativo ruolo da `profiles`.
export async function getAuthedUser(req: NextRequest): Promise<AuthedUser | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null

  const sb = adminClient()
  const { data: userData, error: userError } = await sb.auth.getUser(token)
  if (userError || !userData?.user) return null

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  if (!profile) return null

  return { id: userData.user.id, email: userData.user.email || '', role: profile.role }
}

// Un utente può accedere alla risorsa se è admin oppure se la risorsa è sua (stesso userId).
export function canAccess(authedUser: AuthedUser | null, targetUserId: string | null): boolean {
  if (!authedUser || !targetUserId) return false
  return authedUser.role === 'admin' || authedUser.id === targetUserId
}
