'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
export default function LoginPage({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError('Credenziali non valide.'); setLoading(false); return }
    if (data.user) onLogin(data.user); setLoading(false)
  }
  const inp = { width:'100%',padding:'10px 14px',background:'var(--bg-3)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-0)',fontSize:14,outline:'none' } as React.CSSProperties
  return (
    <div style={{minHeight:'100vh',background:'var(--bg-0)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:'100%',maxWidth:420,padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:40}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:32,letterSpacing:'-0.02em'}}>Alpha<span style={{color:'var(--accent)'}}>Desk</span></div>
          <div style={{fontSize:11,color:'var(--text-2)',fontFamily:"'DM Mono',monospace",letterSpacing:'0.12em',marginTop:4}}>ANALYSIS · REVIEW · EDGE</div>
        </div>
        <div style={{background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:16,padding:'32px 28px'}}>
          <div style={{fontSize:18,fontWeight:600,marginBottom:4}}>Accedi alla piattaforma</div>
          <div style={{fontSize:13,color:'var(--text-2)',marginBottom:24}}>Inserisci le credenziali fornite dall'amministratore</div>
          <form onSubmit={handleLogin} style={{display:'flex',flexDirection:'column',gap:16}}>
            <div><label style={{display:'block',fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text-2)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="nome@email.com" style={inp} /></div>
            <div><label style={{display:'block',fontSize:11,fontFamily:"'DM Mono',monospace",color:'var(--text-2)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••" style={inp} /></div>
            {error && <div style={{padding:'10px 14px',background:'var(--red-dim)',border:'1px solid rgba(255,77,109,0.3)',borderRadius:8,fontSize:13,color:'var(--red)'}}>{error}</div>}
            <button type="submit" disabled={loading} style={{padding:11,background:loading?'rgba(0,212,170,0.5)':'var(--accent)',border:'none',borderRadius:8,color:'#000',fontSize:14,fontWeight:700,cursor:'pointer',marginTop:4}}>{loading?'Accesso...':'Accedi'}</button>
          </form>
          <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--border)',fontSize:12,color:'var(--text-2)',textAlign:'center'}}>Non hai un account? Contatta l'amministratore.</div>
        </div>
        <div style={{textAlign:'center',marginTop:20,fontSize:11,color:'var(--text-2)',fontFamily:"'DM Mono',monospace"}}>© 2026 AlphaDesk — Accesso riservato</div>
      </div>
    </div>
  )
}
