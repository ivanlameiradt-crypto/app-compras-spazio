import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO, importar } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, responder, resp, chamar, erroDe, encerrar,
  payloadDe, V_FULANO, V_BELTRANO, type Json,
} from './fixture-cotacao'

// Fase 2, Bloco E1 (DESIGN-fase-2.md, E.4 e E.9, testes 1 a 6): painel de economia.
//   - view cot_economia_linhas (a "linha de pedido única"): somada por semana com a fórmula M, é idêntica
//     à cot_economia (teste 3);
//   - cot_painel_economia (teste 4): mês pela segunda-feira, acumulados, pct, período, papel, pedido desfeito,
//     bloco SisChef;
//   - cot_historico_item (teste 5): estados que entram, no_pedido, conferir, admin só;
//   - categorias (teste 6): sem linha em cot_categorias usa Bebidas/Insumos; com linha, a categoria.
// (Os testes 1 e 2 — a migration aplica e o md5(prosrc) das funções da 1B não muda — são o fase2-base.test.ts.)
const atual = bancoPorArquivo(async (db) => { await db.exec('truncate cot_categorias'); await semearCotacao(db) })
const banco = async () => atual()

const numeroDe = async (db: PGlite, cotId: number, produto: number): Promise<number> => {
  const r = await db.query<{ numero: number }>('select numero from cot_itens where cotacao_id = $1 and produto_id = $2', [cotId, produto])
  return Number(r.rows[0].numero)
}
const unidadeDe = async (db: PGlite, cotId: number, produto: number): Promise<string> => {
  const r = await db.query<{ unidade: string }>('select unidade from cot_itens where cotacao_id = $1 and produto_id = $2', [cotId, produto])
  return r.rows[0].unidade
}

interface LinhaPedido { produto: number; qtd: number; base: string; preco: number; respBase?: string }

/** Congela a cotação, responde os itens ("tem") e grava o pedido com as linhas dadas. */
async function pedido(db: PGlite, cotId: number, linhas: LinhaPedido[]): Promise<void> {
  const codigo = (await congelar(db, cotId)).codigo
  const respostas: Json[] = []
  for (const l of linhas) {
    const numero = await numeroDe(db, cotId, l.produto)
    respostas.push(resp(numero, 0, 'tem', { preco: l.preco, base: l.respBase ?? (await unidadeDe(db, cotId, l.produto)) }))
  }
  await responder(db, codigo, respostas)
  const itens: Json[] = []
  for (const l of linhas) {
    itens.push({ numero: await numeroDe(db, cotId, l.produto), qtd: l.qtd, base: l.base, embalagens: null, fator: null, preco_combinado: l.preco })
  }
  await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [cotId, JSON.stringify(itens)])
}

const painel = (db: PGlite, de: string | null = null, ate: string | null = null, quem = ADMIN) =>
  chamar(db, quem, 'cot_painel_economia($1, $2)', [de, ate])
const historico = (db: PGlite, produto: number, de: string | null = null, ate: string | null = null, quem = ADMIN) =>
  chamar(db, quem, 'cot_historico_item($1, $2, $3)', [produto, de, ate])

describe('E1 — cot_economia_linhas × cot_economia (teste 3: linha de pedido única)', () => {
  it('somada por semana com a fórmula M, é idêntica à cot_economia (comparável, antiga, sem ref, litro)', async () => {
    const db = await banco()
    // Semana 1: Fulano 101 (comparável) e 104 (ref antiga); Beltrano 106 (sem referência)
    const s1 = await aprovar(db)
    await preparar(db, s1)
    await pedido(db, await cotacaoDe(db, s1, V_FULANO), [
      { produto: 101, qtd: 60, base: 'un', preco: 2.2 },
      { produto: 104, qtd: 20, base: 'kg', preco: 5.5 },
    ])
    await pedido(db, await cotacaoDe(db, s1, V_BELTRANO), [{ produto: 106, qtd: 25, base: 'kg', preco: 3.5 }])
    await encerrar(db, s1)
    // Semana 2: Fulano 102 (comparável) e 103 como litro sem conversão; Beltrano 105 (comparável)
    const s2 = await aprovar(db, payloadDe('2026-10-26'), '2026-10-26T11:00:00Z', '2026-10-26T18:00:00Z')
    await preparar(db, s2)
    await pedido(db, await cotacaoDe(db, s2, V_FULANO), [
      { produto: 102, qtd: 48, base: 'un', preco: 3.3 },
      { produto: 103, qtd: 8, base: 'litro', preco: 4, respBase: 'kg' }, // pedido em litro sem kg_por_litro → sem conversão
    ])
    await pedido(db, await cotacaoDe(db, s2, V_BELTRANO), [{ produto: 105, qtd: 3, base: await unidadeDe(db, await cotacaoDe(db, s2, V_BELTRANO), 105), preco: 9 }])
    await encerrar(db, s2)
    // Semana 3: só Fulano 101 (comparável)
    const s3 = await aprovar(db, payloadDe('2026-11-02'), '2026-11-02T11:00:00Z', '2026-11-02T18:00:00Z')
    await preparar(db, s3)
    await pedido(db, await cotacaoDe(db, s3, V_FULANO), [{ produto: 101, qtd: 60, base: 'un', preco: 2.1 }])

    const eco = await como(db, ADMIN, `select semana_id, pedidos, itens_pedido, itens_com_referencia, itens_sem_comparacao,
      total_pedido, total_ultimo, diferenca from cot_economia order by semana_id`)
    const lin = await como(db, ADMIN, `
      select semana_id, count(distinct cotacao_id)::int as pedidos, count(*)::int as itens_pedido,
        count(*) filter (where comparavel)::int as itens_com_referencia,
        (count(*) - count(*) filter (where comparavel))::int as itens_sem_comparacao,
        round(coalesce(sum(valor_pedido), 0), 2) as total_pedido,
        round(coalesce(sum(valor_ultimo), 0), 2) as total_ultimo,
        round(coalesce(sum(valor_pedido), 0), 2) - round(coalesce(sum(valor_ultimo), 0), 2) as diferenca
      from cot_economia_linhas group by semana_id order by semana_id`)
    expect(lin).toEqual(eco)
    expect(eco.length).toBe(3)
    // os motivos batem com a regra: 104 antiga, 106 sem referência, 103 litro sem conversão
    const motivos = await como(db, ADMIN,
      `select produto_id, motivo_sem_comparacao from cot_economia_linhas where not comparavel order by produto_id`)
    expect(motivos).toEqual([
      { produto_id: 103, motivo_sem_comparacao: 'sem_conversao' },
      { produto_id: 104, motivo_sem_comparacao: 'ultimo_preco_antigo' },
      { produto_id: 106, motivo_sem_comparacao: 'sem_referencia' },
    ])
  })

  it('pedido desfeito some da view (a linha de cot_pedidos é apagada)', async () => {
    const db = await banco()
    const s1 = await aprovar(db)
    await preparar(db, s1)
    const f = await cotacaoDe(db, s1, V_FULANO)
    await pedido(db, f, [{ produto: 101, qtd: 60, base: 'un', preco: 2.2 }])
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_economia_linhas')).toEqual([{ n: 1 }])
    await chamar(db, ADMIN, 'cot_desfazer_pedido($1)', [f])
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_economia_linhas')).toEqual([{ n: 0 }])
  })
})

describe('E1 — cot_painel_economia (teste 4)', () => {
  /** Duas semanas com pedido: 28/09 (setembro) e 05/10 (outubro), ambas só Fulano com o item 101. */
  async function duasSemanas(db: PGlite): Promise<void> {
    const s1 = await aprovar(db, payloadDe('2026-09-28'), '2026-09-28T11:00:00Z', '2026-09-28T18:00:00Z')
    await preparar(db, s1)
    await pedido(db, await cotacaoDe(db, s1, V_FULANO), [{ produto: 101, qtd: 100, base: 'un', preco: 2.0 }]) // ref 2,40 → economia
    await encerrar(db, s1)
    const s2 = await aprovar(db, payloadDe('2026-10-05'), '2026-10-05T11:00:00Z', '2026-10-05T18:00:00Z')
    await preparar(db, s2)
    await pedido(db, await cotacaoDe(db, s2, V_FULANO), [{ produto: 101, qtd: 100, base: 'un', preco: 2.6 }]) // ref 2,40 → pagou mais
  }

  it('mês pela segunda-feira; acumulado no período e desde o piloto; total e desde_inicio', async () => {
    const db = await banco()
    await duasSemanas(db)
    const p = await painel(db, '2026-09-01', '2026-10-31')
    expect(p).toMatchObject({ de: '2026-09-01', ate: '2026-10-31', inicio: '2026-09-28' })
    // s1: 100 × 2,00 = 200; último 100 × 2,40 = 240; diferença −40. s2: 260 vs 240; +20. Total −20.
    expect(p.total).toMatchObject({ pedidos: 2, itens: 2, comparados: 2, total_pedido: 460, total_ultimo: 480, diferenca: -20 })
    expect(p.desde_inicio).toEqual({ diferenca: -20, semanas: 2 })
    // a semana de 28/09 cai em setembro; a de 05/10 em outubro
    expect(p.meses.map((m: Json) => m.mes)).toEqual(['2026-09-01', '2026-10-01'])
    expect(p.semanas.map((s: Json) => [s.data_referencia, s.diferenca, s.acumulado, s.acumulado_desde_inicio])).toEqual([
      ['2026-09-28', -40, -40, -40],
      ['2026-10-05', 20, -20, -20],
    ])
    expect(p.semanas[0].status).toBe('encerrada')
  })

  it('período só de outubro: o acumulado do período recomeça, o desde o início não', async () => {
    const db = await banco()
    await duasSemanas(db)
    const p = await painel(db, '2026-10-01', '2026-10-31')
    expect(p.semanas.map((s: Json) => [s.data_referencia, s.acumulado, s.acumulado_desde_inicio])).toEqual([
      ['2026-10-05', 20, -20], // acumulado do período = só a 05/10; desde o início ainda soma a de setembro (−40)
    ])
    expect(p.total.total_pedido).toBe(260)
  })

  it('pct nulo quando total_ultimo = 0 (só linhas sem comparação no período)', async () => {
    const db = await banco()
    const s1 = await aprovar(db)
    await preparar(db, s1)
    await pedido(db, await cotacaoDe(db, s1, V_BELTRANO), [{ produto: 106, qtd: 25, base: 'kg', preco: 3.5 }]) // 106 sem referência
    const p = await painel(db, '2026-10-01', '2026-10-31')
    expect(p.total).toMatchObject({ comparados: 0, total_ultimo: 0, pct: null })
    expect(p.semanas[0].pct).toBeNull()
  })

  it('período invertido e maior que 400 dias dão erro', async () => {
    const db = await banco()
    expect(await erroDe(painel(db, '2026-10-10', '2026-10-01'))).toBe('período inválido')
    expect(await erroDe(painel(db, '2025-01-01', '2026-06-01'))).toBe('período maior que 400 dias')
  })

  it('comprador → exigir_admin recusa; anon não executa', async () => {
    const db = await banco()
    expect(await erroDe(painel(db, null, null, JOAO))).toBe('apenas o administrador pode fazer isso')
    await expect(como(db, 'anon', 'select cot_painel_economia(null, null)')).rejects.toThrow(/permission denied/)
  })

  it('bloco SisChef: descarta preço fora de [0,5;2] do custo médio, exige 2 compras e ordena altas e quedas', async () => {
    const db = await banco()
    // Duas fotos (semanas) com datas de compra diferentes por produto.
    await importar(db, payloadDe('2026-10-05', (itens) => itens.map((i) => {
      if (i.produto_id === 101) return { ...i, data_ultima_compra: '2026-09-20', preco_estimado: 2.0, custo_medio: 2.0 }
      if (i.produto_id === 103) return { ...i, data_ultima_compra: '2026-09-20', preco_estimado: 6.0, custo_medio: 6.0 }
      if (i.produto_id === 102) return { ...i, data_ultima_compra: '2026-09-21', preco_estimado: 3.0, custo_medio: 3.0 }
      if (i.produto_id === 106) return { ...i, data_ultima_compra: '2026-09-22', preco_estimado: 4.0, custo_medio: 1.0 } // ratio 4 → descarta
      return i
    })))
    await importar(db, payloadDe('2026-10-12', (itens) => itens.map((i) => {
      if (i.produto_id === 101) return { ...i, data_ultima_compra: '2026-10-10', preco_estimado: 2.6, custo_medio: 2.5 } // +30% → alta
      if (i.produto_id === 103) return { ...i, data_ultima_compra: '2026-10-10', preco_estimado: 5.0, custo_medio: 5.0 } // −16,67% → queda
      if (i.produto_id === 102) return { ...i, data_ultima_compra: '2026-09-21', preco_estimado: 3.0, custo_medio: 3.0 } // mesma data → 1 compra só
      if (i.produto_id === 106) return { ...i, data_ultima_compra: '2026-10-11', preco_estimado: 5.0, custo_medio: 1.2 } // ratio > 2 → descarta
      return i
    })))
    const p = await painel(db, '2026-10-05', '2026-10-12')
    expect(p.sischef.altas.map((a: Json) => [a.produto_id, a.compras, a.primeiro.preco, a.ultimo.preco, a.variacao])).toEqual([
      [101, 2, 2.0, 2.6, 0.3],
    ])
    expect(p.sischef.quedas.map((a: Json) => [a.produto_id, a.variacao])).toEqual([[103, -0.1667]])
    // 102 (uma compra só) e 106 (as duas fora de [0,5;2] do custo médio) não entram
    const ids = [...p.sischef.altas, ...p.sischef.quedas].map((a: Json) => a.produto_id)
    expect(ids).not.toContain(102)
    expect(ids).not.toContain(106)
    expect(p.sischef.altas[0].primeiro.data).toBe('2026-09-20') // a base pode ser de antes do período
  })
})

describe('E1 — cot_historico_item (teste 5)', () => {
  it('exclui rascunho/liberada/substituida/cancelada; no_pedido correto; admin só', async () => {
    const db = await banco()
    const s1 = await aprovar(db)
    await preparar(db, s1)
    const f = await cotacaoDe(db, s1, V_FULANO)
    // v1 do Fulano: responde 101 e 102 com preço, e vira pedido só do 101
    await pedido(db, f, [{ produto: 101, qtd: 60, base: 'un', preco: 2.2 }])
    // uma cotação cancelada não deve aparecer no histórico
    const b = await cotacaoDe(db, s1, V_BELTRANO)
    const cb = (await congelar(db, b)).codigo
    await responder(db, cb, [resp(await numeroDe(db, b, 106), 0, 'tem', { preco: 3.5, base: 'kg' })])
    await chamar(db, ADMIN, 'cot_cancelar($1)', [b])

    const h = await historico(db, 101)
    expect(h).toMatchObject({ produto_id: 101, unidade: 'un', categoria: 'Bebidas' })
    expect(h.cotacoes).toHaveLength(1)
    expect(h.cotacoes[0]).toMatchObject({ vendedor: 'FORNECEDOR A', versao: 1, preco: 2.2, no_pedido: true })
    expect(h.pedidos).toHaveLength(1)
    expect(h.pedidos[0]).toMatchObject({ vendedor: 'FORNECEDOR A', qtd: 60, preco: 2.2, comparavel: true })
    // 106 estava só numa cotação cancelada → nada
    const h106 = await historico(db, 106)
    expect(h106.cotacoes).toEqual([])
    expect(h106.pedidos).toEqual([])
    // admin só
    expect(await erroDe(historico(db, 101, null, null, JOAO))).toBe('apenas o administrador pode fazer isso')
  })

  it('compras_sischef traz a compra fora de [0,5;2] com conferir = true; período > 731 dias dá erro', async () => {
    const db = await banco()
    await importar(db, payloadDe('2026-10-05', (itens) => itens.map((i) =>
      i.produto_id === 106 ? { ...i, data_ultima_compra: '2026-10-01', preco_estimado: 4.0, custo_medio: 1.0 } : i)))
    const h = await historico(db, 106, '2026-09-01', '2026-10-31')
    expect(h.compras_sischef).toHaveLength(1)
    expect(h.compras_sischef[0]).toMatchObject({ preco: 4, conferir: true }) // 4 / 1 fora de [0,5;2]
    expect(await erroDe(historico(db, 106, '2024-01-01', '2026-10-31'))).toBe('período maior que 731 dias')
  })
})

describe('E1 — categorias (teste 6)', () => {
  it('sem linha em cot_categorias a view usa Bebidas/Insumos; com linha, usa a categoria', async () => {
    const db = await banco()
    const s1 = await aprovar(db)
    await preparar(db, s1)
    await pedido(db, await cotacaoDe(db, s1, V_FULANO), [
      { produto: 101, qtd: 60, base: 'un', preco: 2.2 },   // bebida → Bebidas
      { produto: 103, qtd: 8, base: 'kg', preco: 5 },       // insumo → Insumos
    ])
    const antes = await como(db, ADMIN, 'select produto_id, categoria from cot_economia_linhas order by produto_id')
    expect(antes).toEqual([{ produto_id: 101, categoria: 'Bebidas' }, { produto_id: 103, categoria: 'Insumos' }])
    // com a categoria fina gravada, a view passa a usá-la
    await db.exec(`insert into cot_categorias (produto_id, categoria) values (101, 'Refrigerantes')`)
    const depois = await como(db, ADMIN, 'select produto_id, categoria from cot_economia_linhas order by produto_id')
    expect(depois).toEqual([{ produto_id: 101, categoria: 'Refrigerantes' }, { produto_id: 103, categoria: 'Insumos' }])
    const p = await painel(db, '2026-10-01', '2026-10-31')
    expect(p.categorias.map((c: Json) => c.categoria).sort()).toEqual(['Insumos', 'Refrigerantes'])
  })
})
