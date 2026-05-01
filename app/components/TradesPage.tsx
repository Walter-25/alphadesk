'use client'
import { useState, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, PieChart, Pie, Cell } from 'recharts'

// ─── TIPI ─────────────────────────────────────────────────────────────────────
interface Trade {
  id?: string; ninja_id?: string; account: string; strategy: string
  instrument: string; direction: 'Long'|'Short'; entry_time: string
  exit_time: string; duration_min: number; entry_price: number
  exit_price: number; quantity: number; pnl: number; commission: number; net_pnl: number
  mae?: number; mfe?: number
}

interface PerfStats {
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

// ─── PARSER PERFORMANCE REPORT (il tuo formato) ───────────────────────────────
function parseNinjaPerfReport(text: string): PerfStats | null {
  const data: Record<string, string[]> = {}
  const lines = text.split('\n')
  for (const line of lines) {
    const cols = line.replace(/\r/,'').split(';')
    if (cols[0]?.trim()) {
      data[cols[0].trim()] = cols.slice(1).map(c => c.trim()).filter(Boolean)
    }
  }
  const num = (key: string, col = 0) => {
    const v = data[key]?.[col] || '0'
    return parseFloat(v.replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
  }
  const str = (key: string, col = 0) => data[key]?.[col] || ''

  if (!data['Total net profit']) return null

  return {
    totalNetProfit: num('Total net profit'),
    grossProfit: num('Gross profit'),
    grossLoss: num('Gross loss'),
    commission: num('Commission'),
    profitFactor: num('Profit factor'),
    maxDrawdown: num('Max drawdown'),
    sharpeRatio: num('Sharpe ratio'),
    totalTrades: num('Total # of trades'),
    winRate: num('Percent profitable'),
    winTrades: num('# of winning trades'),
    lossTrades: num('# of losing trades'),
    avgTrade: num('Avg trade'),
    avgWin: num('Avg winning trade'),
    avgLoss: num('Avg losing trade'),
    rrRatio: num('Ratio avg win / avg loss'),
    maxConsecWin: num('Max consec winners'),
    maxConsecLoss: num('Max consec losers'),
    largestWin: num('Largest winning trade'),
    largestLoss: num('Largest losing trade'),
    avgTimeInMarket: str('Avg time in market'),
    startDate: str('Start date'),
    endDate: str('End date'),
    avgMAE: num('Avg MAE'),
    avgMFE: num('Avg MFE'),
    longStats: {
      netProfit: num('Total net profit', 1),
      winRate: num('Percent profitable', 1),
      trades: num('Total # of trades', 1),
    },
    shortStats: {
      netProfit: num('Total net profit', 2),
      winRate: num('Percent profitable', 2),
      trades: num('Total # of trades', 2),
    },
  }
}

// ─── PARSER LISTA TRADE INDIVIDUALI ──────────────────────────────────────────
function parseNinjaTradeList(text: string, account: string): Trade[] {
  const lines = text.split('\n').filter(l => l.trim())
  const trades: Trade[] = []
  let header: string[] = []
  const sep = text.includes(';') ? ';' : ','

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].replace(/\r/,'').split(sep).map(c => c.trim().replace(/"/g,''))
    if (i === 0) { header = cols.map(h => h.toLowerCase()); continue }
    if (cols.length < 4) continue
    const get = (keys: string[]) => {
      for (const k of keys) {
        const idx = header.findIndex(h => h.includes(k))
        if (idx >= 0 && cols[idx]) return cols[idx]
      }
      return ''
    }
    const parseNum = (s: string) => parseFloat(s.replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
    const pnl = parseNum(get(['profit','pnl','p&l','net profit']))
    const comm = parseNum(get(['commission','comm']))
    const entryStr = get(['entry time','entrytime','entry_time','time of entry','ora ingresso'])
    const exitStr = get(['exit time','exittime','exit_time','time of exit','ora uscita'])
    const e1 = new Date(entryStr), e2 = new Date(exitStr)
    const dur = !isNaN(e1.getTime()) && !isNaN(e2.getTime()) ? Math.round((e2.getTime()-e1.getTime())/60000) : 0
    const dirRaw = get(['direction','dir','side','tipo','market pos','market position']) || 'Long'
    const dir: 'Long'|'Short' = dirRaw.toLowerCase().includes('short') ? 'Short' : 'Long'
    trades.push({
      ninja_id: `${account}-${i}`,
      account, strategy: get(['strategy','strategia','strat']) || 'Manual',
      instrument: get(['instrument','strumento','market','ticker','symbol']) || get(['']) || 'N/A',
      direction: dir, entry_time: entryStr, exit_time: exitStr, duration_min: dur,
      entry_price: parseNum(get(['entry price','entry_price','avg entry'])),
      exit_price: parseNum(get(['exit price','exit_price','avg exit'])),
      quantity: parseInt(get(['quantity','qty','contratti','size'])) || 1,
      pnl, commission: comm, net_pnl: pnl - comm,
      mae: parseNum(get(['mae'])) || undefined,
      mfe: parseNum(get(['mfe'])) || undefined,
    })
  }
  return trades.filter(t => t.instrument || t.pnl !== 0)
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pc = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const fmtUSD = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`

// ─── STATS CARD ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: 'var(--font-mono)', fontWeight: 700, color: color || 'var(--text-0)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── PERFORMANCE REPORT VIEW ──────────────────────────────────────────────────
function PerfReportView({ stats, accountName }: { stats: PerfStats; accountName: string }) {
  const longShortData = [
    { name: 'Long', value: stats.longStats.trades, pnl: stats.longStats.netProfit, wr: stats.longStats.winRate },
    { name: 'Short', value: stats.shortStats.trades, pnl: stats.shortStats.netProfit, wr: stats.shortStats.winRate },
  ]
  const winLossData = [
    { name: 'Win', value: stats.winTrades, fill: '#00d4aa' },
    { name: 'Loss', value: stats.lossTrades, fill: '#ff4d6d' },
  ]
  const maeMfeData = [
    { name: 'Avg MAE', value: stats.avgMAE, fill: '#ff4d6d' },
    { name: 'Avg MFE', value: stats.avgMFE, fill: '#00d4aa' },
    { name: 'Avg Win', value: stats.avgWin, fill: '#4da6ff' },
    { name: '|Avg Loss|', value: Math.abs(stats.avgLoss), fill: '#f5a623' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header conto */}
      <div style={{ background: 'var(--bg-3)', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-0)' }}>{accountName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{stats.startDate} → {stats.endDate}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontFamily: 'var(--font-mono)', fontWeight: 800, color: pc(stats.totalNetProfit) }}>{fmtUSD(stats.totalNetProfit)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>Net P&L totale</div>
        </div>
      </div>

      {/* KPI principali — riga 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.winTrades}W / ${stats.lossTrades}L`} color={stats.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} sub={stats.profitFactor >= 1.5 ? '✓ Buono' : stats.profitFactor >= 1 ? '~ Accettabile' : '✗ Negativo'} color={stats.profitFactor >= 1.5 ? 'var(--green)' : stats.profitFactor >= 1 ? 'var(--amber)' : 'var(--red)'} />
        <StatCard label="R:R Ratio" value={stats.rrRatio.toFixed(2)} sub="Avg Win / Avg Loss" color={stats.rrRatio >= 1 ? 'var(--green)' : 'var(--amber)'} />
        <StatCard label="Max Drawdown" value={fmtUSD(stats.maxDrawdown)} sub="Peak to valley" color="var(--red)" />
      </div>

      {/* KPI riga 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <StatCard label="Trade Totali" value={`${stats.totalTrades}`} sub={`Avg ${stats.avgTimeInMarket}`} />
        <StatCard label="Avg Trade" value={fmtUSD(stats.avgTrade)} sub="Per operazione" color={pc(stats.avgTrade)} />
        <StatCard label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} sub={stats.sharpeRatio >= 1 ? 'Buono' : 'Da migliorare'} color={stats.sharpeRatio >= 1 ? 'var(--green)' : 'var(--amber)'} />
        <StatCard label="Commissioni" value={fmtUSD(-stats.commission)} sub="Totale periodo" color="var(--amber)" />
      </div>

      {/* Grafici */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        {/* Win/Loss pie */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Distribuzione trade</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={winLossData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={11}>
                {winLossData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--green)' }}>● Win {stats.winTrades}</span>
            <span style={{ fontSize: 11, color: 'var(--red)' }}>● Loss {stats.lossTrades}</span>
          </div>
        </div>

        {/* Long vs Short */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Long vs Short</div>
          {longShortData.map(d => (
            <div key={d.name} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: d.name === 'Long' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{d.name}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: pc(d.pnl) }}>{fmtUSD(d.pnl)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ width: `${d.wr}%`, height: '100%', background: d.name === 'Long' ? 'var(--green)' : 'var(--red)', borderRadius: 3 }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-2)' }}>
                <span>{d.value} trade</span><span>WR {d.wr.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>

        {/* MAE/MFE */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>MAE / MFE / Win-Loss</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={maeMfeData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={40} />
              <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`$${parseFloat(v).toFixed(0)}`, '']} />
              <Bar dataKey="value" radius={[4,4,0,0]}>
                {maeMfeData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dettaglio numerico */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Dettaglio P&L</div>
          {[
            { l: 'Gross Profit', v: fmtUSD(stats.grossProfit), c: 'var(--green)' },
            { l: 'Gross Loss', v: fmtUSD(stats.grossLoss), c: 'var(--red)' },
            { l: 'Commissioni', v: fmtUSD(-stats.commission), c: 'var(--amber)' },
            { l: 'Net Profit', v: fmtUSD(stats.totalNetProfit), c: pc(stats.totalNetProfit) },
            { l: 'Trade più grande (Win)', v: fmtUSD(stats.largestWin), c: 'var(--green)' },
            { l: 'Trade più grande (Loss)', v: fmtUSD(stats.largestLoss), c: 'var(--red)' },
          ].map(r => (
            <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{r.l}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.c }}>{r.v}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Metriche avanzate</div>
          {[
            { l: 'Avg Win', v: fmtUSD(stats.avgWin), c: 'var(--green)' },
            { l: 'Avg Loss', v: fmtUSD(stats.avgLoss), c: 'var(--red)' },
            { l: 'Max consec. vittorie', v: `${stats.maxConsecWin}`, c: 'var(--green)' },
            { l: 'Max consec. perdite', v: `${stats.maxConsecLoss}`, c: 'var(--red)' },
            { l: 'Avg MAE (avversità)', v: fmtUSD(stats.avgMAE), c: 'var(--amber)' },
            { l: 'Avg MFE (favorevole)', v: fmtUSD(stats.avgMFE), c: 'var(--blue)' },
          ].map(r => (
            <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{r.l}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.c }}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Insight automatico */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>◈ Analisi automatica del conto</div>
        <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.8 }}>
          {generateInsight(stats)}
        </div>
      </div>
    </div>
  )
}

function generateInsight(s: PerfStats): string {
  const insights: string[] = []
  if (s.winRate >= 50) insights.push(`Win rate del ${s.winRate.toFixed(1)}% — statisticamente consistente.`)
  else insights.push(`Win rate del ${s.winRate.toFixed(1)}% — sotto il 50%, necessario un R:R superiore a 1 per essere profittevole.`)
  if (s.rrRatio >= 1.5) insights.push(`R:R di ${s.rrRatio.toFixed(2)} ottimo — lasci correre i winner rispetto alle perdite.`)
  else if (s.rrRatio < 1) insights.push(`⚠ R:R di ${s.rrRatio.toFixed(2)} — le perdite medie superano i guadagni medi. Lavora sulla gestione delle uscite.`)
  if (s.longStats.netProfit > 0 && s.shortStats.netProfit < 0) insights.push(`Il lato Long genera profitto ($${s.longStats.netProfit.toFixed(0)}), il lato Short è in perdita ($${s.shortStats.netProfit.toFixed(0)}). Considera di ridurre o eliminare le posizioni Short.`)
  else if (s.shortStats.netProfit > 0 && s.longStats.netProfit < 0) insights.push(`Il lato Short è profittevole, il Long no. Valuta il contesto di mercato.`)
  if (s.maxConsecLoss >= 4) insights.push(`${s.maxConsecLoss} perdite consecutive registrate — valuta una regola di stop giornaliero dopo 2-3 loss consecutivi.`)
  if (s.avgMAE > Math.abs(s.avgLoss)) insights.push(`L'Avg MAE ($${s.avgMAE.toFixed(0)}) supera l'Avg Loss — stai rischiando più di quanto necessario prima che il mercato ti stoppi.`)
  if (s.profitFactor >= 1.5) insights.push(`Profit factor di ${s.profitFactor.toFixed(2)} — sistema robusto e statisticamente affidabile.`)
  return insights.join(' ') || 'Importa più dati per generare un\'analisi significativa.'
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────
export default function TradesPage({ userId }: { userId: string }) {
  const [perfStats, setPerfStats] = useState<Record<string, PerfStats>>({})
  const [trades, setTrades] = useState<Trade[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [selectedStrategy, setSelectedStrategy] = useState<string>('all')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const [view, setView] = useState<'stats'|'list'>('stats')
  const [fileType, setFileType] = useState<'perf'|'trades'>('perf')
  const fileRef = useRef<HTMLInputElement>(null)

  const accounts = Object.keys(perfStats).concat(
    Array.from(new Set(trades.map(t => t.account))).filter(a => !perfStats[a])
  )
  const strategies = ['all', ...Array.from(new Set(trades.filter(t => t.account === selectedAccount).map(t => t.strategy)))]
  const filtered = trades.filter(t => t.account === selectedAccount && (selectedStrategy === 'all' || t.strategy === selectedStrategy))

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !accountName.trim()) { setImportMsg('⚠ Inserisci prima il nome del conto'); return }
    setImporting(true); setImportMsg('')
    const text = await file.text()
    if (fileType === 'perf') {
      const stats = parseNinjaPerfReport(text)
      if (!stats) { setImportMsg('⚠ Formato non riconosciuto. Usa: New → Performance → Export CSV'); setImporting(false); return }
      setPerfStats(prev => ({ ...prev, [accountName.trim()]: stats }))
      setSelectedAccount(accountName.trim())
      setImportMsg(`✓ Performance Report importato per il conto "${accountName}" — ${stats.totalTrades} trade, P&L netto ${fmtUSD(stats.totalNetProfit)}`)
    } else {
      const parsed = parseNinjaTradeList(text, accountName.trim())
      if (!parsed.length) { setImportMsg('⚠ Nessun trade trovato. Usa: Esporta lista trade singoli'); setImporting(false); return }
      setTrades(prev => [...prev.filter(t => t.account !== accountName.trim()), ...parsed])
      if (!selectedAccount) setSelectedAccount(accountName.trim())
      setImportMsg(`✓ ${parsed.length} trade importati per il conto "${accountName}"`)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [accountName, fileType, selectedAccount])

  const inp = { padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)' } as React.CSSProperties

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Eseguiti & Performance</div>

      {/* Import panel */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Importa da NinjaTrader</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Import */}
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 10 }}>📂 Import file CSV</div>
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
              {fileType === 'perf' ? 'NT8: New → Performance → esporta il report CSV (il file che hai già)' : 'NT8: griglia operazioni → tasto destro → Export → CSV'}
            </div>
          </div>
          {/* Connessione diretta */}
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 8 }}>🔌 Connessione diretta NinjaTrader 8</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 10 }}>
              Sincronizzazione automatica degli eseguiti senza export manuale. Richiede NinjaTrader 8 attivo e porta 36973 aperta sul tuo PC.
            </div>
            <button style={{ width: '100%', padding: '8px', background: 'var(--blue-dim)', border: '1px solid rgba(77,166,255,0.3)', borderRadius: 8, color: 'var(--blue)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚡ Connetti NinjaTrader</button>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>Attivazione in arrivo — prima configura il bridge NT8</div>
          </div>
        </div>
        {importMsg && <div style={{ marginTop: 10, padding: '8px 12px', background: importMsg.startsWith('✓') ? 'var(--green-dim)' : 'var(--amber-dim)', borderRadius: 8, fontSize: 12, color: importMsg.startsWith('✓') ? 'var(--green)' : 'var(--amber)' }}>{importMsg}</div>}
      </div>

      {/* Selezione conto */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Conto:</div>
          {accounts.map(a => (
            <button key={a} onClick={() => { setSelectedAccount(a); setSelectedStrategy('all') }}
              style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${selectedAccount === a ? 'var(--accent)' : 'var(--border)'}`, background: selectedAccount === a ? 'var(--accent-dim)' : 'transparent', color: selectedAccount === a ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: selectedAccount === a ? 600 : 400 }}>
              {a}
            </button>
          ))}
          {perfStats[selectedAccount] && (
            <>
              <div style={{ width: 1, height: 18, background: 'var(--border)' }}></div>
              <button onClick={() => setView('stats')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: view === 'stats' ? 'var(--bg-3)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>📊 Statistiche</button>
              {trades.filter(t => t.account === selectedAccount).length > 0 && (
                <button onClick={() => setView('list')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: view === 'list' ? 'var(--bg-3)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>📋 Lista trade</button>
              )}
            </>
          )}
        </div>
      )}

      {/* Contenuto */}
      {!selectedAccount ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 12 }}>◑</div>
          <div style={{ fontSize: 14, color: 'var(--text-1)' }}>Importa il tuo Performance Report da NinjaTrader</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.6 }}>
            Su NinjaTrader: scheda "New" → seleziona il conto e il periodo → "Performance" → esporta il CSV<br/>
            Supporta sia il Performance Report aggregato che la lista trade singoli
          </div>
        </div>
      ) : perfStats[selectedAccount] && view === 'stats' ? (
        <PerfReportView stats={perfStats[selectedAccount]} accountName={selectedAccount} />
      ) : view === 'list' && filtered.length > 0 ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 110px 70px 130px 130px 60px 60px 80px 80px', padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div>Strumento</div><div>Strategia</div><div>Dir.</div><div>Entrata</div><div>Uscita</div><div>Durata</div><div>Qty</div><div>P&L</div><div>Net P&L</div>
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {filtered.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 110px 70px 130px 130px 60px 60px 80px 80px', padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12, alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ fontWeight: 500 }}>{t.instrument}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{t.strategy}</div>
                <div><span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: t.direction === 'Long' ? 'var(--green-dim)' : 'var(--red-dim)', color: t.direction === 'Long' ? 'var(--green)' : 'var(--red)' }}>{t.direction}</span></div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{t.entry_time}</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{t.exit_time}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{t.duration_min}m</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{t.quantity}</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: pc(t.pnl) }}>${t.pnl.toFixed(0)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: pc(t.net_pnl) }}>${t.net_pnl.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
