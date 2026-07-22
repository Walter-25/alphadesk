// Utility pure per ragionare sui giorni di mercato (lun-ven).
// Semplificazione voluta: i festivi di borsa NON sono gestiti, solo sabato/domenica.
// Si potrà raffinare in futuro con un calendario festività, se servirà.

export function isMarketDay(date: Date): boolean {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

// Conta i giorni di mercato (lun-ven) strettamente compresi tra due date,
// esclusi gli estremi (from e to stessi non vengono conteggiati).
export function marketDaysBetween(from: Date, to: Date): number {
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  cur.setDate(cur.getDate() + 1)
  let count = 0
  while (cur < end) {
    if (isMarketDay(cur)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export function describeGap(marketDays: number): { level: 'none' | 'weekend' | 'short' | 'long'; label: string } {
  if (marketDays <= 0) return { level: 'none', label: '' }
  if (marketDays === 1) return { level: 'weekend', label: 'Prima sessione dopo la pausa' }
  if (marketDays <= 4) return { level: 'short', label: 'Rientro dopo qualche giorno di pausa' }
  return { level: 'long', label: 'Rientro dopo una pausa prolungata — riparti con gradualità' }
}

// Converte una chiave data locale "YYYY-MM-DD" (come da colonna entry_date) in un Date a mezzanotte.
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
