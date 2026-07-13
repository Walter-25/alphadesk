import { NextRequest, NextResponse } from 'next/server'
import { adminClient, getAuthedUser } from '../../../lib/supabase-server'
export async function POST(req: NextRequest) {
  const authedUser = await getAuthedUser(req)
  if (!authedUser || authedUser.role !== 'admin') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { userId } = await req.json()
  if (userId === authedUser.id) {
    return NextResponse.json({ error: 'Non puoi eliminare il tuo stesso account' }, { status: 400 })
  }
  const sb = adminClient()
  await sb.from('profiles').delete().eq('id', userId)
  await sb.auth.admin.deleteUser(userId)
  return NextResponse.json({ success: true })
}
