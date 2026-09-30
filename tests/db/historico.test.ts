import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import { semearCotacao, aprovar, preparar, congelar, cotacaoDe, chamar, V_FULANO, type Json } from './fixture-cotacao'
import { pedido } from './fixture-recebimento'

// Fase 2, Bloco C2 (DESIGN-fase-2.md, C.4.10, C.10 nº 23): as views de histórico. O dinheiro vem da linha de
// pedido do E (cot_economia_linhas), então Histórico, painel de economia e Resumo nunca discordam (X4).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

/** Semana aprovada, preparada, com um pedido do Fulano em 101 e 102 (só o Fulano tem pedido: X4 = 1 vendedor/semana). */
async function comPedido(db: PGlite): Promise<{ semana: number; cot: number }> {
  const semana = await aprovar(db)
  await preparar(db, semana)
  const cot = await cotacaoDe(db, semana, V_FULANO)
  await pedido(db, cot, [ // congela, responde "tem" e grava o pedido (resultado = 'pedido')
    { produto: 101, qtd: 60, base: 'un', preco: 2.5, respBase: 'un' },
    { produto: 102, qtd: 48, base: 'un', preco: 3, respBase: 'un' },
  ])
  return { semana, cot }
}

describe('C2 — histórico (C.10 nº 23)', () => {
  it('as views só retornam linhas para o admin', async () => {
    const db = await banco()
    await comPedido(db)
    expect((await como(db, ADMIN, 'select * from cot_historico_semanas')).length).toBeGreaterThan(0)
    expect((await como(db, ADMIN, 'select * from cot_historico_itens')).length).toBeGreaterThan(0)
    expect(await como(db, JOAO, 'select * from cot_historico_semanas')).toEqual([])
    expect(await como(db, JOAO, 'select * from cot_historico_itens')).toEqual([])
  })

  it('cot_historico_semanas: desfecho pedido, e no_pedido/qtd_pedido nos itens do pedido', async () => {
    const db = await banco()
    const { semana, cot } = await comPedido(db)
    const [s] = await como(db, ADMIN, 'select * from cot_historico_semanas where semana_id = $1 and vendedor_id = $2', [semana, V_FULANO])
    expect(s.desfecho).toBe('pedido')
    expect(Number(s.pedido_itens)).toBe(2)
    const itens = await como(db, ADMIN, 'select produto_id, no_pedido, qtd_pedido from cot_historico_itens where cotacao_id = $1 order by produto_id', [cot])
    expect(itens.find((i: Json) => Number(i.produto_id) === 101)).toMatchObject({ no_pedido: true, qtd_pedido: '60' })
  })

  it('item de versão substituída não aparece; a v2 congelada aparece', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const v1 = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, v1)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [v1]) // "Já enviei": vira enviada
    await chamar(db, ADMIN, 'cot_nova_versao($1)', [v1]) // v1 → substituida, v2 rascunho
    const v2 = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, v2)
    const cots = await como(db, ADMIN, 'select distinct cotacao_id from cot_historico_itens where semana_id = $1', [semana])
    expect(cots.map((c: Json) => Number(c.cotacao_id))).toEqual([v2]) // só a v2, não a v1 substituída
  })

  it('X4: total_pedido/total_ultimo/diferenca somados por semana batem com cot_economia', async () => {
    const db = await banco()
    const { semana } = await comPedido(db)
    const [h] = await como(db, ADMIN,
      `select coalesce(sum(total_pedido), 0) as tp, coalesce(sum(total_ultimo), 0) as tu, coalesce(sum(diferenca), 0) as dif
         from cot_historico_semanas where semana_id = $1`, [semana])
    const [e] = await como(db, ADMIN, 'select total_pedido as tp, total_ultimo as tu, diferenca as dif from cot_economia where semana_id = $1', [semana])
    expect([h.tp, h.tu, h.dif]).toEqual([e.tp, e.tu, e.dif])
  })
})
