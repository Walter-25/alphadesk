import { NextResponse } from 'next/server'
export async function GET() {
  try {
    const symbols = ['^VIX','^VIX9D','SPY','QQQ','^GSPC','^NDX','^DJI','^RUT','^N225','^HSI','^STOXX50E','^FTSE','^GDAXI','^FCHI','^IBEX']
    const query = symbols.map(s => encodeURIComponent(s)).join('%2C')
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${query}`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 60 } })
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    return NextResponse.json({ quotes: data.quoteResponse?.result || [], timestamp: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, quotes: [] }, { status: 500 })
  }
}
