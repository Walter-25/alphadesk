// ─────────────────────────────────────────────────────────────────────────────
//  Parser dell'export "Trading Journal" di ATAS (.xlsx, foglio "Journal").
//
//  Obiettivo: produrre trade con lo STESSO ninja_id del Bridge, così import
//  storico e invio live sullo stesso conto NON creano doppioni (upsert merge).
//
//  Integrazione consigliata (zero nuova logica backend):
//    per ogni oggetto restituito -> POST a /api/ingest (lo stesso endpoint del
//    Bridge). La route riconosce source:'AtasBridge', costruisce
//    ninja_id = `atas-${trade_uid}`, applica il fallback commissioni e fa
//    l'upsert su (ninja_id, user_id). Il trade_uid qui NON ha il prefisso
//    "atas-" proprio perche' lo antepone la route (come per il Bridge).
//
//  Verificato sul file reale: 9 righe -> 6 merge / 3 nuovi (tz Europe/Rome).
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx';

const NET_EPOCH_OFFSET = 62135596800; // secondi tra 0001-01-01 (epoca .NET/Bridge) e 1970-01-01
const CONTRACT_SUFFIX = /[FGHJKMNQUVXZ]\d{1,2}$/; // mese+anno del contratto (ESU6 -> ES)

export interface AtasIngestPayload {
  source: 'AtasBridge';
  platform: 'atas';
  trade_uid: string;        // senza prefisso "atas-": lo aggiunge la route
  account: string;
  instrument: string;       // root, es. "ES"
  instrument_base: string;  // idem (la route usa instrument_base || instrument)
  direction: 'Long' | 'Short';
  entry_quantity: number;
  entry_avg_price: number;
  exit_avg_price: number;
  gross_pnl: number;
  net_pnl: number;
  commission_total: 0;      // 0 -> scatta il fallback commission_settings
  profit_ticks: number;
  entry_time: string;       // ISO UTC
  exit_time: string;        // ISO UTC
  entry_name: string;       // strategia
}

export interface ParseOptions {
  /** Timezone in cui ATAS mostrava gli orari nel file (es. "Europe/Rome").
   *  Serve a convertire local->UTC e allineare l'uid al Bridge. */
  timeZone: string;
  /** Strategia da applicare quando la colonna Comment e' vuota. Default "ATAS". */
  defaultStrategy?: string;
}

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; }

/** Legge una cella data del foglio (numero seriale Excel, Date, o stringa) in wall-clock. */
function readWall(cell: unknown): Wall {
  if (typeof cell === 'number') {
    const ms = Math.round((cell - 25569) * 86400 * 1000); // 25569 = 1899-12-30 -> 1970-01-01
    const d = new Date(ms); // il seriale e' un wall-clock: leggo i campi UTC
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  if (cell instanceof Date) {
    // SheetJS con cellDates:true codifica il wall-clock nei campi UTC
    return { y: cell.getUTCFullYear(), mo: cell.getUTCMonth() + 1, d: cell.getUTCDate(), h: cell.getUTCHours(), mi: cell.getUTCMinutes(), s: cell.getUTCSeconds() };
  }
  const m = String(cell).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Data non riconosciuta: ${cell}`);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0) };
}

/** Wall-clock in `tz` -> Date UTC. Nessuna dipendenza esterna: usa Intl e gestisce il DST. */
function wallClockToUtc(w: Wall, tz: string): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(guess))) p[part.type] = part.value;
  let hh = +p.hour; if (hh === 24) hh = 0; // en-US puo' emettere "24" a mezzanotte
  const asSeenUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute, +p.second);
  return new Date(guess - (asSeenUtc - guess));
}

function netSeconds(utc: Date): number {
  return Math.floor(utc.getTime() / 1000) + NET_EPOCH_OFFSET;
}

/** "ESU6@CME" -> "ES", "NQU6" -> "NQ", "M2K" -> "M2K". */
function root(instrument: string): string {
  const s = instrument.split('@')[0].trim();
  const m = s.match(CONTRACT_SUFFIX);
  return m ? s.slice(0, m.index) : s;
}

/**
 * Legge il buffer .xlsx dell'export ATAS e restituisce i payload pronti per /api/ingest.
 * @param fileBuf  ArrayBuffer / Buffer del file .xlsx
 */
export function parseAtasJournal(fileBuf: ArrayBuffer | Buffer, opts: ParseOptions): AtasIngestPayload[] {
  const wb = XLSX.read(fileBuf, { type: fileBuf instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: false });
  const ws = wb.Sheets['Journal'];
  if (!ws) throw new Error('Foglio "Journal" non trovato: e\' davvero un export ATAS Trading Journal?');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const strategy = opts.defaultStrategy?.trim() || 'ATAS';
  const out: AtasIngestPayload[] = [];

  // Colonne (riga 0 = header): Account, Instrument, Open time, Open price, Open volume,
  // Close time, Close price, Close volume, Price PnL, Profit (ticks), PnL, Comment
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] == null) continue;

    const account = String(r[0]).trim();
    const datedCode = String(r[1]).split('@')[0].trim(); // "ESU6" (per l'uid)
    const openVol = Number(r[4]);                        // con segno: >0 Long, <0 Short
    if (!account || !datedCode || !openVol) continue;

    const openUtc = wallClockToUtc(readWall(r[2]), opts.timeZone);
    const closeUtc = wallClockToUtc(readWall(r[5]), opts.timeZone);
    const pnl = Number(r[10]);

    // STESSA formula del Bridge C#: {account}-{codiceDatato}-{openSec}-{closeSec}-{volumeConSegno}
    const tradeUid = `${account}-${datedCode}-${netSeconds(openUtc)}-${netSeconds(closeUtc)}-${openVol}`;

    out.push({
      source: 'AtasBridge',
      platform: 'atas',
      trade_uid: tradeUid,
      account,
      instrument: root(datedCode),
      instrument_base: root(datedCode),
      direction: openVol > 0 ? 'Long' : 'Short',
      entry_quantity: Math.abs(openVol),
      entry_avg_price: Number(r[3]),
      exit_avg_price: Number(r[6]),
      gross_pnl: pnl,
      net_pnl: pnl,
      commission_total: 0,
      profit_ticks: Number(r[9]),
      entry_time: openUtc.toISOString(),
      exit_time: closeUtc.toISOString(),
      entry_name: (r[11] ? String(r[11]).trim() : '') || strategy,
    });
  }

  return out;
}
