import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export type UserRole = 'admin' | 'trader'
export interface Profile {
  id: string; email: string; full_name: string
  role: UserRole; created_at: string; created_by?: string
}
