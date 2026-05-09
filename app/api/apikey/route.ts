import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'ad_'
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)]
  return key
}

export async function POST(req: NextRequest) {
  const { userId, label } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const sb = admin()
  const key = generateKey()
  const { error } = await sb.from('api_keys').insert({ user_id: userId, key, label: label || 'NinjaTrader' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ key })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const sb = admin()
  const { data } = await sb.from('api_keys').select('id,key,label,created_at').eq('user_id', userId||'')
  return NextResponse.json({ keys: data || [] })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const sb = admin()
  await sb.from('api_keys').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
