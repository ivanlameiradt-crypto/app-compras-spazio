import { bancoPorArquivo, como, novoBanco } from './banco'
import { semear, importar, idItem, idSemana, ADMIN, PAYLOAD } from './fixture'

// Fase 1A: o robô manda selos "conferir" e o custo médio junto com a lista (dados inventados).
const atual = bancoPorArquivo(semear)
const banco = async () => atual()

const SELO_LINHA = { codigo: 'linha_alta', texto: '≈ R$ 1.200,00 nesta linha (acima de R$ 1.000)' }
const SELO_PRECO = { codigo: 'preco_fora', texto: 'Última compra R$ 30,00/kg é 3,0× o custo médio (R$ 10,00) — confira a unidade no SisChef' }
const SELO_BEBIDA = { codigo: 'bebida_negativa', texto: 'Estoque −90 un (mais de 1 semana de venda no negativo) — confira a baixa no SisChef antes de comprar 250 un' }

const COM_SELOS = {
  data_referencia: '2026-09-28',
  itens: [
    { produto_id: 11, produto: 'COCO RALADO - INSUMOS (KG)', bebida: false, estoque: 5, estoque_minimo: 55, qtd_sugerida: 50, preco_estimado: 20, custo_medio: 6.5, data_ultima_compra: '2026-09-10', fornecedor_ultima: 'FORNECEDOR A', situacao: 'ABAIXO DO MÍNIMO', selos: [SELO_LINHA, SELO_PRECO] },
    { produto_id: 12, produto: 'SUCO LATA 350 ML', bebida: true, estoque: -4, estoque_minimo: 62, qtd_sugerida: 128, preco_estimado: 2.5, custo_medio: 2.4, data_ultima_compra: '2026-09-10', fornecedor_ultima: 'FORNECEDOR B', situacao: 'ESTOQUE NEGATIVO', selos: [] },
    { produto_id: 13, produto: 'REFRI LATA 350 ML', bebida: true, estoque: -90, estoque_minimo: 80, qtd_sugerida: 250, preco_estimado: 3, custo_medio: 3, data_ultima_compra: '2026-09-10', fornecedor_ultima: 'FORNECEDOR B', situacao: 'ESTOQUE NEGATIVO', selos: [SELO_BEBIDA] },
    { produto_id: 14, produto: 'COMINHO - INSUMOS (KG)', bebida: false, estoque: -12, estoque_minimo: 0, qtd_sugerida: 12, preco_estimado: 40, custo_medio: 38, data_ultima_compra: null, fornecedor_ultima: null, situacao: 'ESTOQUE NEGATIVO', selos: [] },
    { produto_id: 15, produto: 'AÇÚCAR - INSUMOS (KG)', bebida: false, estoque: 2, estoque_minimo: 10, qtd_sugerida: 8, preco_estimado: 5, custo_medio: 5.1, data_ultima_compra: '2026-09-01', fornecedor_ultima: 'FORNECEDOR A', situacao: 'ABAIXO DO MÍNIMO', selos: [] },
  ],
}

type Linha = { produto_id: number; incluido: boolean; qtd_aprovada: number; negativo: boolean; selos: unknown[] }

async function linhas(db: Awaited<ReturnType<typeof banco>>): Promise<Record<number, Linha>> {
  const r = await como(db, ADMIN, 'select produto_id, incluido, qtd_aprovada, negativo, selos from itens_semana order by produto_id')
  return Object.fromEntries(r.map((x) => [Number(x.produto_id), { ...x, produto_id: Number(x.produto_id), qtd_aprovada: Number(x.qtd_aprovada) }]))
}

function comItem(item: Record<string, unknown>) {
  return { data_referencia: '2026-09-28', itens: [{ ...COM_SELOS.itens[4], ...item }] }
}

describe('importar_semana com selos (Fase 1A)', () => {
  it('item com selo chega fora da lista (incluido = false, qtd_aprovada = 0) e guarda os selos', async () => {
    const db = await banco()
    expect(await importar(db, COM_SELOS)).toEqual({ resultado: 'criada', semana_id: expect.any(Number), itens: 5, selos: true, regras: { barrados: 0, incluidos: 0 } })
    const l = await linhas(db)
    expect([l[11].incluido, l[11].qtd_aprovada]).toEqual([false, 0])
    expect(l[11].selos).toEqual([SELO_LINHA, SELO_PRECO])
    const [q] = await como(db, ADMIN, 'select qtd_sugerida from itens_semana where produto_id = 11')
    expect(Number(q.qtd_sugerida)).toBe(50) // o "Incluir (50 kg)" do App usa a sugestão, que continua gravada
    expect([l[15].incluido, l[15].qtd_aprovada, l[15].selos]).toEqual([true, 8, []])
  })

  it('bebida negativa sem selo entra na lista com a qtd_sugerida; com selo bebida_negativa, fica para conferir', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    const l = await linhas(db)
    expect([l[12].negativo, l[12].incluido, l[12].qtd_aprovada]).toEqual([false, true, 128])
    expect([l[13].negativo, l[13].incluido, l[13].qtd_aprovada]).toEqual([false, false, 0])
    expect(l[13].selos).toEqual([SELO_BEBIDA])
    expect([l[14].negativo, l[14].incluido, l[14].qtd_aprovada]).toEqual([true, false, 0]) // insumo negativo: aba Negativos
  })

  it('"Incluir" de um item com selo (ajustar_item com a qtd_sugerida) põe o item na lista', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    await como(db, ADMIN, 'select ajustar_item($1, 50, true)', [await idItem(db, 11, '2026-09-28')])
    const l = await linhas(db)
    expect([l[11].incluido, l[11].qtd_aprovada]).toEqual([true, 50])
  })

  it('payload sem selos nem custo_medio (formato antigo) se comporta como hoje', async () => {
    const db = await banco()
    // o payload antigo continua aceito; a resposta traz "selos": true do mesmo jeito (identifica o banco, não o payload)
    expect(await importar(db)).toEqual({ resultado: 'criada', semana_id: expect.any(Number), itens: 5, selos: true, regras: { barrados: 0, incluidos: 0 } })
    const r = await como(db, ADMIN, 'select produto_id, unidade, negativo, incluido, qtd_aprovada, selos, custo_medio from itens_semana order by produto_id')
    expect(r.map((i) => [Number(i.produto_id), i.unidade, i.negativo, i.incluido, Number(i.qtd_aprovada), i.selos, i.custo_medio])).toEqual([
      [1, 'un', false, true, 52, [], null],
      [2, 'un', false, true, 148, [], null],
      [3, 'kg', false, true, 1.2, [], null],
      [4, 'kg', true, false, 0, [], null],
      [5, 'un', false, false, 0, [], null],
    ])
  })

  it('selos: null conta como sem selo', async () => {
    const db = await banco()
    await importar(db, comItem({ selos: null }))
    const l = await linhas(db)
    expect([l[15].incluido, l[15].qtd_aprovada, l[15].selos]).toEqual([true, 8, []])
  })

  it('texto do selo com exatamente 200 caracteres é aceito', async () => {
    const db = await banco()
    await importar(db, comItem({ selos: [{ codigo: 'fracao_un', texto: 'x'.repeat(200) }] }))
    const l = await linhas(db)
    expect(l[15].incluido).toBe(false)
  })

  const invalidos: [string, unknown][] = [
    ['código fora da lista', [{ codigo: 'qtd_alta', texto: 'antigo' }]],
    ['sem código', [{ texto: 'sem código' }]],
    ['código que não é texto', [{ codigo: 1, texto: 'número' }]],
    ['texto vazio', [{ codigo: 'linha_alta', texto: '' }]],
    ['texto com 201 caracteres', [{ codigo: 'linha_alta', texto: 'x'.repeat(201) }]],
    ['texto que não é texto', [{ codigo: 'linha_alta', texto: 1000 }]],
    ['sem texto', [{ codigo: 'linha_alta' }]],
    ['selo que não é objeto', ['linha_alta']],
    ['selos que não são lista', { codigo: 'linha_alta', texto: 'objeto solto' }],
  ]
  it.each(invalidos)('selo inválido (%s) → nada gravado', async (_, selos) => {
    const db = await banco()
    const ruim = { ...COM_SELOS, itens: [...COM_SELOS.itens, { ...COM_SELOS.itens[4], produto_id: 16, selos }] }
    await expect(importar(db, ruim)).rejects.toThrow(/selo/)
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(0)
    expect(await como(db, ADMIN, 'select * from itens_semana')).toHaveLength(0)
  })

  it('selo inválido numa reimportação não mexe no rascunho que já existia', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    const antes = await como(db, ADMIN, 'select * from itens_semana order by id')
    await expect(importar(db, comItem({ selos: [{ codigo: 'outro', texto: 'x' }] }))).rejects.toThrow(/selo inválido/)
    expect(await como(db, ADMIN, 'select * from itens_semana order by id')).toEqual(antes)
  })

  it('preco_estimado e custo_medio 0 (ou negativos) viram null, sem exceção; positivos ficam', async () => {
    const db = await banco()
    await importar(db, {
      data_referencia: '2026-09-28',
      itens: [
        { ...COM_SELOS.itens[4], produto_id: 21, preco_estimado: 0, custo_medio: 0 },
        { ...COM_SELOS.itens[4], produto_id: 22, preco_estimado: -1, custo_medio: -3 },
        { ...COM_SELOS.itens[4], produto_id: 23, preco_estimado: null, custo_medio: null },
        { ...COM_SELOS.itens[4], produto_id: 24, preco_estimado: 7.25, custo_medio: 6.9 },
      ],
    })
    const r = await como(db, ADMIN, 'select produto_id, preco_estimado, custo_medio from itens_semana order by produto_id')
    expect(r.map((i) => [Number(i.produto_id), i.preco_estimado === null ? null : Number(i.preco_estimado), i.custo_medio === null ? null : Number(i.custo_medio)]))
      .toEqual([[21, null, null], [22, null, null], [23, null, null], [24, 7.25, 6.9]])
  })

  it('custo_medio 0 gravado direto na tabela é recusado (a coluna só aceita > 0 ou null)', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    await expect(db.exec('update itens_semana set custo_medio = 0 where produto_id = 15')).rejects.toThrow(/check/)
    await expect(db.exec(`update itens_semana set selos = '{}'::jsonb where produto_id = 15`)).rejects.toThrow(/check/)
  })

  it('reimportar em rascunho substitui a lista inteira, selos inclusive (ajustes feitos antes se perdem)', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    await como(db, ADMIN, 'select ajustar_item($1, 50, true)', [await idItem(db, 11, '2026-09-28')])
    const novo = {
      ...COM_SELOS,
      itens: [
        { ...COM_SELOS.itens[0], selos: [] },
        { ...COM_SELOS.itens[4], selos: [SELO_LINHA] },
      ],
    }
    const r = await importar(db, novo)
    expect(r).toEqual({ resultado: 'substituida', semana_id: expect.any(Number), itens: 2, selos: true, regras: { barrados: 0, incluidos: 0 } })
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(1)
    const l = await linhas(db)
    expect(Object.keys(l).map(Number)).toEqual([11, 15])
    expect([l[11].incluido, l[11].qtd_aprovada, l[11].selos]).toEqual([true, 50, []])
    expect([l[15].incluido, l[15].qtd_aprovada, l[15].selos]).toEqual([false, 0, [SELO_LINHA]])
  })

  it('ja_aprovada: semana já aprovada não muda nada, nem com selos e quantidades novos', async () => {
    const db = await banco()
    await importar(db, COM_SELOS)
    const s = await idSemana(db, '2026-09-28')
    await como(db, ADMIN, 'select aprovar_semana($1)', [s])
    const antes = await como(db, ADMIN, 'select * from itens_semana order by id')
    const [semAntes] = await como(db, ADMIN, 'select * from semanas')
    const outro = { ...COM_SELOS, itens: COM_SELOS.itens.map((i) => ({ ...i, qtd_sugerida: 1, custo_medio: 99, selos: [SELO_LINHA] })) }
    expect(await importar(db, outro)).toEqual({ resultado: 'ja_aprovada', semana_id: s, selos: true })
    expect(await como(db, ADMIN, 'select * from itens_semana order by id')).toEqual(antes)
    expect(await como(db, ADMIN, 'select * from semanas')).toEqual([semAntes])
  })
})

describe('"selos": true na resposta — o robô reconhece o banco antigo pela falta da chave', () => {
  it('payload antigo reimportado em rascunho e depois numa semana aprovada: substituida e ja_aprovada trazem a chave', async () => {
    const db = await banco()
    await importar(db)
    expect(await importar(db)).toMatchObject({ resultado: 'substituida', selos: true })
    await como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db, '2026-09-22')])
    expect(await importar(db)).toMatchObject({ resultado: 'ja_aprovada', selos: true })
  })

  it('o importar_semana de antes desta migration (0002) aceita o payload com selos e responde sem a chave', async () => {
    const antigo = await novoBanco('20260928000001')
    try {
      await semear(antigo)
      const r = await importar(antigo, { ...PAYLOAD, itens: PAYLOAD.itens.map((i) => ({ ...i, selos: [SELO_LINHA], custo_medio: 1 })) })
      expect(r.resultado).toBe('criada')
      expect(r).not.toHaveProperty('selos')
    } finally {
      await antigo.close()
    }
  })
})

describe('unidade derivada do nome (regra do App)', () => {
  it('"(KG)", "- INSUMOS (KG)", "( KG )" são kg; "(SC)" e nome sem unidade são un', async () => {
    const db = await banco()
    const nomes: [number, string][] = [
      [31, 'MOLHO DA CASA (KG)'],
      [32, 'MOLHO BRANCO- INSUMOS (KG)'],
      [33, 'FARINHA ESPECIAL - INSUMOS ( KG )'],
      [34, 'CARVÃO- INSUMOS (SC)'],
      [35, 'BETERRABA - UND -INSUMOS (KG)'],
      [36, 'queijo ralado (kg)'],
      [37, 'PÃO DE FORMA - INSUMOS (UN)'],
      [38, 'ÁGUA MINERAL 500 ML'],
    ]
    await importar(db, { data_referencia: '2026-09-28', itens: nomes.map(([produto_id, produto]) => ({ ...COM_SELOS.itens[4], produto_id, produto })) })
    const r = await como(db, ADMIN, 'select produto_id, unidade from itens_semana order by produto_id')
    expect(r.map((i) => [Number(i.produto_id), i.unidade])).toEqual([
      [31, 'kg'], [32, 'kg'], [33, 'kg'], [34, 'un'], [35, 'kg'], [36, 'kg'], [37, 'un'], [38, 'un'],
    ])
  })
})

