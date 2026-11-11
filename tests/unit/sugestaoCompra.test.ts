import { describe, expect, it } from 'vitest'
import { quantoComprar, sugerirCompras, type LinhaCompra, type ProdutoHistorico } from '../../src/lib/sugestaoCompra'

// Conta de "quanto comprar" a partir do histórico de compras do SisChef (11/11/2026). Dados INVENTADOS.
const HOJE = '2026-11-11'
/** Data N dias antes de HOJE. */
const dia = (n: number): string => new Date(Date.UTC(2026, 10, 11 - n)).toISOString().slice(0, 10)
const l = (diasAtras: number, qtd: number, custo = 1, fornecedor = 'F1'): LinhaCompra =>
  ({ data: dia(diasAtras), fornecedor, referencia: null, qtd, precoUnit: custo, custoLiquido: custo })
const prod = (produtoId: number, linhas: LinhaCompra[], nome = `P${produtoId}`): ProdutoHistorico => ({ produtoId, nome, unidade: 'KG', linhas })

// batata: 8 compras em 8 semanas somando 842 kg (números de conferência reais, dados montados)
const BATATA = prod(1, [100, 110, 95, 120, 105, 102, 100, 110].map((q, k) => l(k * 7 + 1, q, 0.79)), 'BATATA')

describe('sugerirCompras', () => {
  it('batata: média 105,25 por semana e alvo ≈ 131,56 (folga 25%)', () => {
    const [s] = sugerirCompras([BATATA], HOJE)
    expect(s.compras).toBe(8)
    expect(s.semanas).toBe(8)
    expect(s.janelaEncolhida).toBe(false)
    expect(s.mediaSemana).toBeCloseTo(105.25, 6)
    expect(s.alvo).toBeCloseTo(131.5625, 6)
    expect(s.gastoSemana).toBeCloseTo((842 * 0.79) / 8, 6)
    expect(s.esporadico).toBe(false)
  })

  it('compra fora da janela de 8 semanas não conta; produto sem compra na janela sai da lista', () => {
    const r = sugerirCompras([prod(1, [l(3, 10), l(70, 999)]), prod(2, [l(60, 5)])], HOJE)
    expect(r.map((s) => s.produtoId)).toEqual([1])
    expect(r[0].compras).toBe(1)
  })

  it('esporádico (1 compra na janela): sem alvo', () => {
    const [s] = sugerirCompras([prod(1, [l(3, 10)])], HOJE)
    expect(s.esporadico).toBe(true)
    expect(s.alvo).toBeNull()
    expect(s.mediaSemana).toBeCloseTo(10 / 8, 6)
  })

  it('janela encolhida: 10+ linhas e a mais antiga dentro da janela → começa nela (mínimo 1 semana)', () => {
    const dez = Array.from({ length: 10 }, (_, k) => l(k * 3, 7)) // a mais antiga há 27 dias
    const [s] = sugerirCompras([prod(1, dez)], HOJE)
    expect(s.janelaEncolhida).toBe(true)
    expect(s.semanas).toBeCloseTo(27 / 7, 6)
    expect(s.mediaSemana).toBeCloseTo(70 / (27 / 7), 6)
    const [m] = sugerirCompras([prod(1, Array.from({ length: 10 }, () => l(2, 1)))], HOJE)
    expect(m.semanas).toBe(1)
    // com 9 linhas não encolhe
    const [n] = sugerirCompras([prod(1, dez.slice(0, 9))], HOJE)
    expect(n.janelaEncolhida).toBe(false)
    expect(n.semanas).toBe(8)
  })

  it('ordena por gasto semanal e classifica A/B/C pelo acumulado (80% / 95%)', () => {
    const r = sugerirCompras([
      prod(1, [l(1, 10), l(8, 10)]),      // gasto 20
      prod(2, [l(1, 100), l(8, 60)]),     // gasto 160
      prod(3, [l(1, 1), l(8, 1)]),        // gasto 2
      prod(4, [l(1, 9), l(8, 9)]),        // gasto 18
    ], HOJE)
    expect(r.map((s) => s.produtoId)).toEqual([2, 1, 4, 3])
    // total 200: 2 = 80% (A); 1 leva a 90% (B); 4 leva a 99% (C); 3 (C)
    expect(r.map((s) => s.classe)).toEqual(['A', 'B', 'C', 'C'])
  })

  it('fornecedores: último custo de cada um nos últimos 90 dias; melhor = o mais barato; outros em ordem de preço', () => {
    const [s] = sugerirCompras([prod(1, [l(1, 5, 1.2, 'B'), l(10, 5, 0.9, 'B'), l(5, 5, 1.0, 'A'), l(20, 5, 1.5, 'C'), l(100, 5, 0.1, 'D')])], HOJE)
    expect(s.fornecedores.conferirUnidade).toBe(false)
    expect(s.fornecedores.melhor).toEqual({ fornecedor: 'A', custo: 1.0, data: dia(5) })
    expect(s.fornecedores.outros).toEqual([{ fornecedor: 'B', custo: 1.2, data: dia(1) }, { fornecedor: 'C', custo: 1.5, data: dia(20) }])
  })

  it('trava: maior preço mais que o dobro do menor → conferirUnidade e nunca "melhor"', () => {
    const [s] = sugerirCompras([prod(1, [l(1, 5, 2.01, 'A'), l(5, 5, 1, 'B')])], HOJE)
    expect(s.fornecedores.conferirUnidade).toBe(true)
    expect(s.fornecedores.melhor).toBeNull()
    expect(s.fornecedores.outros.map((f) => f.fornecedor)).toEqual(['B', 'A'])
    const [t] = sugerirCompras([prod(1, [l(1, 5, 2, 'A'), l(5, 5, 1, 'B')])], HOJE)
    expect(t.fornecedores.conferirUnidade).toBe(false)
  })

  it('parâmetros mudam janela e folga', () => {
    const [s] = sugerirCompras([BATATA], HOJE, { semanas: 4, folga: 0 })
    expect(s.compras).toBe(4)
    expect(s.alvo).toBeCloseTo(s.mediaSemana, 9)
  })
})

describe('quantoComprar', () => {
  it('usa a contagem; senão o estoque do SisChef se ≥ 0; senão null (precisa contar)', () => {
    expect(quantoComprar(131.5625, 40, 999)).toBe(91.6)
    expect(quantoComprar(131.5625, null, 31.5)).toBe(100.1)
    expect(quantoComprar(131.5625, null, -3)).toBeNull()
    expect(quantoComprar(131.5625, null, null)).toBeNull()
    expect(quantoComprar(10, 0, null)).toBe(10)
  })

  it('nunca negativo e arredonda para cima em 1 casa', () => {
    expect(quantoComprar(10, 15, null)).toBe(0)
    expect(quantoComprar(10.01, 0, null)).toBe(10.1)
    expect(quantoComprar(10.3, 0.1, null)).toBe(10.2)
  })
})
