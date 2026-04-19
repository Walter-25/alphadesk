'use client'
import { useState, useEffect } from 'react'

// ─── TIPI ────────────────────────────────────────────────────────────────────
interface Index { name: string; ticker: string; value: string; chg: string; pct: string; region: 'asia'|'europe'|'us' }
interface NewsEvent { time: string; currency: string; impact: 'high'|'medium'|'low'; event: string; actual?: string; forecast?: string; previous?: string }
interface SectorData { name: string; pct: number }

// ─── DATI MOCK (saranno sostituiti da API reali) ──────────────────────────────
const INDICES: Index[] = [
  // ASIA
  { name: 'Nikkei 225', ticker: 'NKY', value: '38,475', chg: '-1,042', pct: '-1.75', region: 'asia' },
  { name: 'Hang Seng', ticker: 'HSI', value: '26,160', chg: '-233', pct: '-0.89', region: 'asia' },
  { name: 'CSI 300', ticker: 'SHSZ300', value: '4,728', chg: '-7.9', pct: '-0.17', region: 'asia' },
  { name: 'ASX 200', ticker: 'AS51', value: '8,946', chg: '-8.1', pct: '-0.09', region: 'asia' },
  // EUROPE
  { name: 'Euro Stoxx 50', ticker: 'SX5E', value: '6,057', chg: '+124', pct: '+2.10', region: 'europe' },
  { name: 'DAX', ticker: 'DAX', value: '24,702', chg: '+547', pct: '+2.27', region: 'europe' },
  { name: 'FTSE 100', ticker: 'UKX', value: '10,667', chg: '+77', pct: '+0.73', region: 'europe' },
  { name: 'CAC 40', ticker: 'CAC', value: '8,425', chg: '+162', pct: '+1.97', region: 'europe' },
  // US
  { name: 'S&P 500', ticker: 'SPX', value: '5,452', chg: '+38', pct: '+0.71', region: 'us' },
  { name: 'Nasdaq 100', ticker: 'NDX', value: '19,284', chg: '+142', pct: '+0.74', region: 'us' },
  { name: 'Dow Jones', ticker: 'INDU', value: '40,212', chg: '+289', pct: '+0.72', region: 'us' },
  { name: 'Russell 2000', ticker: 'RUT', value: '2,071', chg: '+12', pct: '+0.58', region: 'us' },
]

const SECTORS: SectorData[] = [
  { name: 'Consumer Cycl.', pct: 2.11 },
  { name: 'Industrials', pct: 2.00 },
  { name: 'Technology', pct: 1.69 },
  { name: 'Real Estate', pct: 1.59 },
  { name: 'Healthcare', pct: 1.56 },
  { name: 'Consumer Def.', pct: 1.40 },
  { name: 'Basic Materials', pct: 1.37 },
  { name: 'Financial', pct: 1.18 },
  { name: 'Comm. Services', pct: 0.81 },
  { name: 'Utilities', pct: -0.33 },
  { name: 'Energy', pct: -1.85 },
]

const NEWS_EVENTS: NewsEvent[] = [
  { time: '14:30', currency: 'USD', impact: 'high', event: 'Core CPI m/m', actual: '0.3%', forecast: '0.3%', previous: '0.2%' },
  { time: '14:30', currency: 'USD', impact: 'high', event: 'Initial Jobless Claims', actual: '215K', forecast: '220K', previous: '219K' },
  { time: '16:00', currency: 'USD', impact: 'medium', event: 'ISM Services PMI', forecast: '52.8', previous: '53.5' },
  { time: '16:30', currency: 'USD', impact: 'low', event: 'Natural Gas Storage', forecast: '-38B', previous: '-62B' },
  { time: '18:00', currency: 'USD', impact: 'medium', event: 'Fed Speaker — Williams', },
]

const VIX_DATA = { value: 17.8, prev: 19.2, chg: '-1.40', pct: '-7.29' }
const VVIX_DATA = { value: 92.4, prev: 98.1 }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isPos = (s: string) => s.startsWith('+') || (!s.startsWith('-') && parseFloat(s) >= 0)
const pctColor = (p: string | number) => { const n = typeof p === 'string' ? parseFloat(p) : p; return n > 0 ? '#00d4aa' : n < 0 ? '#ff4d6d' : '#8fa3b8' }
const impactColor = (i: string) => i === 'high' ? '#ff4d6d' : i === 'medium' ? '#f5a623' : '#8fa3b8'

// ─── COMPONENTI ──────────────────────────────────────────────────────────────

function Sidebar({ active, setActive }: { active: string; setActive: (s: string) => void }) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'analisi', label: 'Analisi Mercati', icon: '◉' },
    { id: 'playbook', label: 'Playbook', icon: '◎' },
    { id: 'revisione', label: 'Revisione', icon: '◐' },
    { id: 'sistemi', label: 'Sistemi Auto', icon: '◑' },
    { id: 'journal', label: 'Journal', icon: '◒' },
  ]
  return (
    <aside style={{ width: 220, background: 'var(--bg-1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 100 }}>
      {/* Logo */}
      <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--text-0)' }}>
          Alpha<span style={{ color: 'var(--accent)' }}>Desk</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginTop: 3, letterSpacing: '0.08em' }}>ANALYSIS · REVIEW · EDGE</div>
      </div>

      {/* User */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#000', flexShrink: 0 }}>W</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }}>Walter F.</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>Admin</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '12px 10px', flex: 1 }}>
        {nav.map(item => (
          <button key={item.id} onClick={() => setActive(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none', background: active === item.id ? 'var(--accent-dim)' : 'transparent', color: active === item.id ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontSize: 13, fontWeight: active === item.id ? 500 : 400, marginBottom: 2, textAlign: 'left', borderLeft: active === item.id ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 2s infinite' }}></span>
          LIVE — {new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </aside>
  )
}

function IndexCard({ idx }: { idx: Index }) {
  const pos = isPos(idx.pct)
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', transition: 'border-color 0.2s', cursor: 'default' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{idx.ticker}</div>
          <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 6 }}>{idx.name}</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>{idx.value}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: pctColor(idx.pct), fontWeight: 500 }}>{idx.pct}%</div>
          <div style={{ fontSize: 11, color: pctColor(idx.chg), fontFamily: 'var(--font-mono)', marginTop: 2 }}>{idx.chg}</div>
          <div style={{ width: 40, height: 3, borderRadius: 2, background: pos ? 'var(--green-dim)' : 'var(--red-dim)', marginTop: 8, marginLeft: 'auto', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(Math.abs(parseFloat(idx.pct)) * 30, 100)}%`, height: '100%', background: pos ? 'var(--green)' : 'var(--red)', borderRadius: 2 }}></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectorBar({ s }: { s: SectorData }) {
  const pos = s.pct >= 0
  const maxAbs = 2.5
  const pct = Math.abs(s.pct) / maxAbs * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div style={{ width: 110, fontSize: 12, color: 'var(--text-1)', flexShrink: 0, textAlign: 'right' }}>{s.name}</div>
      <div style={{ flex: 1, height: 18, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: pos ? '50%' : `calc(50% - ${pct/2}%)`, width: `${pct/2}%`, height: '100%', background: pos ? 'var(--green)' : 'var(--red)', opacity: 0.8, borderRadius: 2 }}></div>
        <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-hover)' }}></div>
      </div>
      <div style={{ width: 48, fontSize: 12, fontFamily: 'var(--font-mono)', color: pctColor(s.pct), textAlign: 'right', flexShrink: 0 }}>{s.pct > 0 ? '+' : ''}{s.pct}%</div>
    </div>
  )
}

function NewsRow({ ev }: { ev: NewsEvent }) {
  const hasActual = !!ev.actual
  const beatForecast = ev.actual && ev.forecast && parseFloat(ev.actual) > parseFloat(ev.forecast)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 36, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', flexShrink: 0 }}>{ev.time}</div>
      <div style={{ width: 4, height: 4, borderRadius: '50%', background: impactColor(ev.impact), flexShrink: 0, boxShadow: `0 0 4px ${impactColor(ev.impact)}` }}></div>
      <div style={{ width: 36, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--blue)', flexShrink: 0 }}>{ev.currency}</div>
      <div style={{ flex: 1, fontSize: 12, color: 'var(--text-0)' }}>{ev.event}</div>
      {ev.forecast && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', flexShrink: 0 }}>prev {ev.previous}</div>}
      {ev.forecast && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', flexShrink: 0 }}>est {ev.forecast}</div>}
      {ev.actual && <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: beatForecast ? 'var(--green)' : 'var(--red)', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>{ev.actual}</div>}
      {!ev.actual && <div style={{ width: 40 }}></div>}
    </div>
  )
}

function VixGauge({ value, label }: { value: number; label: string }) {
  const getColor = (v: number) => v < 15 ? '#00d4aa' : v < 20 ? '#00d4aa' : v < 25 ? '#f5a623' : '#ff4d6d'
  const getLabel = (v: number) => v < 15 ? 'CALMO' : v < 20 ? 'NORMALE' : v < 25 ? 'ELEVATO' : v < 35 ? 'ALTO' : 'ESTREMO'
  const color = getColor(value)
  const angle = Math.min((value / 50) * 180, 180)
  const r = 50, cx = 60, cy = 60
  const rad = (angle - 180) * Math.PI / 180
  const x = cx + r * Math.cos(rad)
  const y = cy + r * Math.sin(rad)
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={120} height={70} viewBox="0 0 120 70">
        <path d={`M 10 60 A 50 50 0 0 1 110 60`} fill="none" stroke="var(--bg-4)" strokeWidth={8} strokeLinecap="round" />
        <path d={`M 10 60 A 50 50 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill={color} />
      </svg>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color, marginTop: -8 }}>{value.toFixed(1)}</div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color, letterSpacing: '0.08em', marginTop: 2 }}>{getLabel(value)}</div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

// ─── PAGINE ───────────────────────────────────────────────────────────────────

function PageDashboard() {
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginTop: 4, textTransform: 'capitalize' }}>{today}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 12 }}>+ Nuova sessione</button>
          <button style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Apri Playbook</button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'P&L settimana', val: '+€1.240', sub: '+3 sessioni positive', pos: true },
          { label: 'Win rate (30gg)', val: '62%', sub: '21 trade eseguiti', pos: true },
          { label: 'Max drawdown', val: '-€380', sub: 'sotto soglia', pos: false },
          { label: 'Sessioni registrate', val: '14', sub: 'questo mese', pos: null },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 600, color: k.pos === true ? 'var(--green)' : k.pos === false ? 'var(--red)' : 'var(--text-0)' }}>{k.val}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* VIX + Indici rapidi */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>Volatilità</div>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <VixGauge value={VIX_DATA.value} label="VIX" />
            <VixGauge value={VVIX_DATA.value} label="VVIX" />
          </div>
          <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>
              VIX in calo del <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>7.3%</span> rispetto a ieri. Condizioni normali, livelli tecnici affidabili.
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Performance indici — oggi</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {INDICES.filter(i => ['SPX','NDX','SX5E','NKY'].includes(i.ticker)).map(idx => (
              <div key={idx.ticker} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{idx.ticker}</div>
                <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, marginTop: 2, color: 'var(--text-0)' }}>{idx.value}</div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: pctColor(idx.pct), marginTop: 2 }}>{idx.pct}%</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8 }}>Prossime news</div>
            {NEWS_EVENTS.slice(0, 2).map((e, i) => <NewsRow key={i} ev={e} />)}
          </div>
        </div>
      </div>

      {/* AI insight */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: '100%', background: 'radial-gradient(ellipse at right, rgba(0,212,170,0.06) 0%, transparent 70%)', pointerEvents: 'none' }}></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(0,212,170,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>◈</div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>AI — Pattern settimanale</div>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7 }}>Le sessioni con oltre 7h di sonno mostrano win rate <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>71%</span> vs <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>38%</span> con meno di 5h. Hai una tendenza a chiudere i long in anticipo nelle sessioni europee quando sei sotto pressione — il secondo trade post-loss ha win rate del <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>28%</span>. Valuta cooldown obbligatorio di 20 minuti.</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PageAnalisi() {
  const [regionFilter, setRegionFilter] = useState<'all'|'asia'|'europe'|'us'>('all')
  const filtered = regionFilter === 'all' ? INDICES : INDICES.filter(i => i.region === regionFilter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Analisi Mercati</div>

      {/* VIX row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>VIX — Fear Index</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <VixGauge value={17.8} label="" />
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.8 }}>
                <div>Prev close: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>19.2</span></div>
                <div>Var: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>-7.3%</span></div>
                <div>52w High: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>38.4</span></div>
                <div>52w Low: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>12.1</span></div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-3)', borderRadius: 6, fontSize: 11, color: 'var(--green)' }}>
            ↓ Volatilità in calo — condizioni favorevoli ai livelli tecnici
          </div>
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>VVIX — Volatility of VIX</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <VixGauge value={92.4} label="" />
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.8 }}>
                <div>Prev close: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>98.1</span></div>
                <div>Var: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>-5.8%</span></div>
                <div>Soglia: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>&gt;100 allerta</span></div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10 }}>Calendario economico</div>
          {NEWS_EVENTS.map((e, i) => <NewsRow key={i} ev={e} />)}
          <div style={{ marginTop: 10 }}>
            <a href="https://www.investing.com/economic-calendar/" target="_blank" rel="noopener" style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ Calendario completo su Investing.com</a>
          </div>
        </div>
      </div>

      {/* Indici globali */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Indici globali</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all','asia','europe','us'] as const).map(r => (
              <button key={r} onClick={() => setRegionFilter(r)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: regionFilter === r ? 'var(--accent-dim)' : 'transparent', color: regionFilter === r ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {filtered.map(idx => <IndexCard key={idx.ticker} idx={idx} />)}
        </div>
      </div>

      {/* Settori */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Performance settori S&P 500 — oggi</div>
          {SECTORS.map(s => <SectorBar key={s.name} s={s} />)}
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Grafici — TradingView embedded</div>
          <div style={{ background: 'var(--bg-3)', borderRadius: 8, padding: 16, textAlign: 'center', height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>◎</div>
            <div style={{ fontSize: 13, color: 'var(--text-1)' }}>Grafico TradingView</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', maxWidth: 260, textAlign: 'center', lineHeight: 1.6 }}>Nel sito deployato, qui caricherai i widget TradingView di SPY, QQQ, ES1! con trendline e livelli annotabili direttamente in piattaforma</div>
            <a href="https://it.tradingview.com/chart/" target="_blank" rel="noopener" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>→ Apri TradingView</a>
          </div>
        </div>
      </div>
    </div>
  )
}

function PagePlaybook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Playbook Istituzionale</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 12 }}>◎</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, color: 'var(--text-0)' }}>Modulo Playbook — Fase 2</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
          Compilazione rapida multi-mercato con grafici TradingView annotabili, struttura istituzionale, esportazione PowerPoint professionale da hedge fund.<br /><br />
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ In sviluppo nella Fase 2</span>
        </div>
      </div>
    </div>
  )
}

function PageSistemi() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Sistemi Automatici</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 12 }}>◑</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, color: 'var(--text-0)' }}>Import MetaTrader — Fase 3</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
          Import file storico MetaTrader (.csv/.html), analisi comparativa due sistemi, equity curve, drawdown, statistiche avanzate.<br /><br />
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ In sviluppo nella Fase 3</span>
        </div>
      </div>
    </div>
  )
}

function PageRevisione() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Revisione Sessione</div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 12 }}>◐</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, color: 'var(--text-0)' }}>Modulo Revisione completo — disponibile</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
          Il modulo di revisione giornaliera con laboratorio movimenti, livelli, VIX contestuale e psico-emotivo è già pronto.<br />Verrà integrato qui con persistenza dati Supabase.<br /><br />
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>→ Integrazione in corso</span>
        </div>
      </div>
    </div>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [active, setActive] = useState('dashboard')

  const pages: Record<string, React.ReactNode> = {
    dashboard: <PageDashboard />,
    analisi: <PageAnalisi />,
    playbook: <PagePlaybook />,
    revisione: <PageRevisione />,
    sistemi: <PageSistemi />,
    journal: <PageDashboard />,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar active={active} setActive={setActive} />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', minHeight: '100vh', background: 'var(--bg-0)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          {pages[active]}
        </div>
      </main>
    </div>
  )
}
