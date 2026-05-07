import { NextResponse } from 'next/server'
const DEMO_EVENTS = [
  { date: 'Oggi', time: '14:30', currency: 'USD', impact: 'high', event: 'Initial Jobless Claims', forecast: '220K', previous: '219K' },
  { date: 'Oggi', time: '16:00', currency: 'USD', impact: 'medium', event: 'ISM Services PMI', forecast: '52.8', previous: '53.5' },
  { date: 'Domani', time: '08:00', currency: 'EUR', impact: 'medium', event: 'German CPI m/m', forecast: '0.4%', previous: '0.3%' },
  { date: 'Domani', time: '10:00', currency: 'EUR', impact: 'high', event: 'ECB Interest Rate Decision', forecast: '2.40%', previous: '2.65%' },
  { date: 'Domani', time: '14:30', currency: 'USD', impact: 'high', event: 'Non-Farm Payrolls', forecast: '185K', previous: '228K' },
]
export async function GET() {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 1800 }
    })
    if (!res.ok) throw new Error('FF unavailable')
    const raw = await res.json()
    const events = raw.map((e: any) => ({
      date: e.date, time: e.time || '', currency: e.country || '',
      impact: e.impact === 'High' ? 'high' : e.impact === 'Medium' ? 'medium' : 'low',
      event: e.title || '', actual: e.actual || null, forecast: e.forecast || null, previous: e.previous || null,
    }))
    return NextResponse.json({ events, source: 'forexfactory' })
  } catch {
    return NextResponse.json({ events: DEMO_EVENTS, source: 'demo' })
  }
}
