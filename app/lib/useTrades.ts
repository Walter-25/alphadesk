'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export interface Trade {
  id: string; ninja_id?: string; account: string; strategy: string
  instrument: string; direction: 'Long'|'Short'; entry_time: string
  exit_time: string; duration_min: number; entry_price: number
  exit_price: number; quantity: number; pnl: number
  commission: number; net_pnl: number; mae?: number; mfe?: number
  emotion_tags?: string[]; rule_followed?: boolean
  notes?: string; setup_quality?: number; source?: string
}

export interface PerfReport {
  totalNetProfit: number; grossProfit: number; grossLoss: number
  commission: number; profitFactor: number; maxDrawdown: number
  sharpeRatio: number; totalTrades: number; winRate: number
  winTrades: number; lossTrades: number; avgTrade: number
  avgWin: number; avgLoss: number; rrRatio: number
  maxConsecWin: number; maxConsecLoss: number
  largestWin: number; largestLoss: number; avgTimeInMarket: string
  startDate: string; endDate: string; avgMAE: number; avgMFE: number
  avgTradesPerDay: number; profitPerMonth: number
  longStats: { netProfit: number; winRate: number; trades: number }
  shortStats: { netProfit: number; winRate: number; trades: number }
}

export interface AccountSync {
  account: string; broker: string; last_sync: string; trade_count: number
}

export function useTrades(userId: string) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [perfReports, setPerfReports] = useState<Record<string, PerfReport>>({})
  const [syncs, setSyncs] = useState<AccountSync[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Carica tutto da Supabase al mount
  useEffect(() => {
    if (!userId) return
    loadAll()
  }, [userId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // Leggi prima da localStorage come base
      let localTrades: Trade[] = []
      let localPerf: Record<string, PerfReport> = {}
      try {
        const ls = localStorage.getItem('alphadesk_trades')
        if (ls) localTrades = JSON.parse(ls)
        const lp = localStorage.getItem('alphadesk_perf')
        if (lp) localPerf = JSON.parse(lp)
      } catch {}

      // Carica da Supabase
      const { data: tradesData, error: tradesError } = await supabase
        .from('trades').select('*').eq('user_id', userId)
        .order('entry_time', { ascending: false })

      if (!tradesError && tradesData && tradesData.length > 0) {
        // Supabase ha dati — merge con locale (locale può avere tag emotivi più aggiornati)
        const cloudMap = new Map(tradesData.map((t: any) => [t.ninja_id || t.id, t]))
        const localMap = new Map(localTrades.map((t: Trade) => [t.ninja_id || t.id, t]))
        // Unisce: cloud come base, locale sovrascrive se ha più dati emotivi
        const merged = tradesData.map((t: any) => {
          const local = localMap.get(t.ninja_id || t.id)
          if (local && (local.emotion_tags?.length || local.notes || local.rule_followed !== undefined)) {
            return { ...t, emotion_tags: local.emotion_tags, notes: local.notes,
              rule_followed: local.rule_followed, setup_quality: local.setup_quality }
          }
          return t
        })
        // Aggiungi trade locali non ancora su cloud
        localTrades.forEach((t: Trade) => {
          if (!cloudMap.has(t.ninja_id || t.id)) merged.push(t)
        })
        setTrades(merged)
        // Aggiorna localStorage con dati merged
        try { localStorage.setItem('alphadesk_trades', JSON.stringify(merged)) } catch {}
      } else if (localTrades.length > 0) {
        // Supabase vuoto o errore — usa locale
        setTrades(localTrades)
      }
      // Se nessun dato né locale né cloud, rimane array vuoto

      // Perf reports
      const { data: perfData } = await supabase
        .from('perf_reports').select('*').eq('user_id', userId)
      if (perfData && perfData.length > 0) {
        const map: Record<string, PerfReport> = {}
        perfData.forEach((r: any) => { map[r.account] = r.stats })
        // Merge con perf locali
        setPerfReports({ ...localPerf, ...map })
        try { localStorage.setItem('alphadesk_perf', JSON.stringify({ ...localPerf, ...map })) } catch {}
      } else if (Object.keys(localPerf).length > 0) {
        setPerfReports(localPerf)
      }

      // Syncs
      const { data: syncData } = await supabase
        .from('account_syncs').select('*').eq('user_id', userId)
      if (syncData) setSyncs(syncData)

    } catch (e: any) {
      setError(e.message)
      // In caso di errore totale Supabase, carica da locale
      try {
        const ls = localStorage.getItem('alphadesk_trades')
        if (ls) setTrades(JSON.parse(ls))
        const lp = localStorage.getItem('alphadesk_perf')
        if (lp) setPerfReports(JSON.parse(lp))
      } catch {}
    }
    setLoading(false)
  }, [userId])

  // Salva trades in Supabase (con fallback locale)
  const saveTrades = useCallback(async (newTrades: Trade[], account: string, source = 'csv') => {
    // Aggiorna subito lo stato locale (ottimistico)
    setTrades(prev => {
      const without = prev.filter(t => t.account !== account)
      return [...newTrades, ...without]
    })
    // Prova a salvare su Supabase
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: newTrades.map(t => ({ ...t, user_id: userId })), userId, account, source })
      })
      const result = await res.json()
      return result
    } catch {
      // Fallback: dati già in stato locale, ritorna success
      return { success: true, count: newTrades.length, local: true }
    }
  }, [userId])

  // Salva perf report in Supabase
  const savePerfReport = useCallback(async (account: string, stats: PerfReport, source = 'csv') => {
    await fetch('/api/trades/perf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, account, stats, source })
    })
    setPerfReports(prev => ({ ...prev, [account]: stats }))
  }, [userId])

  // Aggiorna singolo trade (tag emotivi, note, ecc.)
  const updateTrade = useCallback(async (id: string, updates: Partial<Trade>) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    await supabase.from('trades').update(updates).eq('id', id).eq('user_id', userId)
  }, [userId])

  // Rinomina account localmente
  const renameTrades = useCallback((oldName: string, newName: string) => {
    setTrades(prev => prev.map(t => t.account === oldName ? {...t, account: newName} : t))
    setPerfReports(prev => {
      if (!prev[oldName]) return prev
      const next = {...prev}
      next[newName] = next[oldName]
      delete next[oldName]
      return next
    })
  }, [])

  // Elimina tutti i trade di un account
  const deleteTrades = useCallback(async (account: string) => {
    setTrades(prev => prev.filter(t => t.account !== account))
    setPerfReports(prev => { const next = {...prev}; delete next[account]; return next })
    // Elimina da Supabase
    try {
      const { supabase: sb } = await import('./supabase')
      await sb.from('trades').delete().eq('user_id', userId).eq('account', account)
      await sb.from('perf_reports').delete().eq('user_id', userId).eq('account', account)
      await sb.from('account_syncs').delete().eq('user_id', userId).eq('account', account)
    } catch {}
  }, [userId])

  // Sync broker
  const syncBroker = useCallback(async (account: string, broker: string, config?: any) => {
    const res = await fetch('/api/trades/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, account, broker, config })
    })
    const result = await res.json()
    if (result.newTrades > 0) await loadAll()
    return result
  }, [userId, loadAll])

  // Statistiche aggregate multi-conto per dashboard
  // Legge sia trade singoli che perfReports (Summary)
  const getDashboardStats = useCallback((selectedAccounts: string[]) => {
    const accs = selectedAccounts.length === 0 ? undefined : selectedAccounts

    // --- Da trade singoli ---
    const relevant = trades.filter(t => !accs || accs.includes(t.account))

    // --- Da perfReports (Summary) ---
    const relevantReports = Object.entries(perfReports)
      .filter(([acc]) => !accs || accs.includes(acc))
      .map(([, r]) => r)

    // Se non ho né trade né report, return null
    if (relevant.length === 0 && relevantReports.length === 0) return null

    // Calcola da trade singoli se disponibili, altrimenti aggrega i summary
    let totalPnl = 0, winRate = 0, totalTrades = 0, rr = 0
    let recentPnl = 0, recentTrades = 0
    let equity: {date: string; value: number}[] = []
    let emotionData: {tag: string; pnl: number; wr: number; count: number}[] = []
    let disciplineData = { withRules: { pnl: 0, wr: 0, count: 0 }, withoutRules: { pnl: 0, wr: 0, count: 0 } }

    if (relevant.length > 0) {
      const wins = relevant.filter(t => t.net_pnl > 0)
      const losses = relevant.filter(t => t.net_pnl < 0)
      totalPnl = relevant.reduce((s, t) => s + t.net_pnl, 0)
      winRate = wins.length / relevant.length * 100
      totalTrades = relevant.length
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.net_pnl, 0) / wins.length : 0
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0) / losses.length) : 0
      rr = avgLoss > 0 ? avgWin / avgLoss : 0

      // Equity curve
      let cum = 0
      equity = [...relevant].reverse().slice(0, 60).map(t => {
        cum += t.net_pnl
        const raw = t.entry_time || ''
        const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
        const date = m ? `${m[1]}/${m[2]}` : raw.substring(0, 10)
        return { date, value: parseFloat(cum.toFixed(2)) }
      })

      // P&L ultimi 7 giorni (supporta date ISO e IT)
      const parseDate = (s: string) => {
        const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/)
        if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`)
        return new Date(s || '')
      }
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const recent = relevant.filter(t => { try { return parseDate(t.entry_time) > sevenDaysAgo } catch { return false } })
      recentPnl = recent.reduce((s, t) => s + t.net_pnl, 0)
      recentTrades = recent.length

      // Dati emotivi
      const tagMap: Record<string, {pnl: number; wins: number; count: number}> = {}
      relevant.forEach(t => {
        (t.emotion_tags || []).forEach(tag => {
          if (!tagMap[tag]) tagMap[tag] = {pnl: 0, wins: 0, count: 0}
          tagMap[tag].pnl += t.net_pnl
          tagMap[tag].count++
          if (t.net_pnl > 0) tagMap[tag].wins++
        })
      })
      emotionData = Object.entries(tagMap).map(([tag, v]) => ({
        tag, pnl: parseFloat(v.pnl.toFixed(2)),
        wr: parseFloat((v.wins / v.count * 100).toFixed(1)), count: v.count
      })).sort((a, b) => b.count - a.count).slice(0, 5)

      // Disciplina
      const withR = relevant.filter(t => t.rule_followed === true)
      const withoutR = relevant.filter(t => t.rule_followed === false)
      disciplineData = {
        withRules: { pnl: parseFloat(withR.reduce((s,t) => s+t.net_pnl, 0).toFixed(2)), wr: withR.length > 0 ? parseFloat((withR.filter(t=>t.net_pnl>0).length/withR.length*100).toFixed(1)) : 0, count: withR.length },
        withoutRules: { pnl: parseFloat(withoutR.reduce((s,t) => s+t.net_pnl, 0).toFixed(2)), wr: withoutR.length > 0 ? parseFloat((withoutR.filter(t=>t.net_pnl>0).length/withoutR.length*100).toFixed(1)) : 0, count: withoutR.length },
      }
    } else if (relevantReports.length > 0) {
      // Fallback su summary aggregati
      totalPnl = relevantReports.reduce((s, r) => s + r.totalNetProfit, 0)
      totalTrades = relevantReports.reduce((s, r) => s + r.totalTrades, 0)
      const totalWins = relevantReports.reduce((s, r) => s + r.winTrades, 0)
      winRate = totalTrades > 0 ? totalWins / totalTrades * 100 : 0
      rr = relevantReports.reduce((s, r) => s + r.rrRatio, 0) / relevantReports.length
      recentPnl = totalPnl // non abbiamo breakdown temporale dal summary
    }

    const allAccounts = [...new Set([
      ...relevant.map(t => t.account),
      ...Object.keys(perfReports)
    ])]

    return {
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      recentPnl: parseFloat(recentPnl.toFixed(2)),
      winRate: parseFloat(winRate.toFixed(1)),
      totalTrades,
      recentTrades,
      rr: parseFloat(rr.toFixed(2)),
      equity,
      emotionData,
      disciplineData,
      hasTrades: relevant.length > 0,
      hasReports: relevantReports.length > 0,
      accounts: accs || allAccounts,
    }
  }, [trades, perfReports])

  const accounts = [...new Set([...Object.keys(perfReports), ...trades.map(t => t.account)])]

  return { trades, perfReports, syncs, loading, error, accounts, saveTrades, savePerfReport, updateTrade, renameTrades, deleteTrades, syncBroker, getDashboardStats, reload: loadAll }
}
