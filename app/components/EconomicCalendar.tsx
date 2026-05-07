'use client'
import { useState, useEffect } from 'react'
interface CalEvent { date: string; time: string; currency: string; impact: 'high'|'medium'|'low'; event: string; actual?: string; forecast?: string; previous?: string }
const CURRENCIES = ['USD','EUR','GBP','JPY','CAD','AUD','CHF','CNY','NZD']
const IMPACT_COLORS = { high:'#ff4d6d', medium:'#f5a623', low:'#4a6278' }
const DEMO: CalEvent[] = [
  {date:'Oggi',time:'14:30',currency:'USD',impact:'high',event:'Initial Jobless Claims',forecast:'220K',previous:'219K'},
  {date:'Oggi',time:'14:30',currency:'USD',impact:'high',event:'Core CPI m/m',forecast:'0.3%',previous:'0.2%'},
  {date:'Oggi',time:'16:00',currency:'USD',impact:'medium',event:'ISM Services PMI',forecast:'52.8',previous:'53.5'},
  {date:'Domani',time:'10:00',currency:'EUR',impact:'high',event:'ECB Interest Rate Decision',forecast:'2.40%',previous:'2.65%'},
  {date:'Domani',time:'14:30',currency:'USD',impact:'high',event:'Non-Farm Payrolls',forecast:'185K',previous:'228K'},
]
export default function EconomicCalendar() {
  const [events, setEvents] = useState<CalEvent[]>(DEMO)
  const [loading, setLoading] = useState(true)
  const [filterImpact, setFilterImpact] = useState<Set<string>>(new Set(['high','medium']))
  const [filterCurrency, setFilterCurrency] = useState<Set<string>>(new Set(['USD','EUR','GBP']))
  const [showFilters, setShowFilters] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')
  useEffect(()=>{ fetch('/api/calendar').then(r=>r.json()).then(d=>{ if(d.events?.length){ setEvents(d.events); setLastUpdate(new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})) }}).catch(()=>{}).finally(()=>setLoading(false)) },[])
  const toggleImpact = (i:string) => { const s=new Set(filterImpact); s.has(i)?s.delete(i):s.add(i); setFilterImpact(s) }
  const toggleCurrency = (c:string) => { const s=new Set(filterCurrency); s.has(c)?s.delete(c):s.add(c); setFilterCurrency(s) }
  const filtered = events.filter(e=>filterImpact.has(e.impact)&&filterCurrency.has(e.currency))
  const grouped = filtered.reduce((acc,e)=>{ const d=e.date||'Oggi'; if(!acc[d]) acc[d]=[]; acc[d].push(e); return acc },{} as Record<string,CalEvent[]>)
  const bullet = (i:'high'|'medium'|'low') => <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:IMPACT_COLORS[i],flexShrink:0,boxShadow:`0 0 4px ${IMPACT_COLORS[i]}`}}></span>
  return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:14,padding:'18px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div><div style={{fontSize:13,fontWeight:600}}>Calendario Economico</div>{lastUpdate&&<div style={{fontSize:10,color:'var(--text-2)',fontFamily:'var(--font-mono)',marginTop:2}}>Aggiornato: {lastUpdate}</div>}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>fetch('/api/calendar').then(r=>r.json()).then(d=>{if(d.events?.length)setEvents(d.events)})} style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'transparent',color:'var(--accent)',cursor:'pointer',fontSize:11}}>↻</button>
          <button onClick={()=>setShowFilters(!showFilters)} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${showFilters?'var(--accent)':'var(--border)'}`,background:showFilters?'var(--accent-dim)':'transparent',color:showFilters?'var(--accent)':'var(--text-1)',cursor:'pointer',fontSize:11}}>⚙ Filtri</button>
        </div>
      </div>
      {showFilters&&(
        <div style={{background:'var(--bg-3)',borderRadius:10,padding:'14px 16px',marginBottom:14,display:'flex',flexDirection:'column',gap:10}}>
          <div><div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Impatto</div>
            <div style={{display:'flex',gap:6}}>
              {(['high','medium','low'] as const).map(i=><button key={i} onClick={()=>toggleImpact(i)} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',borderRadius:6,border:`1px solid ${filterImpact.has(i)?IMPACT_COLORS[i]:'var(--border)'}`,background:filterImpact.has(i)?`${IMPACT_COLORS[i]}18`:'transparent',color:filterImpact.has(i)?IMPACT_COLORS[i]:'var(--text-2)',cursor:'pointer',fontSize:12}}>{bullet(i)} {i==='high'?'Alta':i==='medium'?'Media':'Bassa'}</button>)}
            </div>
          </div>
          <div><div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Valute</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {CURRENCIES.map(c=><button key={c} onClick={()=>toggleCurrency(c)} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${filterCurrency.has(c)?'var(--accent)':'var(--border)'}`,background:filterCurrency.has(c)?'var(--accent-dim)':'transparent',color:filterCurrency.has(c)?'var(--accent)':'var(--text-2)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-mono)',fontWeight:500}}>{c}</button>)}
              <button onClick={()=>setFilterCurrency(new Set(['USD']))} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'transparent',color:'var(--text-2)',cursor:'pointer',fontSize:11}}>Solo USD</button>
            </div>
          </div>
        </div>
      )}
      <div style={{maxHeight:360,overflowY:'auto',display:'flex',flexDirection:'column',gap:14}}>
        {Object.keys(grouped).length===0?<div style={{textAlign:'center',padding:16,color:'var(--text-2)',fontSize:12}}>Nessun evento con i filtri selezionati</div>:
          Object.entries(grouped).map(([date,evs])=>(
            <div key={date}>
              <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8,paddingBottom:4,borderBottom:'1px solid var(--border)'}}>{date}</div>
              {evs.map((e,i)=>{
                const beat=e.actual&&e.forecast&&parseFloat(e.actual)>parseFloat(e.forecast)
                const miss=e.actual&&e.forecast&&parseFloat(e.actual)<parseFloat(e.forecast)
                return(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                    <div style={{width:40,fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',flexShrink:0}}>{e.time}</div>
                    {bullet(e.impact)}
                    <div style={{width:34,fontSize:10,fontFamily:'var(--font-mono)',color:'var(--blue)',fontWeight:600,flexShrink:0}}>{e.currency}</div>
                    <div style={{flex:1,fontSize:12,color:'var(--text-0)'}}>{e.event}</div>
                    {e.previous&&<div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-2)',flexShrink:0}}>prev {e.previous}</div>}
                    {e.forecast&&<div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-1)',flexShrink:0}}>est {e.forecast}</div>}
                    {e.actual&&<div style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color:beat?'var(--green)':miss?'var(--red)':'var(--text-1)',flexShrink:0,minWidth:44,textAlign:'right'}}>{beat?'▲':miss?'▼':''} {e.actual}</div>}
                    {!e.actual&&<div style={{width:44}}></div>}
                  </div>
                )
              })}
            </div>
          ))}
      </div>
      <div style={{marginTop:10,paddingTop:8,borderTop:'1px solid var(--border)'}}>
        <a href="https://www.investing.com/economic-calendar/" target="_blank" rel="noopener" style={{fontSize:11,color:'var(--accent)',fontFamily:'var(--font-mono)'}}>→ Calendario completo su Investing.com ↗</a>
      </div>
    </div>
  )
}
