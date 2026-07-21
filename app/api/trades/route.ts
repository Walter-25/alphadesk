import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../lib/supabase-server'

// GET — carica trade per utente (tutti i conti o uno specifico)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const account = searchParams.get('account')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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

// PATCH — aggiorna un singolo trade (note, tag emotivi, disciplina, strategia, ecc.)
// Usa ninja_id come chiave stabile: l'id numerico del frontend NON coincide con
// l'id UUID generato da Supabase all'insert, quindi un update per id fallirebbe in silenzio.
export async function PATCH(req: NextRequest) {
  const { userId, ninjaId, tradeId, updates } = await req.json()
  if (!userId || !updates) return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  // Non permettere di modificare campi identità/chiave
  const { id: _id, user_id: _uid, ninja_id: _nid, ...safe } = updates
  let q = sb.from('trades').update(safe).eq('user_id', userId)
  // Preferisci ninja_id (stabile); fallback su id UUID reale se fornito
  if (ninjaId) q = q.eq('ninja_id', ninjaId)
  else if (tradeId) q = q.eq('id', tradeId)
  else return NextResponse.json({ error: 'ninjaId o tradeId richiesto' }, { status: 400 })
  const { data, error } = await q.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, updated: data?.length || 0 })
}
