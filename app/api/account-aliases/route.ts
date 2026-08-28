import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../lib/supabase-server'

// GET /api/account-aliases?userId=<uuid>
// Ritorna la mappa conto tecnico -> etichetta scelta dall'utente.
// Response: { aliases: { account: string; display_name: string }[] }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const sb = admin()
  const { data, error } = await sb
    .from('account_aliases')
    .select('account, display_name')
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ aliases: data ?? [] })
}

// POST/PUT /api/account-aliases
// Body: { userId: string; account: string; displayName: string }
// Upsert dell'etichetta per il conto tecnico indicato. Non tocca mai la
// colonna `account` dei trade ne' il ninja_id: solo l'etichetta di display.
async function upsertAlias(req: NextRequest) {
  let body: { userId?: string; account?: string; displayName?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON non valido' }, { status: 400 }) }

  const { userId, account, displayName } = body
  if (!userId || !account?.trim() || !displayName?.trim()) {
    return NextResponse.json({ error: 'userId, account e displayName sono obbligatori' }, { status: 400 })
  }
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const sb = admin()
  const { error } = await sb
    .from('account_aliases')
    .upsert({
      user_id: userId,
      account: account.trim(),
      display_name: displayName.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,account' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) { return upsertAlias(req) }
export async function PUT(req: NextRequest) { return upsertAlias(req) }

// DELETE /api/account-aliases
// Body: { userId: string; account: string }
// Rimuove l'etichetta: il conto torna a mostrare il nome tecnico.
export async function DELETE(req: NextRequest) {
  let body: { userId?: string; account?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON non valido' }, { status: 400 }) }

  const { userId, account } = body
  if (!userId || !account?.trim()) return NextResponse.json({ error: 'userId e account sono obbligatori' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const sb = admin()
  const { error } = await sb
    .from('account_aliases')
    .delete()
    .eq('user_id', userId)
    .eq('account', account.trim())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
