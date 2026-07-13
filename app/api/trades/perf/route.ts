import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../../lib/supabase-server'

// Salva/carica performance report aggregati
export async function POST(req: NextRequest) {
  const { userId, account, stats, source } = await req.json()
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  const { error } = await sb.from('perf_reports').upsert({
    user_id: userId, account, stats, source,
    imported_at: new Date().toISOString()
  }, { onConflict: 'user_id,account' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  const { data, error } = await sb.from('perf_reports').select('*').eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ reports: data || [] })
}
