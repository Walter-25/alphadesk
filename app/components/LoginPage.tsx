'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Credenziali non valide. Controlla email e password.')
      setLoading(false)
      return
    }
    if (data.user) onLogin(data.user)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
      {/* Sfondo decorativo */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '20%', left: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,170,0.04) 0%, transparent 70%)' }}></div>
        <div style={{ position: 'absolute', bottom: '20%', right: '10%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(77,166,255,0.04) 0%, transparent 70%)' }}></div>
      </div>

      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 32, letterSpacing: '-0.02em', color: 'var(--text-0)', marginBottom: 6 }}>
            Alpha<span style={{ color: 'var(--accent)' }}>Desk</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.12em' }}>ANALYSIS · REVIEW · EDGE</div>
        </div>

        {/* Card login */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4 }}>Accedi alla piattaforma</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Inserisci le credenziali che ti sono state fornite</div>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="nome@email.com"
                style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 14, outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••••"
                style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 14, outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: 'var(--red-dim)', border: '1px solid rgba(255,77,109,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ padding: '11px', background: loading ? 'rgba(0,212,170,0.5)' : 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s', marginTop: 4 }}
            >
              {loading ? 'Accesso in corso...' : 'Accedi'}
            </button>
          </form>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-2)', textAlign: 'center', lineHeight: 1.6 }}>
            Non hai un account? Contatta l'amministratore per ricevere le credenziali di accesso.
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono', monospace" }}>
          © 2026 AlphaDesk — Accesso riservato
        </div>
      </div>
    </div>
  )
}
