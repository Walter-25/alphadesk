import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../../lib/supabase-server'

// POST /api/commission-settings/recalculate
// Body: { userId: string }
// Le commissioni salvate in commission_settings si applicano solo ai trade
// importati DOPO il salvataggio (fallback in /api/ingest). Questa route ricalcola
// retroattivamente commission e net_pnl dei trade già presenti con commission = 0,
// usando le tariffe attuali — senza dover reimportare. I trade con una commissione
// gia' valorizzata dal broker (commission != 0) non vengono mai toccati.
export async function POST(req: NextRequest) {
  let body: { userId?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON non valido' }, { status: 400 }) }

  const { userId } = body
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const sb = admin()

  const { data: settings, error: settingsError } = await sb
    .from('commission_settings')
    .select('instrument, commission')
    .eq('user_id', userId)
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 })
  if (!settings || settings.length === 0) return NextResponse.json({ success: true, updated: 0 })

  const rateMap: Record<string, number> = {}
  for (const s of settings) rateMap[s.instrument.toUpperCase()] = Number(s.commission)

  const { data: trades, error: tradesError } = await sb
    .from('trades')
    .select('id, instrument, quantity, pnl')
    .eq('user_id', userId)
    .eq('commission', 0)
  if (tradesError) return NextResponse.json({ error: tradesError.message }, { status: 500 })

  const toUpdate = (trades || [])
    .map(t => {
      const rate = rateMap[(t.instrument || '').toUpperCase()]
      if (rate == null) return null
      const commission = parseFloat((rate * (Number(t.quantity) || 0)).toFixed(4))
      if (!(commission > 0)) return null
      const net_pnl = parseFloat((Number(t.pnl) - commission).toFixed(2))
      return { id: t.id as string, commission, net_pnl }
    })
    .filter((r): r is { id: string; commission: number; net_pnl: number } => r !== null)

  if (toUpdate.length === 0) return NextResponse.json({ success: true, updated: 0 })

  const results = await Promise.all(toUpdate.map(row =>
    sb.from('trades')
      .update({ commission: row.commission, net_pnl: row.net_pnl })
      .eq('id', row.id)
      .eq('user_id', userId)
  ))
  const updated = results.filter(r => !r.error).length

  return NextResponse.json({ success: true, updated, matched: toUpdate.length })
}
