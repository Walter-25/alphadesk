'use client'
import { useState, useEffect } from 'react'

interface ApiKey { id: string; key: string; label: string; created_at: string }

export default function CoreTraderSetup({ userId }: { userId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [label, setLabel] = useState('NinjaTrader')

  useEffect(() => { loadKeys() }, [userId])

  const loadKeys = async () => {
    const res = await fetch(`/api/apikey?userId=${userId}`)
    const data = await res.json()
    setKeys(data.keys || [])
  }

  const generateKey = async () => {
    setGenerating(true)
    const res = await fetch('/api/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, label })
    })
    const data = await res.json()
    if (data.key) await loadKeys()
    setGenerating(false)
  }

  const deleteKey = async (id: string) => {
    if (!confirm('Eliminare questa API key? Il plugin NinjaTrader smetterà di funzionare.')) return
    await fetch('/api/apikey', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    loadKeys()
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const endpointUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/ingest`
    : 'https://alphadesk-ecru.vercel.app/api/ingest'

  const inp = { padding: '7px 10px', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-mono)', width: '100%' } as React.CSSProperties

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Intestazione */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
          🔌 CoreTraderExporter → AlphaDesk (Real-time)
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Hai già installato il plugin CoreTraderExporter su NinjaTrader. Configura il plugin per inviare i trade direttamente ad AlphaDesk in tempo reale — ogni trade viene registrato automaticamente appena chiudi la posizione su NT8.
        </div>
      </div>

      {/* Endpoint URL */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10 }}>Step 1 — Endpoint URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={endpointUrl} style={inp} />
          <button onClick={() => copy(endpointUrl)} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: copied ? 'var(--green-dim)' : 'var(--bg-3)', color: copied ? 'var(--green)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
            {copied ? '✓ Copiato' : '📋 Copia'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>
          Inserisci questo URL nel campo <strong>ApiEndpoint</strong> del file <code style={{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>CoreTraderExporter.config.json</code>
        </div>
      </div>

      {/* API Key */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12 }}>Step 2 — API Key</div>

        {keys.length === 0 ? (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>Genera una chiave API da inserire nel campo <strong>ApiKey</strong> del config file.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta (es. NinjaTrader Casa)" style={{ ...inp, flex: 1 }} />
              <button onClick={generateKey} disabled={generating} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
                {generating ? 'Generando...' : '⚡ Genera chiave'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {keys.map(k => (
              <div key={k.id} style={{ background: 'var(--bg-3)', borderRadius: 9, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)' }}>{k.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)' }}>creata il {new Date(k.created_at).toLocaleDateString('it-IT')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input readOnly value={k.key} style={{ ...inp, flex: 1, letterSpacing: '0.03em' }} />
                  <button onClick={() => copy(k.key)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>📋</button>
                  <button onClick={() => deleteKey(k.id)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,77,109,0.3)', background: 'var(--red-dim)', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>🗑</button>
                </div>
              </div>
            ))}
            <button onClick={() => setGenerating(true)} style={{ padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>+ Aggiungi altra chiave</button>
            {generating && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta" style={{ ...inp, flex: 1 }} />
                <button onClick={generateKey} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Genera</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Config file esempio */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10 }}>Step 3 — Config file NinjaTrader</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
          Apri il file <code style={{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>Documenti\NinjaTrader 8\CoreTraderExporter.config.json</code> e aggiorna così:
        </div>
        <pre style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '12px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', lineHeight: 1.7, overflow: 'auto' }}>
{`{
  "ApiEndpoint": "${endpointUrl}",
  "ApiKey": "la-tua-chiave-api",
  "AccountFilter": "",
  "EnableLogging": true,
  "SendSimulatedTrades": true,
  "MaxRetries": 3,
  "TimeoutSeconds": 10,
  "DebugMode": false
}`}
        </pre>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--amber)', lineHeight: 1.6 }}>
          ⚠ Dopo aver modificato il file, riavvia NinjaTrader 8 per applicare la nuova configurazione. Da quel momento ogni trade chiuso su NT8 arriverà automaticamente in AlphaDesk.
        </div>
      </div>
    </div>
  )
}
