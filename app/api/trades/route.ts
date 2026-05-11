import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// GET — carica trade per utente (tutti i conti o uno specifico)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const account = searchParams.get('account')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const sb = admin()
  let q = sb.from('trades').select('*').eq('user_id', userId).order('entry_time', { ascending: false })
  if (account) q = q.eq('account', account)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ trades: data || [] })
}

// POST — salva trade (upsert per evitare duplicati)
export async function POST(req: NextRequest) {
  const { trades, userId, account, source } = await req.json()
  if (!userId || !trades?.length) return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  const sb = admin()
  const rows = trades.map((t: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...rest } = t  // Rimuovi id non-UUID — Supabase lo genera
    return {
      ...rest,
      user_id: userId,
      source: source || 'csv',
      imported_at: new Date().toISOString(),
    }
  })
  const { error, count } = await sb.from('trades').upsert(rows, {
    onConflict: 'ninja_id,user_id',
    ignoreDuplicates: false
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Aggiorna last_sync per questo conto
  await sb.from('account_syncs').upsert({
    user_id: userId, account, source: source || 'csv',
    last_sync: new Date().toISOString(),
    trade_count: trades.length
  }, { onConflict: 'user_id,account' })
  return NextResponse.json({ success: true, count: trades.length })
}
