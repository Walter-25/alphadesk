'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'verifying' | 'ready' | 'invalid' | 'success'

export default function SetPasswordPage() {
  const [status, setStatus] = useState<Status>('verifying')
  const [verifyError, setVerifyError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Se il link arriva già con una sessione attiva (es. token nell'hash,
    // rilevato automaticamente dal client Supabase), non serve altro.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setStatus('ready')
      }
    })

    const verify = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (cancelled) return
        if (exchangeError) { setVerifyError(exchangeError.message); setStatus('invalid'); return }
        setStatus('ready')
        return
      }

      // Nessun ?code= — controlla se il client ha già una sessione
      // (caso token nell'hash, rilevato automaticamente da detectSessionInUrl).
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) { setStatus('ready'); return }

      // Dà al client un istante per processare l'hash prima di arrendersi.
      setTimeout(async () => {
        if (cancelled) return
        const { data: retryData } = await supabase.auth.getSession()
        if (cancelled) return
        if (retryData.session) { setStatus('ready') }
        else { setVerifyError('Link non valido o scaduto.'); setStatus('invalid') }
      }, 800)
    }

    verify()

    return () => { cancelled = true; authListener.subscription.unsubscribe() }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) { setError('La password deve avere almeno 8 caratteri'); return }
    if (newPassword !== confirmPassword) { setError('Le password non coincidono'); return }
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword, data: { password_set: true, privacy_accepted_at: new Date().toISOString() } })
    setLoading(false)
    if (updateError) { setError(updateError.message); return }
    setStatus('success')
  }

  const inp = { width: '100%', padding: '10px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 14, outline: 'none' } as React.CSSProperties
  const labelStyle = { display: 'block', fontSize: 11, fontFamily: "'DM Mono',monospace", color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 } as React.CSSProperties

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 32, letterSpacing: '-0.02em' }}>Alpha<span style={{ color: 'var(--accent)' }}>Desk</span></div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace", letterSpacing: '0.12em', marginTop: 4 }}>ANALYSIS · REVIEW · EDGE</div>
        </div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px' }}>
          {status === 'verifying' && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Verifica del link in corso...</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Un attimo, stiamo verificando il link ricevuto via email.</div>
            </div>
          )}

          {status === 'invalid' && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Link non valido</div>
              <div style={{ padding: '10px 14px', background: 'var(--red-dim)', border: '1px solid rgba(255,77,109,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)', marginTop: 16 }}>
                {verifyError || 'Il link è scaduto o non è più valido. Richiedi un nuovo invito o reset password.'}
              </div>
              <a href="/" style={{ display: 'block', marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--accent)' }}>Torna al login</a>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Imposta la tua password</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 24 }}>Scegli una password per accedere alla piattaforma</div>
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Nuova password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} placeholder="min. 8 caratteri" style={inp} />
                </div>
                <div>
                  <label style={labelStyle}>Conferma password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} placeholder="ripeti la password" style={inp} />
                </div>
                {error && <div style={{ padding: '10px 14px', background: 'var(--red-dim)', border: '1px solid rgba(255,77,109,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
                <button type="submit" disabled={loading || !privacyAccepted} style={{ padding: 11, background: loading ? 'rgba(0,212,170,0.5)' : 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 4, opacity: (loading || !privacyAccepted) ? 0.5 : 1 }}>{loading ? 'Salvataggio...' : 'Imposta password'}</button>
                <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:11,color:'var(--text-2)',cursor:'pointer'}}><input type="checkbox" checked={privacyAccepted} onChange={e=>setPrivacyAccepted(e.target.checked)} style={{marginTop:2,accentColor:'var(--accent)'}}/> <span>Ho letto e compreso l'<a href="/privacy" target="_blank" style={{color:'var(--accent)'}}>informativa privacy</a></span></label>
              </form>
            </>
          )}

          {status === 'success' && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Password impostata</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>La tua password è stata aggiornata correttamente.</div>
              <a href="/" style={{ display: 'block', padding: 11, background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, textAlign: 'center', textDecoration: 'none' }}>Vai alla piattaforma</a>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace" }}>© 2026 AlphaDesk — Accesso riservato</div>
      </div>
    </div>
  )
}
