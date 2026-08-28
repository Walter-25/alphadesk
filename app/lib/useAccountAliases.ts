'use client'
import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from './supabase'

// Alias conto persistente e display-only (Fase 1): il nome tecnico del conto
// (colonna `account` dei trade, dentro il ninja_id) resta l'identita'
// immutabile usata per dedup/filtri/query. Questo hook espone solo
// un'etichetta per la visualizzazione — non riscrive mai i trade.
export function useAccountAliases(userId: string) {
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await authedFetch(`/api/account-aliases?userId=${userId}`)
      const data = await res.json()
      const map: Record<string, string> = {}
      for (const row of data.aliases || []) map[row.account] = row.display_name
      setAliases(map)
    } catch {
      // Silenzioso: senza alias si mostra il nome tecnico, nessuna regressione.
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const displayAccount = useCallback(
    (technical: string) => aliases[technical] || technical,
    [aliases]
  )

  // Nome uguale al tecnico (o vuoto) -> rimuove l'alias invece di salvarne uno inutile.
  const setAlias = useCallback(async (account: string, displayName: string) => {
    const trimmed = displayName.trim()
    if (!trimmed || trimmed === account) {
      setAliases(prev => { const next = { ...prev }; delete next[account]; return next })
      try {
        await authedFetch('/api/account-aliases', { method: 'DELETE', body: JSON.stringify({ userId, account }) })
      } catch {}
      return
    }
    setAliases(prev => ({ ...prev, [account]: trimmed }))
    try {
      await authedFetch('/api/account-aliases', {
        method: 'POST',
        body: JSON.stringify({ userId, account, displayName: trimmed }),
      })
    } catch {}
  }, [userId])

  const removeAlias = useCallback(async (account: string) => {
    setAliases(prev => { const next = { ...prev }; delete next[account]; return next })
    try {
      await authedFetch('/api/account-aliases', { method: 'DELETE', body: JSON.stringify({ userId, account }) })
    } catch {}
  }, [userId])

  return { aliases, loading, displayAccount, setAlias, removeAlias, reload: load }
}
