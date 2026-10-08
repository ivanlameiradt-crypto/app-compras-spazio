// Edge Function (Deno) — consultar-cnpj: devolve razão social, nome fantasia, UF e município de um CNPJ, pela consulta pública, para o app cadastrar fornecedor
// (pedido do Ivan, 08/10/2026). Autoriza o admin pelo token; a lógica pura está em logica.ts (vitest). Nada é gravado aqui.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { deBrasilApi, deCnpjWs, deReceitaWs, tratar, type Deps, type Fonte } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set(['https://ivanlameiradt-crypto.github.io', 'http://localhost:5173', 'http://localhost:4173'])

function cabecalhosCors(origem: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem && ORIGENS_PERMITIDAS.has(origem) ? origem : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const resposta = (status: number, corpo: unknown, cors: Record<string, string>): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** GET JSON com tempo limite; 404 = a fonte diz que o CNPJ não existe (null); outro erro levanta (a próxima fonte tenta). */
function fonte(url: (c: string) => string, adaptar: (j: Record<string, unknown>, c: string) => ReturnType<typeof deBrasilApi>): Fonte {
  return async (cnpj) => {
    const r = await fetch(url(cnpj), { headers: { Accept: 'application/json', 'User-Agent': 'consultar-cnpj' }, signal: AbortSignal.timeout(8000) })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return adaptar((await r.json()) as Record<string, unknown>, cnpj)
  }
}
const FONTES: Fonte[] = [
  fonte((c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, deBrasilApi),
  fonte((c) => `https://publica.cnpj.ws/cnpj/${c}`, deCnpjWs),
  fonte((c) => `https://receitaws.com.br/v1/cnpj/${c}`, deReceitaWs),
]

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'método não permitido' }, cors)
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return resposta(401, { erro: 'sem autenticação' }, cors)
    const url = Deno.env.get('SUPABASE_URL')
    const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !chaveServico) return resposta(500, { erro: 'função sem configuração' }, cors)
    const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)
    const corpo = await req.json().catch(() => ({}))
    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle()
        return (data as { papel: string; ativo: boolean } | null) ?? null
      },
      fontes: FONTES,
    }
    const r = await tratar(corpo, chamador, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    console.error('consultar-cnpj: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
