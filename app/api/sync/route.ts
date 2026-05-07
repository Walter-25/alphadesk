import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  // Verifica API key per sicurezza
  const authHeader = req.headers.get('x-api-key')
  if (authHeader !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { trades, userId, account, source } = await req.json()
  if (!trades?.length) return NextResponse.json({ skipped: true, reason: 'no trades' })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const rows = trades.map((t: any) => ({
    ...t, user_id: userId, account: account || t.account,
    source: source || 'auto_sync', updated_at: new Date().toISOString()
  }))

  const { data, error } = await supabase.from('trades')
    .upsert(rows, { onConflict: 'ninja_id,user_id', ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    success: true, new_trades: data?.length || 0,
    timestamp: new Date().toISOString(), source
  })
}
