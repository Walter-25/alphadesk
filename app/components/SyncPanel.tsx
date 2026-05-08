'use client'
import { useState } from 'react'
import { AccountSync } from '../lib/useTrades'

interface SyncPanelProps {
  accounts: string[]
  syncs: AccountSync[]
  onSync: (account: string, broker: string, config?: any) => Promise<any>
  onReload: () => void
}

const BROKERS = [
  { id: 'ninjatrader', label: 'NinjaTrader 8', icon: '⚡', color: '#4da6ff', desc: 'API locale porta 36973' },
  { id: 'interactive_brokers', label: 'Interactive Brokers', icon: '🏦', color: '#f5a623', desc: 'TWS FlexQuery API' },
  { id: 'tradovate', label: 'Tradovate', icon: '📊', color: '#00d4aa', desc: 'REST API live' },
  { id: 'rithmic', label: 'Rithmic / AMP', icon: '🔌', color: '#9b59b6', desc: 'Prossimamente' },
  { id: 'atas', label: 'ATAS', icon: '📈', color: '#e67e22', desc: 'Prossimamente' },
]

export default function SyncPanel({ accounts, syncs, onSync, onReload }: SyncPanelProps) {
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] || '')
  const [newAccountName, setNewAccountName] = useState('')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState('ninjatrader')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ url: 'http://localhost:36973', flexToken: '', queryId: '', accessToken: '', tvUser: '', tvPass: '' })

  const handleSync = async () => {
    if (!selectedAccount) return
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

  const getBrokerHelp = () => {
    if (selectedBroker === 'ninjatrader') return 'Verifica: NinjaTrader 8 aperto → Tools → Options → Remoting → abilita porta 36973 → riavvia NT8'
    if (selectedBroker === 'interactive_brokers') return 'Verifica: TWS o IB Gateway aperto → API Settings → porta 4001 abilitata → configura FlexQuery su Account Management'
    if (selectedBroker === 'tradovate') return 'Genera il token API su app.tradovate.com → Account → API Access'
    return ''
  }

  const getSyncInfo = (account: string) => syncs.find(s => s.account === account)

  const inp = { padding: '7px 10px', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-mono)', width: '100%' } as React.CSSProperties

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
        Sincronizzazione automatica broker
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Selezione broker */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>Broker</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {BROKERS.map(b => (
              <button key={b.id} onClick={() => b.id !== 'rithmic' && b.id !== 'atas' && setSelectedBroker(b.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${selectedBroker === b.id ? b.color : 'var(--border)'}`, background: selectedBroker === b.id ? `${b.color}15` : 'var(--bg-3)', color: b.id === 'rithmic' || b.id === 'atas' ? 'var(--text-2)' : 'var(--text-0)', cursor: b.id === 'rithmic' || b.id === 'atas' ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: b.id === 'rithmic' || b.id === 'atas' ? 0.5 : 1 }}>
                <span style={{ fontSize: 16 }}>{b.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{b.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)' }}>{b.desc}</div>
                </div>
                {selectedBroker === b.id && <span style={{ fontSize: 10, color: b.color }}>●</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Configurazione + sync */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>Conto da sincronizzare</div>
            <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
              style={{ ...inp, marginBottom: 8 }}>
              {[...new Set([...accounts, ...(selectedAccount && !accounts.includes(selectedAccount) ? [selectedAccount] : [])])].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {selectedAccount && getSyncInfo(selectedAccount) && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                Ultima sync: {new Date(getSyncInfo(selectedAccount)!.last_sync).toLocaleString('it-IT')}
              </div>
            )}
          </div>

          {/* Config per broker */}
          <div>
            <button onClick={() => setShowConfig(!showConfig)} style={{ fontSize: 11, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: showConfig ? 10 : 0 }}>
              {showConfig ? '▼' : '▶'} Configurazione {selectedBroker}
            </button>
            {showConfig && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedBroker === 'ninjatrader' && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>URL NT8 (default: localhost)</div>
                    <input style={inp} value={config.url} onChange={e => setConfig(p => ({ ...p, url: e.target.value }))} placeholder="http://localhost:36973" />
                    <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>
                      NT8 deve essere aperto. Vai in Tools → Options → Remoting e abilita la porta 36973.
                    </div>
                  </div>
                )}
                {selectedBroker === 'interactive_brokers' && (
                  <>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Flex Token</div>
                      <input style={inp} value={config.flexToken} onChange={e => setConfig(p => ({ ...p, flexToken: e.target.value }))} placeholder="Token IB FlexQuery" />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Query ID</div>
                      <input style={inp} value={config.queryId} onChange={e => setConfig(p => ({ ...p, queryId: e.target.value }))} placeholder="ID della FlexQuery" />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>
                      IB: Account Management → Reports → Flex Queries → crea una query con Trades e copia token e ID.
                    </div>
                  </>
                )}
                {selectedBroker === 'tradovate' && (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Username Tradovate</div>
                      <input style={inp} value={config.tvUser || ''} onChange={e => setConfig(p => ({ ...p, tvUser: e.target.value }))} placeholder="La tua email Tradovate" />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Password Tradovate</div>
                      <input style={{...inp, fontFamily:'monospace'}} type="password" value={config.tvPass || ''} onChange={e => setConfig(p => ({ ...p, tvPass: e.target.value }))} placeholder="Password account" />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>API Key (opzionale)</div>
                      <input style={inp} value={config.accessToken} onChange={e => setConfig(p => ({ ...p, accessToken: e.target.value }))} placeholder="App ID da developer.tradovate.com" />
                    </div>
                    <div style={{fontSize:10,color:'var(--text-2)',lineHeight:1.6,padding:'6px 8px',background:'var(--bg-2)',borderRadius:5}}>
                      Tradovate API: accedi su <strong>trader.tradovate.com</strong> → Account → API Access → genera credenziali. Per Lucid Trading, usa le stesse credenziali del portale Lucid.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{fontSize:11,color:'var(--text-2)',marginBottom:8,padding:'6px 10px',background:'var(--bg-3)',borderRadius:6}}>
            ⏰ Sincronizzazione automatica: <strong>22:30</strong> — o manuale in qualsiasi momento
          </div>
          <button onClick={handleSync} disabled={syncing || !selectedAccount}
            style={{ padding: '10px', background: syncing ? 'var(--bg-4)' : 'var(--accent)', border: 'none', borderRadius: 8, color: syncing ? 'var(--text-2)' : '#000', fontSize: 13, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {syncing ? '⟳ Sincronizzando...' : '⚡ Sincronizza ora'}
          </button>

          {result && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: result.error ? 'var(--red-dim)' : result.newTrades > 0 ? 'var(--green-dim)' : 'var(--bg-3)', fontSize: 12, color: result.error ? 'var(--red)' : result.newTrades > 0 ? 'var(--green)' : 'var(--text-2)', lineHeight: 1.6 }}>
              {result.error
                ? <>⚠ {result.error}<br/><span style={{fontSize:10,opacity:0.8}}>{getBrokerHelp()}</span></>
                : result.newTrades > 0
                  ? `✓ ${result.newTrades} nuovi trade sincronizzati`
                  : '✓ Nessun trade nuovo dall\'ultima sync — i dati sono aggiornati'}
            </div>
          )}

          {/* Status tutti i conti */}
          {syncs.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 8 }}>Status conti</div>
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
    </div>
  )
}
