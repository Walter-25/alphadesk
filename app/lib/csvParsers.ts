// ─── TIPI ─────────────────────────────────────────────────────────────────────
export interface Trade {
  id: string; ninja_id?: string; account: string; strategy: string
  instrument: string; direction: 'Long'|'Short'; entry_time: string
  exit_time: string; duration_min: number; entry_price: number
  exit_price: number; quantity: number; pnl: number; commission: number
  net_pnl: number; mae?: number; mfe?: number
  emotion_tags?: string[]; rule_followed?: boolean; notes?: string; setup_quality?: number
  screenshot_1_url?: string | null; screenshot_2_url?: string | null
}

export function parseNinjaTradeList(text: string, account: string): Trade[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const sep = text.includes(';') ? ';' : ','
  const header = lines[0].replace(/\r/,'').split(sep).map(h => h.trim().toLowerCase().replace(/"/g,''))

  // Formato compatto (es. export DeepTrade): Symbol;DT;Quantity;Entry;Exit;ProfitLoss
  // Una riga per trade già chiuso: solo data (niente orario), Entry/Exit sono prezzi, nessuna colonna direzione.
  const isCompact = header.includes('symbol') && header.includes('dt') && header.includes('quantity')
    && header.includes('entry') && header.includes('exit') && header.some(h => h.includes('profit'))
  if (isCompact) {
    const iSymbol = header.indexOf('symbol'), iDate = header.indexOf('dt'), iQty = header.indexOf('quantity')
    const iEntry = header.indexOf('entry'), iExit = header.indexOf('exit'), iPnl = header.findIndex(h => h.includes('profit'))
    const trades: Trade[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/\r/,'').split(sep)
      if (cols.length < header.length) continue
      const symbol = cols[iSymbol]?.trim() || 'N/A'
      const dateStr = cols[iDate]?.trim() || ''
      const qty = parseInt(cols[iQty]) || 1
      const entryPrice = parseFloat(cols[iEntry]) || 0
      const exitPrice = parseFloat(cols[iExit]) || 0
      const pnl = parseFloat(cols[iPnl]) || 0
      // Nessuna colonna direzione: la deduciamo dal segno del movimento prezzo vs segno del P&L
      const priceMove = exitPrice - entryPrice
      const direction: 'Long' | 'Short' = (priceMove >= 0) === (pnl >= 0) ? 'Long' : 'Short'
      // Solo data disponibile (niente orario) — mezzogiorno come orario di default
      const d = new Date(`${dateStr}T12:00:00`)
      const iso = isNaN(d.getTime()) ? dateStr : d.toISOString()
      trades.push({
        id: `${account}-${i}`, ninja_id: `${account}-CD-${symbol}-${dateStr}-${i}`, account,
        strategy: 'Manual', instrument: symbol, direction,
        entry_time: iso, exit_time: iso, duration_min: 0,
        entry_price: entryPrice, exit_price: exitPrice, quantity: qty,
        pnl, commission: 0, net_pnl: pnl,
        emotion_tags: [], rule_followed: undefined, notes: '',
      })
    }
    return trades
  }

  // Detect formato: Trades vs Executions vs altro
  const isNTTrades = header.includes('trade number') || header.includes('entry time')
  const isNTExec = header.includes('action') && header.includes('e/x')

  // Parser numeri formato IT: "25.014,00 $" o "-85,50 $" o "25014,00"
  const pn = (s: string) => {
    if (!s) return 0
    const clean = s.replace(/\./g,'').replace(',','.').replace(/[^0-9.\-]/g,'')
    return parseFloat(clean) || 0
  }

  const get = (cols: string[], keys: string[]) => {
    for (const k of keys) {
      const idx = header.findIndex(h => h.includes(k))
      if (idx >= 0 && cols[idx]?.trim()) return cols[idx].trim().replace(/"/g,'')
    }; return ''
  }

  // Formato NinjaTrader Trades (Trade number;Instrument;Account;Strategy;Market pos.;...)
  if (isNTTrades) {
    const trades: Trade[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/\r/,'').split(sep)
      if (cols.length < 10) continue
      const entryStr = get(cols, ['entry time'])
      const exitStr = get(cols, ['exit time'])
      const e1 = new Date(entryStr), e2 = new Date(exitStr)
      // Gestisce formato data italiano: "09/04/2026 16:10:56"
      const parseDate = (s: string) => {
        const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
        if (m) return new Date(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`) // spazio = ora locale, non UTC
        return new Date(s)
      }
      const d1 = parseDate(entryStr), d2 = parseDate(exitStr)
      const dur = !isNaN(d1.getTime())&&!isNaN(d2.getTime()) ? Math.round((d2.getTime()-d1.getTime())/60000) : 0
      const dirRaw = get(cols, ['market pos','direction','side']) || 'Long'
      const pnl = pn(get(cols, ['profit']))
      const comm = pn(get(cols, ['commission']))
      const mae = pn(get(cols, ['mae']))
      const mfe = pn(get(cols, ['mfe']))
      trades.push({
        id: `${account}-${i}`,
        ninja_id: `${account}-NT-${get(cols,['trade number'])||i}-${entryStr.replace(/[^0-9]/g,'').slice(0,12)}`,
        account,
        strategy: get(cols, ['strategy']) || 'Manual',
        instrument: get(cols, ['instrument']) || 'N/A',
        direction: dirRaw.toLowerCase().includes('short') ? 'Short' : 'Long',
        entry_time: d1.toISOString(),
        exit_time: d2.toISOString(),
        duration_min: dur,
        entry_price: pn(get(cols, ['entry price'])),
        exit_price: pn(get(cols, ['exit price'])),
        quantity: parseInt(get(cols, ['qty'])) || 1,
        pnl: pnl + comm, commission: comm, net_pnl: pnl, // Profit CSV è già netto; pnl lordo = netto + comm
        mae: mae || undefined,
        mfe: mfe || undefined,
        emotion_tags: [], rule_followed: undefined, notes: '',
      })
    }
    return trades
  }

  // Formato Executions — raggruppa per posizione
  if (isNTExec) {
    const entries: any[] = [], exits: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].replace(/\r/,'').split(sep)
      if (cols.length < 7) continue
      const ex = get(cols, ['e/x'])
      const parseDate = (s: string) => {
        const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
        if (m) return new Date(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`) // spazio = ora locale, non UTC
        return new Date(s)
      }
      const row = {
        instrument: get(cols, ['instrument']),
        action: get(cols, ['action']),
        qty: parseInt(get(cols, ['quantity'])) || 1,
        price: pn(get(cols, ['price'])),
        time: parseDate(get(cols, ['time'])),
        comm: pn(get(cols, ['commission'])),
        account: get(cols, ['account']) || account,
        exType: ex,
      }
      if (ex.toLowerCase().includes('entry')) entries.push(row)
      else exits.push(row)
    }
    // Abbina entry/exit
    const trades: Trade[] = []
    entries.forEach((en, i) => {
      const ex = exits.find(x => x.instrument === en.instrument && x.time >= en.time) || exits[i]
      if (!ex) return
      const dur = ex ? Math.round((ex.time.getTime()-en.time.getTime())/60000) : 0
      const pnl = ex ? (en.action.toLowerCase()==='sell'
        ? (en.price-ex.price)*en.qty*2  // MNQ = 2$/tick
        : (ex.price-en.price)*en.qty*2) : 0
      trades.push({
        id: `${account}-ex-${i}`,
        ninja_id: `${account}-EX-${i}`,
        account: en.account || account,
        strategy: 'Manual',
        instrument: en.instrument || 'N/A',
        direction: en.action.toLowerCase()=='sell'?'Short':'Long',
        entry_time: en.time.toISOString(),
        exit_time: ex?.time.toISOString() || en.time.toISOString(),
        duration_min: dur,
        entry_price: en.price, exit_price: ex?.price || 0,
        quantity: en.qty,
        pnl: parseFloat(pnl.toFixed(2)),
        commission: (en.comm||0)+(ex?.comm||0),
        net_pnl: parseFloat((pnl-(en.comm||0)-(ex?.comm||0)).toFixed(2)),
        emotion_tags: [], rule_followed: undefined, notes: '',
      })
    })
    return trades
  }

  // Formato generico fallback
  const trades: Trade[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r/,'').split(sep)
    if (cols.length < 4) continue
    const pnl = pn(get(cols,['profit','pnl','p&l','net profit']))
    const comm = pn(get(cols,['commission','comm']))
    const entryStr = get(cols,['entry time','time'])
    const exitStr = get(cols,['exit time'])
    const parseDate = (s: string) => {
      const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/)
      if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`)
      return new Date(s)
    }
    const d1 = parseDate(entryStr), d2 = parseDate(exitStr || entryStr)
    const dur = !isNaN(d1.getTime())&&!isNaN(d2.getTime()) ? Math.round((d2.getTime()-d1.getTime())/60000) : 0
    const dirRaw = get(cols,['market pos','direction','side','action']) || 'Long'
    trades.push({
      id: `${account}-${i}`, ninja_id: `${account}-G-${i}`, account,
      strategy: get(cols,['strategy']) || 'Manual',
      instrument: get(cols,['instrument','market','symbol']) || 'N/A',
      direction: dirRaw.toLowerCase().includes('short')||dirRaw.toLowerCase()==='sell'?'Short':'Long',
      entry_time: isNaN(d1.getTime())?entryStr:d1.toISOString(),
      exit_time: isNaN(d2.getTime())?exitStr:d2.toISOString(),
      duration_min: dur,
      entry_price: pn(get(cols,['entry price','price'])),
      exit_price: pn(get(cols,['exit price'])),
      quantity: parseInt(get(cols,['qty','quantity','size'])) || 1,
      pnl, commission: comm, net_pnl: pnl-comm,
      mae: pn(get(cols,['mae']))||undefined,
      mfe: pn(get(cols,['mfe']))||undefined,
      emotion_tags: [], rule_followed: undefined, notes: '',
    })
  }
  return trades
}
