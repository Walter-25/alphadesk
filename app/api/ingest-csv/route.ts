import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin } from '../../lib/supabase-server'
import { parseNinjaTradeList } from '../../lib/csvParsers'

const MAX_CSV_BYTES = 1024 * 1024 // 1MB

// POST — import CSV via API key (AlphaDesk Watcher)
export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  const { apiKey, account, csv, source } = body

  if (!apiKey || !account || !csv) {
    return NextResponse.json({ error: 'apiKey, account e csv sono obbligatori' }, { status: 400 })
  }
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'csv troppo grande (max 1MB)' }, { status: 400 })
  }

  const sb = admin()
  const { data: keyData } = await sb
    .from('api_keys')
    .select('user_id')
    .eq('key', apiKey)
    .single()

  if (!keyData) {
    return NextResponse.json({ error: 'API key non valida' }, { status: 401 })
  }
  const userId = keyData.user_id

  const parsed = parseNinjaTradeList(csv, account)
  if (!parsed.length) {
    return NextResponse.json({ imported: 0, skipped: 0, parsed: 0 })
  }

  const { data: existingRows } = await sb
    .from('trades')
    .select('ninja_id')
    .eq('user_id', userId)
    .eq('account', account)

  const existingIds = new Set((existingRows || []).map(r => r.ninja_id))

  const toInsert = parsed.filter(t => !existingIds.has(t.ninja_id))
  const skipped = parsed.length - toInsert.length

  let imported = 0
  if (toInsert.length) {
    const rows = toInsert.map((t: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = t // Rimuovi id non-UUID — Supabase lo genera
      return {
        ...rest,
        user_id: userId,
        source: source || 'csv',
        imported_at: new Date().toISOString(),
      }
    })
    const { error } = await sb.from('trades').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    imported = rows.length

    await sb.from('account_syncs').upsert({
      user_id: userId, account, source: source || 'csv',
      last_sync: new Date().toISOString(),
      trade_count: rows.length
    }, { onConflict: 'user_id,account' })
  }

  return NextResponse.json({ imported, skipped, parsed: parsed.length })
}
