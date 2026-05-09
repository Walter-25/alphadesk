import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  const { id, coretraders_key } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const sb = admin()
  const { error } = await sb
    .from('api_keys')
    .update({ coretraders_key: coretraders_key || null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
