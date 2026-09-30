// Edge Function (Deno) — leitura com IA da resposta do vendedor (B.7). Lógica pura em logica.ts (testada pelo vitest);
// aqui só a ligação: Deno.serve, CORS, o cliente Supabase COM O LOGIN DO IVAN (não a chave de serviço) e o SDK da
// Anthropic. A chave da Anthropic fica só nos Secrets; nunca vai ao repositório, ao log nem à resposta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.70.0'
import { type CodigoErro, type ContextoIA, type Deps, type PedidoModelo, tratar } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set([
  'https://ivanlameiradt-crypto.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])

function cabecalhosCors(origem: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem && ORIGENS_PERMITIDAS.has(origem) ? origem : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function resposta(status: number, corpo: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** Erro do SDK da Anthropic → código de B.13. */
function erroDaApi(e: unknown): CodigoErro {
  const status = (e as { status?: number })?.status
  const nome = (e as { name?: string })?.name ?? ''
  const msg = (e instanceof Error ? e.message : String(e)) ?? ''
  if (/timeout/i.test(nome) || /timed out|timeout/i.test(msg)) return 'tempo'
  if (status === 429 || status === 529) return 'ocupada'
  if (status === 400 && /credit balance/i.test(msg)) return 'sem_credito'
  if (status === 401) return 'chave'
  return 'api'
}

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'metodo', mensagem: 'método não permitido' }, cors)
  const tamanho = Number(req.headers.get('content-length') ?? '0')
  if (tamanho > 3_000_000) return resposta(413, { ok: false, erro: 'entrada', mensagem: 'pedido grande demais' }, cors)

  try {
    const cabecalhoAuth = req.headers.get('authorization') ?? ''
    if (!cabecalhoAuth.replace(/^Bearer\s+/i, '')) return resposta(401, { ok: false, erro: 'sessao', mensagem: 'sem autenticação' }, cors)

    const url = Deno.env.get('SUPABASE_URL')
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !anon) return resposta(500, { ok: false, erro: 'api', mensagem: 'função sem configuração' }, cors)

    // o banco é chamado COMO O IVAN (Authorization do chamador); a função não usa a chave de serviço
    const sb = createClient(url, anon, { global: { headers: { Authorization: cabecalhoAuth } } })
    const chaveIA = Deno.env.get('ANTHROPIC_API_KEY')

    const deps: Deps = {
      async iniciar(e) {
        const { data, error } = await sb.rpc('cot_ia_iniciar', {
          p_cotacao: e.cotacao_id, p_caracteres: e.caracteres, p_imagens: e.imagens, p_transcricao: e.transcricao,
        })
        if (error) {
          const sessao = /JWT|jwt|token/.test(error.message) || (error as { status?: number }).status === 401
          return { ok: false, mensagem: error.message, sessao }
        }
        return { ok: true, ctx: data as ContextoIA }
      },
      async chamarModelo(pedido: PedidoModelo) {
        try {
          const cliente = new Anthropic({ apiKey: chaveIA!, timeout: 110_000, maxRetries: 0 })
          const opus = pedido.model === 'claude-opus-5'
          const opcoes = opus ? { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } } : undefined
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await cliente.messages.create(pedido as any, opcoes as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const texto = ((r as any).content ?? [])
            .filter((b: { type: string }) => b.type === 'text')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((b: any) => b.text ?? '').join('')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const u = (r as any).usage ?? {}
          return {
            ok: true,
            resp: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              stop_reason: (r as any).stop_reason ?? '',
              texto,
              usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 },
            },
          }
        } catch (e) {
          return { ok: false, erro: erroDaApi(e) }
        }
      },
      async concluir(leitura, p) {
        const { error } = await sb.rpc('cot_ia_concluir', { p_leitura: leitura, p })
        if (error) throw new Error(error.message) // melhor esforço: tratar() já engole com .catch
      },
      chaveExiste: () => !!chaveIA,
      agora: () => Date.now(),
    }

    const corpo = await req.json().catch(() => null)
    const r = await tratar(corpo, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    // nunca vaza a chave nem o texto: só uma mensagem genérica
    return resposta(500, { ok: false, erro: 'api', mensagem: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
