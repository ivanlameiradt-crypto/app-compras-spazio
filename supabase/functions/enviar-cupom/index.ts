// Edge Function (Deno) — recebe {foto_path, pagamento, teste}, autoriza o admin pelo token, lê a foto do bucket privado
// `cupons` com service_role, lê com IA (Anthropic), casa pelo cupom_aprendizado confirmado, grava a linha `cupom` e
// dispara ela mesma o lancar-cupom.yml. Lógica pura em logica.ts/gravacao.ts (vitest); aqui só a ligação (Deno.serve,
// CORS, SDK, storage, GitHub). Segredos só no servidor: ANTHROPIC_API_KEY e GITHUB_PAT nunca vão ao repo, ao log nem à resposta.
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.70.0'
import { tratar, type Corpo, type Deps, type ImagemBase64, type PedidoModelo } from './logica.ts'
import { gravarSemDuplicar } from './gravacao.ts'
import type { Aprendizado } from './casamento.ts'

const ORIGENS_PERMITIDAS = new Set([
  'https://ivanlameiradt-crypto.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])
const REPO = 'ivanlameiradt-crypto/sischef-monitor-notas'
const WORKFLOW = 'lancar-cupom.yml'
const MODELO = (Deno.env.get('CUPOM_MODELO') ?? '').trim() || 'claude-sonnet-5'

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
async function paraBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const TAM = 0x8000 // em pedaços: o spread de uma foto inteira estouraria a pilha
  for (let i = 0; i < bytes.length; i += TAM) bin += String.fromCharCode(...bytes.subarray(i, i + TAM))
  return btoa(bin)
}
function mediaType(path: string): ImagemBase64['media_type'] {
  if (path.toLowerCase().endsWith('.png')) return 'image/png'
  if (path.toLowerCase().endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
// Só dígitos entram no filtro do PostgREST (que é texto): EAN e CNPJ vêm da leitura por IA, dado não confiável.
const ehEan = (v: string) => /^\d{1,14}$/.test(v)
const ehCnpj = (v: string) => /^\d{14}$/.test(v)

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'método não permitido' }, cors)

  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return resposta(401, { erro: 'sem autenticação' }, cors)

    const url = Deno.env.get('SUPABASE_URL')
    const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const chaveIA = Deno.env.get('ANTHROPIC_API_KEY')
    const pat = Deno.env.get('GITHUB_PAT') // ausente NÃO derruba o envio: o cupom fica PENDENTE (o reaper só o marca para conferência após 60 min)
    // Sem a chave da IA nenhuma foto pode ser lida. Falha aqui (500 claro) em vez de gravar uma linha REVISAR "não consegui
    // ler a foto": por causa do dedup por foto_path ela impediria reenviar a MESMA foto depois de configurada a chave.
    if (!url || !chaveServico || !chaveIA) return resposta(500, { erro: 'função sem configuração' }, cors)

    const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)

    const corpo = (await req.json().catch(() => ({}))) as Corpo

    // Procura o cupom por uma coluna única. Erro de leitura NÃO vira "não achei": seguir adiante gastaria a IA e gravaria por cima de uma falha.
    const achar = async (coluna: 'foto_path' | 'chave', valor: string): Promise<{ id: string } | null> => {
      const { data, error } = await admin.from('cupom').select('id').eq(coluna, valor).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as { id: string } | null) ?? null
    }

    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle()
        return (data as { papel: string; ativo: boolean } | null) ?? null
      },
      acharCupomPorFoto: (fotoPath) => achar('foto_path', fotoPath),
      async baixarFoto(fotoPath) {
        const { data, error } = await admin.storage.from('cupons').download(fotoPath)
        if (error || !data) throw new Error(error?.message ?? 'não consegui baixar a foto do bucket')
        return { media_type: mediaType(fotoPath), base64: await paraBase64(data) }
      },
      async chamarModelo(pedido: PedidoModelo) {
        try {
          const cliente = new Anthropic({ apiKey: chaveIA, timeout: 110_000, maxRetries: 0 })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await cliente.messages.create(pedido as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const texto = ((r as any).content ?? [])
            .filter((b: { type: string }) => b.type === 'text')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((b: any) => b.text ?? '').join('')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: true as const, resp: { stop_reason: (r as any).stop_reason ?? '', texto } }
        } catch (e) {
          // diagnóstico sem segredo: só o tipo e o status do erro (nunca a chave, a foto nem a resposta)
          console.error('enviar-cupom: leitura por IA falhou', (e as { name?: string })?.name, (e as { status?: number })?.status)
          return { ok: false as const }
        }
      },
      async buscarAprendizado(eans, chaves) {
        // Só o CONFIRMADO. Sempre traz os SINÔNIMOS GLOBAIS (emitente_cnpj null — o mesmo produto com descrições de
        // fornecedores diferentes, lista curada pequena), mais o que casa com esta leitura por EAN e pelo CNPJ do emitente.
        // O recorte dos globais (`emitente_cnpj` E `codigo_barras` nulos) garante que nunca se traz a tabela inteira, mesmo sem EAN/CNPJ na
        // leitura: as linhas por EAN que o app grava ao corrigir um cupom (confirmar-cupom) também têm emitente_cnpj nulo e crescem a cada
        // confirmação — elas só vêm quando o EAN está nesta leitura.
        const codigos = [...new Set(eans.filter(ehEan))]
        const cnpjs = [...new Set(chaves.map((k) => k.cnpj).filter(ehCnpj))]
        const filtro: string[] = ['and(emitente_cnpj.is.null,codigo_barras.is.null)']
        if (codigos.length) filtro.push(`codigo_barras.in.(${codigos.map((e) => `"${e}"`).join(',')})`)
        if (cnpjs.length) filtro.push(`emitente_cnpj.in.(${cnpjs.map((c) => `"${c}"`).join(',')})`)
        const { data, error } = await admin.from('cupom_aprendizado')
          .select('codigo_barras, emitente_cnpj, descricao_norm, insumo_id, insumo_nome, fator_conversao, unidade_destino, confirmado')
          .eq('confirmado', true).or(filtro.join(','))
        // erro de leitura NÃO vira "sem aprendizado": viraria uma linha REVISAR com o motivo errado (e o dedup travaria o reenvio)
        if (error) throw new Error(error.message)
        return ((data ?? []) as Aprendizado[]).map((a) => ({ ...a, fator_conversao: Number(a.fator_conversao) }))
      },
      // insert simples + 23505 tratado em gravacao.ts (o índice de foto_path é PARCIAL: nada de insert-ou-atualiza do PostgREST)
      inserirCupom: (linha) => gravarSemDuplicar(linha, {
        async inserir(l) {
          const { data, error } = await admin.from('cupom').insert(l).select('id').single()
          if (error || !data) return { erro: { code: error?.code, message: error?.message ?? 'sem resposta do banco' } }
          return { id: (data as { id: string }).id }
        },
        acharPorFoto: (fotoPath) => achar('foto_path', fotoPath),
        acharPorChave: (chave) => achar('chave', chave),
      }),
      async dispararLancamento(cupomId) {
        if (!pat) {
          // O tratar() engole este erro de propósito (o envio segue PENDENTE): sem este log, um PAT esquecido gera PENDENTE em silêncio.
          // Só o nome da variável, nunca o valor.
          console.error('enviar-cupom: workflow_dispatch sem GITHUB_PAT')
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
              'User-Agent': 'enviar-cupom',
            },
            body: JSON.stringify({ ref: 'master', inputs: { cupom_id: cupomId } }),
            signal: AbortSignal.timeout(20_000), // um GitHub que não responde não pode travar o envio
          })
        } catch (e) {
          // Sem resposta (rede caiu, timeout de 20s): o tratar() engole este erro de propósito (o envio segue PENDENTE), então é
          // aqui que ele fica registrado — só o NOME (TimeoutError, TypeError…): a mensagem do fetch pode trazer a URL.
          console.error('enviar-cupom: workflow_dispatch sem resposta', (e as { name?: string })?.name)
          throw new Error('workflow_dispatch sem resposta')
        }
        if (r.status !== 204) {
          // diagnóstico sem segredo: o status e o começo da mensagem do GitHub (que não ecoa o token)
          console.error(`enviar-cupom: workflow_dispatch falhou (HTTP ${r.status})`, (await r.text().catch(() => '')).slice(0, 200))
          throw new Error(`workflow_dispatch falhou (HTTP ${r.status})`)
        }
      },
    }

    const r = await tratar(corpo, chamador, deps, MODELO)
    return resposta(r.status, r.corpo, cors)
  } catch (e) {
    // nunca vaza chave/PAT: nada aqui os contém (só mensagens do banco/storage e as nossas)
    console.error('enviar-cupom: erro', e instanceof Error ? e.message : String(e))
    return resposta(500, { erro: e instanceof Error ? e.message : 'erro interno' }, cors)
  }
})
