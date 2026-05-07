'use client'
import { useEffect, useRef, useState } from 'react'
const INTERVALS = [{label:'5m',val:'5'},{label:'15m',val:'15'},{label:'1h',val:'60'},{label:'4h',val:'240'},{label:'D',val:'D'},{label:'W',val:'W'}]
function getHint(symbol: string) {
  if(symbol.includes('VIX9')) return 'VIX9D: volatilità attesa 9 giorni. VIX9D > VIX = spike di volatilità imminente. Livelli: 15 calmo, 20 normale, 25+ attenzione.'
  if(symbol.includes('VIX')) return 'VIX: monitora trend e S/R. Sotto 15 = compiacenza. Spike su divergenza prezzo = inversione. Mean reversion è il comportamento tipico.'
  if(symbol.includes('SPY')) return 'SPY: SMA50/200 come supporti dinamici. Gap apertura indica sentiment. Volume > media conferma i movimenti.'
  if(symbol.includes('QQQ')) return 'QQQ: più volatile di SPY. Se sottoperforma SPY → risk-off. Usa beta relativa per calibrare NQ.'
  if(symbol.includes('VVIX')) return 'VVIX > 100: attenzione a spike VIX. VVIX > 120: regime ad alta volatilità, ridurre size.'
  return 'Identifica: 1) Trend principale 2) Livelli S/R 3) Gap apertura 4) Volume anomalo 5) Divergenze.'
}
export default function TradingViewChart({ symbol, label, interval='D', height=380 }: { symbol:string; label:string; interval?:string; height?:number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentInterval, setCurrentInterval] = useState(interval)
  const [loaded, setLoaded] = useState(false)
  useEffect(()=>{
    if(!containerRef.current) return
    containerRef.current.innerHTML=''; setLoaded(false)
    const wrapper = document.createElement('div')
    wrapper.style.cssText=`height:${height}px;width:100%`
    wrapper.className='tradingview-widget-container__widget'
    const script = document.createElement('script')
    script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async=true; script.onload=()=>setLoaded(true)
    script.innerHTML=JSON.stringify({autosize:true,symbol,interval:currentInterval,timezone:'Europe/Rome',theme:'dark',style:'1',locale:'it',backgroundColor:'rgba(13,17,23,0)',gridColor:'rgba(255,255,255,0.04)',hide_top_toolbar:false,save_image:true,studies:['RSI@tv-basicstudies','MACD@tv-basicstudies'],show_popup_button:true,popup_width:'1200',popup_height:'800',withdateranges:true,allow_symbol_change:true})
    containerRef.current.appendChild(wrapper); containerRef.current.appendChild(script)
  },[symbol,currentInterval,height])
  return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:14,padding:'16px 18px',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{fontSize:14,fontWeight:600}}>{label}</div>
          <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)',background:'var(--bg-3)',padding:'2px 6px',borderRadius:4}}>{symbol}</span>
          <span style={{fontSize:10,color:'var(--accent)',background:'var(--accent-dim)',padding:'2px 8px',borderRadius:4}}>TradingView Live</span>
        </div>
        <div style={{display:'flex',gap:3}}>
          {INTERVALS.map(i=><button key={i.val} onClick={()=>setCurrentInterval(i.val)} style={{padding:'3px 8px',borderRadius:5,border:'1px solid var(--border)',background:currentInterval===i.val?'var(--accent-dim)':'transparent',color:currentInterval===i.val?'var(--accent)':'var(--text-2)',cursor:'pointer',fontSize:11,fontFamily:'var(--font-mono)'}}>{i.label}</button>)}
        </div>
      </div>
      <div style={{position:'relative',borderRadius:10,overflow:'hidden',background:'var(--bg-1)'}}>
        {!loaded&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-1)',zIndex:1,fontSize:12,color:'var(--text-2)',fontFamily:'var(--font-mono)'}}>Caricamento TradingView...</div>}
        <div className="tradingview-widget-container" ref={containerRef} style={{height:`${height}px`,width:'100%'}}></div>
      </div>
      <div style={{padding:'8px 12px',background:'var(--bg-3)',borderRadius:8}}>
        <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>Guida analisi</div>
        <div style={{fontSize:12,color:'var(--text-1)',lineHeight:1.6}}>{getHint(symbol)}</div>
      </div>
    </div>
  )
}
