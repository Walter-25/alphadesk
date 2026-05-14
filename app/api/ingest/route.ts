import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── ENDPOINT PROXY ────────────────────────────────────────────────────────────
// Riceve trade da CoreTraderExporter (NinjaTrader plugin)
// 1. Salva in AlphaDesk (Supabase)
// 2. Inoltra a CoreTraders in parallelo (se configurato)
// Configurazione CoreTraderExporter.config.json:
//   ApiEndpoint: https://alphadesk-ecru.vercel.app/api/ingest
//   ApiKey: <la tua chiave AlphaDesk>  ← genera da Eseguiti → Sync → NinjaTrader

const CORETRADERS_ENDPOINT = 'https://coretraders.it/ninjaapi/ninjaapi.php'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  let body: any = {}

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  // ── Autenticazione API key AlphaDesk ────────────────────────────────────────
  const alphadeskKey = req.headers.get('x-api-key')
    || req.headers.get('authorization')?.replace('Bearer ', '')
    || body.alphadesk_key
    || ''

  // La CoreTraders API key arriva nell'header X-API-Key originale
  const coretradersKey = req.headers.get('x-api-key') || body.api_key || ''

  let userId: string | null = null
  let forwardToCoretraders = false

  // Prova autenticazione AlphaDesk
  if (alphadeskKey) {
    const sb = admin()
    const { data: keyData } = await sb
      .from('api_keys')
      .select('user_id, coretraders_key')
      .eq('key', alphadeskKey)
      .single()

    if (keyData) {
      userId = keyData.user_id
      // Se l'utente ha configurato la propria chiave CoreTraders, abilita forwarding
      if (keyData.coretraders_key) {
        forwardToCoretraders = true
        // Usa la chiave CoreTraders salvata, non quella del config (che ora punta ad AlphaDesk)
      }
    }
  }

  // ── Forwarding a CoreTraders (parallelo, non bloccante) ─────────────────────
  const forwardPromise = forwardToCoretraders
    ? forwardToCoreTraders(body, coretradersKey)
    : Promise.resolve({ forwarded: false })

  // ── Salvataggio in AlphaDesk ────────────────────────────────────────────────
  let savedToAlphadesk = false
  if (userId) {
    try {
      const sb = admin()
      const t = body
      const account = t.account || 'NinjaTrader'
      const safeDate = (s: string) => {
        if (!s) return new Date().toISOString()
        try { return new Date(s).toISOString() } catch { return new Date().toISOString() }
      }
      const entryTime = safeDate(t.entry_time)
      const exitTime = safeDate(t.exit_time)
      const durMin = Math.max(0, Math.round(
        (new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000
      ))

      // Compatibile sia con AlphaDeskBridge v2.0 (nuovi nomi) che con CoreTrader (vecchi nomi)
      const isV2 = !!t.trade_uid // bridge v2.0 invia sempre trade_uid
      const direction = isV2
        ? (t.direction || 'Long')
        : ((t.market_position || '').toLowerCase() === 'short' ? 'Short' : 'Long')
      const entryPrice  = parseFloat(isV2 ? t.entry_avg_price : t.entry_price) || 0
      const exitPrice   = parseFloat(isV2 ? t.exit_avg_price  : t.exit_price)  || 0
      const qty         = parseInt(isV2 ? t.entry_quantity : t.quantity) || 1
      const pnl         = parseFloat(isV2 ? t.gross_pnl   : t.profit_gross) || 0
      const comm        = parseFloat(isV2 ? t.commission_total : t.commission) || 0
      const netPnl      = parseFloat(isV2 ? t.net_pnl      : t.profit_net) || 0
      const ninjaId     = isV2
        ? `bridge-${t.trade_uid}`
        : `ct-${account}-${t.trade_number || Date.now()}`

      const trade = {
        ninja_id: ninjaId,
        user_id: userId,
        account,
        source: (body.source === 'AlphaDeskBridge' ? 'alphadesk_bridge' : 'coretrader_realtime'),
        instrument: t.instrument_base || t.instrument || 'N/A',
        direction,
        entry_time: entryTime,
        exit_time: exitTime,
        duration_min: durMin,
        entry_price: entryPrice,
        exit_price: exitPrice,
        quantity: qty,
        pnl,
        commission: comm,
        net_pnl: netPnl,
        mae: parseFloat(t.mae_account_currency) || null,
        mfe: parseFloat(t.mfe_account_currency) || null,
        strategy: t.entry_name || 'Manual',
        emotion_tags: [],
        extra: {
          trade_uid: t.trade_uid,
          profit_ticks: t.profit_ticks,
          profit_points: t.profit_points,
          point_value: t.point_value || t.point_value,
          tick_size: t.tick_size,
          tick_value: t.tick_value,
          executions_count: t.executions_count,
          is_simulated: t.is_simulated,
          // campi CoreTrader
          mae_ticks: t.mae_ticks,
          mfe_ticks: t.mfe_ticks,
          entry_efficiency: t.entry_efficiency,
          exit_efficiency: t.exit_efficiency,
        }
      }

      const { error } = await sb
        .from('trades')
        .upsert([trade], { onConflict: 'ninja_id,user_id' })

      if (!error) {
        savedToAlphadesk = true
        await sb.from('account_syncs').upsert({
          user_id: userId, account,
          broker: 'coretrader',
          last_sync: new Date().toISOString(),
          trade_count: 1,
        }, { onConflict: 'user_id,account' })
      }
    } catch (e: any) {
      console.error('AlphaDesk save error:', e.message)
    }
  }

  // Aspetta il forwarding (con timeout 8s max)
  const forwardResult = await Promise.race([
    forwardPromise,
    new Promise<any>(r => setTimeout(() => r({ forwarded: false, timeout: true }), 8000))
  ])

  const elapsed = Date.now() - startTime

  return NextResponse.json({
    success: true,
    alphadesk: savedToAlphadesk,
    coretraders: forwardResult,
    ms: elapsed,
    ...(userId ? {} : { warn: 'API key AlphaDesk non valida — trade non salvato in AlphaDesk' })
  })
}

// ── Forward a CoreTraders ──────────────────────────────────────────────────────
async function forwardToCoreTraders(body: any, coretradersKey: string) {
  try {
    const res = await fetch(CORETRADERS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-API-Key': coretradersKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    })
    return {
      forwarded: true,
      status: res.status,
      ok: res.ok,
    }
  } catch (e: any) {
    return { forwarded: false, error: e.message }
  }
}

// ── Health check ───────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'AlphaDesk ingest endpoint',
    version: '2.0',
    features: ['alphadesk_save', 'coretraders_forward'],
    usage: {
      endpoint: 'POST /api/ingest',
      headers: { 'X-API-Key': '<la tua chiave AlphaDesk>' },
      note: 'Salva in AlphaDesk E inoltra a CoreTraders se configurato'
    }
  })
}
