'use client'
import { useState, useEffect } from 'react'

interface ApiKey { id: string; key: string; label: string; created_at: string }

export default function AlphaDeskBridgeSetup({ userId }: { userId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [generating, setGenerating] = useState(false)
  const [label, setLabel] = useState('NinjaTrader')
  const [copied, setCopied] = useState('')

  const endpointUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/ingest`
    : 'https://alphadesk-ecru.vercel.app/api/ingest'

  useEffect(() => { loadKeys() }, [userId])

  const loadKeys = async () => {
    const res = await fetch(`/api/apikey?userId=${userId}`)
    const data = await res.json()
    setKeys(data.keys || [])
  }

  const generateKey = async () => {
    setGenerating(true)
    await fetch('/api/apikey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, label })
    })
    await loadKeys()
    setGenerating(false)
  }

  const deleteKey = async (id: string) => {
    if (!confirm('Eliminare questa API key? Il plugin AlphaDesk Bridge smetterà di funzionare.')) return
    await fetch('/api/apikey', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    loadKeys()
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id); setTimeout(() => setCopied(''), 2000)
  }

  const inp = { padding: '7px 10px', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-mono)', width: '100%' } as React.CSSProperties
  const section = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 10 }
  const stepLabel = { fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ ...section, borderColor: 'rgba(0,212,170,0.3)', background: 'var(--accent-dim)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>⚡ AlphaDesk Bridge — Plugin NinjaTrader 8</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Plugin proprietario AlphaDesk per NinjaTrader 8. Ogni trade chiuso viene inviato automaticamente in tempo reale — senza export manuale, senza software di terze parti. Funziona con qualsiasi conto NT8: simulato, prop, live.
        </div>
      </div>

      {/* Step 1: Download plugin */}
      <div style={section}>
        <div style={stepLabel}>Step 1 — Scarica il plugin</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Scarica il file <strong style={{ color: 'var(--text-0)' }}>AlphaDeskBridge.cs</strong> e copialo in:<br />
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>
            Documenti\NinjaTrader 8\bin\Custom\AddOns\
          </code>
          <br />Poi in NinjaTrader 8: <strong>NinjaScript Editor → F5</strong> per compilare → riavvia NT8.
        </div>
        <a href="/AlphaDeskBridge.cs" download="AlphaDeskBridge.cs"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: 'var(--accent)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', width: 'fit-content' }}>
          ⬇ Scarica AlphaDeskBridge.cs
        </a>
      </div>

      {/* Step 2: Endpoint URL */}
      <div style={section}>
        <div style={stepLabel}>Step 2 — URL Endpoint</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={endpointUrl} style={inp} />
          <button onClick={() => copy(endpointUrl, 'url')}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: copied === 'url' ? 'var(--green-dim)' : 'var(--bg-3)', color: copied === 'url' ? 'var(--green)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
            {copied === 'url' ? '✓ Copiato' : '📋 Copia'}
          </button>
        </div>
      </div>

      {/* Step 3: API Key */}
      <div style={section}>
        <div style={stepLabel}>Step 3 — Genera API Key</div>
        {keys.length === 0 ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Genera una chiave unica per autenticare il plugin.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta (es. PC Casa)" style={{ ...inp, flex: 1 }} />
              <button onClick={generateKey} disabled={generating}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
                {generating ? 'Generando...' : '⚡ Genera chiave'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map(k => (
              <div key={k.id} style={{ background: 'var(--bg-3)', borderRadius: 9, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>{k.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)' }}>creata il {new Date(k.created_at).toLocaleDateString('it-IT')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input readOnly value={k.key} style={{ ...inp, flex: 1 }} />
                  <button onClick={() => copy(k.key, k.id)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: copied === k.id ? 'var(--green-dim)' : 'var(--bg-2)', color: copied === k.id ? 'var(--green)' : 'var(--text-1)', cursor: 'pointer', fontSize: 11 }}>
                    {copied === k.id ? '✓' : '📋'}
                  </button>
                  <button onClick={() => deleteKey(k.id)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,77,109,0.3)', background: 'var(--red-dim)', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>🗑</button>
                </div>
              </div>
            ))}
            <button onClick={() => { setLabel('NinjaTrader'); setGenerating(true) }} style={{ padding: '5px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>+ Aggiungi altra chiave</button>
            {generating && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta" style={{ ...inp, flex: 1 }} />
                <button onClick={generateKey} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Genera</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 4: Configura in NT8 */}
      <div style={section}>
        <div style={stepLabel}>Step 4 — Configura in NinjaTrader 8</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Dopo aver riavviato NT8, trovi <strong style={{ color: 'var(--text-0)' }}>AlphaDesk Bridge</strong> nel menu Strumenti. Incolla URL e API key, clicca <strong style={{ color: 'var(--text-0)' }}>Salva → Test connessione</strong>.
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          In alternativa, modifica direttamente il file di configurazione:
        </div>
        <pre style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '12px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', lineHeight: 1.7, overflow: 'auto', margin: 0 }}>
{`{
  "Endpoint": "${endpointUrl}",
  "ApiKey": "${keys[0]?.key || 'la-tua-chiave-api'}",
  "SendSimulated": true,
  "Debug": false,
  "MaxRetries": 3
}`}
        </pre>
        <div style={{ fontSize: 11, color: 'var(--amber)' }}>
          ⚠ File: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>Documenti\NinjaTrader 8\AlphaDeskBridge.config.json</code>
        </div>
      </div>

      {/* Step 5 opzionale: Inoltro a CoreTraders */}


    </div>
  )
}
