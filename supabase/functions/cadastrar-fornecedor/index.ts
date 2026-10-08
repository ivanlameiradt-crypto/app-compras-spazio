// Edge Function (Deno) — cadastrar-fornecedor: o Ivan toca em "Cadastrar no SisChef" (cupom parado por fornecedor não cadastrado); grava o pedido, guarda a
// fantasia só no app e dispara o workflow cadastrar-fornecedor.yml do robô. Lógica pura em logica.ts (vitest). O GITHUB_PAT fica só no servidor.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { tratar, type Corpo, type CupomLinha, type Deps } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set(['https://ivanlameiradt-crypto.github.io', 'http://localhost:5173', 'http://localhost:4173'])
const REPO = 'ivanlameiradt-crypto/sischef-monitor-notas'
const WORKFLOW = 'cadastrar-fornecedor.yml'

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
        const { data, error } = await admin.from('cupom').select('id, estado, motivo, pedido_sischef').eq('id', id).maybeSingle()
        if (error) throw new Error(error.message)
        return (data as CupomLinha | null) ?? null
      },
      async salvarFantasia(cnpj, razao, fantasia) {
        const { error } = await admin.from('fornecedor_app').upsert({ cnpj, razao_social: razao, nome_fantasia: fantasia, atualizado_em: agora() }, { onConflict: 'cnpj' })
        if (error) throw new Error(error.message)
      },
      async criarPedido(p) {
        const { data, error } = await admin.from('fornecedor_cadastro').insert(p).select('id').single()
        if (!error && data) return { id: (data as { id: string }).id }
        if (error?.code === '23505') {
          // já há um pedido em andamento para este CNPJ (índice único parcial): devolve o existente
          const { data: ex } = await admin.from('fornecedor_cadastro').select('id').eq('cnpj', p.cnpj).in('estado', ['PENDENTE', 'PROCESSANDO']).order('criado_em', { ascending: false }).limit(1)
          const id = ((ex ?? [])[0] as { id: string } | undefined)?.id
          if (id) return { id, duplicado: true }
        }
        throw new Error(error?.message ?? 'não consegui gravar o pedido')
      },
      async dispararCadastro(cadastroId) {
        if (!pat) {
          console.error('cadastrar-fornecedor: workflow_dispatch sem GITHUB_PAT')
          throw new Error('sem GITHUB_PAT')
        }
        let r: Response
        try {
          r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cadastrar-fornecedor' },
            body: JSON.stringify({ ref: 'master', inputs: { cadastro_id: cadastroId } }),
            signal: AbortSignal.timeout(20_000),
          })
        } catch (e) {
          console.error('cadastrar-fornecedor: workflow_dispatch sem resposta', (e as { name?: string })?.name)
          throw new Error('workflow_dispatch sem resposta')
        }
        if (r.status !== 204) {
          console.error(`cadastrar-fornecedor: workflow_dispatch falhou (HTTP ${r.status})`, (await r.text().catch(() => '')).slice(0, 200))
          throw new Error(`workflow_dispatch falhou (HTTP ${r.status})`)
        }
      },
      async marcarRevisar(cadastroId, motivo) {
        await admin.from('fornecedor_cadastro').update({ estado: 'REVISAR', motivo, atualizado_em: agora() }).eq('id', cadastroId)
      },
    }
    const r = await tratar(corpo, chamador, deps)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    console.error('cadastrar-fornecedor: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
