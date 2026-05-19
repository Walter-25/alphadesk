'use client'
import { useState, useEffect } from 'react'

interface ApiKey { id: string; key: string; label: string; created_at: string }
interface AliasRow { ntAccount: string; displayName: string }

export default function AlphaDeskBridgeSetup({ userId }: { userId: string }) {
  const [keys, setKeys]             = useState<ApiKey[]>([])
  const [generating, setGenerating] = useState(false)
  const [label, setLabel]           = useState('NinjaTrader')
  const [copied, setCopied]         = useState('')
  const [aliases, setAliases]       = useState<AliasRow[]>([{ ntAccount: '', displayName: '' }])
  const [aliasesSaved, setAliasesSaved] = useState(false)
  const [commMap, setCommMap]           = useState<{instrument: string; commission: string}[]>([{ instrument: '', commission: '' }])
  const [commSaved, setCommSaved]       = useState(false)
  const [commLoading, setCommLoading]   = useState(false)   // caricamento iniziale da DB
  const [commSaving, setCommSaving]     = useState(false)   // save button
  const [commSaveError, setCommSaveError] = useState('')

  const endpointUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/ingest`
    : 'https://alphadesk-ecru.vercel.app/api/ingest'

  useEffect(() => { loadKeys() }, [userId])

  const loadKeys = async () => {
    const res  = await fetch(`/api/apikey?userId=${userId}`)
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

  const addAlias    = () => setAliases(a => [...a, { ntAccount: '', displayName: '' }])
  const removeAlias = (i: number) => setAliases(a => a.filter((_, idx) => idx !== i))
  const updateAlias = (i: number, field: keyof AliasRow, val: string) =>
    setAliases(a => a.map((row, idx) => idx === i ? { ...row, [field]: val } : row))

  const aliasString = aliases
    .filter(r => r.ntAccount.trim() && r.displayName.trim())
    .map(r => `${r.ntAccount.trim()}=${r.displayName.trim()}`)
    .join(',')

  // Carica mapping salvato da localStorage
  const [savedAliases, setSavedAliases] = useState<AliasRow[]>([])
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ad_account_aliases_' + userId)
      if (saved) {
        const parsed: AliasRow[] = JSON.parse(saved)
        setSavedAliases(parsed)
        setAliases(parsed.length > 0 ? parsed : [{ ntAccount: '', displayName: '' }])
      }
    } catch {}
    // Commission map: DB first, localStorage come fallback offline
    const loadCommissions = async () => {
      setCommLoading(true)
      try {
        const res = await fetch(`/api/commission-settings?userId=${userId}`)
        if (res.ok) {
          const data = await res.json()
          const rows = (data.settings || []).map(
            (s: { instrument: string; commission: number }) => ({
              instrument: s.instrument,
              commission: String(s.commission),
            })
          )
          if (rows.length > 0) {
            setCommMap(rows)
            // Aggiorna cache locale con i dati dal DB
            try { localStorage.setItem('ad_commission_map_' + userId, JSON.stringify(rows)) } catch {}
          } else {
            // DB vuoto -> prova cache localStorage
            try {
              const cached = localStorage.getItem('ad_commission_map_' + userId)
              if (cached) {
                const parsed = JSON.parse(cached)
                setCommMap(parsed.length > 0 ? parsed : [{ instrument: '', commission: '' }])
              }
            } catch {}
          }
        } else {
          // HTTP error -> fallback localStorage
          try {
            const cached = localStorage.getItem('ad_commission_map_' + userId)
            if (cached) {
              const parsed = JSON.parse(cached)
              setCommMap(parsed.length > 0 ? parsed : [{ instrument: '', commission: '' }])
            }
          } catch {}
        }
      } catch {
        // Errore rete -> fallback localStorage
        try {
          const cached = localStorage.getItem('ad_commission_map_' + userId)
          if (cached) {
            const parsed = JSON.parse(cached)
            setCommMap(parsed.length > 0 ? parsed : [{ instrument: '', commission: '' }])
          }
        } catch {}
      } finally {
        setCommLoading(false)
      }
    }
    loadCommissions()
  }, [userId])

  const saveAliases = () => {
    const valid = aliases.filter(r => r.ntAccount.trim() && r.displayName.trim())
    setSavedAliases(valid)
    try { localStorage.setItem('ad_account_aliases_' + userId, JSON.stringify(valid)) } catch {}
    setAliasesSaved(true)
    setTimeout(() => setAliasesSaved(false), 2000)
  }

  const saveCommMap = async () => {
    const valid = commMap.filter(r => r.instrument.trim() && r.commission.trim())
    // 1. localStorage immediato: cache offline disponibile subito
    try { localStorage.setItem('ad_commission_map_' + userId, JSON.stringify(valid)) } catch {}
    // 2. Persisti su Supabase
    setCommSaveError('')
    setCommSaving(true)
    try {
      const res = await fetch('/api/commission-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, settings: valid }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Errore salvataggio')
      setCommSaved(true)
      setTimeout(() => setCommSaved(false), 2000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore salvataggio commissioni'
      setCommSaveError(msg)
      // Mostra comunque saved: localStorage ha gia' funzionato
      setCommSaved(true)
      setTimeout(() => { setCommSaved(false); setCommSaveError('') }, 4000)
    } finally {
      setCommSaving(false)
    }
  }

  const commMapString = commMap
    .filter(r => r.instrument.trim() && r.commission.trim())
    .map(r => r.instrument.trim().toUpperCase() + '=' + r.commission.trim())
    .join(',')

  const maskedKey = (k: ApiKey) =>
    k.key.substring(0, 8) + '••••••••••••••••' + k.key.slice(-4)

  const downloadConfig = () => {
    const apiKey = keys[0]?.key || 'INCOLLA_LA_TUA_CHIAVE_API'
    const json = JSON.stringify({
      Endpoint:      endpointUrl,
      ApiKey:        apiKey,
      SendSimulated: true,
      Debug:         false,
      MaxRetries:    3,
      AccountAlias:  aliasString || '',
      CommissionMap: commMapString || ''
    }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = 'AlphaDeskBridge.config.json'; a.click()
    URL.revokeObjectURL(url)
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

      {/* Step 1 */}
      <div style={section}>
        <div style={stepLabel}>Step 1 — Scarica il plugin</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Scarica il file <strong style={{ color: 'var(--text-0)' }}>AlphaDeskBridge.cs</strong> e copialo in:<br />
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 4 }}>Documenti\NinjaTrader 8\bin\Custom\AddOns\</code><br />
          Poi in NinjaTrader 8: <strong>NinjaScript Editor → F5</strong> per compilare → riavvia NT8.
        </div>
        <a href="/AlphaDeskBridge.cs" download="AlphaDeskBridge.cs"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: 'var(--accent)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', width: 'fit-content' }}>
          ⬇ Scarica AlphaDeskBridge.cs
        </a>
      </div>

      {/* Step 2 */}
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

      {/* Step 3 */}
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
                  <input readOnly value={copied === k.id ? k.key : maskedKey(k)}
                    style={{ ...inp, flex: 1, letterSpacing: '0.05em' }} />
                  <button onClick={() => copy(k.key, k.id)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: copied === k.id ? 'var(--green-dim)' : 'var(--bg-2)', color: copied === k.id ? 'var(--green)' : 'var(--text-1)', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {copied === k.id ? '✓ Copiato' : '📋 Copia'}
                  </button>
                  <button onClick={() => deleteKey(k.id)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,77,109,0.3)', background: 'var(--red-dim)', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>🗑</button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 4 }}>La chiave è mascherata per sicurezza — clicca 📋 Copia per usarla</div>
              </div>
            ))}
            <button onClick={() => { setLabel('NinjaTrader'); setGenerating(true) }}
              style={{ padding: '5px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}>
              + Aggiungi altra chiave
            </button>
            {generating && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Etichetta" style={{ ...inp, flex: 1 }} />
                <button onClick={generateKey}
                  style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Genera</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 4: Mapping conti */}
      <div style={section}>
        <div style={stepLabel}>Step 4 — Mapping conti (opzionale)</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Associa i nomi tecnici dei conti NT8 ai nomi che vuoi vedere in AlphaDesk. Il numero del conto non viene mai mostrato — viene sostituito dal nome scelto.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const }}>Nome conto in NT8</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const }}>Nome in AlphaDesk</div>
            <div />
          </div>
          {aliases.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6 }}>
              <input value={row.ntAccount} onChange={e => updateAlias(i, 'ntAccount', e.target.value)}
                placeholder="es. LFE05067595930005" style={inp} />
              <input value={row.displayName} onChange={e => updateAlias(i, 'displayName', e.target.value)}
                placeholder="es. LucidProp1" style={inp} />
              <button onClick={() => removeAlias(i)} disabled={aliases.length === 1}
                style={{ padding: '4px', borderRadius: 6, border: '1px solid rgba(255,77,109,0.3)', background: aliases.length === 1 ? 'transparent' : 'var(--red-dim)', color: aliases.length === 1 ? 'var(--text-2)' : 'var(--red)', cursor: aliases.length === 1 ? 'default' : 'pointer', fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button onClick={addAlias}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11, textAlign: 'left' as const }}>
            + Aggiungi conto
          </button>
          {aliasString && (
            <div style={{ background: 'var(--bg-3)', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', wordBreak: 'break-all' as const }}>
              {aliasString}
            </div>
          )}
          <button onClick={saveAliases}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: aliasesSaved ? 'var(--green-dim)' : 'var(--accent)', color: aliasesSaved ? 'var(--green)' : '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12, width: 'fit-content' }}>
            {aliasesSaved ? '✓ Mapping salvato' : '💾 Salva mapping'}
          </button>
          {savedAliases.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' as const, marginBottom: 6 }}>Mapping attivi</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                {savedAliases.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr 32px 32px', alignItems: 'center', gap: 6, background: 'var(--bg-3)', borderRadius: 6, padding: '5px 10px' }}>
                    <input
                      value={r.ntAccount}
                      onChange={e => {
                        const updated = savedAliases.map((x, idx) => idx === i ? { ...x, ntAccount: e.target.value } : x)
                        setSavedAliases(updated)
                        setAliases(updated)
                      }}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', background: 'transparent', border: 'none', outline: 'none', padding: '2px 4px', borderRadius: 4 }}
                      onFocus={e => e.target.style.background = 'var(--bg-2)'}
                      onBlur={e => e.target.style.background = 'transparent'}
                    />
                    <span style={{ color: 'var(--accent)', fontSize: 11 }}>→</span>
                    <input
                      value={r.displayName}
                      onChange={e => {
                        const updated = savedAliases.map((x, idx) => idx === i ? { ...x, displayName: e.target.value } : x)
                        setSavedAliases(updated)
                        setAliases(updated)
                      }}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-0)', fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', padding: '2px 4px', borderRadius: 4 }}
                      onFocus={e => e.target.style.background = 'var(--bg-2)'}
                      onBlur={e => e.target.style.background = 'transparent'}
                    />
                    <button onClick={() => saveAliases()} title="Salva modifiche"
                      style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>✓</button>
                    <button onClick={() => {
                        const updated = savedAliases.filter((_, idx) => idx !== i)
                        setSavedAliases(updated)
                        setAliases(updated.length > 0 ? updated : [{ ntAccount: '', displayName: '' }])
                        try { localStorage.setItem('ad_account_aliases_' + userId, JSON.stringify(updated)) } catch {}
                      }}
                      style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid rgba(255,77,109,0.3)', background: 'var(--red-dim)', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step 4b: Commission Map */}
      <div style={section}>
        <div style={stepLabel}>Step 4b — Commissioni per strumento (opzionale)</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Inserisci la commissione per contratto per ogni strumento. Usata solo se il tuo broker
          non invia le commissioni automaticamente (es. Lucid, alcuni conti Tradovate prop).
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const }}>Strumento (es. NQ)</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const }}>Comm. per contratto ($)</div>
            <div />
          </div>
          {commMap.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6 }}>
              <input value={row.instrument} onChange={e => setCommMap(m => m.map((r, idx) => idx === i ? { ...r, instrument: e.target.value } : r))}
                placeholder="es. NQ" style={inp} />
              <input value={row.commission} onChange={e => setCommMap(m => m.map((r, idx) => idx === i ? { ...r, commission: e.target.value } : r))}
                placeholder="es. 5.76" style={inp} />
              <button onClick={() => setCommMap(m => m.filter((_, idx) => idx !== i))} disabled={commMap.length === 1}
                style={{ padding: '4px', borderRadius: 6, border: '1px solid rgba(255,77,109,0.3)', background: commMap.length === 1 ? 'transparent' : 'var(--red-dim)', color: commMap.length === 1 ? 'var(--text-2)' : 'var(--red)', cursor: commMap.length === 1 ? 'default' : 'pointer', fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button onClick={() => setCommMap(m => [...m, { instrument: '', commission: '' }])}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11, textAlign: 'left' as const }}>
            + Aggiungi strumento
          </button>
          {commMapString && (
            <div style={{ background: 'var(--bg-3)', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', wordBreak: 'break-all' as const }}>
              {commMapString}
            </div>
          )}
          <button onClick={saveCommMap} disabled={commSaving}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none',
              background: commSaved ? 'var(--green-dim)' : 'var(--bg-3)',
              color: commSaved ? 'var(--green)' : commSaving ? 'var(--text-2)' : 'var(--text-1)',
              fontWeight: 700, cursor: commSaving ? 'not-allowed' : 'pointer',
              fontSize: 12, width: 'fit-content' }}>
            {commSaving ? '⟳ Salvando...' : commSaved ? '✓ Salvato' : '💾 Salva commissioni'}
          </button>
          {commSaveError && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>
              ⚠ {commSaveError} — impostazioni salvate in locale
            </div>
          )}
        </div>
      </div>

      {/* Step 5: Scarica config */}
      <div style={section}>
        <div style={stepLabel}>Step 5 — Scarica e installa il config</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Scarica il file di configurazione già compilato con la tua API key e il mapping conti, e copialo in:
        </div>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-3)', padding: '4px 8px', borderRadius: 4, color: 'var(--text-1)' }}>
          Documenti\NinjaTrader 8\AlphaDeskBridge.config.json
        </code>
        <pre style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '12px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', lineHeight: 1.7, overflow: 'auto', margin: 0 }}>
{`{
  "Endpoint": "${endpointUrl}",
  "ApiKey": "${keys[0] ? maskedKey(keys[0]) : 'genera-prima-la-chiave'}",
  "SendSimulated": true,
  "Debug": false,
  "MaxRetries": 3,
  "AccountAlias": "${aliasString || ''}",
  "CommissionMap": "${commMapString || ''}"
}`}
        </pre>
        <div style={{ fontSize: 10, color: 'var(--text-2)' }}>ℹ La chiave è mascherata nell&apos;anteprima — nel file scaricato sarà quella reale.</div>
        <button onClick={downloadConfig} disabled={keys.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', background: keys.length === 0 ? 'var(--bg-4)' : 'var(--accent)', color: keys.length === 0 ? 'var(--text-2)' : '#000', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: keys.length === 0 ? 'not-allowed' : 'pointer', border: 'none', width: 'fit-content' }}>
          ⬇ Scarica AlphaDeskBridge.config.json
        </button>
        {keys.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--amber)' }}>⚠ Genera prima una API key al Step 3</div>
        )}
      </div>

    </div>
  )
}
