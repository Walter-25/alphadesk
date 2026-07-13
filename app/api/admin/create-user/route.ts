import { NextRequest, NextResponse } from 'next/server'
import { adminClient, getAuthedUser } from '../../../lib/supabase-server'
export async function POST(req: NextRequest) {
  const authedUser = await getAuthedUser(req)
  if (!authedUser || authedUser.role !== 'admin') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { email, full_name, role } = await req.json()
  const sb = adminClient()
  const redirectTo = new URL('/set-password', req.nextUrl.origin).toString()
  const { data: authData, error: authError } = await sb.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name, role },
  })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })
  const { error: profileError } = await sb.from('profiles').insert({ id: authData.user.id, email, full_name, role })
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
