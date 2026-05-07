import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Salva/carica performance report aggregati
export async function POST(req: NextRequest) {
  const { userId, account, stats, source } = await req.json()
  const sb = admin()
  const { error } = await sb.from('perf_reports').upsert({
    user_id: userId, account, stats, source,
    imported_at: new Date().toISOString()
  }, { onConflict: 'user_id,account' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const sb = admin()
  const { data, error } = await sb.from('perf_reports').select('*').eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ reports: data || [] })
}
