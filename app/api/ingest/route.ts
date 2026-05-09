import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ','')
    const body = await req.json()
    const apiKey = authHeader || body.api_key || ''
    if (!apiKey) return NextResponse.json({ error: 'API key mancante' }, { status: 401 })

    const sb = admin()
    const { data: keyData } = await sb.from('api_keys').select('user_id').eq('key', apiKey).single()
    if (!keyData) return NextResponse.json({ error: 'API key non valida' }, { status: 401 })

    const t = body
    const account = t.account || 'NinjaTrader'
    const parseISO = (s: string) => { try { return new Date(s).toISOString() } catch { return new Date().toISOString() } }
    const entryTime = parseISO(t.entry_time)
    const exitTime = parseISO(t.exit_time)
    const durMin = Math.round((new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000)

    const trade = {
      ninja_id: `ct-${account}-${t.trade_number || Date.now()}`,
      user_id: keyData.user_id, account,
      source: 'coretrader_realtime',
      instrument: t.instrument_base || t.instrument || 'N/A',
      direction: (t.market_position||'').toLowerCase()==='short' ? 'Short' : 'Long',
      entry_time: entryTime, exit_time: exitTime, duration_min: durMin,
      entry_price: parseFloat(t.entry_price)||0, exit_price: parseFloat(t.exit_price)||0,
      quantity: parseInt(t.quantity)||1,
      pnl: parseFloat(t.profit_gross)||0,
      commission: parseFloat(t.commission)||0,
      net_pnl: parseFloat(t.profit_net)||0,
      mae: parseFloat(t.mae_account_currency)||null,
      mfe: parseFloat(t.mfe_account_currency)||null,
      strategy: t.entry_name || 'Manual',
      emotion_tags: [],
    }

    const { error } = await sb.from('trades').upsert([trade], { onConflict: 'ninja_id,user_id' })
    if (error) throw new Error(error.message)

    await sb.from('account_syncs').upsert({
      user_id: keyData.user_id, account, broker: 'coretrader',
      last_sync: new Date().toISOString(), trade_count: 1,
    }, { onConflict: 'user_id,account' })

    return NextResponse.json({ success: true, trade_id: trade.ninja_id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'AlphaDesk CoreTrader ingest endpoint' })
}
