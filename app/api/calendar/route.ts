import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') || new Date().toISOString().split('T')[0]
    const to = searchParams.get('to') || from

    // Investing.com non ha API pubblica — usiamo forexfactory feed o fallback strutturato
    // Proviamo prima Forex Factory RSS (pubblico)
    const ffUrl = `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
    const res = await fetch(ffUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      next: { revalidate: 1800 }
    })

    if (!res.ok) throw new Error(`FF ${res.status}`)
    const raw = await res.json()

    const events = raw.map((e: any) => ({
      date: e.date,
      time: e.time || '',
      currency: e.country || '',
      impact: e.impact === 'High' ? 'high' : e.impact === 'Medium' ? 'medium' : 'low',
      event: e.title || '',
      actual: e.actual || null,
      forecast: e.forecast || null,
      previous: e.previous || null,
    }))

    return NextResponse.json({ events, source: 'forexfactory' })
  } catch (e: any) {
    return NextResponse.json({ events: [], error: e.message }, { status: 500 })
  }
}
