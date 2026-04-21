import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { userId } = await req.json()
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  await supabaseAdmin.from('profiles').delete().eq('id', userId)
  await supabaseAdmin.auth.admin.deleteUser(userId)
  return NextResponse.json({ success: true })
}
