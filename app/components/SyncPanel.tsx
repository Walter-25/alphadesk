'use client'
import AlphaDeskBridgeSetup from './CoreTraderSetup'
import { useState } from 'react'
import { AccountSync } from '../lib/useTrades'

interface SyncPanelProps {
  accounts: string[]
  syncs: AccountSync[]
  onSync: (account: string, broker: string, config?: any) => Promise<any>
  onReload: () => void
  userId?: string
}

export default function SyncPanel({ accounts, syncs, onSync, onReload, userId }: SyncPanelProps) {
  const [selectedBroker, setSelectedBroker] = useState('ninjatrader')
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] || '')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({
    url: 'http://localhost:36973', flexToken: '', queryId: '',
    accessToken: '', tvUser: '', tvPass: ''
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
    { id: 'ninjatrader', label: 'NinjaTrader 8', icon: '⚡', color: '#f5a623', desc: 'Plugin AlphaDesk Bridge' },
    { id: 'tradovate', label: 'Tradovate Live', icon: '📊', color: '#00d4aa', desc: 'Conto live reale' },
    { id: 'tradovate_prop', label: 'Tradovate Prop', icon: '🏆', color: '#4da6ff', desc: 'Prop / Simulazione' },
    { id: 'interactive_brokers', label: 'Interactive Brokers', icon: '🏦', color: '#9b59b6', desc: 'TWS FlexQuery API' },
    { id: 'rithmic', label: 'Rithmic / AMP', icon: '🔌', color: '#4a6278', desc: 'Prossimamente' },
    { id: 'atas', label: 'ATAS', icon: '📈', color: '#4a6278', desc: 'Prossimamente' },
  ]

  const isDisabled = (id: string) => id === 'rithmic' || id === 'atas'
  const lastSync = (acc: string) => syncs.find(s => s.account === acc)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── NinjaTrader: mostra setup Bridge senza chiedere il conto ── */}
      {selectedBroker === 'ninjatrader' && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
          {/* Lista broker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 4 }}>Broker</div>
            {BROKERS.map(b => (
              <button key={b.id} onClick={() => !isDisabled(b.id) && setSelectedBroker(b.id)}
                disabled={isDisabled(b.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${selectedBroker === b.id ? b.color : 'var(--border)'}`,
                  background: selectedBroker === b.id ? `${b.color}15` : 'transparent',
                  color: isDisabled(b.id) ? 'var(--text-2)' : 'var(--text-0)',
                  cursor: isDisabled(b.id) ? 'not-allowed' : 'pointer',
                  opacity: isDisabled(b.id) ? 0.4 : 1, textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{b.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)' }}>{b.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Setup AlphaDesk Bridge */}
          <div>
            {userId
              ? <AlphaDeskBridgeSetup userId={userId} />
              : <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                  Effettua il login per configurare il plugin.
                </div>
            }
          </div>
        </div>
      )}

      {/* ── Altri broker: mostra select conto + config ── */}
      {selectedBroker !== 'ninjatrader' && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
          {/* Lista broker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 4 }}>Broker</div>
            {BROKERS.map(b => (
              <button key={b.id} onClick={() => !isDisabled(b.id) && setSelectedBroker(b.id)}
                disabled={isDisabled(b.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${selectedBroker === b.id ? b.color : 'var(--border)'}`,
                  background: selectedBroker === b.id ? `${b.color}15` : 'transparent',
                  color: isDisabled(b.id) ? 'var(--text-2)' : 'var(--text-0)',
                  cursor: isDisabled(b.id) ? 'not-allowed' : 'pointer',
                  opacity: isDisabled(b.id) ? 0.4 : 1, textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{b.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)' }}>{b.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Config + sync */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Selezione conto — solo per broker non-NT8 */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>Conto da sincronizzare</div>
              {accounts.length > 0 ? (
                <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} style={{ ...inp }}>
                  {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <input value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
                  placeholder="Nome conto (es. LucidProp)"
                  style={{ ...inp }} />
              )}
              {selectedAccount && lastSync(selectedAccount) && (
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
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
                  {(selectedBroker === 'tradovate' || selectedBroker === 'tradovate_prop') && (
                    <>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Email account Tradovate</div>
                        <input style={inp} value={config.tvUser} onChange={e => setConfig(p => ({ ...p, tvUser: e.target.value }))} placeholder="email@esempio.com" />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Password Tradovate</div>
                        <input style={inp} type="password" value={config.tvPass} onChange={e => setConfig(p => ({ ...p, tvPass: e.target.value }))} placeholder="••••••••" />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.6, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 5 }}>
                        Usa le credenziali di trader.tradovate.com — per Lucid Trading usa quelle del portale Lucid.
                      </div>
                    </>
                  )}
                  {selectedBroker === 'interactive_brokers' && (
                    <>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Flex Token</div>
                        <input style={inp} value={config.flexToken} onChange={e => setConfig(p => ({ ...p, flexToken: e.target.value }))} placeholder="Token IB FlexQuery" />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Query ID</div>
                        <input style={inp} value={config.queryId} onChange={e => setConfig(p => ({ ...p, queryId: e.target.value }))} placeholder="ID FlexQuery" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-2)', padding: '6px 10px', background: 'var(--bg-3)', borderRadius: 6 }}>
              ⏰ Sync automatica: <strong>22:30</strong> — o manuale in qualsiasi momento
            </div>

            <button onClick={handleSync} disabled={syncing || !selectedAccount.trim()}
              style={{ padding: '10px', background: syncing ? 'var(--bg-4)' : 'var(--accent)', border: 'none', borderRadius: 8, color: syncing ? 'var(--text-2)' : '#000', fontSize: 13, fontWeight: 700, cursor: syncing && selectedAccount.trim() ? 'not-allowed' : 'pointer' }}>
              {syncing ? '⟳ Sincronizzando...' : '⚡ Sincronizza ora'}
            </button>

            {result && (
              <div style={{ padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
                background: result.error ? 'var(--red-dim)' : result.newTrades > 0 ? 'var(--green-dim)' : 'var(--bg-3)',
                color: result.error ? 'var(--red)' : result.newTrades > 0 ? 'var(--green)' : 'var(--text-2)' }}>
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
                <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8 }}>Ultima sincronizzazione</div>
                {syncs.map(s => (
                  <div key={s.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)', fontWeight: 500 }}>{s.account}</span>
                    <span style={{ color: 'var(--text-2)' }}>{s.broker} · {new Date(s.last_sync).toLocaleDateString('it-IT')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status syncs globale — sempre visibile */}
      {syncs.length > 0 && selectedBroker === 'ninjatrader' && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8 }}>Conti con sync attiva</div>
          {syncs.map(s => (
            <div key={s.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)', fontWeight: 500 }}>{s.account}</span>
              <span style={{ color: 'var(--text-2)' }}>{s.broker} · ultima: {new Date(s.last_sync).toLocaleDateString('it-IT')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
