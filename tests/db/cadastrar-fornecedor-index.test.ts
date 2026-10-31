// tests/db/cadastrar-fornecedor-index.test.ts — roda o index.ts DE VERDADE da Edge Function cadastrar-fornecedor contra o Postgres das migrações (PGlite), com o global Deno e o
// fetch do GitHub falsos. O que a lógica pura (supabase/functions/cadastrar-fornecedor/logica.test.ts, com deps falsas) não prova: que as colunas lidas de cot_nfe existem, que o
// INSERT com cupom_id NULL passa por todas as restrições, como o índice único parcial se comporta e que um pedido PARADO é encerrado em vez de bloquear o CNPJ para sempre.
// Origem: revisão independente do PR 63 (31/10/2026; Plast Mais 8928 — fornecedor novo cadastrado pela própria nota).
import { vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { novoBanco } from './banco'
import { semear } from './fixture'
import { clienteSobrePglite, type Registro } from './pgliteSupabase'

const h = vi.hoisted(() => ({ cliente: null as unknown }))
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: () => h.cliente }))

const CNPJ_PLAST = '55384032000120'
const CNPJ_OUTRO = '63540861000182'
// cUF 15 + AAMM 2610 + CNPJ do emitente + modelo 55 + série 001 + nº 000008928 + tpEmis 1 + cNF 44282112 + DV 3 = 44 dígitos
const CHAVE = `152610${CNPJ_PLAST}550010000089281442821123`
const MOTIVO_NOTA = 'fornecedor não cadastrado no Sischef e sem autorização do Ivan (autorize no app) — nada lançado'
const CAMINHO = '../../supabase/functions/cadastrar-fornecedor/index.ts'

let db: PGlite
let handler: (req: Request) => Promise<Response>
const log: Registro[] = []
const disparos: string[] = []

beforeAll(async () => {
  db = await novoBanco()
  await semear(db)
  // a tabela `cupom` NÃO está nas migrações deste repositório (vem do outro projeto): uma versão mínima, só com o que a função lê
  await db.exec(`create table public.cupom (id uuid primary key, estado text, motivo text, pedido_sischef text);
                 grant all on public.cupom to service_role;`)
  h.cliente = clienteSobrePglite(db, { 'tok-ivan': 'ivan@spazio.com', 'tok-joao': 'joao@spazio.com' }, log)
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', GITHUB_PAT: 'pat' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { handler = fn },
  }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    disparos.push(JSON.parse(init.body).inputs.cadastro_id)
    return { status: 204, text: async () => '' }
  }))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await import(/* @vite-ignore */ CAMINHO)
})
afterAll(async () => { delete (globalThis as unknown as { Deno?: unknown }).Deno; vi.unstubAllGlobals(); await db?.close() })

beforeEach(async () => {
  await db.exec('truncate fornecedor_cadastro, fornecedor_app, cupom; delete from cot_nfe;')
  disparos.length = 0
  log.length = 0
  await db.query(
    `insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens, situacao, primeiro_visto_em, visto_na_fila_em, atualizado_em,
                          lancamento_estado, lancamento_motivo)
     values ($1, substr($1, 7, 14), 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', '000008928', '2026-10-30', 363.7, true, '[]'::jsonb, 'na_fila', now(), now(), now(),
             'revisar', $2)`, [CHAVE, MOTIVO_NOTA])
})

const corpoNota = (extra: Record<string, unknown> = {}) => ({
  cnpj: '55.384.032/0001-20', razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Belém', nota_chave: CHAVE, ...extra,
})
async function chamar(corpo: unknown, token = 'tok-ivan'): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const r = await handler(new Request('https://x.supabase.co/functions/v1/cadastrar-fornecedor', {
    method: 'POST', headers: { origin: 'https://ivanlameiradt-crypto.github.io', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }))
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> }
}
const pedidos = async () => (await db.query<Record<string, unknown>>('select cnpj, cupom_id, estado, criado_por, motivo from fornecedor_cadastro order by criado_em')).rows
const inserirPedido = (estado: string, criadoHa: string, atualizadoHa = criadoHa, cupomId: string | null = null) =>
  db.query(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio, cupom_id, estado, criado_em, atualizado_em)
            values ($1, 'PLAST MAIS', 'PA', 'Belém', $2, $3, now() - $4::interval, now() - $5::interval)`, [CNPJ_PLAST, cupomId, estado, criadoHa, atualizadoHa])

describe('cadastrar-fornecedor/index.ts contra o esquema real (PGlite)', () => {
  it('caminho da nota: as colunas de cot_nfe existem, o INSERT com cupom_id NULL passa e o robô é chamado UMA vez', async () => {
    const r = await chamar(corpoNota())
    expect(r.status).toBe(200)
    expect(await pedidos()).toEqual([{ cnpj: CNPJ_PLAST, cupom_id: null, estado: 'PENDENTE', criado_por: 'ivan@spazio.com', motivo: null }])
    expect(disparos).toEqual([r.corpo.cadastro_id])
    expect(log.some((l) => l.sql.startsWith('select chave, situacao, lancamento_estado, lancamento_motivo, descartada_em from public.cot_nfe'))).toBe(true)
  })

  it('toque duplo (dois pedidos ao mesmo tempo): o índice único parcial deixa só UM pedido e só UM disparo; o segundo recebe "em andamento"', async () => {
    const [a, b] = await Promise.all([chamar(corpoNota()), chamar(corpoNota())])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await pedidos()).toHaveLength(1)
    expect(disparos).toHaveLength(1)
    expect([a.corpo.em_andamento, b.corpo.em_andamento].filter(Boolean)).toHaveLength(1)
  })

  it('pedido em andamento RECENTE (inclusive o que veio de um CUPOM do mesmo CNPJ): o da nota é deduplicado nele (200 em_andamento, nada disparado, nada encerrado)', async () => {
    await inserirPedido('PROCESSANDO', '2 minutes', '1 minute', crypto.randomUUID())
    const r = await chamar(corpoNota())
    expect(r.status).toBe(200)
    expect(r.corpo.em_andamento).toBe(true)
    expect(disparos).toEqual([])
    expect((await pedidos()).map((p) => p.estado)).toEqual(['PROCESSANDO'])
  })

  it('nota_chave E cupom_id juntos: vale a nota, o cupom_id é ignorado (a linha fica com cupom_id NULL)', async () => {
    const r = await chamar(corpoNota({ cupom_id: 'aaf54e6f-0b1c-4d2e-9f3a-4b5c6d7e8f90' }))
    expect(r.status).toBe(200)
    expect((await pedidos())[0].cupom_id).toBeNull()
  })

  it('CNPJ de outra empresa (válido) com a chave da nota: 400 e nada gravado', async () => {
    const r = await chamar(corpoNota({ cnpj: CNPJ_OUTRO }))
    expect(r.status).toBe(400)
    expect(await pedidos()).toEqual([])
  })

  it('nota já lançada / pela metade / lançando / DESCARTADA pelo Ivan: 409 e nada gravado', async () => {
    for (const sql of [
      `update cot_nfe set situacao = 'lancada'`,
      `update cot_nfe set situacao = 'na_fila', lancamento_estado = 'erro'`,
      `update cot_nfe set lancamento_estado = 'lancando'`,
      `update cot_nfe set lancamento_estado = 'revisar', descartada_em = now(), descartada_por = 'ivan@spazio.com'`,
    ]) {
      await db.exec(sql)
      expect((await chamar(corpoNota())).status).toBe(409)
    }
    expect(await pedidos()).toEqual([])
  })

  it('comprador (não admin): 403 e nada lido de cot_nfe nem gravado', async () => {
    const r = await chamar(corpoNota(), 'tok-joao')
    expect(r.status).toBe(403)
    expect(log.some((l) => l.sql.includes('cot_nfe'))).toBe(false)
    expect(await pedidos()).toEqual([])
  })
})

describe('cadastrar-fornecedor/index.ts — pedido PARADO não bloqueia o CNPJ para sempre', () => {
  it('PENDENTE de 2 dias que o robô nunca pegou (disparo cancelado na fila): é encerrado (REVISAR) e o pedido novo é gravado e DISPARADO', async () => {
    await inserirPedido('PENDENTE', '2 days')
    const r = await chamar(corpoNota())
    expect(r.status).toBe(200)
    expect(r.corpo.em_andamento).toBeUndefined()
    const todos = await pedidos()
    expect(todos.map((p) => p.estado)).toEqual(['REVISAR', 'PENDENTE'])
    expect(todos[0].motivo).toContain('parado na fila')
    expect(disparos).toEqual([r.corpo.cadastro_id])
  })

  it('PROCESSANDO há mais de 30 minutos (o robô caiu no meio): também é encerrado; PENDENTE de 14 minutos e PROCESSANDO de 29 NÃO são', async () => {
    await inserirPedido('PROCESSANDO', '2 hours', '45 minutes')
    expect((await chamar(corpoNota())).status).toBe(200)
    expect((await pedidos()).map((p) => p.estado)).toEqual(['REVISAR', 'PENDENTE'])
    await db.exec('truncate fornecedor_cadastro')
    disparos.length = 0
    await inserirPedido('PENDENTE', '14 minutes')
    expect((await chamar(corpoNota())).corpo.em_andamento).toBe(true)
    await db.exec('truncate fornecedor_cadastro')
    await inserirPedido('PROCESSANDO', '2 hours', '29 minutes')
    expect((await chamar(corpoNota())).corpo.em_andamento).toBe(true)
    expect(disparos).toEqual([])
  })

  it('o encerramento só mexe no CNPJ do pedido: o pedido parado de OUTRO CNPJ continua como estava', async () => {
    await db.query(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio, estado, criado_em, atualizado_em)
                    values ($1, 'A. N. DA SILVA', 'PA', 'Abaetetuba', 'PENDENTE', now() - interval '3 days', now() - interval '3 days')`, [CNPJ_OUTRO])
    expect((await chamar(corpoNota())).status).toBe(200)
    expect((await pedidos()).map((p) => `${p.cnpj}:${p.estado}`).sort()).toEqual([`${CNPJ_OUTRO}:PENDENTE`, `${CNPJ_PLAST}:PENDENTE`].sort())
  })

  it('pedido recusado (400/403/409) não encerra nada', async () => {
    await inserirPedido('PENDENTE', '2 days')
    expect((await chamar(corpoNota({ cnpj: CNPJ_OUTRO }))).status).toBe(400)
    expect((await chamar(corpoNota(), 'tok-joao')).status).toBe(403)
    await db.exec(`update cot_nfe set lancamento_estado = 'lancando'`)
    expect((await chamar(corpoNota())).status).toBe(409)
    expect((await pedidos()).map((p) => p.estado)).toEqual(['PENDENTE'])
  })
})
