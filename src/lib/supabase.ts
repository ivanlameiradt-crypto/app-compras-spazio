import { createClient } from '@supabase/supabase-js'
import { comPrazo } from './prazo'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'http://localhost:54321'
const chave = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'sem-chave'

// comPrazo: toda chamada ao servidor tem tempo limite (prazo.ts); sem ele, com a internet pendurada, os botões ficavam em "Enviando…" por minutos
export const supabase = createClient(url, chave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: comPrazo() },
})
