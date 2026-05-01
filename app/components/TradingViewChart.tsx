'use client'
import { useEffect, useRef, useState } from 'react'

interface TVChartProps {
  symbol: string
  label: string
  interval?: string
  height?: number
  studies?: string[]
  showAnalysisBar?: boolean
}

const INTERVALS = [
  { label: '5m', val: '5' },
  { label: '15m', val: '15' },
  { label: '1h', val: '60' },
  { label: '4h', val: '240' },
  { label: 'D', val: 'D' },
  { label: 'W', val: 'W' },
]

export default function TradingViewChart({ symbol, label, interval = 'D', height = 420, studies = [], showAnalysisBar = true }: TVChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<any>(null)
  const [currentInterval, setCurrentInterval] = useState(interval)
  const [loaded, setLoaded] = useState(false)

  const loadWidget = (ivl: string) => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''
    setLoaded(false)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.onload = () => setLoaded(true)

    const defaultStudies = ['RSI@tv-basicstudies', 'MACD@tv-basicstudies', ...studies]

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: ivl,
      timezone: 'Europe/Rome',
      theme: 'dark',
      style: '1',
      locale: 'it',
      backgroundColor: 'rgba(13, 17, 23, 0)',
      gridColor: 'rgba(255, 255, 255, 0.04)',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
      studies: defaultStudies,
      show_popup_button: true,
      popup_width: '1200',
      popup_height: '800',
      withdateranges: true,
      allow_symbol_change: true,
      watchlist: ['CBOE:VIX', 'CBOE:VIX9D', 'AMEX:SPY', 'NASDAQ:QQQ', 'CME_MINI:ES1!', 'CME_MINI:NQ1!'],
    })

    const wrapper = document.createElement('div')
    wrapper.className = 'tradingview-widget-container__widget'
    wrapper.style.height = `${height}px`
    wrapper.style.width = '100%'
    containerRef.current.appendChild(wrapper)
    containerRef.current.appendChild(script)
  }

  useEffect(() => { loadWidget(currentInterval) }, [symbol, currentInterval])

  const changeInterval = (ivl: string) => {
    setCurrentInterval(ivl)
  }

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>{label}</div>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 4 }}>{symbol}</span>
          <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: 4 }}>TradingView Live</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {INTERVALS.map(i => (
            <button key={i.val} onClick={() => changeInterval(i.val)}
              style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: currentInterval === i.val ? 'var(--accent-dim)' : 'transparent', color: currentInterval === i.val ? 'var(--accent)' : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{i.label}</button>
          ))}
        </div>
      </div>

      {/* TradingView Widget */}
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-1)' }}>
        {!loaded && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-1)', zIndex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>Caricamento grafico TradingView...</div>
          </div>
        )}
        <div className="tradingview-widget-container" ref={containerRef} style={{ height: `${height}px`, width: '100%' }}></div>
      </div>

      {/* Barra analisi automatica */}
      {showAnalysisBar && (
        <div style={{ padding: '10px 14px', background: 'var(--bg-3)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guida analisi — {label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7 }}>
            {getAnalysisHint(symbol)}
          </div>
        </div>
      )}
    </div>
  )
}

function getAnalysisHint(symbol: string): string {
  if (symbol.includes('VIX9D') || symbol.includes('VIX9')) return 'VIX9D misura la volatilità attesa nei prossimi 9 giorni. Quando VIX9D > VIX si anticipa un aumento di volatilità a breve. Traccia trendline su massimi/minimi recenti per identificare breakout di volatilità. Livelli chiave: 15 (calmo), 20 (normale), 25 (attenzione), 35+ (panico).'
  if (symbol.includes('VIX')) return 'Analizza struttura: trend, supporti e resistenze chiave. Gap di apertura rispetto alla chiusura precedente segnala cambi di regime. Mean reversion sotto 15 indica compiacenza — attenzione a spike improvvisi. Monitora la divergenza VIX/prezzo per anticipare inversioni di mercato.'
  if (symbol.includes('SPY')) return 'ETF S&P500 — identifica livelli chiave (massimi/minimi annuali, livelli psicologici). Gap di apertura rispetto chiusura precedente indica sentiment pre-market. Volume sopra media conferma i movimenti. SMA50 e SMA200 come supporti/resistenze dinamici principali.'
  if (symbol.includes('QQQ')) return 'ETF Nasdaq100 — più volatile di SPY, utile per leggere il sentiment tech. Confronta sempre con SPY: se QQQ sottoperforma, il mercato è in risk-off. Identifica la beta relativa per calibrare il rischio sui futures NQ.'
  return 'Identifica: 1) Trend principale (HH/HL o LH/LL) 2) Livelli S/R chiave 3) Gap apertura 4) Volume anomalo 5) Divergenze con indicatori.'
}
