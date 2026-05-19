import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// GET /api/commission-settings?userId=<uuid>
// Ritorna le commissioni manuali per strumento dell'utente.
// Response: { settings: { instrument: string; commission: number }[] }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const sb = admin()
  const { data, error } = await sb
    .from('commission_settings')
    .select('instrument, commission')
    .eq('user_id', userId)
    .order('instrument')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data ?? [] })
}

// POST /api/commission-settings
// Body: { userId: string; settings: { instrument: string; commission: string }[] }
// Upsert delle righe. Instrument viene normalizzato in uppercase.
// Response: { success: true; upserted: number }
export async function POST(req: NextRequest) {
  let body: { userId?: string; settings?: { instrument: string; commission: string }[] }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON non valido' }, { status: 400 }) }

  const { userId, settings } = body
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Array.isArray(settings)) return NextResponse.json({ error: 'settings must be an array' }, { status: 400 })

  // Filtra, normalizza, valida
  const rows = settings
    .filter(r => r.instrument?.trim() && r.commission?.trim())
    .map(r => ({
      user_id:    userId,
      instrument: r.instrument.trim().toUpperCase(),
      commission: parseFloat(r.commission.replace(',', '.')),
      updated_at: new Date().toISOString(),
    }))
    .filter(r => !isNaN(r.commission) && r.commission > 0)

  if (rows.length === 0) return NextResponse.json({ success: true, upserted: 0 })

  const sb = admin()
  const { error } = await sb
    .from('commission_settings')
    .upsert(rows, { onConflict: 'user_id,instrument' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, upserted: rows.length })
}