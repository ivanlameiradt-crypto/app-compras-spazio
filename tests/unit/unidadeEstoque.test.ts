import { unidadeDoProduto } from '../../src/admin/unidadeEstoque'

const lista = [
  { produto_id: 3469726, nome: 'BATATA CRINKLE - INSUMOS (KG)', unidade: 'kg' },
  { produto_id: 1, nome: 'ALFACE', unidade: 'UN' },
  { produto_id: 2, nome: 'SEM UNIDADE', unidade: null },
]

describe('unidadeDoProduto — a unidade do banco (planilha), a mesma do SisChef', () => {
  it('devolve a unidade do produto, em minúscula', () => {
    expect(unidadeDoProduto(lista, 3469726)).toBe('kg')
    expect(unidadeDoProduto(lista, '3469726')).toBe('kg')
    expect(unidadeDoProduto(lista, 1)).toBe('un')
  })
  it('produto fora da lista, sem unidade, lista ainda não carregada ou id vazio: null (vale a unidade da linha)', () => {
    expect(unidadeDoProduto(lista, 999)).toBeNull()
    expect(unidadeDoProduto(lista, 2)).toBeNull()
    expect(unidadeDoProduto(null, 3469726)).toBeNull()
    expect(unidadeDoProduto(lista, '')).toBeNull()
    expect(unidadeDoProduto(lista, undefined)).toBeNull()
  })
})
