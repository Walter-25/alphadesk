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

      const trade = {
        ninja_id: `ct-${account}-${t.trade_number || Date.now()}`,
        user_id: userId,
        account,
        source: (body.source === 'AlphaDeskBridge' ? 'alphadesk_bridge' : 'coretrader_realtime'),
        instrument: t.instrument_base || t.instrument || 'N/A',
        direction: (t.market_position || '').toLowerCase() === 'short' ? 'Short' : 'Long',
        entry_time: entryTime,
        exit_time: exitTime,
        duration_min: durMin,
        entry_price: parseFloat(t.entry_price) || 0,
        exit_price: parseFloat(t.exit_price) || 0,
        quantity: parseInt(t.quantity) || 1,
        pnl: parseFloat(t.profit_gross) || 0,
        commission: parseFloat(t.commission) || 0,
        net_pnl: parseFloat(t.profit_net) || 0,
        mae: parseFloat(t.mae_account_currency) || null,
        mfe: parseFloat(t.mfe_account_currency) || null,
        strategy: t.entry_name || 'Manual',
        emotion_tags: [],
        extra: {
          profit_ticks: t.profit_ticks,
          profit_points: t.profit_points,
          mae_ticks: t.mae_ticks,
          mfe_ticks: t.mfe_ticks,
          entry_efficiency: t.entry_efficiency,
          exit_efficiency: t.exit_efficiency,
          total_efficiency: t.total_efficiency,
          point_value: t.point_value,
          tick_value: t.tick_value,
          is_simulated: t.is_simulated,
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
