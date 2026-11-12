// Pedidos (etapa 4 da Compra): compra na loja agrupada por fornecedor e resumo da tela. Dados INVENTADOS.
import { gruposDeLoja, resumoPedidos, SEM_FORNECEDOR } from '../../src/admin/pedidosRegras'
import { sugerirCompras } from '../../src/lib/sugestaoCompra'
import type { LinhaCompra } from '../../src/lib/sugestaoCompra'
import type { ItemSemVendedor } from '../../src/lib/tipos'
import { item } from '../fabricas'

const sv = (p: Partial<ItemSemVendedor>): ItemSemVendedor => ({
  item_semana_id: 1, produto_id: 1, produto: 'X', nome: 'X', unidade: 'kg', qtd: 1, motivo: 'nunca_comprado', fornecedor: null, vendedor_id: null, ...p,
})
const hoje = '2026-11-12'
const linha = (p: Partial<LinhaCompra>): LinhaCompra => ({ data: '2026-11-05', fornecedor: null, qtd: 1, precoUnit: 1, custoLiquido: 1, ...p })
const hist = (produtoId: number, linhas: LinhaCompra[]) => ({ produtoId, nome: `P${produtoId}`, unidade: 'kg', linhas })

describe('gruposDeLoja', () => {
  it('usa o melhor fornecedor do histórico e calcula qtd × preço', () => {
    const sug = sugerirCompras([hist(1, [linha({ data: '2026-11-05', fornecedor: 'ATACADO A', qtd: 4, precoUnit: 5, custoLiquido: 5 })])], hoje)
    const g = gruposDeLoja([sv({ item_semana_id: 10, produto_id: 1, nome: 'FARINHA', qtd: 3 })], [item({ id: 10, produto_id: 1 })], sug)
    expect(g).toHaveLength(1)
    expect(g[0].nome).toBe('ATACADO A')
    expect(g[0].itens[0]).toMatchObject({ nome: 'FARINHA', qtd: 3, unidade: 'kg', valor: 15 })
    expect(g[0].subtotal).toBe(15)
    expect(g[0].semPreco).toBe(0)
  })

  it('sem histórico cai no fornecedor do item, depois no da última compra, depois "Sem fornecedor definido" (por último)', () => {
    const itens = [
      item({ id: 1, produto_id: 1, fornecedor_ultima: 'ULTIMA X', preco_estimado: 2 }),
      item({ id: 2, produto_id: 2, fornecedor_ultima: 'ULTIMA Y', preco_estimado: 100 }),
      item({ id: 3, produto_id: 3 }),
    ]
    const g = gruposDeLoja([
      sv({ item_semana_id: 1, produto_id: 1, nome: 'A', qtd: 2 }), // última compra X
      sv({ item_semana_id: 2, produto_id: 2, nome: 'B', qtd: 1, fornecedor: 'DO ITEM' }), // o do item ganha da última compra
      sv({ item_semana_id: 3, produto_id: 3, nome: 'C', qtd: 9 }), // nenhum
    ], itens, [])
    expect(g.map((x) => x.nome)).toEqual(['DO ITEM', 'ULTIMA X', SEM_FORNECEDOR])
    expect(g[1].itens[0].valor).toBe(4)
    expect(g[2].itens[0].valor).toBeNull()
    expect(g[2].semPreco).toBe(1)
    expect(g[2].subtotal).toBe(0)
  })

  it('unidade a conferir: não usa o melhor preço nem o preço estimado, e cai nos outros fallbacks', () => {
    const sug = sugerirCompras([hist(1, [
      linha({ data: '2026-11-05', fornecedor: 'BARATO', qtd: 1, precoUnit: 1, custoLiquido: 1 }),
      linha({ data: '2026-11-04', fornecedor: 'CARO', qtd: 1, precoUnit: 5, custoLiquido: 5 }),
    ])], hoje)
    expect(sug[0].fornecedores.conferirUnidade).toBe(true)
    const g = gruposDeLoja([sv({ produto_id: 1, item_semana_id: 1, qtd: 2, fornecedor: 'DO ITEM' })], [item({ id: 1, produto_id: 1, preco_estimado: 3 })], sug)
    expect(g[0].nome).toBe('DO ITEM')
    expect(g[0].itens[0].valor).toBeNull()
  })

  it('junta nomes iguais sem ligar para caixa e espaços, e ordena do maior subtotal para o menor', () => {
    const itens = [item({ id: 1, produto_id: 1, preco_estimado: 1 }), item({ id: 2, produto_id: 2, preco_estimado: 1 }), item({ id: 3, produto_id: 3, preco_estimado: 50 })]
    const g = gruposDeLoja([
      sv({ item_semana_id: 1, produto_id: 1, qtd: 2, fornecedor: 'Mercado  Um' }),
      sv({ item_semana_id: 2, produto_id: 2, qtd: 3, fornecedor: 'MERCADO UM ' }),
      sv({ item_semana_id: 3, produto_id: 3, qtd: 1, fornecedor: 'Outro' }),
    ], itens, [])
    expect(g.map((x) => [x.nome, x.itens.length, x.subtotal])).toEqual([['Outro', 1, 50], ['Mercado Um', 2, 5]])
  })

  it('sem itens, sem grupos', () => {
    expect(gruposDeLoja([], [], [])).toEqual([])
  })
})

describe('resumoPedidos', () => {
  it('soma fornecedores, produtos e total estimado (cotações + loja)', () => {
    const grupos = gruposDeLoja([sv({ item_semana_id: 1, produto_id: 1, qtd: 2, fornecedor: 'L1' })], [item({ id: 1, produto_id: 1, preco_estimado: 10 })], [])
    const r = resumoPedidos([{ itens: 3, estimado: 100 }, { itens: 2, estimado: 50.5 }], grupos)
    expect(r).toEqual({ fornecedores: 3, produtos: 6, total: 170.5 })
  })
  it('vazio', () => {
    expect(resumoPedidos([], [])).toEqual({ fornecedores: 0, produtos: 0, total: 0 })
  })
})
