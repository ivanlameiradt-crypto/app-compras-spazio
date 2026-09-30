import {
  datasDoPeriodo, economia, ordenarItens, pontosDaCurva, textoEconomia, textoPct, zeroDaCurva,
} from '../../src/lib/contas'
import type { ItemEconomia, Metricas, SemanaPainel } from '../../src/lib/tipos'

// Fase 2, Bloco E1 (DESIGN-fase-2.md E.9, App teste 1): contas puras do painel de economia.

const m = (x: Partial<Metricas> = {}): Metricas => ({
  pedidos: 1, itens: 1, comparados: 1, sem_comparacao: 0, acima: 0,
  total_pedido: 0, total_ultimo: 0, diferenca: 0, pct: null, ...x,
})
const item = (produto: string, diferenca: number, x: Partial<ItemEconomia> = {}): ItemEconomia => ({
  ...m({ diferenca }), produto_id: produto.length, produto, unidade: 'un', categoria: 'Insumos',
  qtd: 1, preco_primeiro: null, preco_ultimo: null, variacao: null, pontos: [], ...x,
})
const semana = (data: string, acumulado: number): SemanaPainel => ({
  ...m(), semana_id: data.length, data_referencia: data, status: 'encerrada', acumulado, acumulado_desde_inicio: acumulado,
})

describe('datasDoPeriodo (relógio em 28/09/2026)', () => {
  const hoje = new Date(2026, 8, 28) // 28/09/2026, horário local
  it('este mês vai do dia 1 até hoje', () => {
    expect(datasDoPeriodo('este_mes', hoje)).toEqual({ de: '2026-09-01', ate: '2026-09-28' })
  })
  it('mês passado é o mês anterior inteiro', () => {
    expect(datasDoPeriodo('mes_passado', hoje)).toEqual({ de: '2026-08-01', ate: '2026-08-31' })
  })
  it('3 meses começa no primeiro dia de dois meses atrás', () => {
    expect(datasDoPeriodo('tres_meses', hoje)).toEqual({ de: '2026-07-01', ate: '2026-09-28' })
  })
  it('desde o piloto não fixa o início (de = null)', () => {
    expect(datasDoPeriodo('desde_inicio', hoje)).toEqual({ de: null, ate: '2026-09-28' })
  })
  it('mês passado na virada do ano volta ao ano anterior', () => {
    expect(datasDoPeriodo('mes_passado', new Date(2026, 0, 15))).toEqual({ de: '2025-12-01', ate: '2025-12-31' })
  })
})

describe('textoEconomia — as quatro frases', () => {
  it('sem itens comparáveis (nenhum comparado ou último = 0)', () => {
    expect(textoEconomia(m({ comparados: 0, total_ultimo: 0 }))).toBe('Sem itens comparáveis no período.')
    expect(textoEconomia(m({ comparados: 3, total_ultimo: 0, diferenca: -10 }))).toBe('Sem itens comparáveis no período.')
  })
  it('economizou (diferença negativa)', () => {
    expect(textoEconomia(m({ comparados: 2, total_pedido: 460, total_ultimo: 480, diferenca: -20, pct: 460 / 480 - 1 })))
      .toBe('Economizou R$ 20,00 (4,2% abaixo do último preço pago)')
  })
  it('pagou a mais (diferença positiva)', () => {
    expect(textoEconomia(m({ comparados: 2, total_pedido: 260, total_ultimo: 240, diferenca: 20, pct: 260 / 240 - 1 })))
      .toBe('Pagou R$ 20,00 a mais (8,3% acima do último preço pago)')
  })
  it('igual ao último preço', () => {
    expect(textoEconomia(m({ comparados: 2, total_pedido: 240, total_ultimo: 240, diferenca: 0, pct: 0 })))
      .toBe('Igual ao último preço pago.')
  })
})

describe('textoPct', () => {
  it('uma casa, sem sinal; null vira vazio', () => {
    expect(textoPct(0.053)).toBe('5,3%')
    expect(textoPct(-0.042)).toBe('4,2%')
    expect(textoPct(null)).toBe('')
  })
})

describe('economia', () => {
  it('é o oposto da diferença (positivo = economizou)', () => {
    expect(economia(m({ diferenca: -40 }))).toBe(40)
    expect(economia(m({ diferenca: 15 }))).toBe(-15)
  })
})

describe('ordenarItens', () => {
  const itens = [item('BANANA', 10), item('ARROZ', -30), item('CAFÉ', -5)]
  it('mais economia: a maior economia (menor diferença) primeiro', () => {
    expect(ordenarItens(itens, 'economia').map((i) => i.produto)).toEqual(['ARROZ', 'CAFÉ', 'BANANA'])
  })
  it('mais caros que o último: a maior diferença primeiro', () => {
    expect(ordenarItens(itens, 'acima').map((i) => i.produto)).toEqual(['BANANA', 'CAFÉ', 'ARROZ'])
  })
  it('A–Z por nome', () => {
    expect(ordenarItens(itens, 'nome').map((i) => i.produto)).toEqual(['ARROZ', 'BANANA', 'CAFÉ'])
  })
  it('não muda o array recebido', () => {
    const copia = [...itens]
    ordenarItens(itens, 'nome')
    expect(itens).toEqual(copia)
  })
})

describe('pontosDaCurva', () => {
  it('com todos os valores negativos, a linha do zero fica dentro do gráfico', () => {
    const semanas = [semana('2026-09-28', 40), semana('2026-10-05', 100)] // acumulado positivo → economia negativa
    const pts = pontosDaCurva(semanas, 320, 120)
    expect(pts.map((p) => [p.rotulo, p.valor])).toEqual([['28/09', -40], ['05/10', -100]])
    expect(pts[0].x).toBe(0)
    expect(pts[1].x).toBe(320)
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(0), expect(p.y).toBeLessThanOrEqual(120)
    const zero = zeroDaCurva(semanas, 120)
    expect(zero).toBeGreaterThanOrEqual(0)
    expect(zero).toBeLessThanOrEqual(120)
    expect(pts[1].y).toBe(120) // o pior acumulado no fundo do gráfico
  })
  it('sem semanas devolve lista vazia', () => {
    expect(pontosDaCurva([], 320, 120)).toEqual([])
  })
})
