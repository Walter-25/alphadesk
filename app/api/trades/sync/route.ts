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

  // Recupera ultima sync
  const { data: syncData } = await sb.from('account_syncs')
    .select('last_sync').eq('user_id', userId).eq('account', account).single()
  const lastSync = syncData?.last_sync || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    let newTrades: any[] = []

    if (broker === 'ninjatrader') {
      // NinjaTrader 8 REST API (porta locale 36973)
      const ntUrl = config?.url || 'http://localhost:36973'
      const res = await fetch(`${ntUrl}/api/v1/executions?account=${account}&from=${lastSync}`, {
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        const data = await res.json()
        newTrades = (data.executions || []).map((e: any) => ({
          ninja_id: e.id || `nt-${e.orderId}-${Date.now()}`,
          account, user_id: userId, source: 'ninjatrader_api',
          instrument: e.instrument, direction: e.marketPosition === 'Long' ? 'Long' : 'Short',
          entry_time: e.entryTime, exit_time: e.exitTime,
          duration_min: Math.round((new Date(e.exitTime).getTime() - new Date(e.entryTime).getTime()) / 60000),
          entry_price: e.entryPrice, exit_price: e.exitPrice,
          quantity: e.quantity, pnl: e.profitLoss,
          commission: e.commission || 0, net_pnl: e.profitLoss - (e.commission || 0),
          strategy: e.strategy || 'Manual',
        }))
      }
    } else if (broker === 'interactive_brokers') {
      // IB TWS API via FlexQuery (richiede token configurato)
      if (config?.flexToken && config?.queryId) {
        const step1 = await fetch(`https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=${config.flexToken}&q=${config.queryId}&v=3`)
        const xml1 = await step1.text()
        const refCode = xml1.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1]
        if (refCode) {
          await new Promise(r => setTimeout(r, 2000))
          const step2 = await fetch(`https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement?t=${config.flexToken}&q=${refCode}&v=3`)
          const xml2 = await step2.text()
          const trades = [...xml2.matchAll(/<Trade[^>]+>/g)].map(m => {
            const get = (attr: string) => m[0].match(new RegExp(`${attr}="([^"]+)"`))?.[1] || ''
            return {
              ninja_id: `ib-${get('tradeID')}`,
              account, user_id: userId, source: 'interactive_brokers',
              instrument: get('symbol'), direction: get('buySell') === 'BUY' ? 'Long' : 'Short',
              entry_time: get('dateTime'), exit_time: get('dateTime'),
              duration_min: 0, entry_price: parseFloat(get('tradePrice')) || 0,
              exit_price: parseFloat(get('tradePrice')) || 0,
              quantity: Math.abs(parseInt(get('quantity'))) || 1,
              pnl: parseFloat(get('fifoPnlRealized')) || 0,
              commission: Math.abs(parseFloat(get('ibCommission'))) || 0,
              net_pnl: (parseFloat(get('fifoPnlRealized')) || 0) - Math.abs(parseFloat(get('ibCommission')) || 0),
              strategy: 'Manual',
            }
          })
          newTrades = trades
        }
      }
    } else if (broker === 'tradovate') {
      if (config?.accessToken) {
        const res = await fetch('https://live.tradovateapi.com/v1/fill/list', {
          headers: { 'Authorization': `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' }
        })
        if (res.ok) {
          const fills = await res.json()
          newTrades = fills.filter((f: any) => new Date(f.timestamp) > new Date(lastSync)).map((f: any) => ({
            ninja_id: `tv-${f.id}`, account, user_id: userId, source: 'tradovate',
            instrument: f.contractId?.toString() || 'N/A',
            direction: f.action === 'Buy' ? 'Long' : 'Short',
            entry_time: f.timestamp, exit_time: f.timestamp,
            duration_min: 0, entry_price: f.price || 0, exit_price: f.price || 0,
            quantity: f.qty || 1, pnl: 0, commission: f.totalFees || 0, net_pnl: 0,
            strategy: 'Manual',
          }))
        }
      }
    }

    if (newTrades.length > 0) {
      const { error } = await sb.from('trades').upsert(newTrades, { onConflict: 'ninja_id,user_id' })
      if (error) throw new Error(error.message)
      await sb.from('account_syncs').upsert({
        user_id: userId, account, broker, last_sync: new Date().toISOString(), trade_count: newTrades.length
      }, { onConflict: 'user_id,account' })
    }

    return NextResponse.json({ success: true, newTrades: newTrades.length, lastSync, broker })
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
