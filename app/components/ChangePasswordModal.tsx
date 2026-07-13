'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const inp = { width: '100%', padding: '9px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)' } as React.CSSProperties
  const label = { fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.06em' } as React.CSSProperties

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) { setError('La password deve avere almeno 8 caratteri'); return }
    if (newPassword !== confirmPassword) { setError('Le password non coincidono'); return }
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (updateError) { setError(updateError.message); return }
    setSuccess(true)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ width: 360, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Cambia password</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        {success ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 16 }}>Password aggiornata con successo.</div>
            <button onClick={onClose} style={{ width: '100%', padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Chiudi</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={label}>Nuova password</label>
              <input style={inp} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} placeholder="min. 8 caratteri" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={label}>Conferma password</label>
              <input style={inp} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} placeholder="ripeti la password" />
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>Annulla</button>
              <button type="submit" disabled={loading} style={{ padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Salvataggio...' : 'Salva'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
