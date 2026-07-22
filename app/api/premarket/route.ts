import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../lib/supabase-server'

// GET /api/premarket?userId=<uuid>&date=YYYY-MM-DD
// Con date: ritorna { entry } (la voce del giorno) o { entry: null }.
// Senza date: ritorna le ultime 30 voci come { entries: [...] } (entry_date desc).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const date = searchParams.get('date')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const authedUser = await getAuthedUser(req)
    if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

    const sb = admin()

    if (date) {
      const { data, error } = await sb
        .from('premarket_journal')
        .select('*')
        .eq('user_id', userId)
        .eq('entry_date', date)
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ entry: data ?? null })
    }

    const { data, error } = await sb
      .from('premarket_journal')
      .select('*')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false })
      .limit(30)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ entries: data ?? [] })
  } catch (e: any) {
    console.error('premarket GET error:', e)
    return NextResponse.json({ error: `internal: ${e?.message || String(e)}` }, { status: 500 })
  }
}

// POST /api/premarket
// Body: { userId, entry_date, mood, energy, sleep_quality, self_confidence, life_events, intention, emotions }
// Upsert su (user_id, entry_date). Risposta { success, entry }.
export async function POST(req: NextRequest) {
  try {
    let body: any = {}
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'JSON non valido' }, { status: 400 }) }

    const { userId, entry_date, mood, energy, sleep_quality, self_confidence, life_events, intention, emotions } = body
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (!entry_date) return NextResponse.json({ error: 'entry_date required' }, { status: 400 })
    const authedUser = await getAuthedUser(req)
    if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

    const sb = admin()
    const row = {
      user_id: authedUser!.id, // non fidarti del userId del body per la scrittura
      entry_date,
      mood, energy, sleep_quality, self_confidence,
      life_events: life_events || '',
      intention: intention || '',
      emotions: Array.isArray(emotions) ? emotions : [],
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await sb
      .from('premarket_journal')
      .upsert(row, { onConflict: 'user_id,entry_date' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, entry: data })
  } catch (e: any) {
    console.error('premarket POST error:', e)
    return NextResponse.json({ error: `internal: ${e?.message || String(e)}` }, { status: 500 })
  }
}
