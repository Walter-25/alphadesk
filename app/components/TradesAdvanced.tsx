'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
         ReferenceLine, CartesianGrid, PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis } from 'recharts'
import SyncPanel from './SyncPanel'

// ─── TIPI ─────────────────────────────────────────────────────────────────────
interface Trade {
  id: string; ninja_id?: string; account: string; strategy: string
  instrument: string; direction: 'Long'|'Short'; entry_time: string
  exit_time: string; duration_min: number; entry_price: number
  exit_price: number; quantity: number; pnl: number; commission: number
  net_pnl: number; mae?: number; mfe?: number
  emotion_tags?: string[]; rule_followed?: boolean; notes?: string; setup_quality?: number
}

interface PerfReport {
  totalNetProfit: number; grossProfit: number; grossLoss: number; commission: number
  profitFactor: number; maxDrawdown: number; sharpeRatio: number; totalTrades: number
  winRate: number; winTrades: number; lossTrades: number; avgTrade: number
  avgWin: number; avgLoss: number; rrRatio: number; maxConsecWin: number
  maxConsecLoss: number; largestWin: number; largestLoss: number
  avgTimeInMarket: string; startDate: string; endDate: string; avgMAE: number; avgMFE: number
  longStats: { netProfit: number; winRate: number; trades: number }
  shortStats: { netProfit: number; winRate: number; trades: number }
}

// ─── EMOTION TAGS ─────────────────────────────────────────────────────────────
const EMOTION_TAGS = [
  { id: 'fomo', label: 'FOMO', color: '#f5a623' },
  { id: 'revenge', label: 'Revenge', color: '#ff4d6d' },
  { id: 'early_exit', label: 'Uscita anticipata', color: '#4da6ff' },
  { id: 'overtrading', label: 'Overtrading', color: '#ff6b35' },
  { id: 'hesitation', label: 'Esitazione', color: '#9b59b6' },
  { id: 'disciplined', label: 'Disciplinato', color: '#00d4aa' },
  { id: 'patient', label: 'Paziente', color: '#2ecc71' },
  { id: 'overconfident', label: 'Overconfidence', color: '#e67e22' },
  { id: 'fear', label: 'Paura', color: '#e74c3c' },
  { id: 'plan_trade', label: 'Trade pianificato', color: '#1abc9c' },
]
const POSITIVE_TAGS = ['disciplined', 'patient', 'plan_trade']
const WEEKDAYS = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

// ─── PARSERS ──────────────────────────────────────────────────────────────────
function parseNinjaPerfReport(text: string): PerfReport | null {
  const data: Record<string, string[]> = {}
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r/,'').split(';')
    if (cols[0]?.trim()) data[cols[0].trim()] = cols.slice(1).map(c => c.trim()).filter(Boolean)
  }
  const num = (k: string, col = 0) => parseFloat((data[k]?.[col] || '0').replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
  const str = (k: string, col = 0) => data[k]?.[col] || ''
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

function parseNinjaTradeList(text: string, account: string): Trade[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const sep = text.includes(';') ? ';' : ','
  const header = lines[0].replace(/\r/,'').split(sep).map(h => h.trim().toLowerCase().replace(/"/g,''))

  // Detect formato: Trades vs Executions vs altro
  const isNTTrades = header.includes('trade number') || header.includes('entry time')
  const isNTExec = header.includes('action') && header.includes('e/x')

  // Parser numeri formato IT: "25.014,00 $" o "-85,50 $" o "25014,00"
  const pn = (s: string) => {
    if (!s) return 0
    const clean = s.replace(/\./g,'').replace(',','.').replace(/[^0-9.\-]/g,'')
    return parseFloat(clean) || 0
  }

  const get = (cols: string[], keys: string[]) => {
    for (const k of keys) {
      const idx = header.findIndex(h => h.includes(k))
      if (idx >= 0 && cols[idx]?.trim()) return cols[idx].trim().replace(/"/g,'')
    }; return ''
  }

  // Formato NinjaTrader Trades (Trade number;Instrument;Account;Strategy;Market pos.;...)
  if (isNTTrades) {
    const trades: Trade[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/\r/,'').split(sep)
      if (cols.length < 10) continue
      const entryStr = get(cols, ['entry time'])
      const exitStr = get(cols, ['exit time'])
      const e1 = new Date(entryStr), e2 = new Date(exitStr)
      // Gestisce formato data italiano: "09/04/2026 16:10:56"
      const parseDate = (s: string) => {
        const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
        if (m) return new Date(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`) // spazio = ora locale, non UTC
        return new Date(s)
      }
      const d1 = parseDate(entryStr), d2 = parseDate(exitStr)
      const dur = !isNaN(d1.getTime())&&!isNaN(d2.getTime()) ? Math.round((d2.getTime()-d1.getTime())/60000) : 0
      const dirRaw = get(cols, ['market pos','direction','side']) || 'Long'
      const pnl = pn(get(cols, ['profit']))
      const comm = pn(get(cols, ['commission']))
      const mae = pn(get(cols, ['mae']))
      const mfe = pn(get(cols, ['mfe']))
      trades.push({
        id: `${account}-${i}`,
        ninja_id: `${account}-NT-${get(cols,['trade number'])||i}-${entryStr.replace(/[^0-9]/g,'').slice(0,12)}`,
        account,
        strategy: get(cols, ['strategy']) || 'Manual',
        instrument: get(cols, ['instrument']) || 'N/A',
        direction: dirRaw.toLowerCase().includes('short') ? 'Short' : 'Long',
        entry_time: d1.toISOString(),
        exit_time: d2.toISOString(),
        duration_min: dur,
        entry_price: pn(get(cols, ['entry price'])),
        exit_price: pn(get(cols, ['exit price'])),
        quantity: parseInt(get(cols, ['qty'])) || 1,
        pnl: pnl + comm, commission: comm, net_pnl: pnl, // Profit CSV è già netto; pnl lordo = netto + comm
        mae: mae || undefined,
        mfe: mfe || undefined,
        emotion_tags: [], rule_followed: undefined, notes: '',
      })
    }
    return trades
  }

  // Formato Executions — raggruppa per posizione
  if (isNTExec) {
    const entries: any[] = [], exits: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/\r/,'').split(sep)
      if (cols.length < 7) continue
      const ex = get(cols, ['e/x'])
      const parseDate = (s: string) => {
        const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
        if (m) return new Date(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`) // spazio = ora locale, non UTC
        return new Date(s)
      }
      const row = {
        instrument: get(cols, ['instrument']),
        action: get(cols, ['action']),
        qty: parseInt(get(cols, ['quantity'])) || 1,
        price: pn(get(cols, ['price'])),
        time: parseDate(get(cols, ['time'])),
        comm: pn(get(cols, ['commission'])),
        account: get(cols, ['account']) || account,
        exType: ex,
      }
      if (ex.toLowerCase().includes('entry')) entries.push(row)
      else exits.push(row)
    }
    // Abbina entry/exit
    const trades: Trade[] = []
    entries.forEach((en, i) => {
      const ex = exits.find(x => x.instrument === en.instrument && x.time >= en.time) || exits[i]
      if (!ex) return
      const dur = ex ? Math.round((ex.time.getTime()-en.time.getTime())/60000) : 0
      const pnl = ex ? (en.action.toLowerCase()==='sell'
        ? (en.price-ex.price)*en.qty*2  // MNQ = 2$/tick
        : (ex.price-en.price)*en.qty*2) : 0
      trades.push({
        id: `${account}-ex-${i}`,
        ninja_id: `${account}-EX-${i}`,
        account: en.account || account,
        strategy: 'Manual',
        instrument: en.instrument || 'N/A',
        direction: en.action.toLowerCase()=='sell'?'Short':'Long',
        entry_time: en.time.toISOString(),
        exit_time: ex?.time.toISOString() || en.time.toISOString(),
        duration_min: dur,
        entry_price: en.price, exit_price: ex?.price || 0,
        quantity: en.qty,
        pnl: parseFloat(pnl.toFixed(2)),
        commission: (en.comm||0)+(ex?.comm||0),
        net_pnl: parseFloat((pnl-(en.comm||0)-(ex?.comm||0)).toFixed(2)),
        emotion_tags: [], rule_followed: undefined, notes: '',
      })
    })
    return trades
  }

  // Formato generico fallback
  const trades: Trade[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r/,'').split(sep)
    if (cols.length < 4) continue
    const pnl = pn(get(cols,['profit','pnl','p&l','net profit']))
    const comm = pn(get(cols,['commission','comm']))
    const entryStr = get(cols,['entry time','time'])
    const exitStr = get(cols,['exit time'])
    const parseDate = (s: string) => {
      const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
      if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`)
      return new Date(s)
    }
    const d1 = parseDate(entryStr), d2 = parseDate(exitStr || entryStr)
    const dur = !isNaN(d1.getTime())&&!isNaN(d2.getTime()) ? Math.round((d2.getTime()-d1.getTime())/60000) : 0
    const dirRaw = get(cols,['market pos','direction','side','action']) || 'Long'
    trades.push({
      id: `${account}-${i}`, ninja_id: `${account}-G-${i}`, account,
      strategy: get(cols,['strategy']) || 'Manual',
      instrument: get(cols,['instrument','market','symbol']) || 'N/A',
      direction: dirRaw.toLowerCase().includes('short')||dirRaw.toLowerCase()==='sell'?'Short':'Long',
      entry_time: isNaN(d1.getTime())?entryStr:d1.toISOString(),
      exit_time: isNaN(d2.getTime())?exitStr:d2.toISOString(),
      duration_min: dur,
      entry_price: pn(get(cols,['entry price','price'])),
      exit_price: pn(get(cols,['exit price'])),
      quantity: parseInt(get(cols,['qty','quantity','size'])) || 1,
      pnl, commission: comm, net_pnl: pnl-comm,
      mae: pn(get(cols,['mae']))||undefined,
      mfe: pn(get(cols,['mfe']))||undefined,
      emotion_tags: [], rule_followed: undefined, notes: '',
    })
  }
  return trades
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pc = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const fmtUSD = (v: number, sign = true) =>
  `${sign && v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`

function computeStatsFromTrades(trades: Trade[]): Partial<PerfReport> & { equity: any[]; byDay: any[]; byHour: any[]; byDuration: any[]; streaks: any; maeFmeData: any[] } {
  const wins = trades.filter(t => t.net_pnl > 0)
  const losses = trades.filter(t => t.net_pnl < 0)
  const totalPnl = trades.reduce((s,t) => s+t.net_pnl, 0)
  const avgWin = wins.length > 0 ? wins.reduce((s,t) => s+t.net_pnl,0)/wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s,t) => s+t.net_pnl,0)/losses.length) : 0

  // Equity curve
  let cum = 0
  const equity = [...trades].reverse().map((t,i) => {
    cum += t.net_pnl
    return { i: i+1, value: parseFloat(cum.toFixed(2)), pnl: t.net_pnl, date: t.entry_time?.split('T')[0] || t.entry_time?.split(' ')[0] || '' }
  })

  // By weekday
  const byDayMap: Record<number,{pnl:number;count:number;wins:number}> = {}
  const parseTradeDate = (s: string) => {
    const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`)
    return new Date(s || '')
  }
  trades.forEach(t => {
    if (!t.entry_time) return
    const d = parseTradeDate(t.entry_time); if(isNaN(d.getTime())) return
    const wd = d.getDay()
    if (!byDayMap[wd]) byDayMap[wd] = {pnl:0,count:0,wins:0}
    byDayMap[wd].pnl += t.net_pnl; byDayMap[wd].count++
    if (t.net_pnl > 0) byDayMap[wd].wins++
  })
  const byDay = [1,2,3,4,5].map(d => ({
    day: WEEKDAYS[d],
    pnl: parseFloat((byDayMap[d]?.pnl || 0).toFixed(2)),
    count: byDayMap[d]?.count || 0,
    wr: byDayMap[d] ? parseFloat((byDayMap[d].wins/byDayMap[d].count*100).toFixed(1)) : 0
  }))

  // By hour
  const byHourMap: Record<number,{pnl:number;count:number;wins:number}> = {}
  trades.forEach(t => {
    if (!t.entry_time) return
    const d = parseTradeDate(t.entry_time); if(isNaN(d.getTime())) return
    const h = d.getHours()
    if (!byHourMap[h]) byHourMap[h] = {pnl:0,count:0,wins:0}
    byHourMap[h].pnl += t.net_pnl; byHourMap[h].count++
    if (t.net_pnl > 0) byHourMap[h].wins++
  })
  const byHour = Object.entries(byHourMap).map(([h,v]) => ({
    hour: `${h}:00`, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count,
    wr: parseFloat((v.wins/v.count*100).toFixed(1))
  })).sort((a,b) => parseInt(a.hour)-parseInt(b.hour))

  // By duration bucket
  const durBuckets = [{label:'<5m',max:5},{label:'5-15m',max:15},{label:'15-30m',max:30},{label:'30-60m',max:60},{label:'>60m',max:99999}]
  const byDuration = durBuckets.map(b => {
    const bucket = trades.filter(t => t.duration_min <= b.max && (b.max===5?true:t.duration_min>durBuckets[durBuckets.indexOf(b)-1]?.max||0))
    const pnl = bucket.reduce((s,t)=>s+t.net_pnl,0)
    const wins = bucket.filter(t=>t.net_pnl>0).length
    return { label:b.label, count:bucket.length, pnl:parseFloat(pnl.toFixed(2)), wr:bucket.length>0?parseFloat((wins/bucket.length*100).toFixed(1)):0 }
  }).filter(b => b.count > 0)

  // Streak tracker
  let curStreak = 0, maxWin = 0, maxLoss = 0, streakType: 'win'|'loss'|null = null
  const streakHistory: number[] = []
  trades.forEach(t => {
    if (t.net_pnl > 0) {
      if (streakType === 'win') curStreak++; else curStreak = 1; streakType = 'win'
      maxWin = Math.max(maxWin, curStreak)
    } else {
      if (streakType === 'loss') curStreak++; else curStreak = 1; streakType = 'loss'
      maxLoss = Math.max(maxLoss, curStreak)
    }
    streakHistory.push(streakType === 'win' ? curStreak : -curStreak)
  })

  // MAE/MFE scatter
  const maeFmeData = trades.filter(t => t.mae != null || t.mfe != null).map(t => ({
    mae: Math.abs(t.mae || 0), mfe: t.mfe || 0, pnl: t.net_pnl,
    size: Math.abs(t.net_pnl) > 0 ? Math.max(4, Math.min(16, Math.abs(t.net_pnl)/20)) : 4
  }))

  // Max drawdown da trades
  let peak = 0, dd = 0, cumPnl = 0
  const tradesCopy = trades.slice().reverse()
  tradesCopy.forEach(t => { cumPnl += t.net_pnl; if(cumPnl>peak) peak=cumPnl; dd=Math.max(dd,peak-cumPnl) })

  return {
    totalNetProfit: parseFloat(totalPnl.toFixed(2)),
    grossProfit: parseFloat(wins.reduce((s,t)=>s+t.net_pnl,0).toFixed(2)),
    grossLoss: parseFloat(losses.reduce((s,t)=>s+t.net_pnl,0).toFixed(2)),
    winRate: trades.length > 0 ? parseFloat((wins.length/trades.length*100).toFixed(1)) : 0,
    winTrades: wins.length, lossTrades: losses.length, totalTrades: trades.length,
    avgWin: parseFloat(avgWin.toFixed(2)), avgLoss: parseFloat(avgLoss.toFixed(2)),
    rrRatio: avgLoss > 0 ? parseFloat((avgWin/avgLoss).toFixed(2)) : 0,
    maxDrawdown: parseFloat(dd.toFixed(2)),
    profitFactor: Math.abs(losses.reduce((s,t)=>s+t.net_pnl,0)) > 0 ? parseFloat((wins.reduce((s,t)=>s+t.net_pnl,0)/Math.abs(losses.reduce((s,t)=>s+t.net_pnl,0))).toFixed(2)) : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t=>t.net_pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t=>t.net_pnl)) : 0,
    avgTrade: parseFloat((totalPnl/Math.max(trades.length,1)).toFixed(2)),
    commission: parseFloat(trades.reduce((s,t)=>s+(t.commission||0),0).toFixed(2)),
    equity, byDay, byHour, byDuration,
    streaks: { maxWin, maxLoss, current: curStreak, currentType: streakType, history: streakHistory },
    maeFmeData,
    longStats: { netProfit: parseFloat(trades.filter(t=>t.direction==='Long').reduce((s,t)=>s+t.net_pnl,0).toFixed(2)), winRate: parseFloat((trades.filter(t=>t.direction==='Long'&&t.net_pnl>0).length/Math.max(trades.filter(t=>t.direction==='Long').length,1)*100).toFixed(1)), trades: trades.filter(t=>t.direction==='Long').length },
    shortStats: { netProfit: parseFloat(trades.filter(t=>t.direction==='Short').reduce((s,t)=>s+t.net_pnl,0).toFixed(2)), winRate: parseFloat((trades.filter(t=>t.direction==='Short'&&t.net_pnl>0).length/Math.max(trades.filter(t=>t.direction==='Short').length,1)*100).toFixed(1)), trades: trades.filter(t=>t.direction==='Short').length },
  } as any
}

function generateInsight(s: Partial<PerfReport>): string {
  const ins: string[] = []
  if (s.winRate! >= 50) ins.push(`Win rate ${s.winRate?.toFixed(1)}% — consistente.`)
  else ins.push(`Win rate ${s.winRate?.toFixed(1)}% — sotto 50%. Con R:R attuale di ${s.rrRatio?.toFixed(2)} ${s.rrRatio! >= 1 ? 'sei comunque in positivo' : 'stai perdendo nel lungo periodo'}.`)
  if (s.rrRatio! >= 1.5) ins.push(`R:R ${s.rrRatio?.toFixed(2)} ottimo.`)
  else if (s.rrRatio! < 1) ins.push(`⚠ R:R ${s.rrRatio?.toFixed(2)} — considera di tagliare prima le perdite o lasciare correre di più i winner.`)
  if (s.longStats!.netProfit > 0 && s.shortStats!.netProfit < 0) ins.push(`Long profittevole (${fmtUSD(s.longStats!.netProfit)}), Short in perdita (${fmtUSD(s.shortStats!.netProfit)}).`)
  if (s.profitFactor! >= 1.5) ins.push(`Profit factor ${s.profitFactor?.toFixed(2)} — sistema robusto.`)
  else if (s.profitFactor! < 1) ins.push(`⚠ Profit factor ${s.profitFactor?.toFixed(2)} — il sistema perde nel lungo periodo.`)
  return ins.join(' ')
}

// ─── CALENDARIO P&L ───────────────────────────────────────────────────────────
function PnLCalendar({ trades }: { trades: Trade[] }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [year, mon] = month.split('-').map(Number)
  const firstDay = new Date(year, mon-1, 1).getDay()
  const daysInMonth = new Date(year, mon, 0).getDate()

  const dayMap: Record<string,{pnl:number;trades:number;wins:number}> = {}
  trades.forEach(t => {
    if (!t.entry_time) return
    // Supporta sia ISO (2026-04-09T16:10:56.000Z) che formato italiano (09/04/2026 16:10:56)
    let d: Date
    const itMatch = t.entry_time.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (itMatch) {
      d = new Date(`${itMatch[3]}-${itMatch[2]}-${itMatch[1]}`)
    } else {
      d = new Date(t.entry_time)
    }
    if(isNaN(d.getTime())) return
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!dayMap[key]) dayMap[key] = {pnl:0,trades:0,wins:0}
    dayMap[key].pnl += t.net_pnl; dayMap[key].trades++
    if (t.net_pnl > 0) dayMap[key].wins++
  })

  const maxAbs = Math.max(...Object.values(dayMap).map(d => Math.abs(d.pnl)), 1)
  const monthPnl = Object.entries(dayMap).filter(([k]) => k.startsWith(month)).reduce((s,[,v]) => s+v.pnl, 0)
  const monthTrades = Object.entries(dayMap).filter(([k]) => k.startsWith(month)).reduce((s,[,v]) => s+v.trades, 0)
  const monthWinDays = Object.entries(dayMap).filter(([k]) => k.startsWith(month) && dayMap[k].pnl > 0).length
  const monthDays = Object.keys(dayMap).filter(k => k.startsWith(month)).length

  const prevMonth = () => { const d = new Date(year,mon-2); setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
  const nextMonth = () => { const d = new Date(year,mon); setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:'var(--text-0)'}}>Calendario P&L</div>
            <div style={{fontSize:11,color:'var(--text-2)',marginTop:2}}>{monthTrades} trade · <span style={{color:pc(monthPnl),fontFamily:'var(--font-mono)'}}>{fmtUSD(monthPnl)}</span> · {monthWinDays}/{monthDays} giorni positivi</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={prevMonth} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'transparent',color:'var(--text-1)',cursor:'pointer',fontSize:13}}>‹</button>
            <div style={{fontSize:13,fontWeight:500,color:'var(--text-0)',minWidth:120,textAlign:'center'}}>{new Date(year,mon-1).toLocaleDateString('it-IT',{month:'long',year:'numeric'})}</div>
            <button onClick={nextMonth} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'transparent',color:'var(--text-1)',cursor:'pointer',fontSize:13}}>›</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:4}}>
          {['Dom','Lun','Mar','Mer','Gio','Ven','Sab'].map(d => <div key={d} style={{fontSize:10,textAlign:'center',color:'var(--text-2)',fontFamily:'var(--font-mono)',padding:'4px 0'}}>{d}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
          {Array.from({length:firstDay}).map((_,i) => <div key={`e${i}`}/>)}
          {Array.from({length:daysInMonth}).map((_,i) => {
            const day = i+1
            const key = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const s = dayMap[key]
            const intensity = s ? Math.min(Math.abs(s.pnl)/maxAbs, 1) : 0
            const isToday = key === new Date().toISOString().split('T')[0]
            return (
              <div key={day} title={s ? `${s.trades} trade · ${fmtUSD(s.pnl)} · WR ${(s.wins/s.trades*100).toFixed(0)}%` : ''}
                style={{aspectRatio:'1',borderRadius:6,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontSize:10,cursor:s?'pointer':'default',
                  background:!s?'var(--bg-3)':s.pnl>0?`rgba(0,212,170,${0.15+intensity*0.7})`:`rgba(255,77,109,${0.15+intensity*0.7})`,
                  border:isToday?'1px solid var(--accent)':'1px solid transparent',
                  color:s?'white':'var(--text-2)',fontWeight:s?600:400}}>
                <div>{day}</div>
                {s && <div style={{fontSize:8,opacity:0.9}}>{s.pnl>0?'+':''}{s.pnl.toFixed(0)}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── ANALYTICS STATS ──────────────────────────────────────────────────────────
function StatsView({ perfReport, trades }: { perfReport?: PerfReport; trades: Trade[] }) {
  const computed = computeStatsFromTrades(trades)
  // Merge: preferisce perfReport se disponibile per i dati aggregati
  const stats = perfReport ? { ...computed, ...perfReport, equity: computed.equity, byDay: computed.byDay, byHour: computed.byHour, byDuration: computed.byDuration, streaks: computed.streaks, maeFmeData: computed.maeFmeData } : computed as any
  const hasTrades = trades.length > 0

  if (!perfReport && !hasTrades) return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:40,textAlign:'center'}}>
      <div style={{fontSize:32,opacity:0.15,marginBottom:12}}>◑</div>
      <div style={{fontSize:14,color:'var(--text-1)'}}>Nessun dato disponibile</div>
      <div style={{fontSize:12,color:'var(--text-2)',marginTop:6}}>Importa un Performance Report o una lista trade singoli</div>
    </div>
  )

  const winLoss = [{name:'Win',value:stats.winTrades||0,fill:'#00d4aa'},{name:'Loss',value:stats.lossTrades||0,fill:'#ff4d6d'}]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Header conto */}
      <div style={{background:'var(--bg-3)',borderRadius:12,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:'var(--text-0)'}}>Riepilogo</div>
          {perfReport && <div style={{fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)',marginTop:2}}>{perfReport.startDate} → {perfReport.endDate} · {perfReport.totalTrades} trade</div>}
          {!perfReport && hasTrades && <div style={{fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)',marginTop:2}}>{trades.length} trade importati</div>}
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:28,fontFamily:'var(--font-mono)',fontWeight:800,color:pc(stats.totalNetProfit||0)}}>{fmtUSD(stats.totalNetProfit||0)}</div>
          <div style={{fontSize:11,color:'var(--text-2)'}}>Net P&L</div>
        </div>
      </div>

      {/* KPI row 1 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
        {[
          {l:'Win Rate',v:`${(stats.winRate||0).toFixed(1)}%`,s:`${stats.winTrades||0}W/${stats.lossTrades||0}L`,c:(stats.winRate||0)>=50?'var(--green)':'var(--red)'},
          {l:'Profit Factor',v:(stats.profitFactor||0).toFixed(2),s:(stats.profitFactor||0)>=1.5?'Ottimo':(stats.profitFactor||0)>=1?'Accettabile':'Negativo',c:(stats.profitFactor||0)>=1.5?'var(--green)':(stats.profitFactor||0)>=1?'var(--amber)':'var(--red)'},
          {l:'R:R Ratio',v:(stats.rrRatio||0).toFixed(2),s:'Avg Win / Avg Loss',c:(stats.rrRatio||0)>=1?'var(--green)':'var(--amber)'},
          {l:'Max Drawdown',v:fmtUSD(stats.maxDrawdown||0,false),s:'Peak to valley',c:'var(--red)'},
          {l:'Sharpe',v:(stats.sharpeRatio||0).toFixed(2)||'—',s:(stats.sharpeRatio||0)>=1?'Buono':'Da migliorare',c:(stats.sharpeRatio||0)>=1?'var(--green)':'var(--amber)'},
        ].map(k => (
          <div key={k.l} style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:5}}>{k.l}</div>
            <div style={{fontSize:19,fontFamily:'var(--font-mono)',fontWeight:700,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:'var(--text-2)',marginTop:3}}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* Equity + Win/Loss */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 180px',gap:14}}>
        {computed.equity.length > 0 ? (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Equity Curve</div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={computed.equity}>
                <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00d4aa" stopOpacity={0.2}/><stop offset="95%" stopColor="#00d4aa" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} interval={Math.floor(computed.equity.length/5)}/>
                <YAxis tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`} width={50}/>
                <Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}} formatter={(v:any) => [`$${v}`,'Equity'] as [string,string]}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
                <Area type="monotone" dataKey="value" stroke="#00d4aa" strokeWidth={1.5} fill="url(#eqGrad)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{fontSize:12,color:'var(--text-2)',textAlign:'center'}}>Importa la lista trade singoli per visualizzare l'equity curve</div>
          </div>
        )}
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Win / Loss</div>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart><Pie data={winLoss} cx="50%" cy="50%" innerRadius={30} outerRadius={52} paddingAngle={3} dataKey="value">{winLoss.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Pie><Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}}/></PieChart>
          </ResponsiveContainer>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:4}}>
            <span style={{color:'var(--green)'}}>W {stats.winTrades||0}</span>
            <span style={{color:'var(--red)'}}>L {stats.lossTrades||0}</span>
          </div>
          <div style={{marginTop:10,fontSize:11,display:'flex',flexDirection:'column',gap:4}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text-2)'}}>Long</span><span style={{color:pc((stats.longStats?.winRate||0)-50),fontFamily:'var(--font-mono)'}}>{(stats.longStats?.winRate||0).toFixed(0)}% WR</span></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text-2)'}}>Short</span><span style={{color:pc((stats.shortStats?.winRate||0)-50),fontFamily:'var(--font-mono)'}}>{(stats.shortStats?.winRate||0).toFixed(0)}% WR</span></div>
          </div>
        </div>
      </div>

      {/* P&L per giorno della settimana + per ora */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        {computed.byDay.length > 0 && (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>P&L per giorno della settimana</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={computed.byDay}>
                <XAxis dataKey="day" tick={{fontSize:10,fill:'var(--text-2)'}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`} width={45}/>
                <Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}} formatter={(v:any,n:any)=>[n==='pnl'?`$${v}`:`${v}%`,n==='pnl'?'P&L':'Win Rate'] as [string,string]}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
                <Bar dataKey="pnl" radius={[4,4,0,0]}>{computed.byDay.map((e:any,i:number)=><Cell key={i} fill={e.pnl>=0?'#00d4aa':'#ff4d6d'}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{display:'flex',justifyContent:'space-around',marginTop:8}}>
              {computed.byDay.map((d:any) => (
                <div key={d.day} style={{textAlign:'center',fontSize:9,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>{d.wr}%</div>
              ))}
            </div>
          </div>
        )}
        {computed.byHour.length > 0 && (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>P&L per ora del giorno</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={computed.byHour}>
                <XAxis dataKey="hour" tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`} width={45}/>
                <Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
                <Bar dataKey="pnl" radius={[3,3,0,0]}>{computed.byHour.map((e:any,i:number)=><Cell key={i} fill={e.pnl>=0?'#00d4aa':'#ff4d6d'}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Durata trade + Streak */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        {computed.byDuration.length > 0 && (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>P&L per durata trade</div>
            {computed.byDuration.map((d:any) => (
              <div key={d.label} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <div style={{width:50,fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-1)',flexShrink:0}}>{d.label}</div>
                <div style={{flex:1,height:18,background:'var(--bg-3)',borderRadius:4,overflow:'hidden',position:'relative'}}>
                  <div style={{position:'absolute',left:'50%',top:0,width:1,height:'100%',background:'rgba(255,255,255,0.1)'}}></div>
                  <div style={{position:'absolute',left:d.pnl>=0?'50%':`calc(50% - ${Math.min(Math.abs(d.pnl)/Math.max(...computed.byDuration.map((x:any)=>Math.abs(x.pnl)))*50,50)}%)`,width:`${Math.min(Math.abs(d.pnl)/Math.max(...computed.byDuration.map((x:any)=>Math.abs(x.pnl)))*50,50)}%`,height:'100%',background:d.pnl>=0?'#00d4aa':'#ff4d6d',opacity:0.8}}></div>
                </div>
                <div style={{width:55,fontSize:11,fontFamily:'var(--font-mono)',color:pc(d.pnl),textAlign:'right'}}>{fmtUSD(d.pnl)}</div>
                <div style={{width:32,fontSize:10,color:'var(--text-2)'}}>{d.wr}%</div>
              </div>
            ))}
          </div>
        )}
        {computed.streaks && (
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Streak tracker</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div style={{background:'var(--bg-3)',borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'var(--text-2)'}}>Max serie vincente</div>
                <div style={{fontSize:22,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--green)'}}>{computed.streaks.maxWin}</div>
              </div>
              <div style={{background:'var(--bg-3)',borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'var(--text-2)'}}>Max serie perdente</div>
                <div style={{fontSize:22,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--red)'}}>{computed.streaks.maxLoss}</div>
              </div>
            </div>
            <div style={{fontSize:11,color:'var(--text-2)',marginBottom:8}}>Streak corrente</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:18,fontFamily:'var(--font-mono)',fontWeight:700,color:computed.streaks.currentType==='win'?'var(--green)':'var(--red)'}}>{computed.streaks.current}</span>
              <span style={{fontSize:12,color:computed.streaks.currentType==='win'?'var(--green)':'var(--red)'}}>{computed.streaks.currentType==='win'?'vincente consecutivi':'perdenti consecutivi'}</span>
            </div>
            {computed.streaks.maxLoss >= 4 && (
              <div style={{marginTop:10,padding:'8px 10px',background:'var(--red-dim)',borderRadius:7,fontSize:11,color:'var(--red)'}}>
                ⚠ {computed.streaks.maxLoss} perdite consecutive — considera uno stop giornaliero dopo 2-3 loss
              </div>
            )}
          </div>
        )}
      </div>

      {/* MAE/MFE scatter */}
      {computed.maeFmeData.length > 0 && (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>MAE vs MFE per trade</div>
          <div style={{fontSize:11,color:'var(--text-2)',marginBottom:12}}>Verde = trade positivo · Rosso = trade negativo · Dimensione = P&L assoluto</div>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/>
              <XAxis dataKey="mae" name="MAE" tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} label={{value:'MAE ($)',position:'bottom',fontSize:10,fill:'var(--text-2)'}} tickFormatter={v=>`$${v}`}/>
              <YAxis dataKey="mfe" name="MFE" tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} label={{value:'MFE ($)',angle:-90,position:'insideLeft',fontSize:10,fill:'var(--text-2)'}} tickFormatter={v=>`$${v}`}/>
              <ZAxis dataKey="size" range={[30,200]}/>
              <Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}} formatter={(v:any) => [`$${v}`,'P&L'] as [string,string]}/>
              <Scatter data={computed.maeFmeData.map(d => ({...d, fill:d.pnl>=0?'rgba(0,212,170,0.6)':'rgba(255,77,109,0.6)'}))} fill="#00d4aa">
                {computed.maeFmeData.map((d:any,i:number) => <Cell key={i} fill={d.pnl>=0?'rgba(0,212,170,0.6)':'rgba(255,77,109,0.6)'}/>)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Dettaglio numerico */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Long vs Short</div>
          {[{name:'Long',s:stats.longStats,color:'var(--green)'},{name:'Short',s:stats.shortStats,color:'var(--red)'}].map(d => (
            <div key={d.name} style={{marginBottom:14}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:d.color}}>{d.name}</span>
                <span style={{fontSize:12,fontFamily:'var(--font-mono)',color:pc(d.s?.netProfit||0)}}>{fmtUSD(d.s?.netProfit||0)}</span>
              </div>
              <div style={{height:6,background:'var(--bg-3)',borderRadius:3,overflow:'hidden',marginBottom:3}}>
                <div style={{width:`${d.s?.winRate||0}%`,height:'100%',background:d.color,borderRadius:3,opacity:0.8}}></div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-2)'}}>
                <span>{d.s?.trades||0} trade</span><span>WR {(d.s?.winRate||0).toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Metriche chiave</div>
          {[
            ['Avg Win',fmtUSD(stats.avgWin||0),'var(--green)'],
            ['Avg Loss',fmtUSD(stats.avgLoss||0),'var(--red)'],
            ['Larger Win',fmtUSD(stats.largestWin||0),'var(--green)'],
            ['Largest Loss',fmtUSD(stats.largestLoss||0),'var(--red)'],
            ['Avg MAE',fmtUSD(stats.avgMAE||0,false),'var(--amber)'],
            ['Avg MFE',fmtUSD((stats as any).avgMFE||0,false),'#4da6ff'],
            ['Commissioni',fmtUSD(stats.commission||0,false),'var(--amber)'],
            ['Avg Trade',fmtUSD(stats.avgTrade||0),pc(stats.avgTrade||0)],
          ].map(([l,v,c]) => (
            <div key={l as string} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{fontSize:11,color:'var(--text-1)'}}>{l}</span>
              <span style={{fontSize:11,fontFamily:'var(--font-mono)',fontWeight:600,color:c as string}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI insight */}
      <div style={{background:'var(--bg-2)',border:'1px solid rgba(0,212,170,0.2)',borderRadius:12,padding:'14px 18px'}}>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--accent)',textTransform:'uppercase',marginBottom:6}}>◈ Analisi automatica</div>
        <div style={{fontSize:13,color:'var(--text-1)',lineHeight:1.8}}>{generateInsight(stats)}</div>
      </div>
    </div>
  )
}

// ─── TRADE ROW ESPANDIBILE ────────────────────────────────────────────────────
function TradeRow({ trade, onUpdate }: { trade: Trade; onUpdate: (id: string, u: Partial<Trade>) => void }) {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<string[]>(trade.emotion_tags || [])
  const [rule, setRule] = useState<boolean|undefined>(trade.rule_followed)
  const [notes, setNotes] = useState(trade.notes || '')
  const [quality, setQuality] = useState(trade.setup_quality || 0)

  const toggleTag = (id: string) => { const n = tags.includes(id)?tags.filter(t=>t!==id):[...tags,id]; setTags(n); onUpdate(trade.id,{emotion_tags:n}) }
  const setR = (v: boolean) => { setRule(v); onUpdate(trade.id,{rule_followed:v}) }
  const setQ = (v: number) => { setQuality(v); onUpdate(trade.id,{setup_quality:v}) }

  return (
    <>
      <div onClick={() => setOpen(!open)}
        style={{display:'grid',gridTemplateColumns:'22px 75px 95px 60px 105px 50px 50px 70px 70px 1fr',padding:'9px 14px',borderBottom:'1px solid rgba(255,255,255,0.04)',fontSize:12,alignItems:'center',cursor:'pointer'}}
        onMouseEnter={e => (e.currentTarget.style.background='var(--bg-3)')}
        onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
        <div style={{fontSize:10,color:'var(--text-2)'}}>{open?'▼':'▶'}</div>
        <div style={{fontWeight:500,color:'var(--text-0)'}}>{trade.instrument}</div>
        <div style={{fontSize:11,color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{trade.strategy}</div>
        <div><span style={{display:'inline-block',padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:trade.direction==='Long'?'var(--green-dim)':'var(--red-dim)',color:trade.direction==='Long'?'var(--green)':'var(--red)'}}>{trade.direction}</span></div>
        <div style={{fontSize:10,color:'var(--text-1)',fontFamily:'var(--font-mono)'}}>{trade.entry_time?.substring(0,16)||'—'}</div>
        <div style={{fontSize:11,color:'var(--text-2)'}}>{trade.duration_min}m</div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:11}}>{trade.quantity}</div>
        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:pc(trade.net_pnl)}}>{trade.net_pnl>=0?'+':''}{trade.net_pnl.toFixed(2)}</div>
        <div style={{fontSize:10,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>{trade.commission>0?`comm -${trade.commission.toFixed(2)}`:''}</div>
        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
          {tags.slice(0,3).map(t=>{const tag=EMOTION_TAGS.find(e=>e.id===t);return tag?<span key={t} style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:`${tag.color}22`,color:tag.color,fontWeight:600}}>{tag.label}</span>:null})}
          {rule===true&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'var(--green-dim)',color:'var(--green)',fontWeight:600}}>✓</span>}
          {rule===false&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'var(--red-dim)',color:'var(--red)',fontWeight:600}}>✗</span>}
          {quality>0&&<span style={{fontSize:9,color:'var(--amber)'}}>{'★'.repeat(quality)}</span>}
        </div>
      </div>
      {open && (
        <div style={{background:'var(--bg-3)',padding:'14px 20px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:10,letterSpacing:'0.06em'}}>Tag emotivi</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {EMOTION_TAGS.map(tag => (
                  <button key={tag.id} onClick={()=>toggleTag(tag.id)}
                    style={{padding:'4px 9px',borderRadius:5,border:`1px solid ${tags.includes(tag.id)?tag.color:'var(--border)'}`,background:tags.includes(tag.id)?`${tag.color}22`:'transparent',color:tags.includes(tag.id)?tag.color:'var(--text-2)',cursor:'pointer',fontSize:11,fontWeight:tags.includes(tag.id)?600:400}}>
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:10,letterSpacing:'0.06em'}}>Regole rispettate</div>
              <div style={{display:'flex',gap:6,marginBottom:14}}>
                <button onClick={()=>setR(true)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${rule===true?'var(--green)':'var(--border)'}`,background:rule===true?'var(--green-dim)':'transparent',color:rule===true?'var(--green)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:600}}>✓ Sì</button>
                <button onClick={()=>setR(false)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${rule===false?'var(--red)':'var(--border)'}`,background:rule===false?'var(--red-dim)':'transparent',color:rule===false?'var(--red)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:600}}>✗ No</button>
              </div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8,letterSpacing:'0.06em'}}>Qualità setup</div>
              <div style={{display:'flex',gap:4}}>
                {[1,2,3,4,5].map(n => <div key={n} style={{fontSize:18,cursor:'pointer',opacity:quality>=n?1:0.25,color:'var(--amber)'}} onClick={()=>setQ(n)}>★</div>)}
              </div>
              <div style={{marginTop:12,fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>
                Entry: <span style={{color:'var(--text-0)'}}>{trade.entry_price||'—'}</span>{' '}
                Exit: <span style={{color:'var(--text-0)'}}>{trade.exit_price||'—'}</span>
                {trade.mae!=null&&<span>{' '}MAE: <span style={{color:'var(--red)'}}>-${Math.abs(trade.mae).toFixed(0)}</span></span>}
                {trade.mfe!=null&&<span>{' '}MFE: <span style={{color:'var(--green)'}}>+${trade.mfe.toFixed(0)}</span></span>}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:10,letterSpacing:'0.06em'}}>Note sul trade</div>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} onBlur={()=>onUpdate(trade.id,{notes})}
                placeholder="Setup, motivazione, cosa hai fatto bene/male..."
                style={{width:'100%',height:90,background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text-0)',fontSize:12,padding:'8px 10px',resize:'none',fontFamily:'var(--font-body)',outline:'none'}}/>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── EMOTION ANALYTICS ────────────────────────────────────────────────────────
function EmotionAnalytics({ trades }: { trades: Trade[] }) {
  const withTags = trades.filter(t=>t.emotion_tags?.length)
  const withRule = trades.filter(t=>t.rule_followed!==undefined)
  if (withTags.length===0&&withRule.length===0) return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:32,textAlign:'center'}}>
      <div style={{fontSize:32,opacity:0.15,marginBottom:10}}>🧠</div>
      <div style={{fontSize:14,color:'var(--text-1)',marginBottom:6}}>Nessun dato psicologico ancora</div>
      <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.6}}>Vai nella tab Lista Trade, espandi i trade singoli e aggiungi i tag emotivi e la valutazione delle regole. L'analisi apparirà qui automaticamente.</div>
    </div>
  )
  const rY=withRule.filter(t=>t.rule_followed), rN=withRule.filter(t=>!t.rule_followed)
  const rYpnl=rY.reduce((s,t)=>s+t.net_pnl,0), rNpnl=rN.reduce((s,t)=>s+t.net_pnl,0)
  const rYwr=rY.filter(t=>t.net_pnl>0).length/Math.max(rY.length,1)*100
  const rNwr=rN.filter(t=>t.net_pnl>0).length/Math.max(rN.length,1)*100
  const tagStats=EMOTION_TAGS.map(tag=>{const tt=trades.filter(t=>t.emotion_tags?.includes(tag.id));if(!tt.length)return null;const pnl=tt.reduce((s,t)=>s+t.net_pnl,0);const wins=tt.filter(t=>t.net_pnl>0).length;return{...tag,count:tt.length,pnl,wr:wins/tt.length*100}}).filter(Boolean) as any[]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {withRule.length>0&&(
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Disciplina — regole rispettate vs non</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            {[{l:'✓ Regole rispettate',trades:rY,pnl:rYpnl,wr:rYwr,c:'var(--green)'},{l:'✗ Regole NON rispettate',trades:rN,pnl:rNpnl,wr:rNwr,c:'var(--red)'}].map(r=>(
              <div key={r.l} style={{background:'var(--bg-3)',borderRadius:10,padding:14}}>
                <div style={{fontSize:12,fontWeight:600,color:r.c,marginBottom:10}}>{r.l}</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  <div><div style={{fontSize:10,color:'var(--text-2)'}}>Trade</div><div style={{fontSize:18,fontFamily:'var(--font-mono)',fontWeight:700}}>{r.trades.length}</div></div>
                  <div><div style={{fontSize:10,color:'var(--text-2)'}}>Win Rate</div><div style={{fontSize:18,fontFamily:'var(--font-mono)',fontWeight:700,color:r.wr>=50?'var(--green)':'var(--red)'}}>{r.wr.toFixed(0)}%</div></div>
                  <div><div style={{fontSize:10,color:'var(--text-2)'}}>P&L</div><div style={{fontSize:16,fontFamily:'var(--font-mono)',fontWeight:700,color:pc(r.pnl)}}>{fmtUSD(r.pnl)}</div></div>
                </div>
              </div>
            ))}
          </div>
          {rNpnl<0&&rYpnl>0&&(
            <div style={{marginTop:10,padding:'8px 12px',background:'var(--accent-dim)',borderRadius:8,fontSize:12,color:'var(--accent)'}}>
              ◈ Quando rispetti le regole guadagni {fmtUSD(rYpnl)}. Senza disciplina perdi {fmtUSD(rNpnl)}. La differenza vale <strong>{fmtUSD(rYpnl-rNpnl)}</strong>.
            </div>
          )}
        </div>
      )}
      {tagStats.length>0&&(
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Performance per stato emotivo</div>
          {tagStats.sort((a:any,b:any)=>b.count-a.count).map((tag:any)=>(
            <div key={tag.id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 10px',background:'var(--bg-3)',borderRadius:8,marginBottom:6}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:tag.color,flexShrink:0,boxShadow:`0 0 4px ${tag.color}`}}></div>
              <div style={{width:130,fontSize:12,fontWeight:500}}>{tag.label}</div>
              <div style={{fontSize:11,color:'var(--text-2)',width:55}}>{tag.count} trade</div>
              <div style={{flex:1,height:6,background:'var(--bg-2)',borderRadius:3,overflow:'hidden'}}><div style={{width:`${tag.wr}%`,height:'100%',background:tag.wr>=50?'var(--green)':'var(--red)',borderRadius:3}}></div></div>
              <div style={{width:44,fontSize:11,fontFamily:'var(--font-mono)',color:tag.wr>=50?'var(--green)':'var(--red)'}}>{tag.wr.toFixed(0)}%</div>
              <div style={{width:80,fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:pc(tag.pnl),textAlign:'right'}}>{fmtUSD(tag.pnl)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ─── ACCOUNT ROW ─────────────────────────────────────────────────────────────
function AccountRow({ account, onRename, onDelete, tradeCount }: {
  account: string; onRename: (o: string, n: string) => void
  onDelete: (a: string) => void; tradeCount: number
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account)
  const [confirmDel, setConfirmDel] = useState(false)

  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== account) {
      onRename(account, trimmed)
    }
    setEditing(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') { setName(account); setEditing(false) }
  }

  return (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--bg-3)',borderRadius:9,border:'1px solid var(--border)'}}>
      <div style={{width:8,height:8,borderRadius:'50%',background:'var(--accent)',flexShrink:0,boxShadow:'0 0 5px var(--accent)'}}></div>
      {editing ? (
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={handleKey}
          autoFocus style={{flex:1,padding:'5px 10px',background:'var(--bg-2)',border:'1px solid var(--accent)',borderRadius:6,color:'var(--text-0)',fontSize:13,fontFamily:'var(--font-mono)',outline:'none'}}/>
      ) : (
        <div style={{flex:1,fontSize:13,fontFamily:'var(--font-mono)',fontWeight:500,color:'var(--text-0)'}}>{account}</div>
      )}
      <div style={{fontSize:11,color:'var(--text-2)'}}>{tradeCount} trade</div>
      {editing ? (
        <div style={{display:'flex',gap:5}}>
          <button onClick={save} style={{padding:'4px 12px',borderRadius:5,border:'1px solid var(--accent)',background:'var(--accent-dim)',color:'var(--accent)',cursor:'pointer',fontSize:11,fontWeight:600}}>✓ Salva</button>
          <button onClick={()=>{setName(account);setEditing(false)}} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--text-2)',cursor:'pointer',fontSize:11}}>Annulla</button>
        </div>
      ) : confirmDel ? (
        <div style={{display:'flex',gap:5,alignItems:'center'}}>
          <span style={{fontSize:11,color:'var(--red)'}}>Eliminare tutti i dati?</span>
          <button onClick={()=>onDelete(account)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--red)',background:'var(--red-dim)',color:'var(--red)',cursor:'pointer',fontSize:11,fontWeight:600}}>Sì, elimina</button>
          <button onClick={()=>setConfirmDel(false)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--text-2)',cursor:'pointer',fontSize:11}}>Annulla</button>
        </div>
      ) : (
        <div style={{display:'flex',gap:5}}>
          <button onClick={()=>setEditing(true)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:'transparent',color:'var(--text-2)',cursor:'pointer',fontSize:11}}>✏ Rinomina</button>
          <button onClick={()=>setConfirmDel(true)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid rgba(255,77,109,0.3)',background:'var(--red-dim)',color:'var(--red)',cursor:'pointer',fontSize:11}}>🗑 Elimina</button>
        </div>
      )}
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function TradesAdvanced({ userId, tradesHook }: { userId: string; tradesHook?: any }) {
  const [perfStats, setPerfStats] = useState<Record<string,PerfReport>>({})  // inizializza vuoto
  const [trades, setTrades] = useState<Trade[]>([])  // inizializza vuoto, carica in useEffect
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [tab, setTab] = useState<'stats'|'calendar'|'list'|'emotion'|'sync'>('stats')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const [fileType] = useState<'trades'>('trades')
  const [filterDir, setFilterDir] = useState<'all'|'Long'|'Short'>('all')
  const [filterStrategy, setFilterStrategy] = useState('all')
  const fileRef = useRef<HTMLInputElement>(null)

  const allPerfStats = tradesHook ? tradesHook.perfReports : perfStats
  const allTrades = tradesHook ? tradesHook.trades : trades
  const accounts = tradesHook ? tradesHook.accounts : [...new Set([...Object.keys(perfStats), ...trades.map(t=>t.account)])]

  // Carica dati locali specifici per questo utente all'avvio
  useEffect(() => {
    if (!userId) return
    const key = userId || 'guest'
    try {
      const lt = localStorage.getItem('ad_trades_' + key)
      if (lt) setTrades(JSON.parse(lt))
      const lp = localStorage.getItem('ad_perf_' + key)
      if (lp) setPerfStats(JSON.parse(lp))
    } catch {}
  }, [userId])

  useEffect(() => { if (accounts.length>0&&selectedAccounts.length===0) setSelectedAccounts([accounts[0]]) }, [accounts])

  const filteredTrades = allTrades.filter((t:Trade) =>
    (selectedAccounts.length===0||selectedAccounts.includes(t.account)) &&
    (filterDir==='all'||t.direction===filterDir) &&
    (filterStrategy==='all'||t.strategy===filterStrategy)
  )
  const strategies = ['all',...new Set(filteredTrades.map((t:Trade)=>t.strategy))]
  const currentPerfReport = selectedAccounts.length===1 ? allPerfStats[selectedAccounts[0]] : undefined

  const updateTrade = useCallback(async (id: string, updates: Partial<Trade>) => {
    if (tradesHook) await tradesHook.updateTrade(id, updates)
    else setTrades(prev => prev.map(t => t.id===id?{...t,...updates}:t))
  }, [tradesHook])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file||!accountName.trim()) { setImportMsg('⚠ Inserisci prima il nome del conto'); return }
    setImporting(true); setImportMsg('')
    const text = await file.text()
    // Auto-detect: se il file è un Performance Report mostra errore utile
    if (text.includes('Total net profit') && text.includes('Gross profit') && !text.includes('Entry time') && !text.includes('Entry price')) {
      setImportMsg('⚠ Questo è un Performance Report (statistiche aggregate). Carica invece la lista trade singoli: su NT8 → New → Trade Performance → scheda "Trades" o "Executions" → Export CSV')
      setImporting(false)
      return
    }
    const parsed = parseNinjaTradeList(text, accountName.trim())
    if (!parsed.length) {
      setImportMsg('⚠ Nessun trade trovato. Assicurati di esportare da: NT8 → New → Trade Performance → scheda "Trades" → tasto destro → Export → CSV')
      setImporting(false)
      return
    }
    const existing = new Map(allTrades.filter((t:Trade)=>t.account===accountName.trim()).map((t:Trade)=>[t.ninja_id||t.id,t]))
    const merged = parsed.map(t => {
      const old = existing.get(t.ninja_id||t.id)
      return old ? {...t, emotion_tags:(old as any).emotion_tags, rule_followed:(old as any).rule_followed, notes:(old as any).notes, setup_quality:(old as any).setup_quality} : t
    })
    // Salva SEMPRE su localStorage come backup immediato
    const localUpdated = [...(tradesHook ? tradesHook.trades : trades).filter((t:Trade)=>t.account!==accountName.trim()),...merged]
    lsSave('trades', localUpdated)
    if (!tradesHook) setTrades(localUpdated)

    if (tradesHook) {
      const result = await tradesHook.saveTrades(merged, accountName.trim())
      if (result?.success && !result?.local) {
        setImportMsg(`✓ ${merged.length} trade salvati in cloud per "${accountName.trim()}" · Conto creato automaticamente · Disponibili ad ogni accesso`)
      } else {
        setImportMsg(`✓ ${merged.length} trade caricati localmente per "${accountName.trim()}" · Resteranno disponibili in questa sessione`)
      }
    } else {
      setImportMsg(`✓ ${merged.length} trade caricati per "${accountName.trim()}"`)
    }
    setSelectedAccounts([accountName.trim()])
    setImporting(false)
    if (fileRef.current) fileRef.current.value=''
  }, [accountName, fileType, allTrades, tradesHook])

  const lsKey = (type: string) => 'ad_' + type + '_' + (userId || 'guest')
  const lsSave = (type: string, data: any) => { try { localStorage.setItem(lsKey(type), JSON.stringify(data)) } catch {} }
  const lsClear = (type: string) => { try { localStorage.removeItem(lsKey(type)) } catch {} }

  const inp = {padding:'8px 12px',background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-0)',fontSize:13,outline:'none',fontFamily:'var(--font-body)'} as React.CSSProperties
  const toggleAccount = (a: string) => setSelectedAccounts(prev => prev.includes(a)?prev.filter(x=>x!==a):[...prev,a])

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:26,letterSpacing:'-0.02em'}}>Eseguiti & Performance</div>

      {/* Import panel */}
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:14}}>Importa da NinjaTrader</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
          <div style={{background:'var(--bg-3)',borderRadius:10,padding:14}}>
            <div style={{fontSize:12,fontWeight:500,color:'var(--text-0)',marginBottom:10}}>📂 Import storico CSV</div>
            <input style={{...inp,width:'100%',marginBottom:10}} placeholder="Nome conto (es. Sim101, LucidProp)" value={accountName} onChange={e=>setAccountName(e.target.value)}/>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:'none'}} onChange={handleFile}/>
            <button onClick={()=>fileRef.current?.click()} disabled={importing||!accountName.trim()} style={{width:'100%',padding:'8px',background:accountName.trim()?'var(--accent)':'var(--bg-4)',border:'none',borderRadius:8,color:accountName.trim()?'#000':'var(--text-2)',fontSize:13,fontWeight:600,cursor:accountName.trim()?'pointer':'not-allowed'}}>
              {importing?'Importando...':'Seleziona file CSV'}
            </button>
            <div style={{fontSize:11,color:'var(--text-2)',marginTop:10,lineHeight:1.7,padding:'8px 10px',background:'var(--bg-2)',borderRadius:6}}>
              <strong style={{color:'var(--text-0)'}}>Come esportare da NT8:</strong><br/>
              New → Trade Performance → seleziona conto e periodo<br/>
              → scheda <strong>"Trades"</strong> → tasto destro → <strong>Export → CSV</strong><br/>
              <span style={{color:'var(--amber)'}}>⚠ Non usare "Performance" (Summary) — serve la lista trade singoli</span>
            </div>
            <div style={{marginTop:8,fontSize:11,color:'var(--text-2)',padding:'6px 10px',background:'var(--bg-2)',borderRadius:6}}>
              💡 Con <strong>AlphaDesk Bridge</strong> (Sync → NinjaTrader) il nome conto viene letto automaticamente da NT8 — non serve importare il CSV.
            </div>
          </div>
          <div style={{background:'var(--bg-3)',borderRadius:10,padding:14}}>
            <div style={{fontSize:12,fontWeight:500,color:'var(--text-0)',marginBottom:8}}>🔌 Connessione diretta</div>
            <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.7,marginBottom:10}}>Sincronizzazione automatica senza export manuale. Configura nella tab 🔌 Sync qui sotto.</div>
            <button onClick={()=>setTab('sync')} style={{width:'100%',padding:'8px',background:'var(--blue-dim)',border:'1px solid rgba(77,166,255,0.3)',borderRadius:8,color:'#4da6ff',fontSize:13,fontWeight:600,cursor:'pointer'}}>⚡ Vai a Sync →</button>
            {tradesHook&&tradesHook.accounts.length>0&&<div style={{fontSize:11,color:'var(--green)',marginTop:8}}>✓ {tradesHook.accounts.length} conto/i con dati in cloud</div>}
          </div>
        </div>
        {importMsg&&<div style={{marginTop:10,padding:'8px 12px',background:importMsg.startsWith('✓')?'var(--green-dim)':'var(--amber-dim)',borderRadius:8,fontSize:12,color:importMsg.startsWith('✓')?'var(--green)':'var(--amber)'}}>{importMsg}</div>}
      </div>

      {/* Gestione conti esistenti */}
      {accounts.length > 0 && (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Conti registrati</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {accounts.map((a: string) => {
              const tc = (tradesHook ? tradesHook.trades : trades).filter((t: Trade) => t.account === a).length
              return (
                <AccountRow key={a} account={a} tradeCount={tc}
                  onRename={(oldName: string, newName: string) => {
                    const src = tradesHook ? tradesHook.trades : trades
                    const updated = src.map((t: Trade) => t.account === oldName ? {...t, account: newName} : t)
                    if (!tradesHook) {
                      setTrades(updated)
                      lsSave('trades', updated)
                    } else {
                      // Aggiorna stato locale del hook
                      tradesHook.renameTrades && tradesHook.renameTrades(oldName, newName)
                    }
                    if (selectedAccounts.includes(oldName)) setSelectedAccounts(prev => prev.map(x => x === oldName ? newName : x))
                  }}
                  onDelete={(accountName: string) => {
                    if (!tradesHook) {
                      const updated = trades.filter((t: Trade) => t.account !== accountName)
                      setTrades(updated)
                      lsSave('trades', updated)
                    } else {
                      tradesHook.deleteTrades && tradesHook.deleteTrades(accountName)
                    }
                    setSelectedAccounts(prev => prev.filter(x => x !== accountName))
                  }}
                />
              )
            })}
          </div>
          <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)',fontSize:11,color:'var(--text-2)'}}>
            💡 Puoi collegare un conto a Sync senza caricare storico — vai nella tab 🔌 Sync e inserisci il nome del conto.
          </div>
        </div>
      )}

      {accounts.length===0 && tab !== 'sync' ? (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:48,textAlign:'center'}}>
          <div style={{fontSize:40,opacity:0.15,marginBottom:14}}>◑</div>
          <div style={{fontSize:14,color:'var(--text-1)',marginBottom:6}}>Importa i tuoi dati NinjaTrader per iniziare</div>
          <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.7,marginBottom:14}}>Lista Trade singoli → equity curve, calendario, tag emotivi</div>
          <button onClick={()=>setTab('sync')} style={{padding:'8px 18px',background:'var(--accent)',border:'none',borderRadius:8,color:'#000',fontSize:13,fontWeight:600,cursor:'pointer'}}>⚡ Oppure configura il plugin AlphaDesk Bridge →</button>
        </div>
      ) : accounts.length===0 && tab === 'sync' ? (
        <div>
          {tab==='sync'&&(
            tradesHook
              ?<SyncPanel accounts={[]} syncs={tradesHook.syncs||[]} onSync={tradesHook.syncBroker} onReload={tradesHook.reload} userId={userId}/>
              :<div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:24,textAlign:'center',color:'var(--text-2)',fontSize:13}}>La sincronizzazione automatica richiede il login.</div>
          )}
        </div>
      ) : (
        <>
          {/* Selezione multi-conto + tab */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase'}}>Conto:</div>
              <button onClick={()=>setSelectedAccounts([])} style={{padding:'5px 10px',borderRadius:5,border:`1px solid ${selectedAccounts.length===0?'var(--accent)':'var(--border)'}`,background:selectedAccounts.length===0?'var(--accent-dim)':'transparent',color:selectedAccounts.length===0?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-mono)'}}>Tutti</button>
              {accounts.map((a:string)=>(
                <button key={a} onClick={()=>toggleAccount(a)}
                  style={{padding:'5px 14px',borderRadius:5,border:`1px solid ${selectedAccounts.includes(a)?'var(--accent)':'var(--border)'}`,background:selectedAccounts.includes(a)?'var(--accent-dim)':'transparent',color:selectedAccounts.includes(a)?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:12,fontFamily:'var(--font-mono)',fontWeight:selectedAccounts.includes(a)?600:400}}>{a}</button>
              ))}
            </div>
            <div style={{display:'flex',gap:4}}>
              {[['stats','📊 Stats'],['calendar','📅 Calendario'],['list','📋 Trade'],['emotion','🧠 Psicologia'],['sync','🔌 Sync']].map(([id,label])=>(
                <button key={id} onClick={()=>setTab(id as any)}
                  style={{padding:'6px 12px',borderRadius:7,border:'1px solid var(--border)',background:tab===id?'var(--bg-3)':'transparent',color:tab===id?'var(--text-0)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:tab===id?500:400}}>{label}</button>
              ))}
            </div>
          </div>

          {/* Filtri lista */}
          {tab==='list'&&(
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {(['all','Long','Short'] as const).map(d=>(
                <button key={d} onClick={()=>setFilterDir(d)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:filterDir===d?'var(--bg-3)':'transparent',color:filterDir===d?'var(--text-0)':'var(--text-2)',cursor:'pointer',fontSize:11}}>{d==='all'?'Tutti':d}</button>
              ))}
              {strategies.length>2&&<>
                <div style={{width:1,height:16,background:'var(--border)'}}></div>
                {(strategies as string[]).map(s=>(
                  <button key={String(s)} onClick={()=>setFilterStrategy(s)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:filterStrategy===s?'rgba(245,166,35,0.15)':'transparent',color:filterStrategy===s?'var(--amber)':'var(--text-2)',cursor:'pointer',fontSize:11}}>{s==='all'?'Tutte':s}</button>
                ))}
              </>}
              <div style={{marginLeft:'auto',fontSize:11,color:'var(--text-2)'}}>{filteredTrades.length} trade</div>
            </div>
          )}

          {/* Tab content */}
          {tab==='stats'&&<StatsView perfReport={currentPerfReport} trades={filteredTrades}/>}
          {tab==='calendar'&&<PnLCalendar trades={filteredTrades}/>}
          {tab==='list'&&(
            <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'22px 75px 95px 60px 105px 50px 50px 70px 70px 1fr',padding:'8px 14px',borderBottom:'1px solid var(--border)',fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                <div></div><div>Strum.</div><div>Strategia</div><div>Dir.</div><div>Data</div><div>Durata</div><div>Qty</div><div>P&L</div><div>Net P&L</div><div>Tag</div>
              </div>
              <div style={{maxHeight:520,overflowY:'auto'}}>
                {filteredTrades.length===0
                  ?<div style={{padding:24,textAlign:'center',color:'var(--text-2)',fontSize:12}}>Importa la lista trade singoli per il dettaglio</div>
                  :filteredTrades.map((t:Trade)=><TradeRow key={t.id} trade={t} onUpdate={updateTrade}/>)}
              </div>
            </div>
          )}
          {tab==='emotion'&&<EmotionAnalytics trades={filteredTrades}/>}
          {tab==='sync'&&(
            tradesHook
              ?<SyncPanel accounts={accounts} syncs={tradesHook.syncs||[]} onSync={tradesHook.syncBroker} onReload={tradesHook.reload} userId={userId}/>
              :<div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:24,textAlign:'center',color:'var(--text-2)',fontSize:13}}>La sincronizzazione automatica richiede il login — effettua l'accesso per abilitarla.</div>
          )}
        </>
      )}
    </div>
  )
}
