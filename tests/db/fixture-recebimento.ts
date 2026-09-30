import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { novoBanco, como } from './banco'
import { fixarRelogio } from './relogio'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, responder, resp, chamar,
  V_FULANO, type Json,
} from './fixture-cotacao'
import { ADMIN } from './fixture'

// Fase 2, Bloco D (recebimento e NF-e). Testes de banco no pglite, com fixtures INVENTADAS. Rodam contra a
// cadeia de migrations ATÉ a D2 (base + E1 + D1 + D2), sem a B (que é construída por outra frente em paralelo
// e, sendo a última por nome de arquivo, reaplicaria a lista de permissões sem as funções da D até integrar a
// D). Assim os testes da D são determinísticos. A integração da lista completa com a B é acompanhada à parte.
const ATE_D2 = '20261104000001_ia_leitura.sql' // exclusivo: aplica tudo que vem antes deste nome

// Segredo do robô de NF-e (256 bits em hex). Inventado (repositório público).
export const SEGREDO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

/** Um banco por arquivo, cadeia até a D2, com o segredo do robô no Vault e a cotação semeada a cada teste. */
export function bancoRecebimento(): () => PGlite {
  let db: PGlite | undefined
  beforeAll(async () => { db = await novoBanco(ATE_D2) })
  beforeEach(async () => {
    // truncate próprio (a cadeia até a D2 não tem as tabelas da B que o limpar() compartilhado trunca)
    await db!.exec(
      'truncate usuarios, semanas, itens_semana, compras, compras_itens, historico_alteracoes, ' +
        'cot_vendedores, cot_fornecedores, cot_catalogo, cot_feriados, cot_cadastros_aplicados, cot_cotacoes, ' +
        'cot_codigos, cot_itens, cot_envios, cot_pedidos, cot_limites, cot_avisos, cot_categorias, ' +
        'cot_pedidos_acomp, cot_recebimentos, cot_fornecedores_cnpj, cot_nfe, cot_nfe_leituras restart identity cascade',
    )
    await fixarRelogio(db!, null)
    await db!.exec('truncate vault.decrypted_secrets')
    await db!.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('cot_nfe_robo', '${SEGREDO}')`)
    await semearCotacao(db!)
  })
  afterAll(async () => { await db?.close() })
  return () => db!
}

const numeroDe = async (db: PGlite, cotId: number, produto: number): Promise<number> => {
  const r = await db.query<{ numero: number }>('select numero from cot_itens where cotacao_id = $1 and produto_id = $2', [cotId, produto])
  return Number(r.rows[0].numero)
}
export const unidadeDe = async (db: PGlite, cotId: number, produto: number): Promise<string> => {
  const r = await db.query<{ unidade: string }>('select unidade from cot_itens where cotacao_id = $1 and produto_id = $2', [cotId, produto])
  return r.rows[0].unidade
}

export interface LinhaPedido { produto: number; qtd: number; base: string; preco: number; respBase?: string; embalagens?: number | null; fator?: number | null; marca?: string }

/** Congela a cotação, responde os itens ("tem") e grava o pedido com as linhas dadas. Devolve os números por produto. */
export async function pedido(db: PGlite, cotId: number, linhas: LinhaPedido[]): Promise<Record<number, number>> {
  const codigo = (await congelar(db, cotId)).codigo
  const respostas: Json[] = []
  const nums: Record<number, number> = {}
  for (const l of linhas) {
    const numero = await numeroDe(db, cotId, l.produto)
    nums[l.produto] = numero
    const extra: Json = { preco: l.preco, base: l.respBase ?? (await unidadeDe(db, cotId, l.produto)) }
    if (l.marca) extra.marca = l.marca
    respostas.push(resp(numero, 0, 'tem', extra))
  }
  await responder(db, codigo, respostas)
  const itens: Json[] = []
  for (const l of linhas) {
    itens.push({ numero: nums[l.produto], qtd: l.qtd, base: l.base, embalagens: l.embalagens ?? null, fator: l.fator ?? null, preco_combinado: l.preco })
  }
  await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [cotId, JSON.stringify(itens)])
  return nums
}

/** Semana aprovada, preparada, e o pedido do Fulano com as linhas dadas. Devolve {semana, cotacao, numeros}. */
export async function semanaComPedido(db: PGlite, linhas: LinhaPedido[]): Promise<{ semana: number; cotacao: number; numeros: Record<number, number> }> {
  const semana = await aprovar(db)
  await preparar(db, semana)
  const cotacao = await cotacaoDe(db, semana, V_FULANO)
  const numeros = await pedido(db, cotacao, linhas)
  return { semana, cotacao, numeros }
}

export { como, chamar, aprovar, preparar, cotacaoDe, fixarRelogio, ADMIN, V_FULANO }
