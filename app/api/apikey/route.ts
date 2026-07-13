import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../lib/supabase-server'

function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'ad_'
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)]
  return key
}

export async function POST(req: NextRequest) {
  const { userId, label } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  const key = generateKey()
  const { error } = await sb.from('api_keys').insert({ user_id: userId, key, label: label || 'NinjaTrader' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ key })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const authedUser = await getAuthedUser(req)
  if (!canAccess(authedUser, userId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  const { data } = await sb.from('api_keys').select('id,key,label,created_at').eq('user_id', userId||'')
  return NextResponse.json({ keys: data || [] })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const authedUser = await getAuthedUser(req)
  if (!authedUser) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const sb = admin()
  // Verifica che la key appartenga all'utente autenticato (o che sia admin)
  const { data: existing } = await sb.from('api_keys').select('user_id').eq('id', id).single()
  if (!existing || !canAccess(authedUser, existing.user_id)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  await sb.from('api_keys').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
