import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { como } from './banco'
import { semear, importar, ADMIN } from './fixture'
import { fixarRelogio } from './relogio'

// Fase 1B (cotação). Repositório PÚBLICO: tudo aqui é inventado — vendedores "Fulano"/"Beltrano",
// "FORNECEDOR A/B", telefones no formato de teste 55 + DDD + 90000 + 4 dígitos (D21), preços redondos.

export const FULANO = { codigo: 'fulano', nome: 'Fulano', empresa: 'FORNECEDOR A (Centro)', whatsapp: '5511900000001' }
export const BELTRANO = { codigo: 'beltrano', nome: 'Beltrano', empresa: 'FORNECEDOR B (Bairro)', whatsapp: '5511900000002' }
export const V_FULANO = 1
export const V_BELTRANO = 2

/** Seg 19/10/2026 (semana 19/10). Aprovada às 08:00 de Brasília; o Ivan prepara às 15:00. */
export const DATA_REF = '2026-10-19'
export const APROVADA_EM = '2026-10-19T11:00:00Z'
export const PREPARO = '2026-10-19T18:00:00Z' // seg 15:00 BRT → prazo ter 20/10 12:00, fechamento 17:00
export const PRAZO = '2026-10-20T15:00:00.000000Z'
export const FECHAMENTO = '2026-10-20T20:00:00.000000Z'

const item = (produto_id: number, produto: string, bebida: boolean, qtd_sugerida: number, preco_estimado: number | null,
  custo_medio: number | null, data_ultima_compra: string | null, fornecedor_ultima: string | null, situacao = 'Repor') => ({
  produto_id, produto, bebida, estoque: 1, estoque_minimo: 0, qtd_sugerida, preco_estimado, custo_medio,
  data_ultima_compra, fornecedor_ultima, situacao, selos: [],
})

/**
 * Semana inventada. Com Fulano ficam 101-104 (104 com referência antiga); com Beltrano, 105 (saco) e 106
 * (sem referência: último preço 4× o custo médio); 107 é de um fornecedor sem vendedor e 108 nunca foi
 * comprado; 109 (insumo negativo) e 110 (sem compra) ficam fora da lista.
 */
export const PAYLOAD_COTACAO = {
  data_referencia: DATA_REF,
  itens: [
    item(101, 'ÁGUA MINERAL 500ML', true, 60, 2.4, 2.3, '2026-10-09', 'FORNECEDOR A LTDA'),
    item(102, 'REFRIGERANTE LATA 350 ML', true, 48, 3, 2.9, '2026-10-15', 'FORNECEDOR A LTDA'),
    item(103, 'AÇÚCAR CRISTAL - INSUMOS (KG)', false, 8, 5, 5.1, '2026-10-01', 'Fornecedor  A Ltda'),
    item(104, 'LEITE INTREGAL - INSUMOS (KG)', false, 20, 6, 6, '2026-05-01', 'FORNECEDOR A LTDA'),
    item(105, 'GELO ESCAMA- INSUMOS (SC)', false, 3, 10, 10, '2026-10-10', 'FORNECEDOR B LTDA'),
    item(106, 'FARINHA DE TRIGO - INSUMOS (KG)', false, 25, 4, 1, '2026-10-05', 'FORNECEDOR B LTDA'),
    item(107, 'OVO - INSUMOS (UN)', false, 30, 0.8, 0.8, '2026-10-12', 'FORNECEDOR C ME'),
    item(108, 'ALHO - INSUMOS (KG)', false, 2, 20, 20, null, null),
    item(109, 'CANELA - INSUMOS (KG)', false, 1, 50, 50, '2026-09-01', 'FORNECEDOR A LTDA', 'ESTOQUE NEGATIVO'),
    item(110, 'SUCO LATA 350 ML', true, 0, 3, 3, '2026-10-01', 'FORNECEDOR A LTDA', 'Coberto por estoque'),
  ],
}

/** Usuários do App (fixture.ts) + os dois vendedores, os dois fornecedores e o feriado de 12/10. */
export async function semearCotacao(db: PGlite): Promise<void> {
  await semear(db)
  await db.exec(`
    insert into cot_vendedores (codigo, nome, empresa, whatsapp) values
      ('${FULANO.codigo}', '${FULANO.nome}', '${FULANO.empresa}', '${FULANO.whatsapp}'),
      ('${BELTRANO.codigo}', '${BELTRANO.nome}', '${BELTRANO.empresa}', '${BELTRANO.whatsapp}');
    insert into cot_fornecedores (nome_normalizado, nome_original, vendedor_id) values
      ('FORNECEDOR A LTDA', 'FORNECEDOR A LTDA', 1),
      ('FORNECEDOR B LTDA', 'FORNECEDOR B LTDA', 2);
    insert into cot_feriados (data, nome) values ('2026-10-12', 'Nossa Senhora Aparecida');
  `)
}

/** Importa a semana (robô), aprova como admin e fixa o carimbo da aprovação e o relógio. Devolve o id da semana. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aprovar(db: PGlite, payload: any = PAYLOAD_COTACAO, aprovadaEm = APROVADA_EM, agora = PREPARO): Promise<number> {
  const r = await importar(db, payload)
  await como(db, ADMIN, 'select aprovar_semana($1)', [r.semana_id])
  await db.query('update semanas set aprovada_em = $1 where id = $2', [aprovadaEm, r.semana_id])
  await fixarRelogio(db, agora)
  return Number(r.semana_id)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any

export async function preparar(db: PGlite, semana: number, quem = ADMIN): Promise<Json> {
  const [r] = await como(db, quem, 'select cot_preparar($1) as r', [semana])
  return r.r
}

/** Id da cotação do vendedor na semana, pela versão (ou a mais nova). */
export async function cotacaoDe(db: PGlite, semana: number, vendedor: number, versao?: number): Promise<number> {
  const r = await db.query<{ id: number }>(
    `select id from cot_cotacoes where semana_id = $1 and vendedor_id = $2 and ($3::int is null or versao = $3)
      order by versao desc limit 1`, [semana, vendedor, versao ?? null])
  if (!r.rows[0]) throw new Error(`sem cotação do vendedor ${vendedor} (v${versao ?? '?'})`)
  return Number(r.rows[0].id)
}

export async function congelar(db: PGlite, id: number, quem = ADMIN): Promise<Json> {
  const [r] = await como(db, quem, 'select cot_congelar($1) as r', [id])
  return r.r
}

export async function codigoDe(db: PGlite, id: number): Promise<string> {
  const r = await db.query<{ codigo: string }>('select codigo from cot_codigos where cotacao_id = $1', [id])
  if (!r.rows[0]) throw new Error(`cotação ${id} sem código`)
  return r.rows[0].codigo
}

/** Semana aprovada, preparada e a cotação do Fulano congelada (pronta). */
export async function prontaDoFulano(db: PGlite): Promise<{ semana: number; id: number; codigo: string }> {
  const semana = await aprovar(db)
  await preparar(db, semana)
  const id = await cotacaoDe(db, semana, V_FULANO)
  await congelar(db, id)
  return { semana, id, codigo: await codigoDe(db, id) }
}

export async function abrir(db: PGlite, codigo: string | null, previa = false, quem = 'anon'): Promise<Json> {
  const [r] = await como(db, quem, 'select cotacao_abrir($1, $2) as r', [codigo, previa])
  return r.r
}

export async function responder(db: PGlite, codigo: string, itens: Json, gerais: Json = null,
  envioId: string | null = randomUUID(), quem = 'anon'): Promise<Json> {
  const [r] = await como(db, quem, 'select cotacao_responder($1, $2, $3::jsonb, $4::jsonb) as r',
    [codigo, envioId, JSON.stringify(itens), gerais === null ? null : JSON.stringify(gerais)])
  return r.r
}

export async function responderAdmin(db: PGlite, id: number, itens: Json, gerais: Json = null,
  origem = 'ivan_digitou', envioId: string = randomUUID(), quem = ADMIN): Promise<Json> {
  const [r] = await como(db, quem, 'select cot_responder_admin($1, $2, $3::jsonb, $4::jsonb, $5) as r',
    [id, envioId, JSON.stringify(itens), gerais === null ? null : JSON.stringify(gerais), origem])
  return r.r
}

/** Linha de cot_itens pelo produto (como superusuário, para conferir o que ficou gravado). */
export async function linhaItem(db: PGlite, id: number, produto: number): Promise<Json> {
  const r = await db.query('select * from cot_itens where cotacao_id = $1 and produto_id = $2', [id, produto])
  return r.rows[0]
}

export async function cotacao(db: PGlite, id: number): Promise<Json> {
  const r = await db.query('select * from cot_cotacoes where id = $1', [id])
  return r.rows[0]
}

/** Chama uma função como `quem` e devolve a coluna r da primeira linha (select <expr> as r). */
export async function chamar(db: PGlite, quem: string, expr: string, params: unknown[] = []): Promise<Json> {
  const [r] = await como(db, quem, `select ${expr} as r`, params)
  return r.r
}

/** Etiquetas da semana (cot_marcas_semana) por item_semana_id. */
export async function marcas(db: PGlite, semana: number, quem = ADMIN): Promise<Record<number, Json>> {
  const linhas = await como(db, quem, 'select * from cot_marcas_semana($1)', [semana])
  return Object.fromEntries(linhas.map((l) => [Number(l.item_semana_id), l]))
}

/** Id de itens_semana do produto na semana. */
export async function itemDe(db: PGlite, semana: number, produto: number): Promise<number> {
  const r = await db.query<{ id: number }>('select id from itens_semana where semana_id = $1 and produto_id = $2', [semana, produto])
  return Number(r.rows[0].id)
}

/** Id de cot_itens do produto na cotação. */
export async function cotItemDe(db: PGlite, id: number, produto: number): Promise<number> {
  const r = await db.query<{ id: number }>('select id from cot_itens where cotacao_id = $1 and produto_id = $2', [id, produto])
  return Number(r.rows[0].id)
}

/** Produtos (produto_id) de uma cotação; só os incluídos com `incluidos`. */
export async function produtosDe(db: PGlite, id: number, incluidos = false): Promise<number[]> {
  const r = await db.query<{ p: number }>(
    `select produto_id as p from cot_itens where cotacao_id = $1 and (not $2 or incluido) order by produto_id`, [id, incluidos])
  return r.rows.map((x) => Number(x.p))
}

/** Retrato do banco da cotação (para comparar antes × depois): cotações, itens, catálogo e itens_semana inteiros. */
export async function retrato(db: PGlite): Promise<Json> {
  const c = await db.query('select * from cot_cotacoes order by id')
  const i = await db.query('select * from cot_itens order by id')
  const s = await db.query('select * from itens_semana order by id')
  const k = await db.query('select * from cot_catalogo order by produto_id')
  return { cotacoes: c.rows, itens: i.rows, itens_semana: s.rows, catalogo: k.rows }
}

/** Resposta de item no formato do envio (5.2); campos ausentes = null. */
export function resp(numero: number, rev_lida: number, estado: string, extra: Json = {}): Json {
  return { numero, rev_lida, estado, ...extra }
}

/** Mensagem de exceção de uma chamada que precisa falhar. */
export async function erroDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('a chamada deveria ter falhado')
}

/**
 * Muitas chamadas de uma função do vendedor numa consulta só, como `quem`: a função é volatile, então cada
 * chamada vê o que as anteriores gravaram, e o relógio de teste fixo põe todas na mesma janela de limite.
 * Devolve a contagem por código de erro ('ok' para as que devolvem ok: true).
 */
export async function muitas(db: PGlite, quem: string, n: number, expr: string, params: unknown[] = []): Promise<Record<string, number>> {
  const r = await como(db, quem,
    `select coalesce(r ->> 'erro', 'ok') as e, count(*)::int as n
       from (select ${expr} as r from generate_series(1, ${Math.trunc(n)})) x group by 1`, params)
  return Object.fromEntries(r.map((l) => [l.e, l.n]))
}

/** Encerra a semana como admin (a semana nova só é aprovada depois). */
export async function encerrar(db: PGlite, semana: number): Promise<void> {
  await como(db, ADMIN, 'select encerrar_semana($1)', [semana])
}

/** A mesma lista inventada, em outra semana. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function payloadDe(dataRef: string, alterar: (itens: any[]) => any[] = (x) => x): Json {
  return { data_referencia: dataRef, itens: alterar(PAYLOAD_COTACAO.itens.map((x) => ({ ...x }))) }
}

export { fixarRelogio, randomUUID }
