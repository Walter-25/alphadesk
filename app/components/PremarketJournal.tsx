'use client'
import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../lib/supabase'
import { EMOTION_TAGS } from './TradesAdvanced'

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
}

const EMPTY: JournalEntry = {
  entry_date: '', mood: null, energy: null, sleep_quality: null, self_confidence: null,
  life_events: '', intention: '', emotions: [],
}

const MOOD_ICONS = ['😞', '🙁', '😐', '🙂', '😄']
const ENERGY_ICONS = ['🪫', '🔋', '🔋', '🔋', '⚡']
const SLEEP_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕']
const CONFIDENCE_ICONS = ['😰', '😟', '😐', '🙂', '💪']

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function LevelSelector({ label, icons, value, onChange }: { label: string; icons: string[]; value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {icons.map((icon, i) => {
          const n = i + 1
          const active = value === n
          return (
            <button key={n} onClick={() => onChange(n)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-dim)' : 'var(--bg-2)', cursor: 'pointer', fontSize: 20, opacity: active ? 1 : 0.5, transition: 'all 0.15s' }}>
              {icon}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function PremarketJournal({ userId }: { userId: string }) {
  const entryDate = todayLocal()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(true)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<JournalEntry>({ ...EMPTY, entry_date: entryDate })

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
          emotions: data.entry.emotions || [],
        })
        setEditing(false)
        setSaved(true)
      }
    } catch (e: any) {
      setError(e?.message || 'Errore di caricamento')
    } finally {
      setLoading(false)
    }
  }, [userId, entryDate])

  useEffect(() => { load() }, [load])

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
    return <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>Caricamento...</div>
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--text-0)', marginBottom: 6 }}>
          ☀ Pre-Market
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Un momento prima di operare per fotografare come arrivi alla sessione. Serve a te, per riconoscere i tuoi pattern nel tempo.
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--red-dim)', color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {saved && !editing ? (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--green-dim)', color: 'var(--green)', fontSize: 12, fontWeight: 600, marginBottom: 20 }}>
            ✓ Check-in di oggi registrato
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
            <SummaryStat label="Come ti senti" icon={form.mood ? MOOD_ICONS[form.mood - 1] : '—'} value={form.mood} />
            <SummaryStat label="Energia" icon={form.energy ? ENERGY_ICONS[form.energy - 1] : '—'} value={form.energy} />
            <SummaryStat label="Sonno" icon={form.sleep_quality ? SLEEP_ICONS[form.sleep_quality - 1] : '—'} value={form.sleep_quality} />
            <SummaryStat label="Fiducia in te" icon={form.self_confidence ? CONFIDENCE_ICONS[form.self_confidence - 1] : '—'} value={form.self_confidence} />
          </div>

          {form.emotions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Emozioni</div>
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
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Cosa è successo prima di operare</div>
              <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{form.life_events}</div>
            </div>
          )}

          {form.intention && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Intenzione per la sessione</div>
              <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{form.intention}</div>
            </div>
          )}

          <button onClick={() => setEditing(true)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            Modifica check-in
          </button>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <LevelSelector label="Come ti senti" icons={MOOD_ICONS} value={form.mood} onChange={v => setForm(f => ({ ...f, mood: v }))} />
            <LevelSelector label="Energia" icons={ENERGY_ICONS} value={form.energy} onChange={v => setForm(f => ({ ...f, energy: v }))} />
            <LevelSelector label="Sonno" icons={SLEEP_ICONS} value={form.sleep_quality} onChange={v => setForm(f => ({ ...f, sleep_quality: v }))} />
            <LevelSelector label="Fiducia in te" icons={CONFIDENCE_ICONS} value={form.self_confidence} onChange={v => setForm(f => ({ ...f, self_confidence: v }))} />
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Emozioni</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {EMOTION_TAGS.map(tag => (
                <button key={tag.id} onClick={() => toggleEmotion(tag.id)}
                  style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${form.emotions.includes(tag.id) ? tag.color : 'var(--border)'}`, background: form.emotions.includes(tag.id) ? `${tag.color}22` : 'transparent', color: form.emotions.includes(tag.id) ? tag.color : 'var(--text-2)', cursor: 'pointer', fontSize: 11, fontWeight: form.emotions.includes(tag.id) ? 600 : 400 }}>
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Cosa è successo prima di operare oggi?</div>
            <textarea value={form.life_events} onChange={e => setForm(f => ({ ...f, life_events: e.target.value }))}
              placeholder="Eventi, imprevisti, discussioni, notizie che ti hanno toccato..."
              style={{ width: '100%', height: 80, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 13, padding: '10px 12px', resize: 'none', fontFamily: 'var(--font-body)', outline: 'none' }} />
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Intenzione per la sessione</div>
            <textarea value={form.intention} onChange={e => setForm(f => ({ ...f, intention: e.target.value }))}
              placeholder="Cosa vuoi portare con te in questa sessione..."
              style={{ width: '100%', height: 80, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-0)', fontSize: 13, padding: '10px 12px', resize: 'none', fontFamily: 'var(--font-body)', outline: 'none' }} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Salvataggio...' : 'Salva check-in di oggi'}
            </button>
            {saved && (
              <button onClick={() => setEditing(false)}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 13 }}>
                Annulla
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, icon, value }: { label: string; icon: string; value: number | null }) {
  return (
    <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--text-1)', marginTop: 2 }}>{value ?? '—'}/5</div>
    </div>
  )
}
