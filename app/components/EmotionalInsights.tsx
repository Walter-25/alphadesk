'use client'
import { useState, useEffect } from 'react'
import { authedFetch } from '../lib/supabase'
import { marketDaysBetween, parseDateKey } from '../lib/tradingDays'
import type { useTrades, Trade } from '../lib/useTrades'

// Emozioni considerate "negative" per la correlazione pre-market → esito trade.
// hope è inclusa qui non come emozione negativa in senso assoluto, ma perché
// nel contesto pre-market spesso segnala aspettative fuori controllo (vedi FOMO/revenge).
const NEGATIVE_EMOTIONS = ['fear', 'anxiety', 'insecure', 'frustration', 'hope', 'revenge', 'fomo']
const MIN_SAMPLE = 5
const MIN_ENTRIES = 10
const TARGET_ENTRIES = 20

interface Group { label: string; count: number; winRate: number; avgPnl: number }

function tradeDateKey(entryTime: string): string {
  if (!entryTime) return ''
  const m = entryTime.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(entryTime)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function parseTradeDateTime(entryTime: string): Date {
  if (!entryTime) return new Date(NaN)
  const m = entryTime.match(/(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(:(\d{2}))?/)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), m[7] ? Number(m[7]) : 0)
  return new Date(entryTime)
}

function buildGroup(label: string, trades: Trade[]): Group {
  const count = trades.length
  const wins = trades.filter(t => t.net_pnl > 0).length
  const winRate = count ? (wins / count) * 100 : 0
  const avgPnl = count ? trades.reduce((s, t) => s + t.net_pnl, 0) / count : 0
  return { label, count, winRate, avgPnl }
}

function GroupLine({ g }: { g: Group }) {
  if (g.count === 0) return null
  if (g.count < MIN_SAMPLE) {
    return <span>{g.label}: <span style={{ color: 'var(--text-2)' }}>dati insufficienti (n={g.count})</span></span>
  }
  const sign = g.avgPnl >= 0 ? '+' : ''
  return (
    <span>
      {g.label} (n={g.count}): win rate <strong style={{ color: 'var(--text-0)' }}>{g.winRate.toFixed(0)}%</strong> · P&L medio{' '}
      <strong style={{ color: g.avgPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{sign}{g.avgPnl.toFixed(0)}$</strong>
    </span>
  )
}

function CorrelationCard({ title, groupA, groupB }: { title: string; groupA: Group; groupB: Group }) {
  if (groupA.count === 0 && groupB.count === 0) return null
  return (
    <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7 }}>
        <GroupLine g={groupA} /><br /><GroupLine g={groupB} />
      </div>
    </div>
  )
}

export default function EmotionalInsights({ userId, tradesHook }: { userId: string; tradesHook: ReturnType<typeof useTrades> }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await authedFetch(`/api/premarket?userId=${userId}`)
        const data = await res.json()
        if (!cancelled) setEntries(data.entries || [])
      } catch { /* silenzioso: pannello puramente informativo */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  const trades = tradesHook.trades || []

  if (loading || tradesHook.loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>Caricamento pattern...</div>
    )
  }

  const entryMap = new Map(entries.map(e => [e.entry_date, e]))

  // Trade con check-in pre-market abbinato (stessa data locale)
  const matched = trades
    .map(t => ({ trade: t, entry: entryMap.get(tradeDateKey(t.entry_time)) }))
    .filter(m => m.entry)

  const sleepLow = buildGroup('Giornate con sonno scarso', matched.filter(m => m.entry.sleep_quality != null && m.entry.sleep_quality <= 2).map(m => m.trade))
  const sleepHigh = buildGroup('Giornate con sonno buono', matched.filter(m => m.entry.sleep_quality != null && m.entry.sleep_quality >= 4).map(m => m.trade))

  const confLow = buildGroup('Giornate con fiducia bassa', matched.filter(m => m.entry.self_confidence != null && m.entry.self_confidence <= 2).map(m => m.trade))
  const confHigh = buildGroup('Giornate con fiducia alta', matched.filter(m => m.entry.self_confidence != null && m.entry.self_confidence >= 4).map(m => m.trade))

  const negativeEmo = buildGroup('Giornate con emozioni negative al check-in', matched.filter(m => (m.entry.emotions || []).some((e: string) => NEGATIVE_EMOTIONS.includes(e))).map(m => m.trade))
  const cleanEmo = buildGroup('Giornate "pulite" (nessuna emozione negativa)', matched.filter(m => !(m.entry.emotions || []).some((e: string) => NEGATIVE_EMOTIONS.includes(e))).map(m => m.trade))

  // Primo trade dopo un rientro (gap di mercato > 0 tra un giorno di trading e il precedente)
  const dayKeys = [...new Set(trades.map(t => tradeDateKey(t.entry_time)).filter(Boolean))].sort()
  const afterGapTrades: Trade[] = []
  for (let i = 1; i < dayKeys.length; i++) {
    const gap = marketDaysBetween(parseDateKey(dayKeys[i - 1]), parseDateKey(dayKeys[i]))
    if (gap > 0) {
      const dayTrades = trades.filter(t => tradeDateKey(t.entry_time) === dayKeys[i])
        .sort((a, b) => parseTradeDateTime(a.entry_time).getTime() - parseTradeDateTime(b.entry_time).getTime())
      if (dayTrades.length) afterGapTrades.push(dayTrades[0])
    }
  }
  const afterGap = buildGroup('Primo trade dopo un rientro', afterGapTrades)
  const overall = buildGroup('Media generale (tutti i trade)', trades)

  const hasAnyData = [sleepLow, sleepHigh, confLow, confHigh, negativeEmo, cleanEmo, afterGap].some(g => g.count > 0)

  return (
    <div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--text-0)', marginBottom: 4 }}>
        I tuoi pattern (aggiornati sui dati reali)
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 16 }}>
        Non sono consigli: sono osservazioni oggettive calcolate sui tuoi dati. L'interpretazione resta tua.
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--text-1)', fontSize: 12, marginBottom: 16 }}>
          Registra il tuo primo check-in dal riquadro qui sopra. I pattern compariranno qui man mano.
        </div>
      ) : entries.length < TARGET_ENTRIES ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
            Check-in registrati: {entries.length}. Ne servono almeno ~{MIN_ENTRIES} per i primi pattern indicativi, ~{TARGET_ENTRIES} per correlazioni affidabili.
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (entries.length / TARGET_ENTRIES) * 100)}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      ) : null}

      {entries.length > 0 && (
        hasAnyData ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
            <CorrelationCard title="Sonno vs esito" groupA={sleepLow} groupB={sleepHigh} />
            <CorrelationCard title="Fiducia in te vs esito" groupA={confLow} groupB={confHigh} />
            <CorrelationCard title="Emozioni al check-in vs esito" groupA={negativeEmo} groupB={cleanEmo} />
            <CorrelationCard title="Rientro dopo una pausa" groupA={afterGap} groupB={overall} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic' }}>
            Le correlazioni compariranno qui man mano che registri check-in e accumuli trade.
          </div>
        )
      )}
    </div>
  )
}
