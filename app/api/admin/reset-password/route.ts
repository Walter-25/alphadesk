import { NextRequest, NextResponse } from 'next/server'
import { adminClient, getAuthedUser } from '../../../lib/supabase-server'
export async function POST(req: NextRequest) {
  const authedUser = await getAuthedUser(req)
  if (!authedUser || authedUser.role !== 'admin') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const sb = adminClient()
  const redirectTo = new URL('/set-password', req.nextUrl.origin).toString()
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
