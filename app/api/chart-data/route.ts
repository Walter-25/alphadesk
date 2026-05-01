import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol') || '^VIX'
  const range = searchParams.get('range') || '6mo'
  const interval = searchParams.get('interval') || '1d'
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 } })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    const chart = data.chart?.result?.[0]
    if (!chart) throw new Error('No chart data')
    const timestamps = chart.timestamp || []
    const quotes = chart.indicators?.quote?.[0] || {}
    const candles = timestamps.map((t: number, i: number) => ({
      date: new Date(t * 1000).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
      open: quotes.open?.[i]?.toFixed(2),
      high: quotes.high?.[i]?.toFixed(2),
      low: quotes.low?.[i]?.toFixed(2),
      close: quotes.close?.[i]?.toFixed(2),
      volume: quotes.volume?.[i],
    })).filter((c: any) => c.close)
    return NextResponse.json({ symbol, candles, meta: chart.meta })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, candles: [] }, { status: 500 })
  }
}
