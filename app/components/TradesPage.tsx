'use client'
import { useState, useCallback, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, AreaChart, Area, BarChart, Bar, CartesianGrid } from 'recharts'

// ─── TIPI ─────────────────────────────────────────────────────────────────────
interface Trade {
  id?: string
  ninja_id?: string
  account: string
  strategy: string
  instrument: string
  direction: 'Long' | 'Short'
  entry_time: string
  exit_time: string
  duration_min: number
  entry_price: number
  exit_price: number
  quantity: number
  pnl: number
  commission: number
  net_pnl: number
  mae?: number
  mfe?: number
  notes?: string
}

// ─── PARSER CSV NINJATRADER ───────────────────────────────────────────────────
function parseNinjaCSV(text: string, account: string): Trade[] {
  const lines = text.split('\n').filter(l => l.trim())
  const trades: Trade[] = []
  let header: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(';').map(c => c.trim().replace(/"/g, ''))
    if (i === 0) { header = cols.map(h => h.toLowerCase()); continue }
    if (cols.length < 5) continue
    try {
      const get = (keys: string[]) => { for (const k of keys) { const idx = header.findIndex(h => h.includes(k)); if (idx >= 0) return cols[idx] || '' } return '' }
      const pnl = parseFloat(get(['profit','pnl','p&l']).replace(',','.')) || 0
      const comm = parseFloat(get(['commission','comm']).replace(',','.')) || 0
      const entryStr = get(['entry time','entry_time','ingresso'])
      const exitStr = get(['exit time','exit_time','uscita'])
      const entryDate = new Date(entryStr)
      const exitDate = new Date(exitStr)
      const durMin = isNaN(entryDate.getTime()) || isNaN(exitDate.getTime()) ? 0 : Math.round((exitDate.getTime() - entryDate.getTime()) / 60000)
      trades.push({
        ninja_id: `${account}-${i}`,
        account,
        strategy: get(['strategy','strategia']) || 'Manual',
        instrument: get(['instrument','strumento','market','ticker']) || 'N/A',
        direction: (get(['direction','tipo','side']) || 'Long').includes('ong') ? 'Long' : 'Short',
        entry_time: entryStr,
        exit_time: exitStr,
        duration_min: durMin,
        entry_price: parseFloat(get(['entry price','entry','prezzo ingresso']).replace(',','.')) || 0,
        exit_price: parseFloat(get(['exit price','exit','prezzo uscita']).replace(',','.')) || 0,
        quantity: parseInt(get(['quantity','qty','contratti'])) || 1,
        pnl,
        commission: comm,
        net_pnl: pnl - comm,
      })
    } catch { continue }
  }
  return trades
}

// ─── STATISTICHE ──────────────────────────────────────────────────────────────
function computeStats(trades: Trade[]) {
  if (trades.length === 0) return null
  const wins = trades.filter(t => t.net_pnl > 0)
  const losses = trades.filter(t => t.net_pnl < 0)
  const totalPnl = trades.reduce((s, t) => s + t.net_pnl, 0)
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.net_pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0) / losses.length) : 0
  const rr = avgLoss > 0 ? avgWin / avgLoss : 0
  // Equity curve
  let cum = 0
  const equity = trades.map(t => { cum += t.net_pnl; return { date: t.entry_time.split(' ')[0], value: parseFloat(cum.toFixed(2)), pnl: t.net_pnl } })
  // Max drawdown
  let peak = 0, maxDD = 0
  equity.forEach(e => { if (e.value > peak) peak = e.value; const dd = peak - e.value; if (dd > maxDD) maxDD = dd })
  // PnL per strategia
  const byStrategy: Record<string, { pnl: number; count: number; wins: number }> = {}
  trades.forEach(t => {
    if (!byStrategy[t.strategy]) byStrategy[t.strategy] = { pnl: 0, count: 0, wins: 0 }
    byStrategy[t.strategy].pnl += t.net_pnl
    byStrategy[t.strategy].count++
    if (t.net_pnl > 0) byStrategy[t.strategy].wins++
  })
  return {
    total: trades.length, wins: wins.length, losses: losses.length,
    winRate: ((wins.length / trades.length) * 100).toFixed(1),
    totalPnl: totalPnl.toFixed(2), avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
    rr: rr.toFixed(2), maxDD: maxDD.toFixed(2), equity, byStrategy
  }
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────
export default function TradesPage({ userId }: { userId: string }) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [selectedStrategy, setSelectedStrategy] = useState<string>('all')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const [view, setView] = useState<'stats'|'list'>('stats')
  const [ninjaConnecting, setNinjaConnecting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Conti unici
  const accounts = ['all', ...Array.from(new Set(trades.map(t => t.account)))]
  // Strategie del conto selezionato
  const strategies = ['all', ...Array.from(new Set(trades.filter(t => selectedAccount === 'all' || t.account === selectedAccount).map(t => t.strategy)))]
  // Trades filtrati
  const filtered = trades.filter(t =>
    (selectedAccount === 'all' || t.account === selectedAccount) &&
    (selectedStrategy === 'all' || t.strategy === selectedStrategy)
  )
  const stats = computeStats(filtered)

  // Import CSV
  const handleCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !accountName.trim()) { setImportMsg('⚠ Inserisci prima il nome del conto'); return }
    setImporting(true)
    setImportMsg('')
    const text = await file.text()
    const parsed = parseNinjaCSV(text, accountName.trim())
    if (parsed.length === 0) { setImportMsg('⚠ Nessun trade trovato. Verifica il formato CSV NinjaTrader.'); setImporting(false); return }
    // Salva su Supabase
    try {
      const res = await fetch('/api/ninja-trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trades: parsed, userId }) })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setTrades(prev => {
        const existing = prev.filter(t => t.account !== accountName.trim())
        return [...existing, ...parsed]
      })
      setImportMsg(`✓ ${parsed.length} trade importati dal conto "${accountName}"`)
    } catch (err: any) {
      // Fallback locale
      setTrades(prev => [...prev.filter(t => t.account !== accountName.trim()), ...parsed])
      setImportMsg(`✓ ${parsed.length} trade caricati localmente (DB: ${err.message})`)
    }
    setImporting(false)
  }, [accountName, userId])

  // Connessione NinjaTrader API (simulata per ora)
  const connectNinja = async () => {
    setNinjaConnecting(true)
    await new Promise(r => setTimeout(r, 1500))
    setNinjaConnecting(false)
    setImportMsg('ℹ La connessione diretta NinjaTrader richiede il plugin NinjaTrader ATM installato sul tuo PC. Per ora usa l\'import CSV.')
  }

  const inp = { padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)' } as React.CSSProperties
  const pctColor = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Eseguiti & Performance</div>

      {/* Import / Connessione */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Importa dati NinjaTrader</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* CSV Import */}
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 10 }}>📂 Import CSV / Excel</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Nome conto (es. Sim101, Live)" value={accountName} onChange={e => setAccountName(e.target.value)} />
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSV} />
            <button onClick={() => fileRef.current?.click()} disabled={importing || !accountName.trim()} style={{ padding: '8px 16px', background: accountName.trim() ? 'var(--accent)' : 'var(--bg-4)', border: 'none', borderRadius: 8, color: accountName.trim() ? '#000' : 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: accountName.trim() ? 'pointer' : 'not-allowed' }}>
              {importing ? 'Importando...' : 'Seleziona file CSV'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>NinjaTrader: Account Performance → Export → CSV</div>
          </div>
          {/* API Diretta */}
          <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', marginBottom: 10 }}>🔌 Connessione diretta NinjaTrader</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10 }}>
              Connessione automatica via NinjaTrader ATM Strategy API. Richiede NinjaTrader 8 attivo sul tuo PC con la porta 36973 aperta.
            </div>
            <button onClick={connectNinja} disabled={ninjaConnecting} style={{ padding: '8px 16px', background: 'var(--blue-dim)', border: '1px solid rgba(77,166,255,0.3)', borderRadius: 8, color: 'var(--blue)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {ninjaConnecting ? 'Connessione...' : '⚡ Connetti NinjaTrader'}
            </button>
          </div>
        </div>
        {importMsg && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: importMsg.startsWith('✓') ? 'var(--green-dim)' : importMsg.startsWith('ℹ') ? 'var(--blue-dim)' : 'var(--amber-dim)', borderRadius: 8, fontSize: 12, color: importMsg.startsWith('✓') ? 'var(--green)' : importMsg.startsWith('ℹ') ? 'var(--blue)' : 'var(--amber)' }}>
            {importMsg}
          </div>
        )}
      </div>

      {trades.length === 0 ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>◑</div>
          <div style={{ fontSize: 14, color: 'var(--text-1)' }}>Nessun trade importato</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Importa un CSV da NinjaTrader per visualizzare le statistiche</div>
        </div>
      ) : (
        <>
          {/* Filtri conto / strategia */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Conto:</div>
            {accounts.map(a => (
              <button key={a} onClick={() => { setSelectedAccount(a); setSelectedStrategy('all') }}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: selectedAccount === a ? 'var(--accent-dim)' : 'transparent', color: selectedAccount === a ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {a === 'all' ? 'Tutti' : a}
              </button>
            ))}
            {strategies.length > 1 && <>
              <div style={{ width: 1, height: 20, background: 'var(--border)' }}></div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>Strategia:</div>
              {strategies.map(s => (
                <button key={s} onClick={() => setSelectedStrategy(s)}
                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: selectedStrategy === s ? 'rgba(245,166,35,0.15)' : 'transparent', color: selectedStrategy === s ? 'var(--amber)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {s === 'all' ? 'Tutte' : s}
                </button>
              ))}
            </>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button onClick={() => setView('stats')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: view === 'stats' ? 'var(--bg-3)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>Statistiche</button>
              <button onClick={() => setView('list')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: view === 'list' ? 'var(--bg-3)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>Lista trade</button>
            </div>
          </div>

          {stats && view === 'stats' && (
            <>
              {/* KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {[
                  { label: 'P&L Netto', val: `€${parseFloat(stats.totalPnl) >= 0 ? '+' : ''}${stats.totalPnl}`, pos: parseFloat(stats.totalPnl) >= 0 },
                  { label: 'Win Rate', val: `${stats.winRate}%`, pos: parseFloat(stats.winRate) >= 50 },
                  { label: 'R:R Medio', val: stats.rr, pos: parseFloat(stats.rr) >= 1 },
                  { label: 'Trade totali', val: stats.total, pos: null },
                  { label: 'Max Drawdown', val: `-€${stats.maxDD}`, pos: false },
                ].map(k => (
                  <div key={k.label} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontSize: 20, fontFamily: 'var(--font-mono)', fontWeight: 700, color: k.pos === null ? 'var(--text-0)' : k.pos ? 'var(--green)' : 'var(--red)' }}>{k.val}</div>
                  </div>
                ))}
              </div>

              {/* Equity curve + PnL per strategia */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Equity Curve</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={stats.equity}>
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} interval={Math.floor(stats.equity.length / 5)} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} tickFormatter={v => `€${v}`} width={55} />
                      <Tooltip contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`€${v}`, 'Equity']} />
                      <ReferenceLine y={0} stroke="var(--border-hover)" />
                      <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} fill="url(#eqGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>P&L per strategia</div>
                  {Object.entries(stats.byStrategy).map(([name, s]) => (
                    <div key={name} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{name}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: pctColor(s.pnl) }}>€{s.pnl.toFixed(0)}</span>
                      </div>
                      <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(s.wins / s.count) * 100}%`, height: '100%', background: 'var(--green)', borderRadius: 3 }}></div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>{s.count} trade · WR {((s.wins / s.count) * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {view === 'list' && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 100px 70px 120px 120px 60px 70px 70px 80px', padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <div>Strumento</div><div>Strategia</div><div>Dir.</div><div>Entrata</div><div>Uscita</div><div>Durata</div><div>Qty</div><div>P&L</div><div>Net P&L</div>
              </div>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {filtered.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 100px 70px 120px 120px 60px 70px 70px 80px', padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <div style={{ fontWeight: 500, color: 'var(--text-0)' }}>{t.instrument}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{t.strategy}</div>
                    <div><span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: t.direction === 'Long' ? 'var(--green-dim)' : 'var(--red-dim)', color: t.direction === 'Long' ? 'var(--green)' : 'var(--red)' }}>{t.direction}</span></div>
                    <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{t.entry_time}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{t.exit_time}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{t.duration_min}m</div>
                    <div style={{ fontFamily: 'var(--font-mono)' }}>{t.quantity}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: pctColor(t.pnl) }}>€{t.pnl.toFixed(0)}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: pctColor(t.net_pnl) }}>€{t.net_pnl.toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
