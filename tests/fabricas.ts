import type { ItemSemana, LinhaCompra } from '../src/lib/tipos'

export function item(p: Partial<ItemSemana>): ItemSemana {
  return {
    id: 1, semana_id: 1, produto_id: 1, produto: 'X', bebida: true, unidade: 'un', estoque: 0, estoque_minimo: 0,
    qtd_sugerida: 0, qtd_aprovada: 0, preco_estimado: null, data_ultima_compra: null, fornecedor_ultima: null,
    situacao: 'Repor', negativo: false, incluido: true, ...p,
  }
}
export function linha(p: Partial<LinhaCompra>): LinhaCompra {
  return {
    id: 'l', compra_id: 'c', item_semana_id: 1, qtd: 0, preco_unit: null, resultado: 'comprado',
    marcado_por: 'joao@spazio.com', marcado_em: '2026-09-23T10:00:00Z', ...p,
  }
}
