'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './components/LoginPage'
import AdminPanel from './components/AdminPanel'
import TradingViewChart from './components/TradingViewChart'
import EconomicCalendar from './components/EconomicCalendar'
import TradesAdvanced from './components/TradesAdvanced'
import SyncPanel from './components/SyncPanel'
import { useTrades } from './lib/useTrades'

// ─── TIPOS ───────────────────────────────────────────────────────────────────
interface Index { name: string; ticker: string; value: string; chg: string; pct: string; region: 'asia'|'europe'|'us' }
interface NewsEvent { time: string; currency: string; impact: 'high'|'medium'|'low'; event: string; actual?: string; forecast?: string; previous?: string }
interface SectorData { name: string; pct: number }

// ─── DATI STATICI ────────────────────────────────────────────────────────────
const NEWS_EVENTS: NewsEvent[] = [
  { time: '14:30', currency: 'USD', impact: 'high', event: 'Core CPI m/m', actual: '0.3%', forecast: '0.3%', previous: '0.2%' },
  { time: '14:30', currency: 'USD', impact: 'high', event: 'Initial Jobless Claims', actual: '215K', forecast: '220K', previous: '219K' },
  { time: '16:00', currency: 'USD', impact: 'medium', event: 'ISM Services PMI', forecast: '52.8', previous: '53.5' },
  { time: '16:30', currency: 'USD', impact: 'low', event: 'Natural Gas Storage', forecast: '-38B', previous: '-62B' },
  { time: '18:00', currency: 'USD', impact: 'medium', event: 'Fed Speaker — Williams' },
]
const SECTORS: SectorData[] = [
  { name: 'Consumer Cycl.', pct: 2.11 },{ name: 'Industrials', pct: 2.00 },
  { name: 'Technology', pct: 1.69 },{ name: 'Real Estate', pct: 1.59 },
  { name: 'Healthcare', pct: 1.56 },{ name: 'Consumer Def.', pct: 1.40 },
  { name: 'Basic Materials', pct: 1.37 },{ name: 'Financial', pct: 1.18 },
  { name: 'Comm. Services', pct: 0.81 },{ name: 'Utilities', pct: -0.33 },
  { name: 'Energy', pct: -1.85 },
]

const pctColor = (v: string|number) => { const n = typeof v === 'string' ? parseFloat(v) : v; return n > 0 ? '#00d4aa' : n < 0 ? '#ff4d6d' : '#8fa3b8' }
const impactColor = (i: string) => i === 'high' ? '#ff4d6d' : i === 'medium' ? '#f5a623' : '#8fa3b8'

// ─── SUB-COMPONENTI ──────────────────────────────────────────────────────────
function NewsRow({ ev }: { ev: NewsEvent }) {
  const beat = ev.actual && ev.forecast && parseFloat(ev.actual) > parseFloat(ev.forecast)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ width: 38, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', flexShrink: 0 }}>{ev.time}</div>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: impactColor(ev.impact), display: 'inline-block', flexShrink: 0, boxShadow: `0 0 4px ${impactColor(ev.impact)}` }}></span>
      <div style={{ width: 34, fontSize: 10, fontFamily: 'var(--font-mono)', color: '#4da6ff', flexShrink: 0 }}>{ev.currency}</div>
      <div style={{ flex: 1, fontSize: 12, color: 'var(--text-0)' }}>{ev.event}</div>
      {ev.forecast && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', flexShrink: 0 }}>est {ev.forecast}</div>}
      {ev.actual && <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: beat ? '#00d4aa' : '#ff4d6d', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>{ev.actual}</div>}
    </div>
  )
}

function SectorBar({ s }: { s: SectorData }) {
  const pos = s.pct >= 0; const maxAbs = 2.5; const pct = Math.abs(s.pct) / maxAbs * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <div style={{ width: 110, fontSize: 12, color: 'var(--text-1)', flexShrink: 0, textAlign: 'right' }}>{s.name}</div>
      <div style={{ flex: 1, height: 18, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: pos ? '50%' : `calc(50% - ${pct/2}%)`, width: `${pct/2}%`, height: '100%', background: pos ? '#00d4aa' : '#ff4d6d', opacity: 0.8, borderRadius: 2 }}></div>
        <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'rgba(255,255,255,0.1)' }}></div>
      </div>
      <div style={{ width: 48, fontSize: 12, fontFamily: 'var(--font-mono)', color: pctColor(s.pct), textAlign: 'right', flexShrink: 0 }}>{s.pct > 0 ? '+' : ''}{s.pct}%</div>
    </div>
  )
}

// ─── TRADING KPI WIDGET ───────────────────────────────────────────────────────
function TradingKPI({ tradesHook, setActive }: { tradesHook: any; setActive: (s: string) => void }) {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const stats = tradesHook.getDashboardStats(selectedAccounts)

  const toggleAccount = (a: string) => {
    setSelectedAccounts(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
  }

  // Se tradesHook è in caricamento
  if (tradesHook.loading) return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:14,padding:'14px 20px',fontSize:12,color:'var(--text-2)'}}>
      Caricamento dati trading...
    </div>
  )

  if (!stats) return (
    <div style={{background:'var(--bg-2)',border:'1px solid rgba(0,212,170,0.1)',borderRadius:14,padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div style={{fontSize:12,color:'var(--text-2)'}}>◈ Nessun dato trading — <span style={{color:'var(--accent)',cursor:'pointer'}} onClick={()=>setActive('eseguiti')}>Importa i tuoi eseguiti →</span></div>
    </div>
  )

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>◈ Performance Trading — Live</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Dati reali dai tuoi conti</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {tradesHook.accounts.map((a: string) => (
            <button key={a} onClick={() => toggleAccount(a)}
              style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${selectedAccounts.includes(a) || selectedAccounts.length === 0 ? 'var(--accent)' : 'var(--border)'}`, background: selectedAccounts.includes(a) || selectedAccounts.length === 0 ? 'var(--accent-dim)' : 'transparent', color: selectedAccounts.includes(a) || selectedAccounts.length === 0 ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{a}</button>
          ))}
          <button onClick={() => setActive('eseguiti')} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>Dettaglio →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { l: 'P&L Totale', v: `${stats.totalPnl >= 0 ? '+' : ''}$${Math.abs(stats.totalPnl).toLocaleString('it-IT', {minimumFractionDigits:2})}`, c: stats.totalPnl >= 0 ? '#00d4aa' : '#ff4d6d' },
          { l: 'P&L 7 giorni', v: `${stats.recentPnl >= 0 ? '+' : ''}$${Math.abs(stats.recentPnl).toFixed(0)}`, c: stats.recentPnl >= 0 ? '#00d4aa' : '#ff4d6d' },
          { l: 'Win Rate', v: `${stats.winRate}%`, c: stats.winRate >= 50 ? '#00d4aa' : '#ff4d6d' },
          { l: 'R:R Medio', v: stats.rr.toFixed(2), c: stats.rr >= 1 ? '#00d4aa' : '#f5a623' },
          { l: 'Trade Totali', v: `${stats.totalTrades}`, c: 'var(--text-0)' },
        ].map(k => (
          <div key={k.l} style={{ background: 'var(--bg-3)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 5 }}>{k.l}</div>
            <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── PAGINE ──────────────────────────────────────────────────────────────────
function PageDashboard({ tradesHook, setActive }: { tradesHook?: any; setActive?: (s: string) => void }) {
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const sa = setActive || (() => {})
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginTop: 4, textTransform: 'capitalize' }}>{today}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => sa('revisione')} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 12 }}>+ Nuova sessione</button>
          <button onClick={() => sa('playbook')} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Apri Playbook</button>
        </div>
      </div>

      {/* Trading KPI da conti reali */}
      {tradesHook && <TradingKPI tradesHook={tradesHook} setActive={sa} />}



      {/* VIX + indici */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 14 }}>Volatilità</div>
          <VixGauge value={17.8} label="VIX" />
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>VIX <span style={{ color: '#00d4aa', fontFamily: 'var(--font-mono)' }}>17.8</span> — condizioni normali, livelli tecnici affidabili.</div>
          </div>
        </div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Calendario economico</div>
          {NEWS_EVENTS.slice(0, 4).map((e, i) => <NewsRow key={i} ev={e} />)}
        </div>
      </div>

      {/* AI insight */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(0,212,170,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>◈</div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>AI — Pattern settimanale</div>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7 }}>Le sessioni con oltre 7h di sonno mostrano win rate <span style={{ color: '#00d4aa', fontFamily: 'var(--font-mono)' }}>71%</span> vs <span style={{ color: '#ff4d6d', fontFamily: 'var(--font-mono)' }}>38%</span> con meno di 5h. Il secondo trade post-loss ha win rate del <span style={{ color: '#ff4d6d', fontFamily: 'var(--font-mono)' }}>28%</span> — valuta cooldown obbligatorio di 20 minuti.</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VixGauge({ value, label }: { value: number; label: string }) {
  const getColor = (v: number) => v < 20 ? '#00d4aa' : v < 25 ? '#f5a623' : '#ff4d6d'
  const color = getColor(value)
  const angle = Math.min((value / 50) * 180, 180)
  const r = 50, cx = 60, cy = 60
  const rad = (angle - 180) * Math.PI / 180
  const x = cx + r * Math.cos(rad); const y = cy + r * Math.sin(rad)
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={120} height={70} viewBox="0 0 120 70">
        <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="var(--bg-4)" strokeWidth={8} strokeLinecap="round" />
        <path d={`M 10 60 A 50 50 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill={color} />
      </svg>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color, marginTop: -8 }}>{value.toFixed(1)}</div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function PageAnalisi() {
  const [quotes, setQuotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState('')
  const [regionFilter, setRegionFilter] = useState<'all'|'asia'|'europe'|'us'>('all')

  useEffect(() => {
    fetchQuotes()
    const iv = setInterval(fetchQuotes, 60000)
    return () => clearInterval(iv)
  }, [])

  const fetchQuotes = async () => {
    try {
      const res = await fetch('/api/market-data')
      const data = await res.json()
      if (data.quotes?.length) { setQuotes(data.quotes); setLastUpdate(new Date().toLocaleTimeString('it-IT')) }
    } catch {}
    setLoading(false)
  }

  const getQ = (sym: string) => quotes.find(q => q.symbol === sym)
  const pc = (v: number) => v >= 0 ? '#00d4aa' : '#ff4d6d'

  const indexMap = [
    { sym: '^N225', name: 'Nikkei 225', ticker: 'NKY', region: 'asia' },
    { sym: '^HSI', name: 'Hang Seng', ticker: 'HSI', region: 'asia' },
    { sym: '^STOXX50E', name: 'Euro Stoxx 50', ticker: 'SX5E', region: 'europe' },
    { sym: '^GDAXI', name: 'DAX', ticker: 'DAX', region: 'europe' },
    { sym: '^FTSE', name: 'FTSE 100', ticker: 'UKX', region: 'europe' },
    { sym: '^FCHI', name: 'CAC 40', ticker: 'CAC', region: 'europe' },
    { sym: '^IBEX', name: 'IBEX 35', ticker: 'IBEX', region: 'europe' },
    { sym: '^GSPC', name: 'S&P 500', ticker: 'SPX', region: 'us' },
    { sym: '^NDX', name: 'Nasdaq 100', ticker: 'NDX', region: 'us' },
    { sym: '^DJI', name: 'Dow Jones', ticker: 'INDU', region: 'us' },
    { sym: '^RUT', name: 'Russell 2000', ticker: 'RUT', region: 'us' },
  ]
  const filtered = regionFilter === 'all' ? indexMap : indexMap.filter(i => i.region === regionFilter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Analisi Mercati</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading ? 'Caricamento...' : `${lastUpdate}`}
          <button onClick={fetchQuotes} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>↻</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <TradingViewChart symbol="CBOE:VIX" label="VIX — Fear Index" interval="D" height={360} />
        <TradingViewChart symbol="CBOE:VIX9D" label="VIX9D — Short Term Vol" interval="D" height={360} />
        <TradingViewChart symbol="AMEX:SPY" label="SPY — S&P 500 ETF" interval="D" height={360} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <TradingViewChart symbol="NASDAQ:QQQ" label="QQQ — Nasdaq ETF" interval="D" height={380} />
        <TradingViewChart symbol="CBOE:VVIX" label="VVIX — Vol of VIX" interval="D" height={380} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Indici globali — live</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {(['all','asia','europe','us'] as const).map(r => (
                <button key={r} onClick={() => setRegionFilter(r)} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: regionFilter === r ? 'var(--accent-dim)' : 'transparent', color: regionFilter === r ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{r}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {filtered.map(idx => {
              const q = getQ(idx.sym)
              const pct = q?.regularMarketChangePercent || 0
              const price = q?.regularMarketPrice || 0
              return (
                <div key={idx.sym} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', marginBottom: 2 }}>{idx.ticker}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-1)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idx.name}</div>
                  <div style={{ fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-0)' }}>{loading || !price ? '—' : price.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: pc(pct), marginTop: 3 }}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
                </div>
              )
            })}
          </div>
        </div>
        <EconomicCalendar />
      </div>

      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 14 }}>Performance settori S&P 500</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {SECTORS.map(s => <SectorBar key={s.name} s={s} />)}
        </div>
      </div>
    </div>
  )
}

function PagePlaybook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>Playbook Istituzionale</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>◎</div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-0)', marginBottom: 8 }}>Playbook Istituzionale — In sviluppo</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>Compilazione rapida multi-mercato, grafici TradingView annotabili, struttura da hedge fund, export PowerPoint professionale.<br/><span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ Prossima fase</span></div>
      </div>
    </div>
  )
}

function PageRevisione() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>Revisione Sessione</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>◐</div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-0)', marginBottom: 8 }}>Revisione completa — In integrazione</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>Laboratorio movimenti, livelli S/R, VIX contestuale, psico-emotivo e reportistica storica.<br/><span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ Prossima fase</span></div>
      </div>
    </div>
  )
}

function PageSistemi() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>Sistemi Automatici</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>◑</div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-0)', marginBottom: 8 }}>Import MetaTrader — In sviluppo</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>Import file storico MT4/MT5, analisi comparativa sistemi, equity curve e drawdown.<br/><span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ Prossima fase</span></div>
      </div>
    </div>
  )
}

// ─── SIDEBAR CON AUTH ────────────────────────────────────────────────────────
function AuthSidebar({ active, setActive, displayName, initials, isAdmin, onLogout }: {
  active: string; setActive: (s: string) => void; displayName: string
  initials: string; isAdmin: boolean; onLogout: () => void
}) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'analisi', label: 'Analisi Mercati', icon: '◉' },
    { id: 'playbook', label: 'Playbook', icon: '◎' },
    { id: 'revisione', label: 'Revisione', icon: '◐' },
    { id: 'eseguiti', label: 'Eseguiti', icon: '◑' },
    { id: 'operativita', label: 'Operatività', icon: '◐' },
    { id: 'sistemi', label: 'Sistemi Auto', icon: '◒' },
    { id: 'journal', label: 'Journal', icon: '○' },
  ]
  return (
    <aside style={{ width: 220, background: 'var(--bg-1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 100 }}>
      <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>
          Alpha<span style={{ color: 'var(--accent)' }}>Desk</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'DM Mono', monospace", marginTop: 3, letterSpacing: '0.08em' }}>ANALYSIS · REVIEW · EDGE</div>
      </div>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#000', flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{isAdmin ? 'Admin' : 'Trader'}</div>
        </div>
      </div>
      <nav style={{ padding: '12px 10px', flex: 1 }}>
        {nav.map(item => (
          <button key={item.id} onClick={() => setActive(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none', background: active === item.id ? 'var(--accent-dim)' : 'transparent', color: active === item.id ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontSize: 13, fontWeight: active === item.id ? 500 : 400, marginBottom: 2, textAlign: 'left', borderLeft: active === item.id ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
            <span style={{ fontSize: 16 }}>{item.icon}</span>{item.label}
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => setActive('admin')} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none', background: active === 'admin' ? 'rgba(245,166,35,0.1)' : 'transparent', color: active === 'admin' ? 'var(--amber)' : 'var(--text-2)', cursor: 'pointer', fontSize: 13, marginBottom: 2, textAlign: 'left', borderLeft: active === 'admin' ? '2px solid var(--amber)' : '2px solid transparent', marginTop: 8 }}>
            <span style={{ fontSize: 16 }}>⚙</span>Utenti
          </button>
        )}
      </nav>
      <div style={{ padding: '14px 10px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono', monospace", marginBottom: 10, paddingLeft: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }}></span>
          LIVE — {new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12, transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,77,109,0.3)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}>
          ⏻ Esci
        </button>
      </div>
    </aside>
  )
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────
export default function App() {
  const [active, setActive] = useState('dashboard')
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); loadProfile(session.user.id) }
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) { setUser(session.user); loadProfile(session.user.id) }
      else { setUser(null); setProfile(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) setProfile(data)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null)
  }

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace" }}>Caricamento...</div>
    </div>
  )
  if (!user) return <LoginPage onLogin={(u) => { setUser(u); loadProfile(u.id) }} />

  const displayName = profile?.full_name || user.email?.split('@')[0] || 'Utente'
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const isAdmin = profile?.role === 'admin'

  return (
    <AppWithTrades user={user} profile={profile} isAdmin={isAdmin} displayName={displayName} initials={initials} active={active} setActive={setActive} onLogout={handleLogout} />
  )
}

function AppWithTrades({ user, profile, isAdmin, displayName, initials, active, setActive, onLogout }: any) {
  const tradesHook = useTrades(user.id)

  const pages: Record<string, React.ReactNode> = {
    dashboard: <PageDashboard tradesHook={tradesHook} setActive={setActive} />,
    analisi: <PageAnalisi />,
    playbook: <PagePlaybook />,
    revisione: <PageRevisione />,
    eseguiti: <TradesAdvanced userId={user.id} tradesHook={tradesHook} />,
    operativita: <PageOperativita tradesHook={tradesHook} />,
    sistemi: <PageSistemi />,
    journal: <PageDashboard tradesHook={tradesHook} setActive={setActive} />,
    admin: isAdmin ? <AdminPanel currentUser={user} /> : <PageDashboard tradesHook={tradesHook} setActive={setActive} />,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <AuthSidebar active={active} setActive={setActive} displayName={displayName} initials={initials} isAdmin={isAdmin} onLogout={onLogout} />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', minHeight: '100vh', background: 'var(--bg-0)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          {pages[active]}
        </div>
      </main>
    </div>
  )
}

// ─── PAGINA OPERATIVITÀ ───────────────────────────────────────────────────────
function PageOperativita({ tradesHook }: { tradesHook: any }) {
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [selectedStrategy, setSelectedStrategy] = useState<string>('all')
  const accounts = tradesHook?.accounts || []
  const allTrades = tradesHook?.trades || []

  const filtered = allTrades.filter((t: any) =>
    (selectedAccount === 'all' || t.account === selectedAccount) &&
    (selectedStrategy === 'all' || t.strategy === selectedStrategy)
  )
  const strategies = ['all', ...new Set(
    allTrades.filter((t: any) => selectedAccount === 'all' || t.account === selectedAccount).map((t: any) => t.strategy)
  )] as string[]

  const pc = (v: number) => v >= 0 ? '#00d4aa' : '#ff4d6d'
  const fmtUSD = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`

  // Stats per conto
  const byAccount = accounts.map((acc: string) => {
    const t = allTrades.filter((x: any) => x.account === acc)
    const wins = t.filter((x: any) => x.net_pnl > 0)
    const pnl = t.reduce((s: number, x: any) => s + x.net_pnl, 0)
    const perf = tradesHook?.perfReports?.[acc]
    return {
      account: acc,
      trades: t.length || perf?.totalTrades || 0,
      pnl: t.length > 0 ? pnl : perf?.totalNetProfit || 0,
      winRate: t.length > 0 ? wins.length / t.length * 100 : perf?.winRate || 0,
      rr: perf?.rrRatio || 0,
      hasDetail: t.length > 0,
    }
  })

  // Stats per strategia (se trade singoli disponibili)
  const byStrategy = strategies.slice(1).map((strat: string) => {
    const t = filtered.filter((x: any) => x.strategy === strat)
    const wins = t.filter((x: any) => x.net_pnl > 0)
    const pnl = t.reduce((s: number, x: any) => s + x.net_pnl, 0)
    return { strategy: strat, trades: t.length, pnl, winRate: t.length > 0 ? wins.length / t.length * 100 : 0 }
  })

  // Emotion summary
  const EMOTION_COLORS: Record<string, string> = {
    fomo: '#f5a623', revenge: '#ff4d6d', early_exit: '#4da6ff',
    overtrading: '#ff6b35', hesitation: '#9b59b6', disciplined: '#00d4aa',
    patient: '#2ecc71', overconfident: '#e67e22', fear: '#e74c3c', plan_trade: '#1abc9c'
  }
  const tagMap: Record<string, {pnl: number; wins: number; count: number}> = {}
  filtered.forEach((t: any) => {
    (t.emotion_tags || []).forEach((tag: string) => {
      if (!tagMap[tag]) tagMap[tag] = {pnl: 0, wins: 0, count: 0}
      tagMap[tag].pnl += t.net_pnl; tagMap[tag].count++
      if (t.net_pnl > 0) tagMap[tag].wins++
    })
  })
  const emotionStats = Object.entries(tagMap).map(([tag, v]) => ({
    tag, pnl: v.pnl, count: v.count, wr: v.wins / v.count * 100,
    color: EMOTION_COLORS[tag] || '#8fa3b8'
  })).sort((a, b) => b.count - a.count)

  const ruleYes = filtered.filter((t: any) => t.rule_followed === true)
  const ruleNo = filtered.filter((t: any) => t.rule_followed === false)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:26,letterSpacing:'-0.02em'}}>Analisi Operatività</div>

      {accounts.length === 0 ? (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:40,textAlign:'center'}}>
          <div style={{fontSize:32,opacity:0.2,marginBottom:12}}>◑</div>
          <div style={{fontSize:14,color:'var(--text-1)'}}>Nessun dato — importa i tuoi eseguiti nella sezione Eseguiti</div>
        </div>
      ) : (
        <>
          {/* Riepilogo per conto */}
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:14}}>Performance per conto</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>
              {byAccount.map((acc: any) => (
                <div key={acc.account} style={{background:'var(--bg-3)',borderRadius:10,padding:'14px 16px',border:`1px solid ${selectedAccount===acc.account?'var(--accent)':'var(--border)'}`,cursor:'pointer'}}
                  onClick={()=>setSelectedAccount(selectedAccount===acc.account?'all':acc.account)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:14,fontWeight:600,color:'var(--text-0)',fontFamily:'var(--font-mono)'}}>{acc.account}</div>
                    {!acc.hasDetail && <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:'var(--amber-dim)',color:'var(--amber)'}}>Solo summary</span>}
                  </div>
                  <div style={{fontSize:22,fontFamily:'var(--font-mono)',fontWeight:800,color:pc(acc.pnl),marginBottom:8}}>{fmtUSD(acc.pnl)}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:11}}>
                    <div><div style={{color:'var(--text-2)'}}>Trade</div><div style={{fontFamily:'var(--font-mono)',fontWeight:500}}>{acc.trades}</div></div>
                    <div><div style={{color:'var(--text-2)'}}>Win Rate</div><div style={{fontFamily:'var(--font-mono)',fontWeight:500,color:acc.winRate>=50?'#00d4aa':'#ff4d6d'}}>{acc.winRate.toFixed(1)}%</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Filtri */}
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase'}}>Conto:</div>
            <button onClick={()=>setSelectedAccount('all')} style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${selectedAccount==='all'?'var(--accent)':'var(--border)'}`,background:selectedAccount==='all'?'var(--accent-dim)':'transparent',color:selectedAccount==='all'?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:11}}>Tutti</button>
            {accounts.map((a: string) => (
              <button key={a} onClick={()=>setSelectedAccount(a)} style={{padding:'5px 12px',borderRadius:5,border:`1px solid ${selectedAccount===a?'var(--accent)':'var(--border)'}`,background:selectedAccount===a?'var(--accent-dim)':'transparent',color:selectedAccount===a?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-mono)'}}>{a}</button>
            ))}
            {strategies.length > 2 && <>
              <div style={{width:1,height:16,background:'var(--border)'}}></div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase'}}>Strategia:</div>
              {strategies.map(s => (
                <button key={s} onClick={()=>setSelectedStrategy(s)} style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${selectedStrategy===s?'var(--amber)':'var(--border)'}`,background:selectedStrategy===s?'rgba(245,166,35,0.15)':'transparent',color:selectedStrategy===s?'var(--amber)':'var(--text-1)',cursor:'pointer',fontSize:11}}>{s==='all'?'Tutte':s}</button>
              ))}
            </>}
          </div>

          {/* Performance per strategia */}
          {byStrategy.length > 0 && filtered.length > 0 && (
            <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:14}}>Performance per strategia</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {byStrategy.map((s: any) => (
                  <div key={s.strategy} style={{display:'grid',gridTemplateColumns:'140px 1fr 80px 80px 80px',alignItems:'center',gap:12,padding:'10px 14px',background:'var(--bg-3)',borderRadius:8}}>
                    <div style={{fontSize:13,fontWeight:500,color:'var(--text-0)'}}>{s.strategy}</div>
                    <div style={{height:8,background:'var(--bg-2)',borderRadius:4,overflow:'hidden',position:'relative'}}>
                      <div style={{position:'absolute',left:'50%',top:0,width:1,height:'100%',background:'var(--border)'}}></div>
                      <div style={{position:'absolute',left:s.pnl>=0?'50%':'auto',right:s.pnl<0?'50%':'auto',width:`${Math.min(Math.abs(s.pnl)/Math.max(...byStrategy.map((x:any)=>Math.abs(x.pnl)),1)*50,50)}%`,height:'100%',background:s.pnl>=0?'#00d4aa':'#ff4d6d',opacity:0.8}}></div>
                    </div>
                    <div style={{fontSize:11,color:'var(--text-2)',textAlign:'center'}}>{s.trades} trade</div>
                    <div style={{fontSize:12,fontFamily:'var(--font-mono)',color:s.winRate>=50?'#00d4aa':'#ff4d6d',textAlign:'center'}}>{s.winRate.toFixed(0)}% WR</div>
                    <div style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:pc(s.pnl),textAlign:'right'}}>{fmtUSD(s.pnl)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Psico-emotivo dettagliato */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {/* Disciplina */}
            <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:14}}>Disciplina — regole operative</div>
              {ruleYes.length === 0 && ruleNo.length === 0 ? (
                <div style={{fontSize:12,color:'var(--text-2)',textAlign:'center',padding:'20px 0'}}>Vai in Eseguiti → Lista Trade e valuta le regole espandendo ogni trade</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {[
                    {label:'✓ Regole rispettate',trades:ruleYes,c:'#00d4aa'},
                    {label:'✗ Regole NON rispettate',trades:ruleNo,c:'#ff4d6d'},
                  ].map(r => {
                    const pnl = r.trades.reduce((s: number, t: any) => s+t.net_pnl, 0)
                    const wr = r.trades.length > 0 ? r.trades.filter((t: any) => t.net_pnl > 0).length / r.trades.length * 100 : 0
                    return (
                      <div key={r.label} style={{background:'var(--bg-3)',borderRadius:10,padding:'12px 14px'}}>
                        <div style={{fontSize:12,fontWeight:600,color:r.c,marginBottom:8}}>{r.label}</div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,fontSize:12}}>
                          <div><div style={{fontSize:10,color:'var(--text-2)'}}>Trade</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700}}>{r.trades.length}</div></div>
                          <div><div style={{fontSize:10,color:'var(--text-2)'}}>Win Rate</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:wr>=50?'#00d4aa':'#ff4d6d'}}>{wr.toFixed(0)}%</div></div>
                          <div><div style={{fontSize:10,color:'var(--text-2)'}}>P&L</div><div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:pc(pnl)}}>{fmtUSD(pnl)}</div></div>
                        </div>
                      </div>
                    )
                  })}
                  {ruleNo.length > 0 && ruleYes.length > 0 && (() => {
                    const diffPnl = ruleYes.reduce((s: number, t: any) => s+t.net_pnl, 0) - ruleNo.reduce((s: number, t: any) => s+t.net_pnl, 0)
                    return diffPnl > 0 ? (
                      <div style={{padding:'10px 12px',background:'var(--accent-dim)',borderRadius:8,fontSize:12,color:'var(--accent)'}}>
                        ◈ La disciplina vale <strong>{fmtUSD(diffPnl)}</strong> in più rispetto ai trade fuori regole.
                      </div>
                    ) : null
                  })()}
                </div>
              )}
            </div>

            {/* Tag emotivi */}
            <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:14}}>Performance per stato emotivo</div>
              {emotionStats.length === 0 ? (
                <div style={{fontSize:12,color:'var(--text-2)',textAlign:'center',padding:'20px 0'}}>Nessun tag emotivo ancora — aggiungili espandendo i trade singoli</div>
              ) : emotionStats.map((e: any) => (
                <div key={e.tag} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'8px 10px',background:'var(--bg-3)',borderRadius:7}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:e.color,flexShrink:0,boxShadow:`0 0 4px ${e.color}`}}></div>
                  <div style={{flex:1,fontSize:12,fontWeight:500,color:'var(--text-0)'}}>{e.tag}</div>
                  <div style={{fontSize:11,color:'var(--text-2)',width:55}}>{e.count} trade</div>
                  <div style={{width:80,height:5,background:'var(--bg-2)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{width:`${e.wr}%`,height:'100%',background:e.wr>=50?'#00d4aa':'#ff4d6d',borderRadius:3}}></div>
                  </div>
                  <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:e.wr>=50?'#00d4aa':'#ff4d6d',width:36}}>{e.wr.toFixed(0)}%</div>
                  <div style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:pc(e.pnl),width:72,textAlign:'right'}}>{fmtUSD(e.pnl)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
