'use client'
import { useState, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, PieChart, Pie, Cell, LineChart, Line } from 'recharts'

// ─── TIPI ─────────────────────────────────────────────────────────────────────
interface Trade {
  id: string; account: string; strategy: string; instrument: string
  direction: 'Long'|'Short'; entry_time: string; exit_time: string
  duration_min: number; entry_price: number; exit_price: number
  quantity: number; pnl: number; commission: number; net_pnl: number
  mae?: number; mfe?: number
  // Emotivi
  emotion_tags?: string[]; rule_followed?: boolean; notes?: string
  setup_quality?: 1|2|3|4|5
}

interface DayStats {
  date: string; pnl: number; trades: number; wins: number
}

interface PerfReport {
  totalNetProfit: number; grossProfit: number; grossLoss: number
  commission: number; profitFactor: number; maxDrawdown: number
  sharpeRatio: number; totalTrades: number; winRate: number
  winTrades: number; lossTrades: number; avgTrade: number
  avgWin: number; avgLoss: number; rrRatio: number
  maxConsecWin: number; maxConsecLoss: number
  largestWin: number; largestLoss: number; avgTimeInMarket: string
  startDate: string; endDate: string; avgMAE: number; avgMFE: number
  longStats: { netProfit: number; winRate: number; trades: number }
  shortStats: { netProfit: number; winRate: number; trades: number }
}

// ─── EMOTION TAGS ─────────────────────────────────────────────────────────────
const EMOTION_TAGS = [
  { id: 'fomo', label: 'FOMO', color: '#f5a623', desc: 'Entrato per paura di perdere' },
  { id: 'revenge', label: 'Revenge', color: '#ff4d6d', desc: 'Trade di recupero dopo loss' },
  { id: 'early_exit', label: 'Uscita anticipata', color: '#4da6ff', desc: 'Chiuso prima del target' },
  { id: 'overtrading', label: 'Overtrading', color: '#ff6b35', desc: 'Troppi trade in sequenza' },
  { id: 'hesitation', label: 'Esitazione', color: '#9b59b6', desc: 'Entrato in ritardo' },
  { id: 'disciplined', label: 'Disciplinato', color: '#00d4aa', desc: 'Setup rispettato al 100%' },
  { id: 'patient', label: 'Paziente', color: '#00d4aa', desc: 'Atteso conferma setup' },
  { id: 'overconfident', label: 'Overconfidence', color: '#e67e22', desc: 'Size troppo grande' },
  { id: 'fear', label: 'Paura', color: '#e74c3c', desc: 'Size ridotta per paura' },
  { id: 'plan_trade', label: 'Trade pianificato', color: '#2ecc71', desc: 'Nel piano pre-sessione' },
]

const POSITIVE_TAGS = ['disciplined', 'patient', 'plan_trade']

// ─── PARSER PERFORMANCE REPORT ────────────────────────────────────────────────
function parseNinjaPerfReport(text: string): PerfReport | null {
  const data: Record<string, string[]> = {}
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r/,'').split(';')
    if (cols[0]?.trim()) data[cols[0].trim()] = cols.slice(1).map(c => c.trim()).filter(Boolean)
  }
  const num = (key: string, col = 0) => parseFloat((data[key]?.[col] || '0').replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
  const str = (key: string, col = 0) => data[key]?.[col] || ''
  if (!data['Total net profit']) return null
  return {
    totalNetProfit: num('Total net profit'), grossProfit: num('Gross profit'),
    grossLoss: num('Gross loss'), commission: num('Commission'),
    profitFactor: num('Profit factor'), maxDrawdown: num('Max drawdown'),
    sharpeRatio: num('Sharpe ratio'), totalTrades: num('Total # of trades'),
    winRate: num('Percent profitable'), winTrades: num('# of winning trades'),
    lossTrades: num('# of losing trades'), avgTrade: num('Avg trade'),
    avgWin: num('Avg winning trade'), avgLoss: num('Avg losing trade'),
    rrRatio: num('Ratio avg win / avg loss'), maxConsecWin: num('Max consec winners'),
    maxConsecLoss: num('Max consec losers'), largestWin: num('Largest winning trade'),
    largestLoss: num('Largest losing trade'), avgTimeInMarket: str('Avg time in market'),
    startDate: str('Start date'), endDate: str('End date'),
    avgMAE: num('Avg MAE'), avgMFE: num('Avg MFE'),
    longStats: { netProfit: num('Total net profit',1), winRate: num('Percent profitable',1), trades: num('Total # of trades',1) },
    shortStats: { netProfit: num('Total net profit',2), winRate: num('Percent profitable',2), trades: num('Total # of trades',2) },
  }
}

// ─── PARSER LISTA TRADE ───────────────────────────────────────────────────────
function parseNinjaTradeList(text: string, account: string): Trade[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const sep = text.includes(';') ? ';' : ','
  const header = lines[0].replace(/\r/,'').split(sep).map(h => h.trim().toLowerCase().replace(/"/g,''))
  const trades: Trade[] = []
  const get = (cols: string[], keys: string[]) => {
    for (const k of keys) {
      const idx = header.findIndex(h => h.includes(k))
      if (idx >= 0 && cols[idx]?.trim()) return cols[idx].trim().replace(/"/g,'')
    }
    return ''
  }
  const parseNum = (s: string) => parseFloat(s.replace(/[^0-9,.-]/g,'').replace(',','.')) || 0

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r/,'').split(sep)
    if (cols.length < 4) continue
    const pnl = parseNum(get(cols, ['profit','pnl','p&l','net profit','gain']))
    const comm = parseNum(get(cols, ['commission','comm']))
    const entryStr = get(cols, ['entry time','entry_time','time of entry'])
    const exitStr = get(cols, ['exit time','exit_time','time of exit'])
    const e1 = new Date(entryStr), e2 = new Date(exitStr)
    const dur = !isNaN(e1.getTime()) && !isNaN(e2.getTime()) ? Math.round((e2.getTime()-e1.getTime())/60000) : 0
    const dirRaw = get(cols, ['direction','dir','side','market pos','market position','tipo']) || 'Long'
    trades.push({
      id: `${account}-${i}`,
      account, strategy: get(cols, ['strategy','strategia']) || 'Manual',
      instrument: get(cols, ['instrument','strumento','market','ticker','symbol']) || 'N/A',
      direction: dirRaw.toLowerCase().includes('short') ? 'Short' : 'Long',
      entry_time: entryStr, exit_time: exitStr, duration_min: dur,
      entry_price: parseNum(get(cols, ['entry price','avg entry'])),
      exit_price: parseNum(get(cols, ['exit price','avg exit'])),
      quantity: parseInt(get(cols, ['quantity','qty','size'])) || 1,
      pnl, commission: comm, net_pnl: pnl - comm,
      mae: parseNum(get(cols, ['mae'])) || undefined,
      mfe: parseNum(get(cols, ['mfe'])) || undefined,
      emotion_tags: [], rule_followed: undefined, notes: '',
    })
  }
  return trades
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pc = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const fmtUSD = (v: number, sign = true) => `${sign && v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`

function generateInsight(s: PerfReport): string {
  const ins: string[] = []
  if (s.winRate >= 50) ins.push(`Win rate ${s.winRate.toFixed(1)}% — consistente.`)
  else ins.push(`Win rate ${s.winRate.toFixed(1)}% — sotto 50%, serve R:R > 1 per essere profittevole.`)
  if (s.rrRatio >= 1.5) ins.push(`R:R ${s.rrRatio.toFixed(2)} ottimo.`)
  else if (s.rrRatio < 1) ins.push(`⚠ R:R ${s.rrRatio.toFixed(2)} — perdite medie > guadagni medi. Lavora sulle uscite.`)
  if (s.longStats.netProfit > 0 && s.shortStats.netProfit < 0) ins.push(`Long profittevole (+$${s.longStats.netProfit.toFixed(0)}), Short in perdita (-$${Math.abs(s.shortStats.netProfit).toFixed(0)}). Considera di ridurre o eliminare i Short.`)
  if (s.maxConsecLoss >= 4) ins.push(`${s.maxConsecLoss} perdite consecutive — valuta uno stop giornaliero dopo 2-3 loss.`)
  if (s.profitFactor >= 1.5) ins.push(`Profit factor ${s.profitFactor.toFixed(2)} — sistema robusto.`)
  else if (s.profitFactor < 1) ins.push(`⚠ Profit factor ${s.profitFactor.toFixed(2)} — il sistema perde denaro nel lungo periodo.`)
  return ins.join(' ')
}

// ─── CALENDARIO P&L ───────────────────────────────────────────────────────────
function PnLCalendar({ trades }: { trades: Trade[] }) {
  const [month, setMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })

  const [year, mon] = month.split('-').map(Number)
  const firstDay = new Date(year, mon-1, 1).getDay()
  const daysInMonth = new Date(year, mon, 0).getDate()

  const dayMap: Record<string, DayStats> = {}
  trades.forEach(t => {
    if (!t.entry_time) return
    const d = new Date(t.entry_time)
    if (isNaN(d.getTime())) return
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!dayMap[key]) dayMap[key] = { date: key, pnl: 0, trades: 0, wins: 0 }
    dayMap[key].pnl += t.net_pnl
    dayMap[key].trades++
    if (t.net_pnl > 0) dayMap[key].wins++
  })

  const maxAbs = Math.max(...Object.values(dayMap).map(d => Math.abs(d.pnl)), 1)
  const prevMonth = () => { const d = new Date(year, mon-2); setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
  const nextMonth = () => { const d = new Date(year, mon); setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }

  const monthPnl = Object.values(dayMap).filter(d => d.date.startsWith(month)).reduce((s, d) => s + d.pnl, 0)
  const monthTrades = Object.values(dayMap).filter(d => d.date.startsWith(month)).reduce((s, d) => s + d.trades, 0)

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Calendario P&L</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{monthTrades} trade · <span style={{ color: pc(monthPnl), fontFamily: 'var(--font-mono)' }}>{fmtUSD(monthPnl)}</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prevMonth} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>‹</button>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', minWidth: 100, textAlign: 'center' }}>
            {new Date(year, mon-1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
          </div>
          <button onClick={nextMonth} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>›</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {['Dom','Lun','Mar','Mer','Gio','Ven','Sab'].map(d => (
          <div key={d} style={{ fontSize: 10, textAlign: 'center', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const key = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const stats = dayMap[key]
          const intensity = stats ? Math.min(Math.abs(stats.pnl) / maxAbs, 1) : 0
          const isToday = key === new Date().toISOString().split('T')[0]
          return (
            <div key={day} title={stats ? `${stats.trades} trade · ${fmtUSD(stats.pnl)}` : ''}
              style={{ aspectRatio: '1', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: stats ? 'pointer' : 'default',
                background: !stats ? 'var(--bg-3)' : stats.pnl > 0 ? `rgba(0,212,170,${0.15 + intensity * 0.7})` : `rgba(255,77,109,${0.15 + intensity * 0.7})`,
                border: isToday ? '1px solid var(--accent)' : '1px solid transparent',
                color: stats ? 'white' : 'var(--text-2)', fontWeight: stats ? 600 : 400 }}>
              <div>{day}</div>
              {stats && <div style={{ fontSize: 8, opacity: 0.9 }}>{stats.pnl > 0 ? '+' : ''}{stats.pnl.toFixed(0)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── TRADE ROW CON EMOTIVI ────────────────────────────────────────────────────
function TradeRow({ trade, onUpdate }: { trade: Trade; onUpdate: (id: string, updates: Partial<Trade>) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [localTags, setLocalTags] = useState<string[]>(trade.emotion_tags || [])
  const [localRule, setLocalRule] = useState<boolean|undefined>(trade.rule_followed)
  const [localNotes, setLocalNotes] = useState(trade.notes || '')

  const toggleTag = (tagId: string) => {
    const newTags = localTags.includes(tagId) ? localTags.filter(t => t !== tagId) : [...localTags, tagId]
    setLocalTags(newTags)
    onUpdate(trade.id, { emotion_tags: newTags })
  }

  const saveRule = (v: boolean) => { setLocalRule(v); onUpdate(trade.id, { rule_followed: v }) }
  const saveNotes = () => { onUpdate(trade.id, { notes: localNotes }) }

  const negTags = localTags.filter(t => !POSITIVE_TAGS.includes(t))
  const posTags = localTags.filter(t => POSITIVE_TAGS.includes(t))

  return (
    <>
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: 'grid', gridTemplateColumns: '28px 80px 100px 65px 110px 55px 55px 75px 75px 1fr', padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
        onMouseLeave={e => (e.currentTarget.style.background = expanded ? 'var(--bg-3)' : 'transparent')}>
        <div style={{ fontSize: 10, color: 'var(--text-2)' }}>{expanded ? '▼' : '▶'}</div>
        <div style={{ fontWeight: 500, color: 'var(--text-0)' }}>{trade.instrument}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{trade.strategy}</div>
        <div><span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: trade.direction === 'Long' ? 'var(--green-dim)' : 'var(--red-dim)', color: trade.direction === 'Long' ? 'var(--green)' : 'var(--red)' }}>{trade.direction}</span></div>
        <div style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{trade.entry_time?.split(' ')?.[0] || '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{trade.duration_min}m</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{trade.quantity}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: pc(trade.pnl) }}>${trade.pnl.toFixed(0)}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: pc(trade.net_pnl) }}>${trade.net_pnl.toFixed(0)}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {negTags.map(t => { const tag = EMOTION_TAGS.find(e => e.id === t); return tag ? <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${tag.color}22`, color: tag.color, fontWeight: 600 }}>{tag.label}</span> : null })}
          {posTags.map(t => { const tag = EMOTION_TAGS.find(e => e.id === t); return tag ? <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${tag.color}22`, color: tag.color, fontWeight: 600 }}>{tag.label}</span> : null })}
          {localRule === true && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--green-dim)', color: 'var(--green)', fontWeight: 600 }}>✓ Regole</span>}
          {localRule === false && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 600 }}>✗ Regole</span>}
        </div>
      </div>

      {expanded && (
        <div style={{ background: 'var(--bg-3)', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {/* Tag emotivi */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Tag emotivi</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {EMOTION_TAGS.map(tag => (
                  <button key={tag.id} onClick={() => toggleTag(tag.id)} title={tag.desc}
                    style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${localTags.includes(tag.id) ? tag.color : 'var(--border)'}`, background: localTags.includes(tag.id) ? `${tag.color}22` : 'transparent', color: localTags.includes(tag.id) ? tag.color : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontWeight: localTags.includes(tag.id) ? 600 : 400, transition: 'all 0.15s' }}>
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Regole + qualità */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Regole rispettate?</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                <button onClick={() => saveRule(true)} style={{ flex: 1, padding: '7px', borderRadius: 7, border: `1px solid ${localRule === true ? 'var(--green)' : 'var(--border)'}`, background: localRule === true ? 'var(--green-dim)' : 'transparent', color: localRule === true ? 'var(--green)' : 'var(--text-2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✓ Sì</button>
                <button onClick={() => saveRule(false)} style={{ flex: 1, padding: '7px', borderRadius: 7, border: `1px solid ${localRule === false ? 'var(--red)' : 'var(--border)'}`, background: localRule === false ? 'var(--red-dim)' : 'transparent', color: localRule === false ? 'var(--red)' : 'var(--text-2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✗ No</button>
              </div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Qualità setup</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1,2,3,4,5].map(n => (
                  <div key={n} style={{ fontSize: 16, cursor: 'pointer', opacity: (trade.setup_quality || 0) >= n ? 1 : 0.3 }}
                    onClick={() => onUpdate(trade.id, { setup_quality: n as 1|2|3|4|5 })}>★</div>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Note sul trade</div>
              <textarea value={localNotes} onChange={e => setLocalNotes(e.target.value)} onBlur={saveNotes}
                placeholder="Setup, motivazione, cosa hai fatto bene/male..."
                style={{ width: '100%', height: 80, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 12, padding: '8px 10px', resize: 'none', fontFamily: 'var(--font-body)', outline: 'none' }} />
            </div>
          </div>

          {/* Dettagli tecnici */}
          <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            <span>Entry: <span style={{ color: 'var(--text-0)' }}>{trade.entry_price || '—'}</span></span>
            <span>Exit: <span style={{ color: 'var(--text-0)' }}>{trade.exit_price || '—'}</span></span>
            <span>Durata: <span style={{ color: 'var(--text-0)' }}>{trade.duration_min}min</span></span>
            {trade.mae != null && <span>MAE: <span style={{ color: 'var(--red)' }}>${trade.mae.toFixed(0)}</span></span>}
            {trade.mfe != null && <span>MFE: <span style={{ color: 'var(--green)' }}>${trade.mfe.toFixed(0)}</span></span>}
          </div>
        </div>
      )}
    </>
  )
}

// ─── EMOTION ANALYTICS ────────────────────────────────────────────────────────
function EmotionAnalytics({ trades }: { trades: Trade[] }) {
  const tagged = trades.filter(t => t.emotion_tags && t.emotion_tags.length > 0)
  const withRule = trades.filter(t => t.rule_followed !== undefined)
  if (tagged.length === 0 && withRule.length === 0) return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Espandi i trade e aggiungi tag emotivi per vedere l'analisi psicologica</div>
    </div>
  )

  // Stats per tag
  const tagStats = EMOTION_TAGS.map(tag => {
    const taggedTrades = trades.filter(t => t.emotion_tags?.includes(tag.id))
    if (taggedTrades.length === 0) return null
    const pnl = taggedTrades.reduce((s, t) => s + t.net_pnl, 0)
    const wins = taggedTrades.filter(t => t.net_pnl > 0).length
    return { ...tag, count: taggedTrades.length, pnl, winRate: (wins / taggedTrades.length * 100) }
  }).filter(Boolean) as any[]

  // Disciplina
  const ruleYes = withRule.filter(t => t.rule_followed)
  const ruleNo = withRule.filter(t => !t.rule_followed)
  const ruleYesPnl = ruleYes.reduce((s, t) => s + t.net_pnl, 0)
  const ruleNoPnl = ruleNo.reduce((s, t) => s + t.net_pnl, 0)
  const ruleYesWR = ruleYes.filter(t => t.net_pnl > 0).length / Math.max(ruleYes.length, 1) * 100
  const ruleNoWR = ruleNo.filter(t => t.net_pnl > 0).length / Math.max(ruleNo.length, 1) * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Disciplina */}
      {withRule.length > 0 && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Disciplina — Regole rispettate vs non</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: '✓ Regole rispettate', trades: ruleYes, pnl: ruleYesPnl, wr: ruleYesWR, color: 'var(--green)' },
              { label: '✗ Regole NON rispettate', trades: ruleNo, pnl: ruleNoPnl, wr: ruleNoWR, color: 'var(--red)' },
            ].map(r => (
              <div key={r.label} style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: r.color, marginBottom: 8 }}>{r.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div><div style={{ fontSize: 10, color: 'var(--text-2)' }}>Trade</div><div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.trades.length}</div></div>
                  <div><div style={{ fontSize: 10, color: 'var(--text-2)' }}>Win Rate</div><div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.wr >= 50 ? 'var(--green)' : 'var(--red)' }}>{r.wr.toFixed(0)}%</div></div>
                  <div><div style={{ fontSize: 10, color: 'var(--text-2)' }}>P&L</div><div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 700, color: pc(r.pnl) }}>{fmtUSD(r.pnl)}</div></div>
                </div>
              </div>
            ))}
          </div>
          {ruleNoPnl < 0 && ruleYesPnl > 0 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--accent-dim)', borderRadius: 8, fontSize: 12, color: 'var(--accent)' }}>
              ◈ Quando rispetti le regole guadagni {fmtUSD(ruleYesPnl)}. Quando non le rispetti perdi {fmtUSD(ruleNoPnl)}. La disciplina vale {fmtUSD(ruleYesPnl - ruleNoPnl)} in più.
            </div>
          )}
        </div>
      )}

      {/* Tag emotivi */}
      {tagStats.length > 0 && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Performance per stato emotivo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tagStats.sort((a, b) => b.count - a.count).map((tag: any) => (
              <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-3)', borderRadius: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, flexShrink: 0 }}></div>
                <div style={{ width: 120, fontSize: 12, fontWeight: 500, color: 'var(--text-0)' }}>{tag.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', width: 60 }}>{tag.count} trade</div>
                <div style={{ flex: 1, height: 6, background: 'var(--bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${tag.winRate}%`, height: '100%', background: tag.winRate >= 50 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }}></div>
                </div>
                <div style={{ width: 44, fontSize: 11, fontFamily: 'var(--font-mono)', color: tag.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{tag.winRate.toFixed(0)}% WR</div>
                <div style={{ width: 80, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: pc(tag.pnl), textAlign: 'right' }}>{fmtUSD(tag.pnl)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── STATISTICHE AVANZATE ─────────────────────────────────────────────────────
function AdvancedStats({ stats, trades }: { stats: PerfReport; trades: Trade[] }) {
  // P&L per ora del giorno
  const byHour: Record<number, { pnl: number; count: number; wins: number }> = {}
  trades.forEach(t => {
    if (!t.entry_time) return
    const d = new Date(t.entry_time)
    if (isNaN(d.getTime())) return
    const h = d.getHours()
    if (!byHour[h]) byHour[h] = { pnl: 0, count: 0, wins: 0 }
    byHour[h].pnl += t.net_pnl
    byHour[h].count++
    if (t.net_pnl > 0) byHour[h].wins++
  })
  const hourData = Object.entries(byHour).map(([h, v]) => ({ hour: `${h}:00`, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count, wr: parseFloat((v.wins/v.count*100).toFixed(1)) })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour))

  // P&L per strumento
  const byInstrument: Record<string, { pnl: number; count: number; wins: number }> = {}
  trades.forEach(t => {
    if (!byInstrument[t.instrument]) byInstrument[t.instrument] = { pnl: 0, count: 0, wins: 0 }
    byInstrument[t.instrument].pnl += t.net_pnl
    byInstrument[t.instrument].count++
    if (t.net_pnl > 0) byInstrument[t.instrument].wins++
  })
  const instrData = Object.entries(byInstrument).map(([name, v]) => ({ name, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count, wr: parseFloat((v.wins/v.count*100).toFixed(1)) })).sort((a, b) => b.pnl - a.pnl)

  const winLossData = [
    { name: 'Win', value: stats.winTrades, fill: '#00d4aa' },
    { name: 'Loss', value: stats.lossTrades, fill: '#ff4d6d' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI principali */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { l: 'Net P&L', v: fmtUSD(stats.totalNetProfit), c: pc(stats.totalNetProfit) },
          { l: 'Win Rate', v: `${stats.winRate.toFixed(1)}%`, c: stats.winRate >= 50 ? 'var(--green)' : 'var(--red)' },
          { l: 'Profit Factor', v: stats.profitFactor.toFixed(2), c: stats.profitFactor >= 1.5 ? 'var(--green)' : stats.profitFactor >= 1 ? 'var(--amber)' : 'var(--red)' },
          { l: 'R:R Medio', v: stats.rrRatio.toFixed(2), c: stats.rrRatio >= 1 ? 'var(--green)' : 'var(--amber)' },
          { l: 'Max Drawdown', v: fmtUSD(stats.maxDrawdown, false), c: 'var(--red)' },
        ].map(k => (
          <div key={k.l} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 5 }}>{k.l}</div>
            <div style={{ fontSize: 19, fontFamily: 'var(--font-mono)', fontWeight: 700, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 180px', gap: 14 }}>
        {/* Ora del giorno */}
        {hourData.length > 0 ? (
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>P&L per ora del giorno</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={45} />
                <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v: any, n: string) => [n === 'pnl' ? `$${v}` : `${v}%`, n === 'pnl' ? 'P&L' : 'Win Rate']} />
                <ReferenceLine y={0} stroke="var(--border-hover)" />
                <Bar dataKey="pnl" radius={[4,4,0,0]}>
                  {hourData.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? '#00d4aa' : '#ff4d6d'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center' }}>Importa la lista trade singoli per vedere il P&L per ora del giorno</div>
          </div>
        )}

        {/* Per strumento */}
        {instrData.length > 0 && instrData[0].name !== 'N/A' ? (
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>P&L per strumento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {instrData.slice(0, 5).map(d => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 50, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-0)', fontWeight: 600 }}>{d.name}</div>
                  <div style={{ flex: 1, height: 18, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-hover)' }}></div>
                    <div style={{ position: 'absolute', left: d.pnl >= 0 ? '50%' : `calc(50% - ${Math.min(Math.abs(d.pnl)/Math.max(...instrData.map(x=>Math.abs(x.pnl)))*50, 50)}%)`, width: `${Math.min(Math.abs(d.pnl)/Math.max(...instrData.map(x=>Math.abs(x.pnl)))*50, 50)}%`, height: '100%', background: d.pnl >= 0 ? 'var(--green)' : 'var(--red)', opacity: 0.8 }}></div>
                  </div>
                  <div style={{ width: 70, fontSize: 11, fontFamily: 'var(--font-mono)', color: pc(d.pnl), textAlign: 'right', fontWeight: 600 }}>{fmtUSD(d.pnl)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center' }}>Importa lista trade singoli per il breakdown per strumento</div>
          </div>
        )}

        {/* Win/Loss pie */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8 }}>Win / Loss</div>
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie data={winLossData} cx="50%" cy="50%" innerRadius={32} outerRadius={55} paddingAngle={3} dataKey="value">
                {winLossData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--green)' }}>W {stats.winTrades}</span>
            <span style={{ color: 'var(--red)' }}>L {stats.lossTrades}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Long WR</span><span style={{ color: pc(stats.longStats.winRate - 50), fontFamily: 'var(--font-mono)' }}>{stats.longStats.winRate.toFixed(0)}%</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Short WR</span><span style={{ color: pc(stats.shortStats.winRate - 50), fontFamily: 'var(--font-mono)' }}>{stats.shortStats.winRate.toFixed(0)}%</span></div>
          </div>
        </div>
      </div>

      {/* Long vs Short + Dettaglio */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Long vs Short</div>
          {[
            { name: 'Long', s: stats.longStats, color: 'var(--green)' },
            { name: 'Short', s: stats.shortStats, color: 'var(--red)' },
          ].map(d => (
            <div key={d.name} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>{d.name}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: pc(d.s.netProfit) }}>{fmtUSD(d.s.netProfit)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ width: `${d.s.winRate}%`, height: '100%', background: d.color, borderRadius: 3, opacity: 0.8 }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-2)' }}>
                <span>{d.s.trades} trade</span><span>WR {d.s.winRate.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Metriche chiave</div>
          {[
            { l: 'Avg Win', v: fmtUSD(stats.avgWin), c: 'var(--green)' },
            { l: 'Avg Loss', v: fmtUSD(stats.avgLoss), c: 'var(--red)' },
            { l: 'Largest Win', v: fmtUSD(stats.largestWin), c: 'var(--green)' },
            { l: 'Largest Loss', v: fmtUSD(stats.largestLoss), c: 'var(--red)' },
            { l: 'Max Consec. Win', v: `${stats.maxConsecWin}`, c: 'var(--green)' },
            { l: 'Max Consec. Loss', v: `${stats.maxConsecLoss}`, c: 'var(--red)' },
            { l: 'Avg MAE', v: fmtUSD(stats.avgMAE, false), c: 'var(--amber)' },
            { l: 'Avg MFE', v: fmtUSD(stats.avgMFE, false), c: 'var(--blue)' },
            { l: 'Sharpe Ratio', v: stats.sharpeRatio.toFixed(2), c: stats.sharpeRatio >= 1 ? 'var(--green)' : 'var(--amber)' },
            { l: 'Commissioni', v: fmtUSD(stats.commission, false), c: 'var(--amber)' },
          ].map(r => (
            <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-1)' }}>{r.l}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.c }}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Insight */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>◈ Analisi automatica</div>
        <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.8 }}>{generateInsight(stats)}</div>
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function TradesAdvanced({ userId }: { userId: string }) {
  const [perfStats, setPerfStats] = useState<Record<string, PerfReport>>({})
  const [trades, setTrades] = useState<Trade[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [selectedStrategy, setSelectedStrategy] = useState('all')
  const [tab, setTab] = useState<'stats'|'calendar'|'list'|'emotion'>('stats')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const [fileType, setFileType] = useState<'perf'|'trades'>('perf')
  const [filterDir, setFilterDir] = useState<'all'|'Long'|'Short'>('all')
  const [filterStrategy, setFilterStrategy] = useState('all')
  const fileRef = useRef<HTMLInputElement>(null)

  const accounts = [...new Set([...Object.keys(perfStats), ...trades.map(t => t.account)])]
  const strategies = ['all', ...new Set(trades.filter(t => !selectedAccount || t.account === selectedAccount).map(t => t.strategy))]

  const filteredTrades = trades.filter(t =>
    (!selectedAccount || t.account === selectedAccount) &&
    (filterDir === 'all' || t.direction === filterDir) &&
    (filterStrategy === 'all' || t.strategy === filterStrategy)
  )

  const updateTrade = useCallback((id: string, updates: Partial<Trade>) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }, [])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !accountName.trim()) { setImportMsg('⚠ Inserisci prima il nome del conto'); return }
    setImporting(true); setImportMsg('')
    const text = await file.text()
    if (fileType === 'perf') {
      const s = parseNinjaPerfReport(text)
      if (!s) { setImportMsg('⚠ Formato non riconosciuto. Usa il Performance Report di NinjaTrader.'); setImporting(false); return }
      setPerfStats(prev => ({ ...prev, [accountName.trim()]: s }))
      setSelectedAccount(accountName.trim())
      setImportMsg(`✓ Performance Report importato — ${s.totalTrades} trade · Net P&L ${fmtUSD(s.totalNetProfit)}`)
    } else {
      const parsed = parseNinjaTradeList(text, accountName.trim())
      if (!parsed.length) { setImportMsg('⚠ Nessun trade trovato. Controlla il formato del file.'); setImporting(false); return }
      setTrades(prev => [...prev.filter(t => t.account !== accountName.trim()), ...parsed])
      if (!selectedAccount) setSelectedAccount(accountName.trim())
      setImportMsg(`✓ ${parsed.length} trade importati — ora puoi aggiungere tag emotivi espandendo ogni riga`)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [accountName, fileType, selectedAccount])

  const inp = { padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)' } as React.CSSProperties

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Eseguiti & Performance</div>

      {/* Import */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Importa da NinjaTrader</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 10 }}>📂 Import CSV</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button onClick={() => setFileType('perf')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: `1px solid ${fileType === 'perf' ? 'var(--accent)' : 'var(--border)'}`, background: fileType === 'perf' ? 'var(--accent-dim)' : 'transparent', color: fileType === 'perf' ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>Performance Report</button>
              <button onClick={() => setFileType('trades')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: `1px solid ${fileType === 'trades' ? 'var(--accent)' : 'var(--border)'}`, background: fileType === 'trades' ? 'var(--accent-dim)' : 'transparent', color: fileType === 'trades' ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>Lista Trade singoli</button>
            </div>
            <input style={{ ...inp, width: '100%', marginBottom: 10 }} placeholder="Nome conto (es. Sim101, Live)" value={accountName} onChange={e => setAccountName(e.target.value)} />
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
            <button onClick={() => fileRef.current?.click()} disabled={importing || !accountName.trim()} style={{ width: '100%', padding: '8px', background: accountName.trim() ? 'var(--accent)' : 'var(--bg-4)', border: 'none', borderRadius: 8, color: accountName.trim() ? '#000' : 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: accountName.trim() ? 'pointer' : 'not-allowed' }}>
              {importing ? 'Importando...' : 'Seleziona file CSV'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.6 }}>
              {fileType === 'perf' ? 'NT8: New → seleziona periodo → Performance → Export CSV' : 'NT8: griglia operazioni → tasto destro → Export → CSV'}
            </div>
          </div>
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 8 }}>🔌 Connessione diretta NinjaTrader 8</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 10 }}>Sincronizzazione automatica senza export manuale. Richiede NT8 attivo con porta 36973 aperta.</div>
            <button style={{ width: '100%', padding: '8px', background: 'var(--blue-dim)', border: '1px solid rgba(77,166,255,0.3)', borderRadius: 8, color: 'var(--blue)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚡ Connetti NinjaTrader</button>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>Prossima fase — richiede bridge NT8 configurato</div>
          </div>
        </div>
        {importMsg && <div style={{ marginTop: 10, padding: '8px 12px', background: importMsg.startsWith('✓') ? 'var(--green-dim)' : 'var(--amber-dim)', borderRadius: 8, fontSize: 12, color: importMsg.startsWith('✓') ? 'var(--green)' : 'var(--amber)' }}>{importMsg}</div>}
      </div>

      {accounts.length === 0 ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 40, opacity: 0.15, marginBottom: 14 }}>◑</div>
          <div style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 6 }}>Importa i tuoi dati NinjaTrader per iniziare</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>Supporta il Performance Report aggregato e la lista trade singoli.<br />Con la lista trade singoli puoi aggiungere tag emotivi, note e valutare la disciplina.</div>
        </div>
      ) : (
        <>
          {/* Selezione conto + tab */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Conto:</div>
              {accounts.map(a => (
                <button key={a} onClick={() => { setSelectedAccount(a); setFilterStrategy('all') }}
                  style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${selectedAccount === a ? 'var(--accent)' : 'var(--border)'}`, background: selectedAccount === a ? 'var(--accent-dim)' : 'transparent', color: selectedAccount === a ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: selectedAccount === a ? 600 : 400 }}>{a}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[['stats','📊 Stats'],['calendar','📅 Calendario'],['list','📋 Trade'],['emotion','🧠 Psicologia']].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id as any)}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: tab === id ? 'var(--bg-3)' : 'transparent', color: tab === id ? 'var(--text-0)' : 'var(--text-2)', cursor: 'pointer', fontSize: 12, fontWeight: tab === id ? 500 : 400 }}>{label}</button>
              ))}
            </div>
          </div>

          {/* Contenuto tab */}
          {tab === 'stats' && perfStats[selectedAccount] && (
            <AdvancedStats stats={perfStats[selectedAccount]} trades={filteredTrades} />
          )}

          {tab === 'calendar' && (
            <PnLCalendar trades={filteredTrades} />
          )}

          {tab === 'list' && (
            <>
              {/* Filtri */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Direzione:</div>
                {(['all','Long','Short'] as const).map(d => (
                  <button key={d} onClick={() => setFilterDir(d)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: filterDir === d ? 'var(--bg-3)' : 'transparent', color: filterDir === d ? 'var(--text-0)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>{d === 'all' ? 'Tutti' : d}</button>
                ))}
                {strategies.length > 2 && <>
                  <div style={{ width: 1, height: 16, background: 'var(--border)' }}></div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Strategia:</div>
                  {strategies.map(s => (
                    <button key={s} onClick={() => setFilterStrategy(s)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: filterStrategy === s ? 'rgba(245,166,35,0.15)' : 'transparent', color: filterStrategy === s ? 'var(--amber)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>{s === 'all' ? 'Tutte' : s}</button>
                  ))}
                </>}
                <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-2)' }}>{filteredTrades.length} trade</div>
              </div>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 80px 100px 65px 110px 55px 55px 75px 75px 1fr', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <div></div><div>Strum.</div><div>Strategia</div><div>Dir.</div><div>Data</div><div>Durata</div><div>Qty</div><div>P&L</div><div>Net P&L</div><div>Tag</div>
                </div>
                <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                  {filteredTrades.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)', fontSize: 12 }}>Importa la lista trade singoli per vedere il dettaglio</div>
                  ) : filteredTrades.map(t => <TradeRow key={t.id} trade={t} onUpdate={updateTrade} />)}
                </div>
              </div>
            </>
          )}

          {tab === 'emotion' && (
            <EmotionAnalytics trades={filteredTrades} />
          )}
        </>
      )}
    </div>
  )
}
