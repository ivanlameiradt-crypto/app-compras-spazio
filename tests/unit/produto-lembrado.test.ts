import {
  linhaLembrada, MIN_VEZES_PARA_ASSOCIAR_SOZINHO, oQueFazerComOLembrado, precoNaFaixa, produtoLembradoDoItem, textoAssociadoSozinho, textoUsarLembrado, type ProdutoLembrado,
} from '../../src/admin/produtoLembrado'
import type { ItemNotaSefaz, ProdutoCatalogo } from '../../src/lib/tipos'

const CNPJ = '12345678000190'
const L: ProdutoLembrado = { cod_forn: '0009085', unidade_nota: 'CX', produto_id: 3324211, produto_nome: 'GUARANA', unidade: 'un', conversao: 12, preco_ref: 37.5, vezes: 2, ultima_em: '2026-11-08T02:30:00Z' }
const item_ = (descricao: string, unidade: string | null = 'CX', valor: number | null = 75, qtd: number | null = 2) =>
  ({ n: 1, descricao, unidade_sischef: unidade, qtd, valor, produto_id: null } as unknown as ItemNotaSefaz)
const G = item_('CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET SH 32,7000')
const CAT: ProdutoCatalogo[] = [{ produto_id: 3324211, nome: 'GUARANA DIET', unidade: 'un' }]

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

describe('travas: preço, unidade, limiar, recusa', () => {
  it('faixa de preço 0,8× a 1,2× (a mesma do robô); sem referência ou sem total = fora', () => {
    expect(precoNaFaixa({ valor: 75, qtd: 2 }, L)).toBe(true)
    expect(precoNaFaixa({ valor: 60, qtd: 2 }, L)).toBe(true)
    expect(precoNaFaixa({ valor: 90, qtd: 2 }, L)).toBe(true)
    expect(precoNaFaixa({ valor: 59, qtd: 2 }, L)).toBe(false)
    expect(precoNaFaixa({ valor: 91, qtd: 2 }, L)).toBe(false)
    expect(precoNaFaixa({ valor: 112.5, qtd: 2 }, L)).toBe(false)
    expect(precoNaFaixa({ valor: 75, qtd: 2 }, { preco_ref: null })).toBe(false)
    expect(precoNaFaixa({ valor: null, qtd: 2 }, L)).toBe(false)
  })
  it('sozinho só com tudo certo; senão sugere; fora do catálogo = nada', () => {
    expect(oQueFazerComOLembrado(L, G, CAT, false)).toBe('sozinho')
    expect(oQueFazerComOLembrado(L, item_('CÓD. FOR: 0009085 X', 'CX', 112.5), CAT, false)).toBe('sugerir')
    expect(oQueFazerComOLembrado({ ...L, preco_ref: null }, G, CAT, false)).toBe('sugerir')
    expect(oQueFazerComOLembrado({ ...L, unidade: 'kg' }, G, CAT, false)).toBe('sugerir')
    expect(oQueFazerComOLembrado({ ...L, unidade: null }, G, CAT, false)).toBe('sugerir')
    expect(oQueFazerComOLembrado(L, G, CAT, true)).toBe('sugerir')
    expect(oQueFazerComOLembrado({ ...L, vezes: MIN_VEZES_PARA_ASSOCIAR_SOZINHO - 1 }, G, CAT, false)).toBe('sugerir')
    expect(oQueFazerComOLembrado(L, G, [{ produto_id: 1, nome: 'X', unidade: 'un' }], false)).toBeNull()
    expect(oQueFazerComOLembrado(L, G, null, false)).toBeNull()
    expect(oQueFazerComOLembrado(null, G, CAT, false)).toBeNull()
  })
  it('o limiar de hoje é 1 nota', () => { expect(MIN_VEZES_PARA_ASSOCIAR_SOZINHO).toBe(1) })
})

describe('frases e leitura', () => {
  it('marca do automático (Brasília) e botão de um toque', () => {
    expect(textoAssociadoSozinho(L.ultima_em, 'cx', 12)).toBe('associado sozinho, igual à nota de 07/11 (1 CX = 12)')
    expect(textoAssociadoSozinho(null, 'CX', null)).toBe('associado sozinho, igual a nota anterior')
    expect(textoUsarLembrado('GUARANÁ DIET', 12)).toBe('Usar o lembrado: GUARANÁ DIET × 12')
    expect(textoUsarLembrado('GUARANÁ DIET', null)).toBe('Usar o lembrado: GUARANÁ DIET')
  })
  it('converte a linha do banco e descarta a fora do formato', () => {
    expect(linhaLembrada({ ...L, produto_id: '3324211', conversao: '12', preco_ref: '37.5000', unidade_nota: 'cx', unidade: 'UN ' })).toEqual(L)
    expect(linhaLembrada({ ...L, conversao: null, preco_ref: null })).toMatchObject({ conversao: null, preco_ref: null })
    expect(linhaLembrada({ ...L, produto_id: null })).toBeNull()
    expect(linhaLembrada({ ...L, cod_forn: ' ' })).toBeNull()
    expect(linhaLembrada('x')).toBeNull()
  })
})
