'use client'
import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Area, AreaChart, CartesianGrid } from 'recharts'

interface Candle { date: string; close: string; high: string; low: string; open: string }
interface ChartProps { symbol: string; label: string; color?: string; showAnalysis?: boolean }

function computeLevels(candles: Candle[]) {
  if (candles.length < 20) return { support: [], resistance: [], trend: 'neutral', gap: null, sma20: null, sma50: null }
  const closes = candles.map(c => parseFloat(c.close))
  const highs = candles.map(c => parseFloat(c.high))
  const lows = candles.map(c => parseFloat(c.low))
  const last = closes[closes.length - 1]
  const open = parseFloat(candles[candles.length - 1].open)
  const prevClose = closes[closes.length - 2]

  // SMA
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null

  // Trend
  const trend = sma50 ? (sma20 > sma50 ? 'bullish' : 'bearish') : (last > sma20 ? 'bullish' : 'bearish')

  // Supporti e resistenze — pivot locali su finestra 10gg
  const supports: number[] = []
  const resistances: number[] = []
  for (let i = 10; i < candles.length - 5; i++) {
    const window = lows.slice(i - 5, i + 5)
    const windowH = highs.slice(i - 5, i + 5)
    if (lows[i] === Math.min(...window)) supports.push(parseFloat(lows[i].toFixed(2)))
    if (highs[i] === Math.max(...windowH)) resistances.push(parseFloat(highs[i].toFixed(2)))
  }
  // Deduplica e prendi i 3 più vicini al prezzo attuale
  const dedupe = (arr: number[], isSupport: boolean) => {
    const sorted = [...new Set(arr.map(v => parseFloat(v.toFixed(2))))].sort((a, b) => a - b)
    if (isSupport) return sorted.filter(v => v < last).slice(-3)
    else return sorted.filter(v => v > last).slice(0, 3)
  }

  // Gap apertura
  const gapPct = ((open - prevClose) / prevClose) * 100
  const gap = Math.abs(gapPct) > 0.1 ? { pct: gapPct.toFixed(2), level: prevClose.toFixed(2) } : null

  return {
    support: dedupe(supports, true),
    resistance: dedupe(resistances, false),
    trend,
    gap,
    sma20: parseFloat(sma20.toFixed(2)),
    sma50: sma50 ? parseFloat(sma50.toFixed(2)) : null
  }
}

export default function LiveChart({ symbol, label, color = '#00d4aa', showAnalysis = true }: ChartProps) {
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('6mo')
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/chart-data?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=1d`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCandles(data.candles || [])
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [symbol, range])

  useEffect(() => { fetchData() }, [fetchData])

  const levels = computeLevels(candles)
  const last = candles.length > 0 ? parseFloat(candles[candles.length - 1].close) : 0
  const prev = candles.length > 1 ? parseFloat(candles[candles.length - 2].close) : 0
  const chgPct = prev > 0 ? (((last - prev) / prev) * 100).toFixed(2) : '0.00'
  const isPos = parseFloat(chgPct) >= 0

  const chartData = candles.slice(-120).map(c => ({
    date: c.date,
    value: parseFloat(c.close),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
  }))

  const minVal = Math.min(...chartData.map(d => d.low)) * 0.995
  const maxVal = Math.max(...chartData.map(d => d.high)) * 1.005

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>{label}</div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 4 }}>{symbol}</span>
            {!loading && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: isPos ? 'var(--green-dim)' : 'var(--red-dim)', color: isPos ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              {isPos ? '▲' : '▼'} {Math.abs(parseFloat(chgPct))}%
            </span>}
          </div>
          {!loading && <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)', marginTop: 2 }}>{last.toFixed(2)}</div>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['1mo','3mo','6mo','1y','2y'].map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: range === r ? 'var(--accent-dim)' : 'transparent', color: range === r ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{r}</button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', fontSize: 12 }}>Caricamento dati live...</div>
      ) : error ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)', fontSize: 12 }}>Errore: {error}</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${symbol.replace(/[\^]/g,'')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} interval={Math.floor(chartData.length / 6)} />
            <YAxis domain={[minVal, maxVal]} tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(0)} width={45} />
            <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--text-1)' }} itemStyle={{ color }} formatter={(v: any) => [parseFloat(v).toFixed(2), 'Close']} />
            {/* Livelli supporto */}
            {levels.support.map((s, i) => <ReferenceLine key={`s${i}`} y={s} stroke="var(--green)" strokeDasharray="4 3" strokeWidth={1} label={{ value: `S ${s}`, position: 'insideLeft', fontSize: 9, fill: 'var(--green)' }} />)}
            {/* Livelli resistenza */}
            {levels.resistance.map((r, i) => <ReferenceLine key={`r${i}`} y={r} stroke="var(--red)" strokeDasharray="4 3" strokeWidth={1} label={{ value: `R ${r}`, position: 'insideLeft', fontSize: 9, fill: 'var(--red)' }} />)}
            {/* SMA */}
            {levels.sma20 && <ReferenceLine y={levels.sma20} stroke="var(--amber)" strokeDasharray="2 2" strokeWidth={1} />}
            {/* Gap */}
            {levels.gap && <ReferenceLine y={parseFloat(levels.gap.level)} stroke="var(--blue)" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `GAP ${levels.gap.pct}%`, position: 'insideRight', fontSize: 9, fill: 'var(--blue)' }} />}
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#grad-${symbol.replace(/[\^]/g,'')})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Analisi automatica */}
      {showAnalysis && !loading && !error && candles.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Analisi automatica</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: levels.trend === 'bullish' ? 'var(--green-dim)' : 'var(--red-dim)', color: levels.trend === 'bullish' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              {levels.trend === 'bullish' ? '↑ TREND RIALZISTA' : '↓ TREND RIBASSISTA'}
            </span>
            {levels.sma20 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--amber-dim)', color: 'var(--amber)' }}>SMA20: {levels.sma20}</span>}
            {levels.sma50 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--blue-dim)', color: 'var(--blue)' }}>SMA50: {levels.sma50}</span>}
            {levels.gap && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--blue-dim)', color: 'var(--blue)' }}>GAP {levels.gap.pct}% → chiusura a {levels.gap.level}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.6 }}>
            {levels.resistance.length > 0 && <span>Resistenze: <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{levels.resistance.join(' · ')}</span>{'  '}</span>}
            {levels.support.length > 0 && <span>Supporti: <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{levels.support.join(' · ')}</span></span>}
          </div>
        </div>
      )}
    </div>
  )
}
