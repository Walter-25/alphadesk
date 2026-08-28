'use client'
import AlphaDeskBridgeSetup from './AlphaDeskBridgeSetup'
import { useState } from 'react'
import { AccountSync } from '../lib/useTrades'

interface SyncPanelProps {
  accounts: string[]
  syncs: AccountSync[]
  onSync: (account: string, broker: string, config?: any) => Promise<any>
  onReload: () => void
  userId?: string
  displayAccount?: (account: string) => string
}

export default function SyncPanel({ accounts, syncs, onSync, onReload, userId, displayAccount = (a) => a }: SyncPanelProps) {
  const [selectedBroker, setSelectedBroker] = useState('ninjatrader')
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] || '')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({
    url: 'http://localhost:36973', flexToken: '', queryId: '',
    accessToken: ''
  })

  const inp = {
    padding: '7px 10px', background: 'var(--bg-0)',
    border: '1px solid var(--border)', borderRadius: 7,
    color: 'var(--text-0)', fontSize: 12, outline: 'none',
    fontFamily: 'var(--font-mono)', width: '100%'
  } as React.CSSProperties

  const handleSync = async () => {
    if (!selectedAccount.trim()) return
    setSyncing(true); setResult(null)
    try {
      const res = await onSync(selectedAccount, selectedBroker, config)
      setResult(res)
      if (res.newTrades > 0) onReload()
    } catch(e: any) {
      setResult({ error: e.message || 'Errore di connessione', newTrades: 0 })
    }
    setSyncing(false)
  }

  const BROKERS = [
    { id: 'ninjatrader', label: 'NinjaTrader 8', icon: '⚡', color: '#f5a623', desc: 'Bridge — tempo reale' },
    { id: 'atas', label: 'ATAS', icon: '📈', color: '#4a6278', desc: 'Bridge — tempo reale' },
    { id: 'interactive_brokers', label: 'Interactive Brokers', icon: '🏦', color: '#9b59b6', desc: 'FlexQuery — non ancora collaudato' },
    { id: 'watcher', label: 'Watcher CSV', icon: '📄', color: '#00d4aa', desc: 'DeepCharts — semi-automatico' },
  ]

  const lastSync = (acc: string) => syncs.find(s => s.account === acc)
  const showBridgeSetup = selectedBroker === 'ninjatrader' || selectedBroker === 'watcher' || selectedBroker === 'atas'
  const bridgeMode = selectedBroker === 'ninjatrader' ? 'nt8' : selectedBroker === 'atas' ? 'atas' : 'watcher'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* A cosa serve questa tab — breve, poi si seleziona un broker per i dettagli */}
      <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, padding: '12px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10 }}>
        Collega la tua piattaforma di trading ad AlphaDesk: ogni trade chiuso arriva qui automaticamente, senza reimportare nulla a mano. Seleziona un broker qui sotto per le istruzioni passo-passo.
      </div>

      {/* Screenshot dei trade — guida statica, sempre visibile */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          📸 Screenshot dei trade — due modi
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
          Puoi allegare fino a 2 immagini per ogni trade (grafici, setup, note visive).
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
          ⚡ <strong style={{ color: 'var(--text-0)' }}>Con NinjaTrader 8 o ATAS (in tempo reale)</strong>: usa l'utility AlphaDesk Screenshot. Scarica i file qui sotto, configurala con la tua API key, avviala e premi Ctrl+Shift+1 o Ctrl+Shift+2 mentre operi — cattura il monitor dove si trova il mouse e lo aggancia all'ultimo trade. Funziona con qualsiasi Bridge in tempo reale: la scelta del trade non dipende dalla piattaforma, prende sempre il più recente arrivato.
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
          📥 <strong style={{ color: 'var(--text-0)' }}>Con DeepCharts, ATAS o qualsiasi import CSV (a posteriori)</strong>: apri la sezione Eseguiti → Lista Trade, espandi il trade che ti interessa e nella sezione Screenshot in fondo trascina un'immagine (o clicca per selezionarla) direttamente sullo slot. È il modo giusto quando importi i trade la sera: salvi gli screenshot durante l'operatività (es. Win+Shift+S di Windows) in una cartella, e poi li associ ai trade dopo l'import.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
          <a href="/AlphaDeskScreenshot.bat" download="AlphaDeskScreenshot.bat" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: 'var(--accent)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', width: 'fit-content' }}>⬇ AlphaDeskScreenshot.bat</a>
          <a href="/AlphaDeskScreenshot.ps1" download="AlphaDeskScreenshot.ps1" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: 'var(--accent)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', width: 'fit-content' }}>⬇ AlphaDeskScreenshot.ps1</a>
          <a href="/AlphaDeskScreenshot.config.example.json" download="AlphaDeskScreenshot.config.example.json" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: 'var(--accent)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', width: 'fit-content' }}>⬇ AlphaDeskScreenshot.config.example.json</a>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-1)' }}>
          L'utility hotkey vale per NinjaTrader 8 e ATAS (qualsiasi Bridge in tempo reale) — per gli import CSV/xlsx a posteriori usa invece il drag&amp;drop sul trade.
        </div>
      </div>

      {/* ── NinjaTrader / Watcher: mostra setup senza chiedere il conto ── */}
      {showBridgeSetup && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
          {/* Lista broker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Broker</div>
            {BROKERS.map(b => (
              <button key={b.id} onClick={() => setSelectedBroker(b.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${selectedBroker === b.id ? b.color : 'var(--border)'}`,
                  background: selectedBroker === b.id ? `${b.color}15` : 'transparent',
                  color: 'var(--text-0)',
                  cursor: 'pointer',
                  opacity: 1, textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{b.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-1)' }}>{b.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Setup AlphaDesk Bridge / Watcher */}
          <div>
            {userId
              ? <AlphaDeskBridgeSetup userId={userId} mode={bridgeMode} onRecalculated={onReload} />
              : <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-1)', fontSize: 13 }}>
                  Effettua il login per configurare il plugin.
                </div>
            }
          </div>
        </div>
      )}

      {/* ── Altri broker: mostra select conto + config ── */}
      {!showBridgeSetup && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
          {/* Lista broker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Broker</div>
            {BROKERS.map(b => (
              <button key={b.id} onClick={() => setSelectedBroker(b.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${selectedBroker === b.id ? b.color : 'var(--border)'}`,
                  background: selectedBroker === b.id ? `${b.color}15` : 'transparent',
                  color: 'var(--text-0)',
                  cursor: 'pointer',
                  opacity: 1, textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{b.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-1)' }}>{b.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Config + sync */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Selezione conto — solo per broker non-NT8 */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 6 }}>Conto da sincronizzare</div>
              {accounts.length > 0 ? (
                <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} style={{ ...inp }}>
                  {accounts.map(a => <option key={a} value={a}>{displayAccount(a)}</option>)}
                </select>
              ) : (
                <input value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
                  placeholder="Nome conto (es. LucidProp)"
                  style={{ ...inp }} />
              )}
              {selectedAccount && lastSync(selectedAccount) && (
                <div style={{ fontSize: 12, color: 'var(--text-1)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  Ultima sync: {new Date(lastSync(selectedAccount)!.last_sync).toLocaleString('it-IT')}
                </div>
              )}
            </div>

            {/* Config broker */}
            <div>
              <button onClick={() => setShowConfig(!showConfig)}
                style={{ fontSize: 11, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                {showConfig ? '▼' : '▶'} Configurazione {selectedBroker}
              </button>
              {showConfig && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {selectedBroker === 'interactive_brokers' && (
                    <>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 4 }}>Flex Token</div>
                        <input style={inp} value={config.flexToken} onChange={e => setConfig(p => ({ ...p, flexToken: e.target.value }))} placeholder="Token IB FlexQuery" />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 4 }}>Query ID</div>
                        <input style={inp} value={config.queryId} onChange={e => setConfig(p => ({ ...p, queryId: e.target.value }))} placeholder="ID FlexQuery" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-1)', padding: '6px 10px', background: 'var(--bg-3)', borderRadius: 6 }}>
              ⏰ Sync automatica: <strong>22:30</strong> — o manuale in qualsiasi momento
            </div>

            <button onClick={handleSync} disabled={syncing || !selectedAccount.trim()}
              style={{ padding: '10px', background: syncing ? 'var(--bg-4)' : 'var(--accent)', border: 'none', borderRadius: 8, color: syncing ? 'var(--text-2)' : '#000', fontSize: 13, fontWeight: 700, cursor: syncing && selectedAccount.trim() ? 'not-allowed' : 'pointer' }}>
              {syncing ? '⟳ Sincronizzando...' : '⚡ Sincronizza ora'}
            </button>

            {result && (
              <div style={{ padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
                background: result.error ? 'var(--red-dim)' : result.newTrades > 0 ? 'var(--green-dim)' : 'var(--bg-3)',
                color: result.error ? 'var(--red)' : result.newTrades > 0 ? 'var(--green)' : 'var(--text-1)' }}>
                {result.error
                  ? `⚠ ${result.error}`
                  : result.newTrades > 0
                    ? `✓ ${result.newTrades} nuovi trade sincronizzati`
                    : '✓ Nessun trade nuovo — dati aggiornati'}
              </div>
            )}

            {/* Status sync conti */}
            {syncs.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Ultima sincronizzazione</div>
                {syncs.map(s => (
                  <div key={s.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)', fontWeight: 500 }}>{displayAccount(s.account)}</span>
                    <span style={{ color: 'var(--text-1)' }}>{s.broker} · {new Date(s.last_sync).toLocaleDateString('it-IT')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status syncs globale — sempre visibile */}
      {syncs.length > 0 && showBridgeSetup && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Conti con sync attiva</div>
          {syncs.map(s => (
            <div key={s.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)', fontWeight: 500 }}>{displayAccount(s.account)}</span>
              <span style={{ color: 'var(--text-1)' }}>{s.broker} · ultima: {new Date(s.last_sync).toLocaleDateString('it-IT')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
