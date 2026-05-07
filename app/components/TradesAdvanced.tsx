'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from 'recharts'

interface Trade {
  id: string; ninja_id?: string; account: string; strategy: string
  instrument: string; direction: 'Long'|'Short'; entry_time: string
  exit_time: string; duration_min: number; entry_price: number
  exit_price: number; quantity: number; pnl: number; commission: number
  net_pnl: number; mae?: number; mfe?: number
  emotion_tags?: string[]; rule_followed?: boolean; notes?: string
  setup_quality?: number; source?: string
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

const EMOTION_TAGS = [
  { id: 'fomo', label: 'FOMO', color: '#f5a623' },
  { id: 'revenge', label: 'Revenge', color: '#ff4d6d' },
  { id: 'early_exit', label: 'Uscita anticipata', color: '#4da6ff' },
  { id: 'overtrading', label: 'Overtrading', color: '#ff6b35' },
  { id: 'hesitation', label: 'Esitazione', color: '#9b59b6' },
  { id: 'disciplined', label: 'Disciplinato', color: '#00d4aa' },
  { id: 'patient', label: 'Paziente', color: '#00d4aa' },
  { id: 'overconfident', label: 'Overconfidence', color: '#e67e22' },
  { id: 'fear', label: 'Paura', color: '#e74c3c' },
  { id: 'plan_trade', label: 'Trade pianificato', color: '#2ecc71' },
]

function parseNinjaPerfReport(text: string): PerfReport | null {
  const data: Record<string, string[]> = {}
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r/,'').split(';')
    if (cols[0]?.trim()) data[cols[0].trim()] = cols.slice(1).map(c => c.trim()).filter(Boolean)
  }
  const num = (k: string, col = 0) => parseFloat((data[k]?.[col]||'0').replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
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
  const trades: Trade[] = []
  const get = (cols: string[], keys: string[]) => { for (const k of keys) { const idx = header.findIndex(h => h.includes(k)); if (idx >= 0 && cols[idx]?.trim()) return cols[idx].trim().replace(/"/g,'') } return '' }
  const n = (s: string) => parseFloat(s.replace(/[^0-9,.-]/g,'').replace(',','.')) || 0
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r/,'').split(sep)
    if (cols.length < 4) continue
    const pnl = n(get(cols, ['profit','pnl','p&l','net profit','gain']))
    const comm = n(get(cols, ['commission','comm']))
    const entryStr = get(cols, ['entry time','entry_time','time of entry'])
    const exitStr = get(cols, ['exit time','exit_time','time of exit'])
    const e1 = new Date(entryStr), e2 = new Date(exitStr)
    const dur = !isNaN(e1.getTime()) && !isNaN(e2.getTime()) ? Math.round((e2.getTime()-e1.getTime())/60000) : 0
    const dirRaw = get(cols, ['direction','dir','side','market pos','market position']) || 'Long'
    trades.push({
      id: `${account}-${i}-${Date.now()}`, ninja_id: `${account}-${entryStr}-${i}`,
      account, strategy: get(cols, ['strategy','strategia']) || 'Manual',
      instrument: get(cols, ['instrument','strumento','market','ticker','symbol']) || 'N/A',
      direction: dirRaw.toLowerCase().includes('short') ? 'Short' : 'Long',
      entry_time: entryStr, exit_time: exitStr, duration_min: dur,
      entry_price: n(get(cols, ['entry price','avg entry'])), exit_price: n(get(cols, ['exit price','avg exit'])),
      quantity: parseInt(get(cols, ['quantity','qty','size'])) || 1,
      pnl, commission: comm, net_pnl: pnl - comm, emotion_tags: [], notes: '',
    })
  }
  return trades
}

const pc = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const fmtUSD = (v: number, sign = true) => `${sign && v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`

function generateInsight(s: PerfReport): string {
  const ins: string[] = []
  ins.push(s.winRate >= 50 ? `Win rate ${s.winRate.toFixed(1)}% — consistente.` : `Win rate ${s.winRate.toFixed(1)}% — sotto 50%, serve R:R > 1.`)
  if (s.rrRatio < 1) ins.push(`⚠ R:R ${s.rrRatio.toFixed(2)} — perdite medie maggiori dei guadagni medi.`)
  else ins.push(`R:R ${s.rrRatio.toFixed(2)}.`)
  if (s.longStats.netProfit > 0 && s.shortStats.netProfit < 0) ins.push(`Long profittevole, Short in perdita — valuta di ridurre i Short.`)
  if (s.maxConsecLoss >= 4) ins.push(`${s.maxConsecLoss} perdite consecutive — considera stop giornaliero dopo 2-3 loss.`)
  return ins.join(' ')
}

function PnLCalendar({ trades }: { trades: Trade[] }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [year, mon] = month.split('-').map(Number)
  const firstDay = new Date(year, mon-1, 1).getDay()
  const daysInMonth = new Date(year, mon, 0).getDate()
  const dayMap: Record<string, { pnl: number; trades: number }> = {}
  trades.forEach(t => {
    if (!t.entry_time) return
    const d = new Date(t.entry_time)
    if (isNaN(d.getTime())) return
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!dayMap[key]) dayMap[key] = { pnl: 0, trades: 0 }
    dayMap[key].pnl += t.net_pnl; dayMap[key].trades++
  })
  const maxAbs = Math.max(...Object.values(dayMap).map(d => Math.abs(d.pnl)), 1)
  const monthPnl = Object.entries(dayMap).filter(([k]) => k.startsWith(month)).reduce((s,[,v]) => s+v.pnl, 0)
  const monthTrades = Object.entries(dayMap).filter(([k]) => k.startsWith(month)).reduce((s,[,v]) => s+v.trades, 0)
  const adj = (dir: number) => { const d = new Date(year, mon-1+dir); setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Calendario P&L</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{monthTrades} trade · <span style={{ color: pc(monthPnl), fontFamily: 'var(--font-mono)' }}>{fmtUSD(monthPnl)}</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => adj(-1)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer' }}>‹</button>
          <div style={{ fontSize: 13, fontWeight: 500, minWidth: 120, textAlign: 'center' }}>{new Date(year, mon-1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</div>
          <button onClick={() => adj(1)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer' }}>›</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 4 }}>
        {['Dom','Lun','Mar','Mer','Gio','Ven','Sab'].map(d => <div key={d} style={{ fontSize: 10, textAlign: 'center', color: 'var(--text-2)', padding: '4px 0' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {Array.from({ length: firstDay }).map((_,i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_,i) => {
          const day = i+1
          const key = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const s = dayMap[key]
          const intensity = s ? Math.min(Math.abs(s.pnl)/maxAbs,1) : 0
          const isToday = key === new Date().toISOString().split('T')[0]
          return (
            <div key={day} title={s ? `${s.trades} trade · ${fmtUSD(s.pnl)}` : ''}
              style={{ aspectRatio:'1', borderRadius:5, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontSize:10, cursor: s?'pointer':'default', background: !s?'var(--bg-3)': s.pnl>0?`rgba(0,212,170,${0.15+intensity*0.7})`:`rgba(255,77,109,${0.15+intensity*0.7})`, border: isToday?'1px solid var(--accent)':'1px solid transparent', color: s?'white':'var(--text-2)', fontWeight: s?600:400 }}>
              <div>{day}</div>
              {s && <div style={{ fontSize:8 }}>{s.pnl>0?'+':''}{s.pnl.toFixed(0)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TradeRow({ trade, onUpdate }: { trade: Trade; onUpdate: (id: string, u: Partial<Trade>) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [tags, setTags] = useState<string[]>(trade.emotion_tags || [])
  const [rule, setRule] = useState<boolean|undefined>(trade.rule_followed)
  const [notes, setNotes] = useState(trade.notes || '')
  const [quality, setQuality] = useState(trade.setup_quality || 0)
  const toggleTag = (id: string) => { const n = tags.includes(id)?tags.filter(t=>t!==id):[...tags,id]; setTags(n); onUpdate(trade.id,{emotion_tags:n}) }
  const setR = (v: boolean) => { setRule(v); onUpdate(trade.id,{rule_followed:v}) }
  const setQ = (v: number) => { setQuality(v); onUpdate(trade.id,{setup_quality:v}) }
  return (
    <>
      <div onClick={() => setExpanded(!expanded)} style={{ display:'grid', gridTemplateColumns:'24px 80px 95px 60px 105px 50px 50px 72px 72px 1fr', padding:'8px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:12, alignItems:'center', cursor:'pointer' }}
        onMouseEnter={e=>(e.currentTarget.style.background='var(--bg-3)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
        <div style={{fontSize:10,color:'var(--text-2)'}}>{expanded?'▼':'▶'}</div>
        <div style={{fontWeight:500}}>{trade.instrument}</div>
        <div style={{fontSize:11,color:'var(--text-2)'}}>{trade.strategy}</div>
        <div><span style={{display:'inline-block',padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:trade.direction==='Long'?'var(--green-dim)':'var(--red-dim)',color:trade.direction==='Long'?'var(--green)':'var(--red)'}}>{trade.direction}</span></div>
        <div style={{fontSize:10,color:'var(--text-1)',fontFamily:'var(--font-mono)'}}>{trade.entry_time?.split(' ')?.[0]||'—'}</div>
        <div style={{fontSize:11,color:'var(--text-2)'}}>{trade.duration_min}m</div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:11}}>{trade.quantity}</div>
        <div style={{fontFamily:'var(--font-mono)',fontWeight:600,color:pc(trade.pnl)}}>${trade.pnl.toFixed(0)}</div>
        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:pc(trade.net_pnl)}}>${trade.net_pnl.toFixed(0)}</div>
        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
          {tags.map(t=>{const tag=EMOTION_TAGS.find(e=>e.id===t);return tag?<span key={t} style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:`${tag.color}22`,color:tag.color,fontWeight:600}}>{tag.label}</span>:null})}
          {rule===true&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'var(--green-dim)',color:'var(--green)',fontWeight:600}}>✓</span>}
          {rule===false&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'var(--red-dim)',color:'var(--red)',fontWeight:600}}>✗</span>}
        </div>
      </div>
      {expanded&&(
        <div style={{background:'var(--bg-3)',padding:'14px 20px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Tag emotivi</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {EMOTION_TAGS.map(tag=>(
                  <button key={tag.id} onClick={()=>toggleTag(tag.id)} style={{padding:'3px 8px',borderRadius:5,border:`1px solid ${tags.includes(tag.id)?tag.color:'var(--border)'}`,background:tags.includes(tag.id)?`${tag.color}22`:'transparent',color:tags.includes(tag.id)?tag.color:'var(--text-2)',cursor:'pointer',fontSize:11,fontWeight:tags.includes(tag.id)?600:400}}>{tag.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Regole rispettate?</div>
              <div style={{display:'flex',gap:6,marginBottom:12}}>
                <button onClick={()=>setR(true)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${rule===true?'var(--green)':'var(--border)'}`,background:rule===true?'var(--green-dim)':'transparent',color:rule===true?'var(--green)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:600}}>✓ Sì</button>
                <button onClick={()=>setR(false)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${rule===false?'var(--red)':'var(--border)'}`,background:rule===false?'var(--red-dim)':'transparent',color:rule===false?'var(--red)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:600}}>✗ No</button>
              </div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Qualità setup</div>
              <div style={{display:'flex',gap:4}}>{[1,2,3,4,5].map(n=><span key={n} onClick={()=>setQ(n)} style={{fontSize:18,cursor:'pointer',opacity:quality>=n?1:0.25,color:'var(--amber)'}}>★</span>)}</div>
            </div>
            <div>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Note</div>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} onBlur={()=>onUpdate(trade.id,{notes})} placeholder="Setup, motivazione, cosa migliorare..." style={{width:'100%',height:80,background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text-0)',fontSize:12,padding:'8px 10px',resize:'none',fontFamily:'var(--font-body)',outline:'none'}} />
            </div>
          </div>
          <div style={{display:'flex',gap:20,marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)',fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>
            <span>Entry: <span style={{color:'var(--text-0)'}}>{trade.entry_price||'—'}</span></span>
            <span>Exit: <span style={{color:'var(--text-0)'}}>{trade.exit_price||'—'}</span></span>
            <span>Durata: <span style={{color:'var(--text-0)'}}>{trade.duration_min}min</span></span>
            {trade.source&&<span style={{marginLeft:'auto',opacity:0.5}}>via {trade.source}</span>}
          </div>
        </div>
      )}
    </>
  )
}

function EmotionAnalytics({ trades }: { trades: Trade[] }) {
  const withTags = trades.filter(t=>t.emotion_tags?.length)
  const withRule = trades.filter(t=>t.rule_followed!==undefined)
  if (!withTags.length&&!withRule.length) return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:32,textAlign:'center'}}>
      <div style={{fontSize:32,opacity:0.2,marginBottom:10}}>🧠</div>
      <div style={{fontSize:13,color:'var(--text-1)'}}>Espandi i trade e aggiungi tag emotivi per vedere l'analisi psicologica</div>
    </div>
  )
  const rY=withRule.filter(t=>t.rule_followed), rN=withRule.filter(t=>!t.rule_followed)
  const rYPnl=rY.reduce((s,t)=>s+t.net_pnl,0), rNPnl=rN.reduce((s,t)=>s+t.net_pnl,0)
  const rYWR=rY.filter(t=>t.net_pnl>0).length/Math.max(rY.length,1)*100
  const rNWR=rN.filter(t=>t.net_pnl>0).length/Math.max(rN.length,1)*100
  const tagStats=EMOTION_TAGS.map(tag=>{const tt=trades.filter(t=>t.emotion_tags?.includes(tag.id));if(!tt.length)return null;const pnl=tt.reduce((s,t)=>s+t.net_pnl,0);return{...tag,count:tt.length,pnl,wr:tt.filter(t=>t.net_pnl>0).length/tt.length*100}}).filter(Boolean) as any[]
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {withRule.length>0&&(
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Disciplina — impatto sulle performance</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            {[{label:'✓ Regole rispettate',t:rY,pnl:rYPnl,wr:rYWR,c:'var(--green)'},{label:'✗ Regole NON rispettate',t:rN,pnl:rNPnl,wr:rNWR,c:'var(--red)'}].map(r=>(
              <div key={r.label} style={{background:'var(--bg-3)',borderRadius:10,padding:14}}>
                <div style={{fontSize:12,fontWeight:600,color:r.c,marginBottom:10}}>{r.label}</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[['Trade',r.t.length,'var(--text-0)'],['Win Rate',`${r.wr.toFixed(0)}%`,r.wr>=50?'var(--green)':'var(--red)'],['P&L',fmtUSD(r.pnl),pc(r.pnl)]].map(([l,v,c])=>(
                    <div key={l as string}><div style={{fontSize:10,color:'var(--text-2)'}}>{l}</div><div style={{fontSize:16,fontFamily:'var(--font-mono)',fontWeight:700,color:c as string}}>{v}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {rNPnl<0&&rYPnl>0&&<div style={{padding:'8px 12px',background:'var(--accent-dim)',borderRadius:8,fontSize:12,color:'var(--accent)'}}>◈ La disciplina vale <strong>{fmtUSD(rYPnl-rNPnl)}</strong> in più rispetto al trading non disciplinato.</div>}
        </div>
      )}
      {tagStats.length>0&&(
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Performance per stato emotivo</div>
          {tagStats.sort((a:any,b:any)=>b.count-a.count).map((tag:any)=>(
            <div key={tag.id} style={{display:'flex',alignItems:'center',gap:12,padding:'7px 10px',background:'var(--bg-3)',borderRadius:7,marginBottom:6}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:tag.color,flexShrink:0}}></div>
              <div style={{width:130,fontSize:12,fontWeight:500}}>{tag.label}</div>
              <div style={{fontSize:11,color:'var(--text-2)',width:55}}>{tag.count} trade</div>
              <div style={{flex:1,height:5,background:'var(--bg-2)',borderRadius:3,overflow:'hidden'}}><div style={{width:`${tag.wr}%`,height:'100%',background:tag.wr>=50?'var(--green)':'var(--red)',borderRadius:3}}></div></div>
              <div style={{width:48,fontSize:11,fontFamily:'var(--font-mono)',color:tag.wr>=50?'var(--green)':'var(--red)'}}>{tag.wr.toFixed(0)}%</div>
              <div style={{width:80,fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:pc(tag.pnl),textAlign:'right'}}>{fmtUSD(tag.pnl)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatsView({ stats, trades }: { stats: PerfReport; trades: Trade[] }) {
  const byHour: Record<number,{pnl:number;count:number}> = {}
  trades.forEach(t=>{if(!t.entry_time)return;const d=new Date(t.entry_time);if(isNaN(d.getTime()))return;const h=d.getHours();if(!byHour[h])byHour[h]={pnl:0,count:0};byHour[h].pnl+=t.net_pnl;byHour[h].count++})
  const hourData=Object.entries(byHour).map(([h,v])=>({hour:`${h}:00`,pnl:parseFloat(v.pnl.toFixed(2)),count:v.count})).sort((a,b)=>parseInt(a.hour)-parseInt(b.hour))
  const winLossData=[{name:'Win',value:stats.winTrades,fill:'#00d4aa'},{name:'Loss',value:stats.lossTrades,fill:'#ff4d6d'}]
  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{background:'var(--bg-3)',borderRadius:12,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div><div style={{fontSize:15,fontWeight:600}}>Riepilogo</div><div style={{fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)',marginTop:2}}>{stats.startDate} → {stats.endDate} · {stats.totalTrades} trade</div></div>
        <div style={{textAlign:'right'}}><div style={{fontSize:28,fontFamily:'var(--font-mono)',fontWeight:800,color:pc(stats.totalNetProfit)}}>{fmtUSD(stats.totalNetProfit)}</div><div style={{fontSize:11,color:'var(--text-2)'}}>Net P&L totale</div></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
        {[{l:'Win Rate',v:`${stats.winRate.toFixed(1)}%`,s:`${stats.winTrades}W/${stats.lossTrades}L`,c:stats.winRate>=50?'var(--green)':'var(--red)'},{l:'Profit Factor',v:stats.profitFactor.toFixed(2),s:stats.profitFactor>=1.5?'Ottimo':stats.profitFactor>=1?'OK':'Negativo',c:stats.profitFactor>=1.5?'var(--green)':stats.profitFactor>=1?'var(--amber)':'var(--red)'},{l:'R:R Ratio',v:stats.rrRatio.toFixed(2),s:'Avg Win/Loss',c:stats.rrRatio>=1?'var(--green)':'var(--amber)'},{l:'Max Drawdown',v:fmtUSD(stats.maxDrawdown,false),s:'Peak to valley',c:'var(--red)'},{l:'Sharpe Ratio',v:stats.sharpeRatio.toFixed(2),s:stats.sharpeRatio>=1?'Buono':'Da migliorare',c:stats.sharpeRatio>=1?'var(--green)':'var(--amber)'}].map(k=>(
          <div key={k.l} style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:5}}>{k.l}</div>
            <div style={{fontSize:20,fontFamily:'var(--font-mono)',fontWeight:700,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:'var(--text-2)',marginTop:3}}>{k.s}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 180px',gap:14}}>
        {hourData.length>0?(
          <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>P&L per ora del giorno</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={hourData}>
                <XAxis dataKey="hour" tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:'var(--text-2)'}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`} width={40}/>
                <Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}}/>
                <ReferenceLine y={0} stroke="var(--border-hover)"/>
                <Bar dataKey="pnl" radius={[3,3,0,0]}>{hourData.map((e,i)=><Cell key={i} fill={e.pnl>=0?'#00d4aa':'#ff4d6d'}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ):<div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:12,color:'var(--text-2)',textAlign:'center'}}>Importa lista trade singoli per P&L per ora</div></div>}
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:12}}>Metriche chiave</div>
          {[['Avg Win',fmtUSD(stats.avgWin),'var(--green)'],['Avg Loss',fmtUSD(stats.avgLoss),'var(--red)'],['Largest Win',fmtUSD(stats.largestWin),'var(--green)'],['Largest Loss',fmtUSD(stats.largestLoss),'var(--red)'],['Max Consec W',`${stats.maxConsecWin}`,'var(--green)'],['Max Consec L',`${stats.maxConsecLoss}`,'var(--red)'],['Avg MAE',fmtUSD(stats.avgMAE,false),'var(--amber)'],['Avg MFE',fmtUSD(stats.avgMFE,false),'var(--blue)'],['Commissioni',fmtUSD(stats.commission,false),'var(--amber)']].map(([l,v,c])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{fontSize:11,color:'var(--text-1)'}}>{l}</span>
              <span style={{fontSize:11,fontFamily:'var(--font-mono)',fontWeight:600,color:c as string}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Win / Loss</div>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart><Pie data={winLossData} cx="50%" cy="50%" innerRadius={30} outerRadius={52} paddingAngle={3} dataKey="value">{winLossData.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Pie><Tooltip contentStyle={{background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,fontSize:11}}/></PieChart>
          </ResponsiveContainer>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:6}}>
            <span style={{color:'var(--green)'}}>W {stats.winTrades}</span>
            <span style={{color:'var(--red)'}}>L {stats.lossTrades}</span>
          </div>
          <div style={{marginTop:10,fontSize:11}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'var(--text-2)'}}>Long</span><span style={{color:pc(stats.longStats.winRate-50),fontFamily:'var(--font-mono)'}}>{stats.longStats.winRate.toFixed(0)}% WR · {fmtUSD(stats.longStats.netProfit)}</span></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text-2)'}}>Short</span><span style={{color:pc(stats.shortStats.winRate-50),fontFamily:'var(--font-mono)'}}>{stats.shortStats.winRate.toFixed(0)}% WR · {fmtUSD(stats.shortStats.netProfit)}</span></div>
          </div>
        </div>
      </div>
      <div style={{background:'var(--bg-2)',border:'1px solid rgba(0,212,170,0.2)',borderRadius:12,padding:'14px 18px'}}>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--accent)',textTransform:'uppercase',marginBottom:6}}>◈ Analisi automatica</div>
        <div style={{fontSize:13,color:'var(--text-1)',lineHeight:1.8}}>{generateInsight(stats)}</div>
      </div>
    </div>
  )
}

export default function TradesAdvanced({ userId, tradesHook }: { userId: string; tradesHook?: any }) {
  const [perfStats, setPerfStats] = useState<Record<string, PerfReport>>({})
  const [trades, setTrades] = useState<Trade[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [tab, setTab] = useState<'stats'|'calendar'|'list'|'emotion'>('stats')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [accountName, setAccountName] = useState('')
  const [fileType, setFileType] = useState<'perf'|'trades'>('perf')
  const [filterDir, setFilterDir] = useState<'all'|'Long'|'Short'>('all')
  const [dbLoading, setDbLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!userId) return
    fetch(`/api/trades?userId=${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.trades?.length) {
          setTrades(data.trades)
          const accs = [...new Set(data.trades.map((t: Trade) => t.account))] as string[]
          setSelectedAccounts(accs)
        }
      }).catch(()=>{}).finally(()=>setDbLoading(false))
  }, [userId])

  const allAccounts = [...new Set([...Object.keys(perfStats), ...trades.map(t => t.account)])]
  const toggleAccount = (a: string) => setSelectedAccounts(prev => prev.includes(a) ? prev.filter(x=>x!==a) : [...prev,a])

  const filteredTrades = trades.filter(t =>
    (!selectedAccounts.length || selectedAccounts.includes(t.account)) &&
    (filterDir === 'all' || t.direction === filterDir)
  )

  const updateTrade = useCallback(async (id: string, updates: Partial<Trade>) => {
    setTrades(prev => prev.map(t => t.id === id ? {...t,...updates} : t))
    try {
      await fetch('/api/trades', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tradeId:id,userId,updates}) })
    } catch {}
  }, [userId])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file||!accountName.trim()){setImportMsg('⚠ Inserisci prima il nome del conto');return}
    setImporting(true);setImportMsg('')
    const text = await file.text()
    if (fileType==='perf') {
      const s = parseNinjaPerfReport(text)
      if (!s){setImportMsg('⚠ Formato non riconosciuto. Usa il Performance Report di NinjaTrader.');setImporting(false);return}
      setPerfStats(prev=>({...prev,[accountName.trim()]:s}))
      if (!selectedAccounts.includes(accountName.trim())) setSelectedAccounts(prev=>[...prev,accountName.trim()])
      setImportMsg(`✓ Performance Report importato — ${s.totalTrades} trade · Net P&L ${fmtUSD(s.totalNetProfit)}`)
    } else {
      const parsed = parseNinjaTradeList(text, accountName.trim())
      if (!parsed.length){setImportMsg('⚠ Nessun trade trovato.');setImporting(false);return}
      let saved = 0
      try {
        const res = await fetch('/api/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trades:parsed,userId,source:'csv'})})
        const r = await res.json(); saved = r.upserted||parsed.length
      } catch {}
      setTrades(prev=>{
        const existing = new Map(prev.map(t=>[t.ninja_id,t]))
        const merged = parsed.map(t=>{const old=existing.get(t.ninja_id||'');return old?{...t,emotion_tags:old.emotion_tags,rule_followed:old.rule_followed,notes:old.notes,setup_quality:old.setup_quality}:t})
        return [...prev.filter(t=>t.account!==accountName.trim()),...merged]
      })
      if (!selectedAccounts.includes(accountName.trim())) setSelectedAccounts(prev=>[...prev,accountName.trim()])
      setImportMsg(`✓ ${parsed.length} trade importati (${saved} salvati in DB) — tag emotivi esistenti mantenuti`)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value=''
  }, [accountName,fileType,selectedAccounts,userId])

  const aggStats = (): PerfReport|null => {
    const active = Object.entries(perfStats).filter(([a])=>selectedAccounts.includes(a))
    if (!active.length) return null
    if (active.length===1) return active[0][1]
    const all = active.map(([,s])=>s)
    const sum = (fn: (s:PerfReport)=>number) => all.reduce((t,s)=>t+fn(s),0)
    const totalT = sum(s=>s.totalTrades), totalW = sum(s=>s.winTrades)
    return {...all[0], totalNetProfit:sum(s=>s.totalNetProfit), grossProfit:sum(s=>s.grossProfit), grossLoss:sum(s=>s.grossLoss), commission:sum(s=>s.commission), totalTrades:totalT, winTrades:totalW, lossTrades:sum(s=>s.lossTrades), winRate:totalT>0?totalW/totalT*100:0, maxDrawdown:Math.max(...all.map(s=>s.maxDrawdown)), profitFactor:Math.abs(sum(s=>s.grossLoss))>0?sum(s=>s.grossProfit)/Math.abs(sum(s=>s.grossLoss)):0, longStats:{netProfit:sum(s=>s.longStats.netProfit),winRate:all.reduce((t,s)=>t+s.longStats.winRate,0)/all.length,trades:sum(s=>s.longStats.trades)}, shortStats:{netProfit:sum(s=>s.shortStats.netProfit),winRate:all.reduce((t,s)=>t+s.shortStats.winRate,0)/all.length,trades:sum(s=>s.shortStats.trades)}}
  }
  const currentStats = aggStats()
  const inp = {padding:'8px 12px',background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-0)',fontSize:13,outline:'none',fontFamily:'var(--font-body)'} as React.CSSProperties

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:26,letterSpacing:'-0.02em'}}>Eseguiti & Performance</div>
        {dbLoading?<div style={{fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>Caricamento storico...</div>:trades.length>0&&<div style={{fontSize:11,color:'var(--accent)',fontFamily:'var(--font-mono)'}}>● {trades.length} trade in memoria</div>}
      </div>
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:18}}>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:14}}>Importa / Sincronizza</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
          <div style={{background:'var(--bg-3)',borderRadius:10,padding:14}}>
            <div style={{fontSize:12,fontWeight:500,marginBottom:10}}>📂 Import CSV</div>
            <div style={{display:'flex',gap:6,marginBottom:10}}>
              <button onClick={()=>setFileType('perf')} style={{flex:1,padding:'6px',borderRadius:6,border:`1px solid ${fileType==='perf'?'var(--accent)':'var(--border)'}`,background:fileType==='perf'?'var(--accent-dim)':'transparent',color:fileType==='perf'?'var(--accent)':'var(--text-2)',cursor:'pointer',fontSize:11}}>Performance Report</button>
              <button onClick={()=>setFileType('trades')} style={{flex:1,padding:'6px',borderRadius:6,border:`1px solid ${fileType==='trades'?'var(--accent)':'var(--border)'}`,background:fileType==='trades'?'var(--accent-dim)':'transparent',color:fileType==='trades'?'var(--accent)':'var(--text-2)',cursor:'pointer',fontSize:11}}>Lista Trade singoli</button>
            </div>
            <input style={{...inp,width:'100%',marginBottom:10}} placeholder="Nome conto (es. Sim101, Live, IBKR)" value={accountName} onChange={e=>setAccountName(e.target.value)}/>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:'none'}} onChange={handleFile}/>
            <button onClick={()=>fileRef.current?.click()} disabled={importing||!accountName.trim()} style={{width:'100%',padding:'8px',background:accountName.trim()?'var(--accent)':'var(--bg-4)',border:'none',borderRadius:8,color:accountName.trim()?'#000':'var(--text-2)',fontSize:13,fontWeight:600,cursor:accountName.trim()?'pointer':'not-allowed'}}>
              {importing?'Importando...':'Seleziona file CSV'}
            </button>
            <div style={{fontSize:11,color:'var(--text-2)',marginTop:8,lineHeight:1.6}}>
              I trade vengono salvati automaticamente — non dovrai ricaricarli.<br/>
              {fileType==='perf'?'NT8: New → Performance → Export CSV':'NT8: griglia operazioni → tasto destro → Export → CSV'}
            </div>
          </div>
          <div style={{background:'var(--bg-3)',borderRadius:10,padding:14,display:'flex',flexDirection:'column'}}>
            <div style={{fontSize:12,fontWeight:500,marginBottom:8}}>🔌 Auto-sync serale</div>
            <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.7,flex:1}}>Script sul tuo PC — esporta automaticamente i nuovi trade ogni sera alle 18:00 da NinjaTrader, ATAS o Interactive Brokers verso AlphaDesk.<br/><br/><span style={{color:'var(--amber)'}}>Richiede configurazione iniziale del bridge (15 min una volta sola).</span></div>
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button style={{flex:1,padding:'7px',background:'var(--blue-dim)',border:'1px solid rgba(77,166,255,0.3)',borderRadius:8,color:'var(--blue)',fontSize:12,fontWeight:600,cursor:'pointer'}}>⚡ NinjaTrader</button>
              <button style={{flex:1,padding:'7px',background:'var(--amber-dim)',border:'1px solid rgba(245,166,35,0.3)',borderRadius:8,color:'var(--amber)',fontSize:12,fontWeight:600,cursor:'pointer'}}>📊 IBKR</button>
            </div>
          </div>
        </div>
        {importMsg&&<div style={{marginTop:10,padding:'8px 12px',background:importMsg.startsWith('✓')?'var(--green-dim)':'var(--amber-dim)',borderRadius:8,fontSize:12,color:importMsg.startsWith('✓')?'var(--green)':'var(--amber)'}}>{importMsg}</div>}
      </div>

      {allAccounts.length===0&&!dbLoading?(
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:48,textAlign:'center'}}>
          <div style={{fontSize:40,opacity:0.15,marginBottom:14}}>◑</div>
          <div style={{fontSize:14,color:'var(--text-1)',marginBottom:6}}>Importa i tuoi dati NinjaTrader per iniziare</div>
          <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.7}}>I trade vengono salvati in modo permanente — importi una volta, li trovi sempre.</div>
        </div>
      ):allAccounts.length>0&&(
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase'}}>Conti:</div>
              {allAccounts.map(a=>(
                <button key={a} onClick={()=>toggleAccount(a)} style={{padding:'5px 14px',borderRadius:6,border:`1px solid ${selectedAccounts.includes(a)?'var(--accent)':'var(--border)'}`,background:selectedAccounts.includes(a)?'var(--accent-dim)':'transparent',color:selectedAccounts.includes(a)?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:12,fontFamily:'var(--font-mono)',fontWeight:selectedAccounts.includes(a)?600:400}}>
                  {selectedAccounts.includes(a)?'● ':'○ '}{a}
                </button>
              ))}
              {selectedAccounts.length>1&&<span style={{fontSize:11,color:'var(--accent)',fontFamily:'var(--font-mono)'}}>({selectedAccounts.length} conti aggregati)</span>}
            </div>
            <div style={{display:'flex',gap:4}}>
              {[['stats','📊 Stats'],['calendar','📅 Calendario'],['list','📋 Trade'],['emotion','🧠 Psicologia'],['sync','🔌 Sync']].map(([id,label])=>(
                <button key={id} onClick={()=>setTab(id as any)} style={{padding:'6px 14px',borderRadius:7,border:'1px solid var(--border)',background:tab===id?'var(--bg-3)':'transparent',color:tab===id?'var(--text-0)':'var(--text-2)',cursor:'pointer',fontSize:12,fontWeight:tab===id?500:400}}>{label}</button>
              ))}
            </div>
          </div>
          {tab==='stats'&&currentStats&&<StatsView stats={currentStats} trades={filteredTrades}/>}
          {tab==='stats'&&!currentStats&&<div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:24,textAlign:'center',color:'var(--text-2)',fontSize:13}}>Importa il Performance Report per vedere le statistiche</div>}
          {tab==='calendar'&&<PnLCalendar trades={filteredTrades}/>}
          {tab==='list'&&(
            <>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase'}}>Direzione:</div>
                {(['all','Long','Short'] as const).map(d=>(
                  <button key={d} onClick={()=>setFilterDir(d)} style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--border)',background:filterDir===d?'var(--bg-3)':'transparent',color:filterDir===d?'var(--text-0)':'var(--text-2)',cursor:'pointer',fontSize:11}}>{d==='all'?'Tutti':d}</button>
                ))}
                <div style={{marginLeft:'auto',fontSize:11,color:'var(--text-2)'}}>{filteredTrades.length} trade</div>
              </div>
              <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'24px 80px 95px 60px 105px 50px 50px 72px 72px 1fr',padding:'8px 14px',borderBottom:'1px solid var(--border)',fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                  <div/><div>Strum.</div><div>Strat.</div><div>Dir.</div><div>Data</div><div>Dur.</div><div>Qty</div><div>P&L</div><div>Net</div><div>Tag</div>
                </div>
                <div style={{maxHeight:520,overflowY:'auto'}}>
                  {filteredTrades.length===0?<div style={{padding:24,textAlign:'center',color:'var(--text-2)',fontSize:12}}>Importa la lista trade singoli per vedere il dettaglio</div>:filteredTrades.map(t=><TradeRow key={t.id} trade={t} onUpdate={updateTrade}/>)}
                </div>
              </div>
            </>
          )}
          {tab==='emotion'&&<EmotionAnalytics trades={filteredTrades}/>}
        </>
      )}
    </div>
  )
}
