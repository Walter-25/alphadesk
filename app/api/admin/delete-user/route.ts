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
  // Eliminazione completa: tutti i dati dell'utente, come dichiarato nell'informativa privacy.
  // Nessuna tabella ha ON DELETE CASCADE, quindi va fatto esplicitamente qui.
  await sb.from('trades').delete().eq('user_id', userId)
  await sb.from('api_keys').delete().eq('user_id', userId)
  await sb.from('perf_reports').delete().eq('user_id', userId)
  await sb.from('account_syncs').delete().eq('user_id', userId)
  await sb.from('commission_settings').delete().eq('user_id', userId)
  // Screenshot nello storage (cartella per-utente nel bucket trade-screenshots)
  try {
    const { data: files } = await sb.storage.from('trade-screenshots').list(userId, { limit: 1000 })
    if (files && files.length > 0) {
      await sb.storage.from('trade-screenshots').remove(files.map(f => `${userId}/${f.name}`))
    }
  } catch {}
  await sb.from('profiles').delete().eq('id', userId)
  await sb.auth.admin.deleteUser(userId)
  return NextResponse.json({ success: true })
}
