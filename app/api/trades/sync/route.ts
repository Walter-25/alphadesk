import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  const { userId, account, broker, config } = await req.json()
  const sb = admin()

  const { data: syncData } = await sb.from('account_syncs')
    .select('last_sync').eq('user_id', userId).eq('account', account).single()
  const lastSync = syncData?.last_sync || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  try {
    let newTrades: any[] = []

    if (broker === 'tradovate') {
      // Step 1: Auth con username/password oppure token diretto
      let accessToken = config?.accessToken || ''

      if (!accessToken && config?.tvUser && config?.tvPass) {
        const authRes = await fetch('https://live.tradovateapi.com/v1/auth/accesstokenrequest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: config.tvUser,
            password: config.tvPass,
            appId: config.accessToken || 'AlphaDesk',
            appVersion: '1.0',
            cid: 0,
            sec: ''
          }),
          signal: AbortSignal.timeout(8000)
        })
        if (authRes.ok) {
          const authData = await authRes.json()
          accessToken = authData.accessToken || ''
        } else {
          const err = await authRes.text()
          throw new Error(`Auth Tradovate fallita: ${err}`)
        }
      }

      if (!accessToken) throw new Error('Inserisci username e password Tradovate nella configurazione')

      // Step 2: Scarica fills/trades dall'ultima sync
      const fromDate = new Date(lastSync).toISOString()
      const fillsRes = await fetch(`https://live.tradovateapi.com/v1/fill/list`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000)
      })

      if (!fillsRes.ok) throw new Error(`Tradovate fills: ${fillsRes.status}`)
      const fills = await fillsRes.json()

      // Raggruppa fills in trade (entry + exit)
      const recentFills = (Array.isArray(fills) ? fills : [])
        .filter((f: any) => new Date(f.timestamp || f.ts || '') > new Date(lastSync))

      // Semplice aggregazione per orderId
      const tradeMap: Record<string, any> = {}
      recentFills.forEach((f: any) => {
        const key = f.orderId || f.id
        if (!tradeMap[key]) {
          tradeMap[key] = {
            ninja_id: `tv-${f.id || key}`,
            account, user_id: userId, source: 'tradovate',
            instrument: f.contractId?.toString() || 'N/A',
            direction: (f.action || f.side || '') === 'Buy' ? 'Long' : 'Short',
            entry_time: f.timestamp || f.ts || new Date().toISOString(),
            exit_time: f.timestamp || f.ts || new Date().toISOString(),
            duration_min: 0,
            entry_price: f.price || 0,
            exit_price: f.price || 0,
            quantity: Math.abs(f.qty || f.quantity || 1),
            pnl: f.realizedPnl || 0,
            commission: Math.abs(f.fees || f.totalFees || 0),
            net_pnl: (f.realizedPnl || 0) - Math.abs(f.fees || f.totalFees || 0),
            strategy: 'Manual',
            emotion_tags: [],
          }
        }
      })
      newTrades = Object.values(tradeMap)
    }

    else if (broker === 'ninjatrader') {
      const ntUrl = config?.url || 'http://localhost:36973'
      const res = await fetch(`${ntUrl}/api/v1/executions?account=${account}&from=${lastSync}`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!res.ok) throw new Error(`NinjaTrader non raggiungibile su ${ntUrl}. Verifica che NT8 sia aperto e Remoting abilitato (Tools → Options → Remoting).`)
      const data = await res.json()
      newTrades = (data.executions || []).map((e: any) => ({
        ninja_id: e.id || `nt-${e.orderId}-${Date.now()}`,
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

    else if (broker === 'interactive_brokers') {
      if (!config?.flexToken || !config?.queryId) throw new Error('Inserisci Flex Token e Query ID di Interactive Brokers')
      const step1 = await fetch(`https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=${config.flexToken}&q=${config.queryId}&v=3`, { signal: AbortSignal.timeout(10000) })
      const xml1 = await step1.text()
      const refCode = xml1.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1]
      if (!refCode) throw new Error('IB FlexQuery: token o query ID non validi')
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

    if (newTrades.length > 0) {
      const { error } = await sb.from('trades').upsert(newTrades, { onConflict: 'ninja_id,user_id' })
      if (error) throw new Error(`Salvataggio DB: ${error.message}`)
    }

    // Aggiorna ultima sync
    await sb.from('account_syncs').upsert({
      user_id: userId, account, broker,
      last_sync: new Date().toISOString(),
      trade_count: newTrades.length
    }, { onConflict: 'user_id,account' })

    return NextResponse.json({
      success: true, newTrades: newTrades.length,
      lastSync, broker,
      message: newTrades.length > 0 ? `${newTrades.length} nuovi trade sincronizzati` : 'Nessun nuovo trade dall\'ultima sync'
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message, newTrades: 0 }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const sb = admin()
  const { data } = await sb.from('account_syncs').select('*').eq('user_id', userId)
  return NextResponse.json({ syncs: data || [] })
}
