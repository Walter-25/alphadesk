'use client'
import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../lib/supabase'
import { EMOTION_TAGS } from './TradesAdvanced'
import { marketDaysBetween, describeGap, parseDateKey, isMarketDay } from '../lib/tradingDays'
import EmotionalInsights from './EmotionalInsights'
import type { useTrades } from '../lib/useTrades'

interface JournalEntry {
  id?: string
  entry_date: string
  mood: number | null
  energy: number | null
  sleep_quality: number | null
  self_confidence: number | null
  life_events: string
  intention: string
  emotions: string[]
  planned_break: boolean
}

const EMPTY: JournalEntry = {
  entry_date: '', mood: null, energy: null, sleep_quality: null, self_confidence: null,
  life_events: '', intention: '', emotions: [], planned_break: false,
}

const MOOD_ICONS = ['😞', '🙁', '😐', '🙂', '😄']
const ENERGY_ICONS = ['🪫', '🔅', '🔆', '🔋', '⚡']
const SLEEP_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕']
const CONFIDENCE_ICONS = ['😰', '😟', '😐', '🙂', '💪']

// Etichette testuali per ogni livello 1 a 5, mostrate sotto le icone per togliere ogni ambiguita'.
const MOOD_LABELS = ['Molto giu', 'Giu', 'Neutro', 'Bene', 'Ottimo']
const ENERGY_LABELS = ['Scarico', 'Fiacco', 'Nella media', 'Carico', 'Al massimo']
const SLEEP_LABELS = ['Pessimo', 'Poco', 'Sufficiente', 'Buono', 'Ottimo']
const CONFIDENCE_LABELS = ['Molto insicuro', 'Insicuro', 'Neutro', 'Fiducioso', 'Molto sicuro']

// Sottoinsieme di EMOTION_TAGS pertinente al PRIMA di operare: solo stati d'animo
// d'arrivo, non i comportamenti-di-trade (FOMO, revenge, overtrading, ecc.) che
// si taggano sul singolo trade in TradesAdvanced.
const PREMARKET_EMOTION_IDS = ['fear', 'anxiety', 'insecure', 'undervalued', 'overconfident', 'euphoric', 'hope', 'frustration', 'serene', 'patient']
const PREMARKET_EMOTIONS = EMOTION_TAGS.filter(t => PREMARKET_EMOTION_IDS.includes(t.id))

function dateKey(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayLocal(): string {
  return dateKey(new Date())
}

// Giorni di mercato strettamente tra due chiavi data (YYYY-MM-DD), estremi esclusi.
function marketDayKeysBetween(fromKey: string, toKey: string): string[] {
  const cur = parseDateKey(fromKey)
  const end = parseDateKey(toKey)
  cur.setDate(cur.getDate() + 1)
  const days: string[] = []
  while (cur < end) {
    if (isMarketDay(cur)) days.push(dateKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function LevelSelector({ label, icons, labels, value, onChange }: { label: string; icons: string[]; labels?: string[]; value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {icons.map((icon, i) => {
          const n = i + 1
          const active = value === n
          return (
            <button key={n} onClick={() => onChange(n)} title={labels ? labels[i] : undefined}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-dim)' : 'var(--bg-2)', cursor: 'pointer', fontSize: 28, opacity: active ? 1 : 0.65, transition: 'all 0.15s' }}>
              {icon}
            </button>
          )
        })}
      </div>
      {labels && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-1)' }}>
          <span>{labels[0]}</span>
          <span style={{ color: value ? 'var(--accent)' : 'var(--text-1)', fontWeight: value ? 700 : 500 }}>{value ? labels[value - 1] : ''}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  )
}

interface GapBanner { level: 'weekend' | 'short' | 'long'; label: string; marketDays: number }

export default function PremarketJournal({ userId, tradesHook }: { userId: string; tradesHook?: ReturnType<typeof useTrades> }) {
  const entryDate = todayLocal()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(true)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<JournalEntry>({ ...EMPTY, entry_date: entryDate })
  const [gapBanner, setGapBanner] = useState<GapBanner | null>(null)
  const [missingDays, setMissingDays] = useState<string[]>([])
  const [markingBreaks, setMarkingBreaks] = useState(false)
  const [missingDaysHandled, setMissingDaysHandled] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/premarket?userId=${userId}&date=${entryDate}`)
      const data = await res.json()
      if (data.entry) {
        setForm({
          entry_date: entryDate,
          mood: data.entry.mood, energy: data.entry.energy,
          sleep_quality: data.entry.sleep_quality, self_confidence: data.entry.self_confidence,
          life_events: data.entry.life_events || '', intention: data.entry.intention || '',
          emotions: data.entry.emotions || [], planned_break: !!data.entry.planned_break,
        })
        setEditing(false)
        setSaved(true)
      }

      // Rilevamento rientro: cerca l'ultima sessione NON di pausa pianificata prima di oggi
      const histRes = await authedFetch(`/api/premarket?userId=${userId}`)
      const histData = await histRes.json()
      const entries: any[] = histData.entries || []
      const lastNonBreak = entries.find(e => e.entry_date < entryDate && !e.planned_break)
      if (lastNonBreak) {
        const mkt = marketDaysBetween(parseDateKey(lastNonBreak.entry_date), parseDateKey(entryDate))
        const gap = describeGap(mkt)
        if (gap.level !== 'none') setGapBanner({ level: gap.level, label: gap.label, marketDays: mkt })

        // Promemoria pause non segnate: solo se oggi non è ancora stato compilato
        if (!data.entry) {
          const knownDates = new Set(entries.map(e => e.entry_date))
          const missing = marketDayKeysBetween(lastNonBreak.entry_date, entryDate).filter(d => !knownDates.has(d))
          if (missing.length > 0) setMissingDays(missing)
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Errore di caricamento')
    } finally {
      setLoading(false)
    }
  }, [userId, entryDate])

  useEffect(() => { load() }, [load])

  const markMissingAsBreak = async () => {
    setMarkingBreaks(true)
    try {
      for (const day of missingDays) {
        await authedFetch('/api/premarket', {
          method: 'POST',
          body: JSON.stringify({ ...EMPTY, userId, entry_date: day, planned_break: true }),
        })
      }
      setMissingDaysHandled(true)
      setMissingDays([])
    } catch (e: any) {
      setError(e?.message || 'Errore nel salvataggio delle pause')
    } finally {
      setMarkingBreaks(false)
    }
  }

  const toggleEmotion = (id: string) => {
    setForm(f => ({ ...f, emotions: f.emotions.includes(id) ? f.emotions.filter(e => e !== id) : [...f.emotions, id] }))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await authedFetch('/api/premarket', {
        method: 'POST',
        body: JSON.stringify({ userId, ...form, entry_date: entryDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel salvataggio')
      setSaved(true)
      setEditing(false)
    } catch (e: any) {
      setError(e?.message || 'Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>Caricamento...</div>
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--text-0)', marginBottom: 6 }}>
          ☀ Pre-Market
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5 }}>
          Un momento prima di operare per fotografare come arrivi alla sessione. Serve a te, per riconoscere i tuoi pattern nel tempo.
        </div>
      </div>

      {gapBanner && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--text-1)', fontSize: 14, lineHeight: 1.5, marginBottom: 16, border: '1px solid var(--accent)' }}>
          {gapBanner.level === 'long'
            ? <>Rientro dopo una pausa prolungata ({gapBanner.marketDays} giorni di mercato) — molti trader ripartono con size ridotta finché non ritrovano il ritmo. La scelta resta a te.</>
            : <>☀ Bentornato. {gapBanner.label}.</>}
        </div>
      )}

      {missingDays.length > 0 && !saved && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--border)', marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 10 }}>
            Nei giorni scorsi risultano {missingDays.length} giorni di mercato senza check-in né pausa segnata. Se erano pause volontarie puoi segnarle, così le statistiche restano pulite.
          </div>
          <button onClick={markMissingAsBreak} disabled={markingBreaks}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: markingBreaks ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: markingBreaks ? 0.6 : 1 }}>
            {markingBreaks ? 'Salvataggio...' : 'Segna quei giorni come pausa'}
          </button>
        </div>
      )}

      {missingDaysHandled && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--green-dim)', color: 'var(--green)', fontSize: 12, marginBottom: 16 }}>
          ✓ Giorni segnati come pausa
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--red-dim)', color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {saved && !editing ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--green-dim)', color: 'var(--green)', fontSize: 12, fontWeight: 600, marginBottom: 20 }}>
            ✓ {form.planned_break ? 'Pausa pianificata registrata per oggi' : 'Check-in di oggi registrato'}
          </div>

          {form.planned_break && (
            <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 16 }}>
              Giornata marcata come pausa volontaria — non verrà contata come sessione saltata.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
            <SummaryStat label="Come ti senti" icon={form.mood ? MOOD_ICONS[form.mood - 1] : '—'} value={form.mood} />
            <SummaryStat label="Energia" icon={form.energy ? ENERGY_ICONS[form.energy - 1] : '—'} value={form.energy} />
            {!form.planned_break && <SummaryStat label="Sonno" icon={form.sleep_quality ? SLEEP_ICONS[form.sleep_quality - 1] : '—'} value={form.sleep_quality} />}
            {!form.planned_break && <SummaryStat label="Fiducia in te" icon={form.self_confidence ? CONFIDENCE_ICONS[form.self_confidence - 1] : '—'} value={form.self_confidence} />}
          </div>

          {form.emotions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em', fontWeight: 600 }}>Emozioni</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {form.emotions.map(id => {
                  const tag = EMOTION_TAGS.find(t => t.id === id)
                  return tag ? <span key={id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: `${tag.color}22`, color: tag.color, fontWeight: 600 }}>{tag.label}</span> : null
                })}
              </div>
            </div>
          )}

          {form.life_events && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em', fontWeight: 600 }}>Cosa è successo prima di operare</div>
              <div style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{form.life_events}</div>
            </div>
          )}

          {!form.planned_break && form.intention && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em', fontWeight: 600 }}>Intenzione per la sessione</div>
              <div style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{form.intention}</div>
            </div>
          )}

          <button onClick={() => setEditing(true)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            Modifica check-in
          </button>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <button onClick={() => setForm(f => ({ ...f, planned_break: !f.planned_break }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px', borderRadius: 8, border: `1px solid ${form.planned_break ? 'var(--accent)' : 'var(--border)'}`, background: form.planned_break ? 'var(--accent-dim)' : 'var(--bg-3)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 18 }}>{form.planned_break ? '☑' : '☐'}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: form.planned_break ? 'var(--accent)' : 'var(--text-1)' }}>Oggi è un giorno di pausa pianificata (non opero)</span>
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-1)', marginTop: 6, lineHeight: 1.4 }}>
              Segna le pause volontarie così non vengono contate come sessioni saltate.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <LevelSelector label="Come ti senti" icons={MOOD_ICONS} labels={MOOD_LABELS} value={form.mood} onChange={v => setForm(f => ({ ...f, mood: v }))} />
            <LevelSelector label="Energia" icons={ENERGY_ICONS} labels={ENERGY_LABELS} value={form.energy} onChange={v => setForm(f => ({ ...f, energy: v }))} />
            {!form.planned_break && <LevelSelector label="Sonno" icons={SLEEP_ICONS} labels={SLEEP_LABELS} value={form.sleep_quality} onChange={v => setForm(f => ({ ...f, sleep_quality: v }))} />}
            {!form.planned_break && <LevelSelector label="Fiducia in te" icons={CONFIDENCE_ICONS} labels={CONFIDENCE_LABELS} value={form.self_confidence} onChange={v => setForm(f => ({ ...f, self_confidence: v }))} />}
          </div>

          {!form.planned_break && (
            <div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em', fontWeight: 600 }}>Emozioni</div>
              <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 10, lineHeight: 1.4 }}>
                Come ti senti arrivando alla sessione (gli schemi operativi come FOMO o revenge si taggano invece sul singolo trade).
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PREMARKET_EMOTIONS.map(tag => (
                  <button key={tag.id} onClick={() => toggleEmotion(tag.id)}
                    style={{ padding: '5px 10px', borderRadius: 5, border: `1px solid ${form.emotions.includes(tag.id) ? tag.color : 'var(--border)'}`, background: form.emotions.includes(tag.id) ? `${tag.color}22` : 'transparent', color: form.emotions.includes(tag.id) ? tag.color : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontWeight: form.emotions.includes(tag.id) ? 700 : 500 }}>
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em', fontWeight: 600 }}>Cosa è successo prima di operare oggi?</div>
            <textarea value={form.life_events} onChange={e => setForm(f => ({ ...f, life_events: e.target.value }))}
              placeholder="Eventi, imprevisti, discussioni, notizie che ti hanno toccato..."
              style={{ width: '100%', height: 80, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 13, padding: '10px 12px', resize: 'none', fontFamily: 'var(--font-body)', outline: 'none' }} />
          </div>

          {!form.planned_break && (
            <div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em', fontWeight: 600 }}>Intenzione per la sessione</div>
              <textarea value={form.intention} onChange={e => setForm(f => ({ ...f, intention: e.target.value }))}
                placeholder="Cosa vuoi portare con te in questa sessione..."
                style={{ width: '100%', height: 80, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 13, padding: '10px 12px', resize: 'none', fontFamily: 'var(--font-body)', outline: 'none' }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Salvataggio...' : 'Salva check-in di oggi'}
            </button>
            {saved && (
              <button onClick={() => setEditing(false)}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>
                Annulla
              </button>
            )}
          </div>
        </div>
      )}

      {tradesHook && (
        <div style={{ marginTop: 32 }}>
          <EmotionalInsights userId={userId} tradesHook={tradesHook} />
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, icon, value }: { label: string; icon: string; value: number | null }) {
  return (
    <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-1)', marginTop: 2, fontWeight: 600 }}>{value ?? '—'}/5</div>
    </div>
  )
}
