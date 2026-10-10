// Edge Function (Deno) — Compras avulsas (pedido do Ivan, 10/10/2026): recebe {envio_id, fornecedor, pagamento, itens}, autoriza o admin pelo token, grava a linha `cupom`
// (origem 'avulsa', sem foto) e dispara o lancar-cupom.yml. Lógica pura em logica.ts/gravacao.ts (vitest); aqui só a ligação (Deno.serve, CORS, SDK, GitHub).
// GITHUB_PAT só no servidor: nunca vai ao repo, ao log nem à resposta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { gravarSemDuplicar } from './gravacao.ts'
import { tratar, type Corpo, type Deps } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set(['https://ivanlameiradt-crypto.github.io', 'http://localhost:5173', 'http://localhost:4173'])
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
    const pat = Deno.env.get('GITHUB_PAT') // ausente NÃO derruba o envio: a compra fica PENDENTE (o reaper só a marca para conferência após 60 min)
    if (!url || !chaveServico) return resposta(500, { erro: 'função sem configuração' }, cors)

    const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)

    const corpo = (await req.json().catch(() => ({}))) as Corpo
    const achar = async (fotoPath: string): Promise<{ id: string } | null> => {
      const { data, error } = await admin.from('cupom').select('id').eq('foto_path', fotoPath).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as { id: string } | null) ?? null
    }

    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle()
        return (data as { papel: string; ativo: boolean } | null) ?? null
      },
      async produtosExistentes(ids) {
        // a lista do app = itens_semana (a lista semanal) + a planilha de produtos do Ivan (produto_planilha); basta estar em uma delas
        const achados = new Set<string>()
        for (const [tabela, coluna] of [['itens_semana', 'produto_id'], ['produto_planilha', 'produto_id']] as const) {
          const { data, error } = await admin.from(tabela).select(coluna).in(coluna, ids)
          if (error) throw new Error(error.message)
          for (const l of (data ?? []) as Record<string, unknown>[]) achados.add(String(l[coluna]))
        }
        return achados
      },
      inserirCupom: (linha) => gravarSemDuplicar(linha, {
        async inserir(l) {
          const { data, error } = await admin.from('cupom').insert(l).select('id').single()
          if (error || !data) return { erro: { code: error?.code, message: error?.message ?? 'sem resposta do banco' } }
          return { id: (data as { id: string }).id }
        },
        acharPorFoto: achar,
        acharPorChave: async () => null,
      }),
      async dispararLancamento(cupomId) {
        if (!pat) { console.error('enviar-compra-avulsa: workflow_dispatch sem GITHUB_PAT'); throw new Error('sem GITHUB_PAT') }
        let r: Response
        try {
          r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'enviar-compra-avulsa' },
            body: JSON.stringify({ ref: 'master', inputs: { cupom_id: cupomId } }),
            signal: AbortSignal.timeout(20_000),
          })
        } catch (e) {
          console.error('enviar-compra-avulsa: workflow_dispatch sem resposta', (e as { name?: string })?.name)
          throw new Error('workflow_dispatch sem resposta')
        }
        if (r.status !== 204) {
          console.error(`enviar-compra-avulsa: workflow_dispatch falhou (HTTP ${r.status})`, (await r.text().catch(() => '')).slice(0, 200))
          throw new Error(`workflow_dispatch falhou (HTTP ${r.status})`)
        }
      },
    }

    const r = await tratar(corpo, chamador, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    console.error('enviar-compra-avulsa: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
