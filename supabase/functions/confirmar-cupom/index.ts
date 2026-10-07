// Edge Function (Deno) — confirmar-cupom: o Ivan corrige no app um cupom parado em REVISAR (item sem produto confirmado): recebe
// {cupom_id, itens:[{indice, insumo_id, quantidade, entrada?, lembrar}]}, autoriza o admin pelo token, refaz os itens com a service_role,
// confere a soma, volta o cupom a PENDENTE, grava o aprendizado confirmado e dispara o lancar-cupom.yml. Lógica pura em logica.ts e
// aprendizado.ts (vitest); aqui só a ligação (Deno.serve, CORS, banco, GitHub). O GITHUB_PAT fica só no servidor: nunca vai ao repo, ao log
// nem à resposta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { tratar, type Corpo, type CupomLinha, type Deps, type Produto } from './logica.ts'
import { gravarAprendizado, type CamposAprendizado } from './aprendizado.ts'

const ORIGENS_PERMITIDAS = new Set([
  'https://ivanlameiradt-crypto.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])
const REPO = 'ivanlameiradt-crypto/sischef-monitor-notas'
const WORKFLOW = 'lancar-cupom.yml'

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
    const pat = Deno.env.get('GITHUB_PAT') // ausente NÃO derruba a correção: o cupom fica PENDENTE (o reaper o marca para conferência após 60 min)
    if (!url || !chaveServico) return resposta(500, { erro: 'função sem configuração' }, cors)

    const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)

    const corpo = (await req.json().catch(() => ({}))) as Corpo
    const agora = () => new Date().toISOString()

    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle()
        return (data as { papel: string; ativo: boolean } | null) ?? null
      },
      async lerCupom(id) {
        const { data, error } = await admin.from('cupom')
          .select('id, estado, pedido_sischef, motivo, itens, valor_a_pagar, emitente_cnpj, teste').eq('id', id).maybeSingle()
        if (error) throw new Error(error.message)
        return (data as CupomLinha | null) ?? null
      },
      async buscarProduto(id) {
        // a lista de insumos do app (a mesma da caixa de associação, api.catalogoProdutos): a linha do produto na semana MAIS NOVA — o mesmo
        // critério do app, senão a tela e o servidor poderiam discordar da unidade do produto (e da necessidade de conversão)
        const { data, error } = await admin.from('itens_semana').select('produto_id, produto, unidade')
          .eq('produto_id', Number(id)).order('semana_id', { ascending: false }).order('id', { ascending: false }).limit(1)
        if (error) throw new Error(error.message)
        const linha = (data ?? [])[0] as { produto_id: number; produto: string | null; unidade: string | null } | undefined
        return linha ? ({ id: String(linha.produto_id), nome: linha.produto, unidade: linha.unidade } satisfies Produto) : null
      },
      async atualizarCupom(id, itens) {
        // compara-e-troca num UPDATE só: quem chega com uma tela velha (cupom já reenviado/lançado) recebe [].
        const { data, error } = await admin.from('cupom')
          .update({ itens, estado: 'PENDENTE', motivo: null, atualizado_em: agora() })
          .eq('id', id).eq('estado', 'REVISAR').is('pedido_sischef', null).select('id')
        if (error) throw new Error(error.message)
        return (data ?? []).length === 1
      },
      gravarAprendizado: (linha) => gravarAprendizado(linha, {
        async inserir(l) {
          const { error } = await admin.from('cupom_aprendizado').insert(l)
          return error ? { erro: { code: error.code, message: error.message } } : { ok: true }
        },
        async atualizarPorEan(ean, campos: CamposAprendizado) {
          const { data, error } = await admin.from('cupom_aprendizado').update({ ...campos, atualizado_em: agora() }).eq('codigo_barras', ean).select('id')
          if (error) throw new Error(error.message)
          return (data ?? []).length >= 1
        },
        async atualizarPorDescricao(cnpj, desc, campos: CamposAprendizado) {
          const { data, error } = await admin.from('cupom_aprendizado').update({ ...campos, atualizado_em: agora() })
            .eq('emitente_cnpj', cnpj).eq('descricao_norm', desc).select('id')
          if (error) throw new Error(error.message)
          return (data ?? []).length >= 1
        },
      }),
      async dispararLancamento(cupomId) {
        if (!pat) {
          // O tratar() engole este erro de propósito (a correção fica PENDENTE): sem este log, um PAT esquecido gera PENDENTE em silêncio.
          console.error('confirmar-cupom: workflow_dispatch sem GITHUB_PAT')
          throw new Error('sem GITHUB_PAT')
        }
        let r: Response
        try {
          r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${pat}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'confirmar-cupom',
            },
            body: JSON.stringify({ ref: 'master', inputs: { cupom_id: cupomId } }),
            signal: AbortSignal.timeout(20_000),
          })
        } catch (e) {
          console.error('confirmar-cupom: workflow_dispatch sem resposta', (e as { name?: string })?.name)
          throw new Error('workflow_dispatch sem resposta')
        }
        if (r.status !== 204) {
          console.error(`confirmar-cupom: workflow_dispatch falhou (HTTP ${r.status})`, (await r.text().catch(() => '')).slice(0, 200))
          throw new Error(`workflow_dispatch falhou (HTTP ${r.status})`)
        }
      },
    }

    const r = await tratar(corpo, chamador, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    // nunca vaza chave/PAT: nada aqui os contém (só mensagens do banco e as nossas)
    console.error('confirmar-cupom: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
