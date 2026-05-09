'use client'
import CoreTraderSetup from './CoreTraderSetup'
import { useState } from 'react'
import { AccountSync } from '../lib/useTrades'

interface SyncPanelProps {
  accounts: string[]
  syncs: AccountSync[]
  onSync: (account: string, broker: string, config?: any) => Promise<any>
  onReload: () => void
}

const BROKERS = [
  { id: 'tradovate', label: 'Tradovate Live', icon: '📊', color: '#00d4aa', desc: 'Conto live reale' },
  { id: 'tradovate_prop', label: 'Tradovate Prop', icon: '🏆', color: '#4da6ff', desc: 'Prop / Simulazione (Lucid, Apex...)' },
  { id: 'ninjatrader', label: 'NinjaTrader 8', icon: '⚡', color: '#f5a623', desc: 'API locale porta 36973' },
  { id: 'interactive_brokers', label: 'Interactive Brokers', icon: '🏦', color: '#9b59b6', desc: 'TWS FlexQuery API' },
  { id: 'rithmic', label: 'Rithmic / AMP', icon: '🔌', color: '#4a6278', desc: 'Prossimamente' },
  { id: 'atas', label: 'ATAS', icon: '📈', color: '#4a6278', desc: 'Prossimamente' },
]

export default function SyncPanel({ accounts, syncs, onSync, onReload, userId }: SyncPanelProps & { userId?: string }) {
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] || '')
  const [newAccountName, setNewAccountName] = useState('')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState('tradovate_prop')
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

          {/* Selezione conto */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>Conto da sincronizzare</div>
            {accounts.length > 0 ? (
              <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
                style={{ ...inp, marginBottom: 8 }}>
                {[...new Set([...accounts, ...(selectedAccount && !accounts.includes(selectedAccount) ? [selectedAccount] : [])])].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : (
              <input value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
                placeholder="Nome conto (es. LucidProp)"
                style={{ ...inp, marginBottom: 8 }} />
            )}
            {selectedAccount && getSyncInfo(selectedAccount) && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                Ultima sync: {new Date(getSyncInfo(selectedAccount)!.last_sync).toLocaleString('it-IT')}
              </div>
            )}
            {!selectedAccount && (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 4 }}>
                ⚠ Inserisci un nome conto per continuare
              </div>
            )}
          </div>

          {/* NinjaTrader: usa CoreTraderSetup */}
          {selectedBroker === 'ninjatrader' && userId && (
            <CoreTraderSetup userId={userId} />
          )}
          {selectedBroker === 'ninjatrader' && !userId && (
            <div style={{padding:'12px',background:'var(--bg-3)',borderRadius:8,fontSize:12,color:'var(--text-2)'}}>
              Effettua il login per configurare la connessione CoreTrader.
            </div>
          )}

          {/* Altri broker: config manuale + sync */}
          {selectedBroker !== 'ninjatrader' && (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div>
                <button onClick={() => setShowConfig(!showConfig)} style={{ fontSize: 11, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: showConfig ? 10 : 0 }}>
                  {showConfig ? '▼' : '▶'} Configurazione {selectedBroker}
                </button>
                {showConfig && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
                    {(selectedBroker === 'tradovate' || selectedBroker === 'tradovate_prop') && (
                      <div style={{display:'flex',flexDirection:'column',gap:8}}>
                        {selectedBroker === 'tradovate_prop' && (
                          <div style={{padding:'8px 10px',background:'rgba(77,166,255,0.1)',borderRadius:6,fontSize:11,color:'#4da6ff',lineHeight:1.5}}>
                            🏆 <strong>Tradovate Prop</strong> — usa le credenziali del tuo account Tradovate.
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Email account Tradovate</div>
                          <input style={inp} value={config.tvUser || ''} onChange={e => setConfig(p => ({ ...p, tvUser: e.target.value }))} placeholder="email@esempio.com" />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>Password Tradovate</div>
                          <input style={{...inp}} type="password" value={config.tvPass || ''} onChange={e => setConfig(p => ({ ...p, tvPass: e.target.value }))} placeholder="••••••••" />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>CID (App ID) — opzionale</div>
                          <input style={inp} value={config.accessToken} onChange={e => setConfig(p => ({ ...p, accessToken: e.target.value }))} placeholder="Lascia vuoto per usare il default" />
                        </div>
                        <div style={{fontSize:10,color:'var(--text-2)',lineHeight:1.6,padding:'8px 10px',background:'var(--bg-2)',borderRadius:6}}>
                          <strong style={{color:'var(--text-0)'}}>Email e password</strong> da usare:<br/>
                          • <strong>Lucid Trading</strong>: email e password con cui ti sei registrato su lucidtrading.com<br/>
                          • Non usare l&apos;ID conto (es. LTTH8J2N35X) — serve l&apos;<strong>email</strong>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{fontSize:11,color:'var(--text-2)',padding:'6px 10px',background:'var(--bg-3)',borderRadius:6}}>
                ⏰ Sincronizzazione automatica: <strong>22:30</strong> — o manuale in qualsiasi momento
              </div>
              <button onClick={handleSync} disabled={syncing || !selectedAccount.trim()}
                style={{ padding: '10px', background: syncing ? 'var(--bg-4)' : 'var(--accent)', border: 'none', borderRadius: 8, color: syncing ? 'var(--text-2)' : '#000', fontSize: 13, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer' }}>
                {syncing ? '⟳ Sincronizzando...' : '⚡ Sincronizza ora'}
              </button>
            </div>
          )}

          {result && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: result.error ? 'var(--red-dim)' : result.newTrades > 0 ? 'var(--green-dim)' : 'var(--bg-3)', fontSize: 12, color: result.error ? 'var(--red)' : result.newTrades > 0 ? 'var(--green)' : 'var(--text-2)', lineHeight: 1.6 }}>
              {result.error
                ? <>{String.fromCharCode(9888)} {result.error}<br/><span style={{fontSize:10,opacity:0.8}}>{getBrokerHelp()}</span></>
                : result.newTrades > 0
                  ? `${result.newTrades} nuovi trade sincronizzati`
                  : 'Nessun trade nuovo — dati aggiornati'}
            </div>
          )}

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
