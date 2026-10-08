import { codForDoItem, codsComUnDifere, conversaoDeItemAssociado, itemPedeConversao } from '../../src/admin/notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

const item = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  ({ n: 3, descricao: 'CÓD. FOR: 376611 CREME DE LEITE - INSUMOS', qtd: 10, unidade_sischef: 'KG', produto_id: '1855900', associacao: 'sischef', ...over }) as ItemNotaSefaz
const nota = (over: Partial<NotaSefazLista> = {}): NotaSefazLista =>
  ({ chave: 'x', itens: [item()], associacoes_app: null, lancamento_estado: 'revisar',
     lancamento_motivo: 'UN DIFERE sem conversão na tela: CÓD. FOR 376611 (no app, informe a conversão)', ...over }) as unknown as NotaSefazLista

describe('conversão de item que já vem associado com UN DIFERE (regras puras)', () => {
  it('lê o CÓD. FOR da descrição do SisChef', () => {
    expect(codForDoItem(item())).toBe('376611')
    expect(codForDoItem(item({ descricao: 'CÓD FOR 99 X' }))).toBe('99')
    expect(codForDoItem(item({ descricao: 'sem código' }))).toBeNull()
  })
  it('lê os CÓD. FOR do motivo do robô (um, vários, texto antigo) e ignora outros motivos', () => {
    expect(codsComUnDifere('UN DIFERE sem conversão na tela: CÓD. FOR 376611 (no app, informe)')).toEqual(['376611'])
    expect(codsComUnDifere('parou (nada lançado): UN DIFERE sem conversão na tela: CÓD. FOR 376611; 132534 (no app, x)')).toEqual(['376611', '132534'])
    expect(codsComUnDifere('UN DIFERE sem conversão na tela: CÓD. FOR: 376611')).toEqual(['376611'])
    expect(codsComUnDifere('item 7: precisa de conversão')).toEqual([])
    expect(codsComUnDifere(null)).toEqual([])
  })
  it('o item pede conversão só em "revisar", se já está associado e se o CÓD. FOR consta no motivo', () => {
    expect(itemPedeConversao(nota(), item())).toBe(true)
    expect(itemPedeConversao(nota(), item({ descricao: 'CÓD. FOR: 111 OUTRO' }))).toBe(false)
    expect(itemPedeConversao(nota({ lancamento_estado: 'lancando' }), item())).toBe(false)
    expect(itemPedeConversao(nota(), item({ produto_id: null, associacao: null }))).toBe(false)   // item sem produto: é a caixa de associação
  })
  it('a conversão informada vem só da decisão com origem "sischef"', () => {
    const d = (origem: string, conversao: number | null) => ({ '3': { produto_id: 1855900, produto_nome: 'X', unidade: null, conversao, origem } })
    expect(conversaoDeItemAssociado(nota({ associacoes_app: d('sischef', 1) }), item())).toBe(1)
    expect(conversaoDeItemAssociado(nota({ associacoes_app: d('lista', 1) }), item())).toBeNull()
    expect(conversaoDeItemAssociado(nota({ associacoes_app: d('sischef', null) }), item())).toBeNull()
    expect(conversaoDeItemAssociado(nota(), item())).toBeNull()
  })
})
