// Edge Function (Deno) — "Lançar" UMA NF-e da aba Lançamento de nota SEFAZ: autoriza o admin pelo token, reserva a nota
// na cot_nfe com a service_role (compara-e-troca, passa pela RLS) e dispara o lancar-nfe.yml do robô com a nota pronta.
// Lógica pura em logica.ts (vitest); aqui só a ligação (Deno.serve, CORS, banco, GitHub). O GITHUB_PAT fica só no
// servidor: nunca vai ao repo, ao log nem à resposta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { filtroReservavel, tratar, type Corpo, type Deps, type NotaReservada } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set([
  'https://ivanlameiradt-crypto.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])
const REPO = 'ivanlameiradt-crypto/sischef-monitor-notas'
const WORKFLOW = 'lancar-nfe.yml'
const COLUNAS = 'chave, emitente, numero, emissao, valor_nf, forma_pagamento, itens'

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

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'método não permitido' }, cors)

  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return resposta(401, { erro: 'sem autenticação' }, cors)

    const url = Deno.env.get('SUPABASE_URL')
    const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const pat = Deno.env.get('GITHUB_PAT')
    // Sem o PAT não há como chamar o robô: falha clara aqui, ANTES de reservar (senão a nota ficaria 'lançando' à toa).
    if (!url || !chaveServico || !pat) return resposta(500, { erro: 'função sem configuração' }, cors)

    const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)

    const corpo = (await req.json().catch(() => ({}))) as Corpo

    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle()
        return (data as { papel: string; ativo: boolean } | null) ?? null
      },
      async reservar(chave, forma, agoraIso, limiteIso) {
        // compara-e-troca num UPDATE só (o PostgREST aplica tudo no mesmo comando): quem perde a corrida recebe [].
        const { data, error } = await admin.from('cot_nfe')
          .update({ forma_pagamento: forma, lancamento_em: agoraIso, lancamento_estado: 'lancando', lancamento_motivo: null,
                    lancamento_estado_em: agoraIso, atualizado_em: agoraIso })
          .eq('chave', chave).eq('situacao', 'na_fila')
          .or(filtroReservavel(limiteIso))
          .select(COLUNAS)
        if (error) throw new Error(error.message)
        return ((data ?? [])[0] as NotaReservada | undefined) ?? null
      },
      async outraLancando(chave, limiteIso) {
        const { data, error } = await admin.from('cot_nfe').select('chave')
          .eq('situacao', 'na_fila').eq('lancamento_estado', 'lancando').gte('lancamento_em', limiteIso).neq('chave', chave).limit(1)
        if (error) throw new Error(error.message)
        return (data ?? []).length > 0
      },
      async soltar(chave) {
        const agora = new Date().toISOString()
        const { error } = await admin.from('cot_nfe')
          .update({ lancamento_em: null, lancamento_estado: null, lancamento_estado_em: agora, atualizado_em: agora })
          .eq('chave', chave).eq('lancamento_estado', 'lancando')
        if (error) throw new Error(error.message)
      },
      async disparar(notaJson) {
        let r: Response
        try {
          r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${pat}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'lancar-nfe',
            },
            body: JSON.stringify({ ref: 'master', inputs: { nota_json: notaJson, modo: 'real' } }),
            signal: AbortSignal.timeout(20_000), // um GitHub que não responde não pode travar o "Lançar"
          })
        } catch (e) {
          // só o NOME do erro (TimeoutError, TypeError…): a mensagem do fetch pode trazer a URL
          console.error('lancar-nfe: workflow_dispatch sem resposta', (e as { name?: string })?.name)
          throw new Error('workflow_dispatch sem resposta')
        }
        if (r.status !== 204) {
          // diagnóstico sem segredo: o status e o começo da mensagem do GitHub (que não ecoa o token)
          console.error(`lancar-nfe: workflow_dispatch falhou (HTTP ${r.status})`, (await r.text().catch(() => '')).slice(0, 200))
          throw new Error(`workflow_dispatch falhou (HTTP ${r.status})`)
        }
      },
      agora: () => new Date(),
    }

    const r = await tratar(corpo, chamador, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    // nunca vaza chave/PAT: nada aqui os contém (só mensagens do banco e as nossas)
    console.error('lancar-nfe: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
