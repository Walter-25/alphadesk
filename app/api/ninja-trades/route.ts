import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const getAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// GET - recupera trades per utente
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const account = searchParams.get('account')
  const strategy = searchParams.get('strategy')
  const supabase = getAdmin()
  let query = supabase.from('trades').select('*').eq('user_id', userId).order('entry_time', { ascending: false })
  if (account) query = query.eq('account', account)
  if (strategy) query = query.eq('strategy', strategy)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ trades: data })
}

// POST - import CSV NinjaTrader
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { trades, userId } = body
  const supabase = getAdmin()
  const { error } = await supabase.from('trades').upsert(
    trades.map((t: any) => ({ ...t, user_id: userId })),
    { onConflict: 'ninja_id,user_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, count: trades.length })
}
