import { linhaLembrada, produtoLembradoDoItem, textoLembrado, type ProdutoLembrado } from '../../src/admin/produtoLembrado'
import type { ItemNotaSefaz } from '../../src/lib/tipos'

const CNPJ = '12345678000190'
const L: ProdutoLembrado = { cod_forn: '0009085', unidade_nota: 'CX', produto_id: 3324211, produto_nome: 'GUARANA', conversao: 12, vezes: 2, ultima_em: '2026-11-08T02:30:00Z' }
const item_ = (descricao: string, unidade: string | null = 'CX') => ({ n: 1, descricao, unidade_sischef: unidade, qtd: 1, produto_id: null } as unknown as ItemNotaSefaz)
const G = item_('CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET SH 32,7000')

describe('produtoLembradoDoItem', () => {
  it('acha por CNPJ + CÓD. FOR + unidade (unidade em maiúsculas, CNPJ com pontuação)', () => {
    expect(produtoLembradoDoItem([L], CNPJ, { cnpj_emitente: '12.345.678/0001-90' }, item_('CÓD. FOR: 0009085 X', ' cx '))).toBe(L)
    expect(produtoLembradoDoItem([L], CNPJ, { cnpj_emitente: CNPJ }, G)).toBe(L)
  })
  it.each([
    ['outro código', item_('CÓD. FOR: 009085 X')],
    ['outra unidade', item_('CÓD. FOR: 0009085 X', 'UN')],
    ['sem unidade', item_('CÓD. FOR: 0009085 X', null)],
    ['sem CÓD. FOR', item_('GUARANA 0009085')],
  ])('%s: null', (_n, item) => {
    expect(produtoLembradoDoItem([L], CNPJ, { cnpj_emitente: CNPJ }, item)).toBeNull()
  })
  it('lista de outro fornecedor, nota sem CNPJ ou lista vazia: null', () => {
    expect(produtoLembradoDoItem([L], '99887766000155', { cnpj_emitente: CNPJ }, G)).toBeNull()
    expect(produtoLembradoDoItem([L], CNPJ, { cnpj_emitente: '' }, G)).toBeNull()
    expect(produtoLembradoDoItem([], CNPJ, { cnpj_emitente: CNPJ }, G)).toBeNull()
    expect(produtoLembradoDoItem(null, CNPJ, { cnpj_emitente: CNPJ }, G)).toBeNull()
  })
})

describe('textoLembrado e linhaLembrada', () => {
  it('data em horário de Brasília', () => {
    expect(textoLembrado(L)).toBe('lembrado da nota de 07/11')
    expect(textoLembrado({ ultima_em: null })).toBe('lembrado de nota anterior')
  })
  it('converte a linha do banco e descarta a fora do formato', () => {
    expect(linhaLembrada({ ...L, produto_id: '3324211', conversao: '12', unidade_nota: 'cx' })).toEqual(L)
    expect(linhaLembrada({ ...L, conversao: null })?.conversao).toBeNull()
    expect(linhaLembrada({ ...L, produto_id: null })).toBeNull()
    expect(linhaLembrada({ ...L, cod_forn: ' ' })).toBeNull()
    expect(linhaLembrada('x')).toBeNull()
  })
})
