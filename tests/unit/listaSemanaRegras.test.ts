import { item } from '../fabricas'
import type { SugestaoProduto } from '../../src/lib/sugestaoCompra'
import {
  abaPrincipais, itensForaDoTotal, montarLinha, nomeNaTela, numeroNaTela, qtdNaTela, montarLinhas, resumoContagem, totalEstimadoLista, itensParaGravar,
} from '../../src/admin/listaSemanaRegras'

const sug = (x: Partial<SugestaoProduto> = {}): SugestaoProduto => ({
  produtoId: 1, nome: 'X', unidade: 'kg', semanas: 8, janelaEncolhida: false, compras: 5, mediaSemana: 8, alvo: 10, gastoSemana: 100,
  esporadico: false, classe: 'A',
  fornecedores: { melhor: { fornecedor: 'FORNECEDOR A', custo: 5, data: '2026-11-01' }, outros: [{ fornecedor: 'FORNECEDOR B', custo: 6, data: '2026-10-20' }], conferirUnidade: false, motivoConferir: null },
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
    expect(montarLinha(item({}), sug({ fornecedores: { melhor: { fornecedor: 'A', custo: 5, data: '2026-11-01' }, outros: [], conferirUnidade: false, motivoConferir: null } }), 0, undefined).melhorPreco).toBe(false)
  })
  it('conferirUnidade: aviso, nenhum selo de melhor preço, vai para Conferir', () => {
    const l = montarLinha(item({ preco_estimado: 7 }), sug({ fornecedores: { melhor: null, outros: [{ fornecedor: 'A', custo: 3, data: '2026-11-01' }, { fornecedor: 'B', custo: 9, data: '2026-11-01' }], conferirUnidade: true, motivoConferir: 'preco_fornecedores' }, alvo: null }), 0, undefined)
    expect(l.avisoUnidade).toBe('Confira a unidade: os preços dos fornecedores estão muito diferentes')
    expect(l.melhorPreco).toBe(false)
    expect(l.conferir).toBe(true)
    expect(l.precoUnit).toBe(7)
  })
  it('unidade a conferir: sem cálculo automático ("contar"), mas o admin pode digitar', () => {
    const conf = sug({ alvo: null, fornecedores: { melhor: null, outros: [], conferirUnidade: true, motivoConferir: 'quantidade_historico' } })
    const l = montarLinha(item({ estoque: 0, qtd_sugerida: 4 }), conf, null, undefined)
    expect(l.calculado).toBeNull()
    expect(l.comprar).toBeNull()
    expect(l.deVezEmQuando).toBe(false)
    expect(montarLinha(item({ estoque: 0 }), conf, null, 6).comprar).toBe(6)
  })
  it('texto do aviso conforme o motivo', () => {
    const com = (m: 'preco_fornecedores' | 'preco_historico' | 'quantidade_historico') => montarLinha(item({}), sug({ alvo: null, fornecedores: { melhor: null, outros: [], conferirUnidade: true, motivoConferir: m } }), null, undefined).avisoUnidade
    expect(com('preco_fornecedores')).toBe('Confira a unidade: os preços dos fornecedores estão muito diferentes')
    expect(com('preco_historico')).toBe('Confira a unidade: os preços deste produto estão muito diferentes entre as compras')
    expect(com('quantidade_historico')).toBe('Confira a unidade: uma das compras tem quantidade muito fora do normal')
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

describe('exibição, arredondamento e total', () => {
  it('números: kg com 1 casa, un inteira, milhar com ponto', () => {
    expect(qtdNaTela(131.563, 'kg')).toBe('131,6 kg')
    expect(numeroNaTela(12943, 'un')).toBe('12.943')
    expect(numeroNaTela(-12943.4, 'un')).toBe('-12.943')
    expect(numeroNaTela(2, 'kg')).toBe('2')
    expect(numeroNaTela(1234.56, 'kg')).toBe('1.234,6')
    expect(montarLinha(item({ estoque: -12943, unidade: 'un' }), sug(), null, undefined).avisoEstoque).toBe('O SisChef mostra -12.943. Esse número está errado, por isso vale a contagem.')
  })
  it('comprar calculado em un sobe para o inteiro; kg mantém 1 casa; manual vale como digitado', () => {
    const s = sug({ alvo: 346.1 })
    expect(montarLinha(item({ unidade: 'un', estoque: 0 }), s, null, undefined).comprar).toBe(347)
    expect(montarLinha(item({ unidade: 'kg', estoque: 0 }), s, null, undefined).comprar).toBe(346.1)
    expect(montarLinha(item({ unidade: 'un', estoque: 0 }), s, null, 12.5).comprar).toBe(12.5)
  })
  it('conferirUnidade fica fora do total e é contado', () => {
    const conf = sug({ fornecedores: { melhor: null, outros: [{ fornecedor: 'A', custo: 3, data: '2026-11-01' }, { fornecedor: 'B', custo: 9, data: '2026-11-01' }], conferirUnidade: true, motivoConferir: 'preco_fornecedores' }, alvo: null })
    const a = montarLinha(item({ estoque: 0, preco_estimado: 7 }), conf, null, 3) // o admin digitou 3, mas o preço não é confiável
    const b = montarLinha(item({ id: 2, produto_id: 2, estoque: 0 }), sug(), null, undefined) // 10 x 5
    expect(totalEstimadoLista([a, b])).toBe(50)
    expect(itensForaDoTotal([a, b])).toBe(1)
  })
  it('nome sem o rabicho do cadastro', () => {
    expect(nomeNaTela('MOSTARDA - INSUMO (KG)')).toBe('MOSTARDA')
    expect(nomeNaTela('CEBOLA EM PÓ - INSUMOS (KG)')).toBe('CEBOLA EM PÓ')
    expect(nomeNaTela('GUARDANAPO (UN)')).toBe('GUARDANAPO')
    expect(nomeNaTela('COCA COLA 350 ML')).toBe('COCA COLA 350 ML')
  })
})
