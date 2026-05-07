import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest) {
  const { email, password, full_name, role } = await req.json()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: authData, error: authError } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })
  const { error: profileError } = await sb.from('profiles').insert({ id: authData.user.id, email, full_name, role })
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
