import { item } from '../fabricas'
import type { SugestaoProduto } from '../../src/lib/sugestaoCompra'
import {
  abaPrincipais, montarLinha, montarLinhas, resumoContagem, totalEstimadoLista, itensParaGravar,
} from '../../src/admin/listaSemanaRegras'

const sug = (x: Partial<SugestaoProduto> = {}): SugestaoProduto => ({
  produtoId: 1, nome: 'X', unidade: 'kg', semanas: 8, janelaEncolhida: false, compras: 5, mediaSemana: 8, alvo: 10, gastoSemana: 100,
  esporadico: false, classe: 'A',
  fornecedores: { melhor: { fornecedor: 'FORNECEDOR A', custo: 5, data: '2026-11-01' }, outros: [{ fornecedor: 'FORNECEDOR B', custo: 6, data: '2026-10-20' }], conferirUnidade: false },
  ...x,
})

describe('montarLinha', () => {
  it('usa alvo, contagem e calcula quanto comprar', () => {
    const l = montarLinha(item({ produto_id: 1, unidade: 'kg', estoque: 2 }), sug(), 4, undefined)
    expect(l.alvo).toBe(10)
    expect(l.comprar).toBe(6)
    expect(l.ajustado).toBe(false)
  })
  it('sem contagem usa o estoque do SisChef', () => {
    expect(montarLinha(item({ estoque: 3 }), sug(), null, undefined).comprar).toBe(7)
  })
  it('estoque negativo e sem contagem: "contar", sem número e fora do total', () => {
    const l = montarLinha(item({ estoque: -4, preco_estimado: 5 }), sug(), null, undefined)
    expect(l.comprar).toBeNull()
    expect(l.avisoEstoque).toBe('O SisChef mostra -4. Esse número está errado, por isso vale a contagem.')
    expect(l.conferir).toBe(true)
    expect(totalEstimadoLista([l])).toBe(0)
  })
  it('estoque negativo com contagem: vale a contagem e sai da aba Conferir, mas o aviso continua', () => {
    const l = montarLinha(item({ estoque: -4 }), sug(), 3, undefined)
    expect(l.comprar).toBe(7)
    expect(l.conferir).toBe(false)
    expect(l.avisoEstoque).not.toBeNull()
  })
  it('esporádico ou sem histórico: "Compra de vez em quando" parte da quantidade sugerida antiga', () => {
    const a = montarLinha(item({ qtd_sugerida: 3 }), sug({ alvo: null, esporadico: true }), null, undefined)
    expect(a.deVezEmQuando).toBe(true)
    expect(a.comprar).toBe(3)
    const b = montarLinha(item({ qtd_sugerida: 2 }), null, null, undefined)
    expect(b.deVezEmQuando).toBe(true)
    expect(b.comprar).toBe(2)
  })
  it('de vez em quando com estoque negativo e sem contagem parte de 0', () => {
    expect(montarLinha(item({ qtd_sugerida: 3, estoque: -1 }), null, null, undefined).comprar).toBe(0)
  })
  it('ajuste manual vence o cálculo', () => {
    const l = montarLinha(item({ estoque: 3 }), sug(), null, 2)
    expect(l.comprar).toBe(2)
    expect(l.calculado).toBe(7)
    expect(l.ajustado).toBe(true)
    // também resolve o "contar"
    expect(montarLinha(item({ estoque: -1 }), sug(), null, 5).comprar).toBe(5)
  })
  it('melhor preço só quando há outros para comparar', () => {
    expect(montarLinha(item({}), sug(), 0, undefined).melhorPreco).toBe(true)
    expect(montarLinha(item({}), sug({ fornecedores: { melhor: { fornecedor: 'A', custo: 5, data: '2026-11-01' }, outros: [], conferirUnidade: false } }), 0, undefined).melhorPreco).toBe(false)
  })
  it('conferirUnidade: aviso, nenhum selo de melhor preço, vai para Conferir', () => {
    const l = montarLinha(item({ preco_estimado: 7 }), sug({ fornecedores: { melhor: null, outros: [{ fornecedor: 'A', custo: 3, data: '2026-11-01' }, { fornecedor: 'B', custo: 9, data: '2026-11-01' }], conferirUnidade: true } }), 0, undefined)
    expect(l.avisoUnidade).toBe('Confira a unidade: os preços dos fornecedores estão muito diferentes')
    expect(l.melhorPreco).toBe(false)
    expect(l.conferir).toBe(true)
    expect(l.precoUnit).toBe(7)
  })
  it('outros mostram a diferença em % sobre o melhor', () => {
    const l = montarLinha(item({}), sug(), 0, undefined)
    expect(l.outros[0]).toMatchObject({ fornecedor: 'FORNECEDOR B', custo: 6, diferencaPct: 20 })
  })
  it('sem histórico usa fornecedor_ultima e preco_estimado', () => {
    const l = montarLinha(item({ fornecedor_ultima: 'FORNECEDOR C', preco_estimado: 4 }), null, null, undefined)
    expect(l.fornecedorTexto).toBe('FORNECEDOR C')
    expect(l.precoUnit).toBe(4)
  })
  it('selo que a Revisão já usa (fora da lista com selo) leva para Conferir', () => {
    const l = montarLinha(item({ incluido: false, selos: [{ codigo: 'linha_alta', texto: 'Valor alto' }] }), sug(), 0, undefined)
    expect(l.conferir).toBe(true)
  })
})

describe('montarLinhas, abas, total, contagem', () => {
  const sugs = Array.from({ length: 25 }, (_, k) => sug({ produtoId: k + 1, gastoSemana: 1000 - k }))
  const itens = Array.from({ length: 25 }, (_, k) => item({ id: k + 1, produto_id: k + 1, produto: `P${k + 1}`, estoque: 0, preco_estimado: 1 }))
  it('Principais = 20 primeiros da ordem de gasto que estão na semana', () => {
    const linhas = montarLinhas(itens, sugs, new Map(), {})
    expect(abaPrincipais(linhas, sugs)).toHaveLength(20)
    expect(abaPrincipais(linhas, sugs)[0].item.produto_id).toBe(1)
    // produto da ordem que não está na semana não ocupa vaga
    const semUm = montarLinhas(itens.filter((i) => i.produto_id !== 3), sugs, new Map(), {})
    const p = abaPrincipais(semUm, sugs)
    expect(p).toHaveLength(20)
    expect(p.some((l) => l.item.produto_id === 3)).toBe(false)
    expect(p.some((l) => l.item.produto_id === 21)).toBe(true)
  })
  it('resumo da contagem dos principais', () => {
    const linhas = montarLinhas(itens, sugs, new Map([[1, 2], [2, 0], [24, 5]]), {})
    expect(resumoContagem(linhas, sugs)).toEqual({ contados: 2, total: 20, faltam: 18 })
  })
  it('total soma comprar x preço do melhor fornecedor, ou do último preço', () => {
    const a = montarLinha(item({ estoque: 0 }), sug(), null, undefined) // 10 x 5
    const b = montarLinha(item({ id: 2, produto_id: 2, estoque: 0, preco_estimado: 3 }), null, null, 2) // 2 x 3
    expect(totalEstimadoLista([a, b])).toBe(56)
  })
  it('itens barrados por regra ficam de fora', () => {
    const linhas = montarLinhas([item({ id: 1, produto_id: 1, regra: 'barrar', incluido: false }), item({ id: 2, produto_id: 2 })], [], new Map(), {})
    expect(linhas.map((l) => l.item.id)).toEqual([2])
  })
  it('itensParaGravar: quantidade e incluído; "contar" sem número não é tocado', () => {
    const a = montarLinha(item({ id: 1, estoque: 0 }), sug(), null, undefined)
    const z = montarLinha(item({ id: 2, produto_id: 2, estoque: 20, qtd_aprovada: 4 }), sug({ produtoId: 2 }), null, undefined)
    const c = montarLinha(item({ id: 3, produto_id: 3, estoque: -1 }), sug({ produtoId: 3 }), null, undefined)
    expect(itensParaGravar([a, z, c])).toEqual([{ id: 1, qtd: 10, incluido: true }, { id: 2, qtd: 0, incluido: false }])
  })
})
