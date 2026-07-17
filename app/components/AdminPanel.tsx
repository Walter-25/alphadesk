'use client'
import { useState, useEffect } from 'react'
import { supabase, authedFetch } from '../lib/supabase'
interface ManagedUser { id: string; email: string; full_name: string; role: string; created_at: string }
export default function AdminPanel({ currentUser }: { currentUser: any }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState(''); const [newName, setNewName] = useState(''); const [newRole, setNewRole] = useState<'admin'|'trader'>('trader')
  const [loading, setLoading] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const [resetting, setResetting] = useState<string>('')
  useEffect(() => { loadUsers() }, [])
  const loadUsers = async () => { const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }); if (data) setUsers(data) }
  const createUser = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(''); setMessage('')
    try {
      const res = await authedFetch('/api/admin/create-user', { method: 'POST', body: JSON.stringify({ email: newEmail, full_name: newName, role: newRole }) })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Errore')
      setMessage(`Invito inviato a ${newEmail} — riceverà una mail per impostare la propria password`); setNewEmail(''); setNewName(''); setNewRole('trader'); setShowCreate(false); loadUsers()
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }
  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`Eliminare ${email}? Verranno eliminati anche tutti i suoi trade e dati.`)) return
    setError(''); setMessage('')
    try {
      const res = await authedFetch('/api/admin/delete-user', { method: 'POST', body: JSON.stringify({ userId }) })
      let result: any = {}
      try { result = await res.json() } catch { throw new Error(`Risposta non valida dal server (HTTP ${res.status})`) }
      if (!res.ok) throw new Error(result.error || `Errore HTTP ${res.status}`)
      setMessage(`Account ${email} eliminato con tutti i suoi dati`)
    } catch (err: any) { setError(`Eliminazione fallita: ${err.message}`) }
    loadUsers()
  }
  const resetPassword = async (email: string) => {
    setResetting(email); setError(''); setMessage('')
    try {
      const res = await authedFetch('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ email }) })
      let result: any = {}
      try { result = await res.json() } catch { throw new Error(`Risposta non valida dal server (HTTP ${res.status}) — probabile versione del sito non aggiornata`) }
      if (!res.ok) throw new Error(result.error || `Errore HTTP ${res.status}`)
      setMessage(`Email di reset password inviata a ${email}`)
    } catch (err: any) { setError(`Reset fallito: ${err.message}`) }
    setResetting('')
  }
  const inp = { width:'100%',padding:'9px 12px',background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-0)',fontSize:13,outline:'none',fontFamily:'var(--font-body)' } as React.CSSProperties
  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:22,letterSpacing:'-0.02em'}}>Gestione utenti</div><div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>Solo tu puoi creare o rimuovere accessi</div></div>
        <button onClick={()=>setShowCreate(!showCreate)} style={{padding:'8px 16px',background:'var(--accent)',border:'none',borderRadius:8,color:'#000',fontSize:13,fontWeight:700,cursor:'pointer'}}>+ Nuovo utente</button>
      </div>
      {message && <div style={{padding:'10px 14px',background:'var(--green-dim)',border:'1px solid rgba(0,212,170,0.3)',borderRadius:8,fontSize:13,color:'var(--accent)'}}>{message}</div>}
      {error && <div style={{padding:'10px 14px',background:'var(--red-dim)',border:'1px solid rgba(255,77,109,0.3)',borderRadius:8,fontSize:13,color:'var(--red)'}}>{error}</div>}
      {showCreate && (
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,padding:20}}>
          <div style={{fontSize:14,fontWeight:500,marginBottom:16}}>Crea nuovo utente</div>
          <form onSubmit={createUser} style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div style={{display:'flex',flexDirection:'column',gap:5}}><label style={{fontSize:11,color:'var(--text-2)',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.06em'}}>Nome completo</label><input style={inp} value={newName} onChange={e=>setNewName(e.target.value)} required placeholder="Mario Rossi" /></div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}><label style={{fontSize:11,color:'var(--text-2)',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.06em'}}>Email</label><input style={inp} type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} required placeholder="mario@email.com" /></div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}><label style={{fontSize:11,color:'var(--text-2)',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.06em'}}>Ruolo</label><select style={inp} value={newRole} onChange={e=>setNewRole(e.target.value as any)}><option value="trader">Trader</option><option value="admin">Admin</option></select></div>
            <div style={{gridColumn:'1/-1',fontSize:11,color:'var(--text-2)'}}>L'utente riceverà una email con un link per impostare la propria password.</div>
            <div style={{gridColumn:'1/-1',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button type="button" onClick={()=>setShowCreate(false)} style={{padding:'8px 16px',background:'transparent',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-1)',cursor:'pointer',fontSize:13}}>Annulla</button>
              <button type="submit" disabled={loading} style={{padding:'8px 16px',background:'var(--accent)',border:'none',borderRadius:8,color:'#000',fontSize:13,fontWeight:700,cursor:'pointer'}}>{loading?'Invio invito...':'Invia invito'}</button>
            </div>
          </form>
        </div>
      )}
      <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 100px 100px 170px',padding:'10px 16px',borderBottom:'1px solid var(--border)',fontSize:10,fontFamily:"'DM Mono',monospace",color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.06em'}}><div>Nome</div><div>Email</div><div>Ruolo</div><div>Creato</div><div></div></div>
        {users.map(u=>(
          <div key={u.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 100px 100px 170px',padding:'12px 16px',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:500}}>{u.full_name}</div>
            <div style={{fontSize:12,color:'var(--text-1)'}}>{u.email}</div>
            <div><span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500,fontFamily:"'DM Mono',monospace",background:u.role==='admin'?'var(--blue-dim)':'var(--accent-dim)',color:u.role==='admin'?'var(--blue)':'var(--accent)'}}>{u.role}</span></div>
            <div style={{fontSize:11,color:'var(--text-2)'}}>{new Date(u.created_at).toLocaleDateString('it-IT')}</div>
            <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
              <button onClick={()=>resetPassword(u.email)} disabled={resetting===u.email} style={{padding:'4px 8px',background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-1)',cursor:'pointer',fontSize:11}}>{resetting===u.email?'Invio...':'Reimposta password'}</button>
              {u.id!==currentUser.id&&<button onClick={()=>deleteUser(u.id,u.email)} style={{padding:'4px 8px',background:'var(--red-dim)',border:'1px solid rgba(255,77,109,0.2)',borderRadius:6,color:'var(--red)',cursor:'pointer',fontSize:11}}>Rimuovi</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
