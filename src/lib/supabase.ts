import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'http://localhost:54321'
const chave = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'sem-chave'

export const supabase = createClient(url, chave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
