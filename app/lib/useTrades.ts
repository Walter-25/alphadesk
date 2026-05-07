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
      // Trades
      const { data: tradesData } = await supabase
        .from('trades').select('*').eq('user_id', userId)
        .order('entry_time', { ascending: false })
      if (tradesData) setTrades(tradesData)

      // Perf reports
      const { data: perfData } = await supabase
        .from('perf_reports').select('*').eq('user_id', userId)
      if (perfData) {
        const map: Record<string, PerfReport> = {}
        perfData.forEach((r: any) => { map[r.account] = r.stats })
        setPerfReports(map)
      }

      // Syncs
      const { data: syncData } = await supabase
        .from('account_syncs').select('*').eq('user_id', userId)
      if (syncData) setSyncs(syncData)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [userId])

  // Salva trades in Supabase
  const saveTrades = useCallback(async (newTrades: Trade[], account: string, source = 'csv') => {
    const res = await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades: newTrades.map(t => ({ ...t, user_id: userId })), userId, account, source })
    })
    const result = await res.json()
    if (result.success) {
      setTrades(prev => {
        const without = prev.filter(t => t.account !== account)
        return [...newTrades, ...without]
      })
    }
    return result
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
  const getDashboardStats = useCallback((selectedAccounts: string[]) => {
    const relevant = selectedAccounts.length === 0
      ? trades
      : trades.filter(t => selectedAccounts.includes(t.account))
    if (relevant.length === 0) return null
    const wins = relevant.filter(t => t.net_pnl > 0)
    const totalPnl = relevant.reduce((s, t) => s + t.net_pnl, 0)
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.net_pnl, 0) / wins.length : 0
    const avgLoss = relevant.filter(t => t.net_pnl < 0).length > 0
      ? Math.abs(relevant.filter(t => t.net_pnl < 0).reduce((s, t) => s + t.net_pnl, 0) / relevant.filter(t => t.net_pnl < 0).length) : 0

    // Equity curve ultimi 30 trade
    let cum = 0
    const equity = [...relevant].reverse().slice(0, 60).map(t => {
      cum += t.net_pnl
      return { date: t.entry_time?.split('T')[0] || t.entry_time?.split(' ')[0] || '', value: parseFloat(cum.toFixed(2)) }
    })

    // P&L ultimi 7 giorni
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recent = relevant.filter(t => t.entry_time && new Date(t.entry_time) > sevenDaysAgo)
    const recentPnl = recent.reduce((s, t) => s + t.net_pnl, 0)

    return {
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      recentPnl: parseFloat(recentPnl.toFixed(2)),
      winRate: parseFloat((wins.length / relevant.length * 100).toFixed(1)),
      totalTrades: relevant.length,
      recentTrades: recent.length,
      rr: avgLoss > 0 ? parseFloat((avgWin / avgLoss).toFixed(2)) : 0,
      equity,
      accounts: [...new Set(relevant.map(t => t.account))],
    }
  }, [trades])

  const accounts = [...new Set([...Object.keys(perfReports), ...trades.map(t => t.account)])]

  return { trades, perfReports, syncs, loading, error, accounts, saveTrades, savePerfReport, updateTrade, syncBroker, getDashboardStats, reload: loadAll }
}
