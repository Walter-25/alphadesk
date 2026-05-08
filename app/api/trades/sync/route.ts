import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Tradovate endpoints
const TV_ENDPOINTS = {
  live: 'https://live.tradovateapi.com/v1',
  demo: 'https://demo.tradovateapi.com/v1',
  prop: 'https://demo.tradovateapi.com/v1', // Prop usa demo endpoint
}

async function tradovateAuth(endpoint: string, user: string, pass: string, cid?: string) {
  const body: any = {
    name: user,
    password: pass,
    appId: cid || 'AlphaDesk',
    appVersion: '1.0.0',
    cid: cid ? parseInt(cid) : 0,
    sec: '',
    deviceId: 'alphadesk-sync',
  }
  const res = await fetch(`${endpoint}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Auth fallita (${res.status}): ${txt.substring(0, 200)}`)
  }
  const data = await res.json()
  if (data.errorText) throw new Error(`Auth Tradovate: ${data.errorText}`)
  if (!data.accessToken) throw new Error('Nessun token ricevuto — verifica username e password')
  return data.accessToken as string
}

async function tradovateFills(endpoint: string, token: string, since: string) {
  // Scarica fills dall'ultima sync
  const res = await fetch(`${endpoint}/fill/list`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Tradovate fills: ${res.status}`)
  const fills: any[] = await res.json()
  return fills.filter(f => {
    const ts = f.timestamp || f.ts || ''
    return ts && new Date(ts) > new Date(since)
  })
}

async function tradovateOrders(endpoint: string, token: string, since: string) {
  // Scarica orders completati (più affidabile per P&L)
  const res = await fetch(`${endpoint}/order/list`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return []
  const orders: any[] = await res.json()
  return orders.filter(o =>
    o.ordStatus === 'Completed' &&
    o.timestamp && new Date(o.timestamp) > new Date(since)
  )
}

async function tradovateContracts(endpoint: string, token: string, ids: number[]) {
  if (!ids.length) return {}
  try {
    const res = await fetch(`${endpoint}/contract/deps`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterids: ids }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return {}
    const data = await res.json()
    const map: Record<number, string> = {}
    ;(data.contract || []).forEach((c: any) => { map[c.id] = c.name || c.symbol || `Contract-${c.id}` })
    return map
  } catch { return {} }
}

export async function POST(req: NextRequest) {
  const { userId, account, broker, config } = await req.json()
  const sb = admin()

  const { data: syncData } = await sb.from('account_syncs')
    .select('last_sync').eq('user_id', userId).eq('account', account).single()
  const lastSync = syncData?.last_sync || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  try {
    let newTrades: any[] = []

    // ── TRADOVATE (Live + Prop/Demo) ────────────────────────────────────────
    if (broker === 'tradovate' || broker === 'tradovate_prop') {
      const isProp = broker === 'tradovate_prop' || config?.mode === 'prop' || config?.mode === 'demo'
      const endpoint = isProp ? TV_ENDPOINTS.prop : TV_ENDPOINTS.live

      if (!config?.tvUser || !config?.tvPass) {
        throw new Error('Inserisci username (email) e password Tradovate nella configurazione')
      }

      const token = await tradovateAuth(endpoint, config.tvUser, config.tvPass, config?.cid)

      // Prova prima con fills (più granulare)
      const fills = await tradovateFills(endpoint, token, lastSync)

      if (fills.length > 0) {
        // Risolvi nomi contratti
        const contractIds = [...new Set(fills.map((f: any) => f.contractId).filter(Boolean))] as number[]
        const contracts = await tradovateContracts(endpoint, token, contractIds)

        // Raggruppa fills per orderId per formare trade completi
        const orderMap: Record<string, any[]> = {}
        fills.forEach((f: any) => {
          const key = String(f.orderId || f.id)
          if (!orderMap[key]) orderMap[key] = []
          orderMap[key].push(f)
        })

        newTrades = Object.entries(orderMap).map(([orderId, fls]) => {
          const first = fls[0]
          const contractName = contracts[first.contractId] || `Contract-${first.contractId}`
          const totalQty = fls.reduce((s: number, f: any) => s + (f.qty || f.quantity || 1), 0)
          const avgPrice = fls.reduce((s: number, f: any) => s + (f.price || 0) * (f.qty || 1), 0) / Math.max(totalQty, 1)
          const pnl = fls.reduce((s: number, f: any) => s + (f.realizedPnl || f.pnl || 0), 0)
          const comm = fls.reduce((s: number, f: any) => s + Math.abs(f.fees || f.totalFees || 0), 0)
          const action = (first.action || first.side || '').toLowerCase()

          return {
            ninja_id: `tv-${orderId}`,
            account, user_id: userId,
            source: isProp ? 'tradovate_prop' : 'tradovate_live',
            instrument: contractName,
            direction: action === 'buy' || action === 'bid' ? 'Long' : 'Short',
            entry_time: first.timestamp || first.ts || new Date().toISOString(),
            exit_time: fls[fls.length - 1].timestamp || first.timestamp || new Date().toISOString(),
            duration_min: 0,
            entry_price: parseFloat(avgPrice.toFixed(4)),
            exit_price: parseFloat(avgPrice.toFixed(4)),
            quantity: totalQty,
            pnl: parseFloat(pnl.toFixed(2)),
            commission: parseFloat(comm.toFixed(2)),
            net_pnl: parseFloat((pnl - comm).toFixed(2)),
            strategy: 'Manual',
            emotion_tags: [],
          }
        })
      }
    }

    // ── NINJATRADER ─────────────────────────────────────────────────────────
    else if (broker === 'ninjatrader') {
      const ntUrl = config?.url || 'http://localhost:36973'
      const res = await fetch(`${ntUrl}/api/v1/executions?account=${account}&from=${lastSync}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`NinjaTrader non raggiungibile su ${ntUrl}. Verifica che NT8 sia aperto e Remoting abilitato (Tools → Options → Remoting → porta 36973).`)
      const data = await res.json()
      newTrades = (data.executions || []).map((e: any) => ({
        ninja_id: e.id || `nt-${e.orderId}`,
        account, user_id: userId, source: 'ninjatrader_api',
        instrument: e.instrument,
        direction: e.marketPosition === 'Long' ? 'Long' : 'Short',
        entry_time: e.entryTime, exit_time: e.exitTime,
        duration_min: Math.round((new Date(e.exitTime).getTime() - new Date(e.entryTime).getTime()) / 60000),
        entry_price: e.entryPrice, exit_price: e.exitPrice,
        quantity: e.quantity, pnl: e.profitLoss,
        commission: e.commission || 0,
        net_pnl: e.profitLoss - (e.commission || 0),
        strategy: e.strategy || 'Manual',
        emotion_tags: [],
      }))
    }

    // ── INTERACTIVE BROKERS ─────────────────────────────────────────────────
    else if (broker === 'interactive_brokers') {
      if (!config?.flexToken || !config?.queryId) throw new Error('Inserisci Flex Token e Query ID')
      const step1 = await fetch(`https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=${config.flexToken}&q=${config.queryId}&v=3`, { signal: AbortSignal.timeout(10000) })
      const xml1 = await step1.text()
      const refCode = xml1.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1]
      if (!refCode) throw new Error('IB: token o query ID non validi')
      await new Promise(r => setTimeout(r, 3000))
      const step2 = await fetch(`https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement?t=${config.flexToken}&q=${refCode}&v=3`, { signal: AbortSignal.timeout(10000) })
      const xml2 = await step2.text()
      const matches = [...xml2.matchAll(/<Trade[^>]+>/g)]
      newTrades = matches.map(m => {
        const g = (attr: string) => m[0].match(new RegExp(`${attr}="([^"]+)"`))?.[1] || ''
        const pnl = parseFloat(g('fifoPnlRealized')) || 0
        const comm = Math.abs(parseFloat(g('ibCommission')) || 0)
        return {
          ninja_id: `ib-${g('tradeID')}`, account, user_id: userId, source: 'interactive_brokers',
          instrument: g('symbol'), direction: g('buySell') === 'BUY' ? 'Long' : 'Short',
          entry_time: g('dateTime'), exit_time: g('dateTime'),
          duration_min: 0, entry_price: parseFloat(g('tradePrice')) || 0,
          exit_price: parseFloat(g('tradePrice')) || 0,
          quantity: Math.abs(parseInt(g('quantity'))) || 1,
          pnl, commission: comm, net_pnl: pnl - comm, strategy: 'Manual', emotion_tags: [],
        }
      }).filter((t: any) => new Date(t.entry_time) > new Date(lastSync))
    }

    // Salva in Supabase
    if (newTrades.length > 0) {
      const { error } = await sb.from('trades').upsert(newTrades, { onConflict: 'ninja_id,user_id' })
      if (error) throw new Error(`DB: ${error.message}`)
    }

    await sb.from('account_syncs').upsert({
      user_id: userId, account, broker,
      last_sync: new Date().toISOString(),
      trade_count: newTrades.length
    }, { onConflict: 'user_id,account' })

    return NextResponse.json({
      success: true, newTrades: newTrades.length, lastSync, broker,
      message: newTrades.length > 0
        ? `✓ ${newTrades.length} nuovi trade sincronizzati`
        : 'Nessun trade nuovo dall\'ultima sync — i dati sono aggiornati'
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message, newTrades: 0 }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const sb = admin()
  const { data } = await sb.from('account_syncs').select('*').eq('user_id', userId || '')
  return NextResponse.json({ syncs: data || [] })
}
