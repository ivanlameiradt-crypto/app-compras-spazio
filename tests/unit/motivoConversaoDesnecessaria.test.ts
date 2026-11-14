import { conversoesDesnecessarias, explicarMotivoDoRobo, fraseConversaoDesnecessaria } from '../../src/admin/motivoDoRobo'
import { planoTirarConversao, textoDoEstado } from '../../src/admin/notaSefazRegras'
import type { NotaSefazLista } from '../../src/lib/tipos'

// 14/11/2026 (pedido do Ivan): o robô parou na nota da LONG WAY com o texto abaixo (nfe_decisoes_app.conferir_conversoes) e o app mostrava o texto cru, sem botão.
// O Ivan tinha digitado 0,24 (o peso do pacote) numa conversão que não precisava: a nota e o produto estão os dois em UN.
const FIM = ' não é de embalagem (embalagem é maior que 1 e vale para UN, PCT, CX ou FD): no app, toque em Editar neste item, deixe a conversão vazia e lance de novo (ou associe no SisChef)'
const motivoDe = (n: number, desc: string, un: string, num: string) => `item ${n} (${desc}): a nota e o produto estão na mesma unidade (${un}) no SisChef e o número informado (${num})${FIM}`
const GUIOZA = motivoDe(5, 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G', 'UN', '0,24')

describe('conversoesDesnecessarias — reconhece o motivo "o número informado não é de embalagem"', () => {
  it('o caso real: o número do item, o nome sem o CÓD. FOR, a unidade e o número informado', () => {
    expect(conversoesDesnecessarias(GUIOZA)).toEqual({
      itens: [{ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' }],
      resto: '',
    })
  })
  it('aceita outra unidade e outro número, e o começo técnico do robô', () => {
    const r = conversoesDesnecessarias(`parou antes de gerar o pedido (nada lançado): ${motivoDe(12, 'CÓD. FOR: 77 QUEIJO PRATO (FATIADO) 1KG - INSUMOS', 'KG', '1,5')}`)
    expect(r).toEqual({ itens: [{ n: 12, nome: 'QUEIJO PRATO (FATIADO) 1KG', unidade: 'KG', numero: '1,5' }], resto: '' })
  })
  it('dois itens no mesmo motivo, separados por "; ": cada um com o seu nome e o seu número', () => {
    const r = conversoesDesnecessarias(`${GUIOZA}; ${motivoDe(7, 'CÓD. FOR: 31 MOLHO TARE 1L', 'UN', '0,5')}`)
    expect(r?.itens).toEqual([
      { n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' },
      { n: 7, nome: 'MOLHO TARE 1L', unidade: 'UN', numero: '0,5' },
    ])
    expect(r?.resto).toBe('')
  })
  it('misturado com outro motivo: o nome de um item não engole o outro, e o que sobra vem em `resto`', () => {
    const outro = 'item 3 (CÓD. FOR: 9 ARROZ 5KG): precisa de conversão: 1 UN da nota = ? KG — no app, na caixa de associação do item, toque em Editar'
    const r = conversoesDesnecessarias(`${outro}; ${GUIOZA}`)
    expect(r?.itens).toEqual([{ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' }])
    expect(r?.resto).toBe(outro)
  })
  it('texto cortado no fim (sem o "no app, toque em Editar…") ainda é reconhecido', () => {
    const curto = 'item 5 (CÓD. FOR: 2894 GUIOZA): a nota e o produto estão na mesma unidade (UN) no SisChef e o número informado (0,24) não é de embalagem'
    expect(conversoesDesnecessarias(curto)).toEqual({ itens: [{ n: 5, nome: 'GUIOZA', unidade: 'UN', numero: '0,24' }], resto: '' })
  })
  it.each([null, undefined, '', 'sem boletos na nota — pagamento manual',
    'item 5 (X): a nota e o produto estão na mesma unidade (UN) no SisChef, mas o nome do produto na lista do app tem "(KG)" e a caixa de associação exige a conversão para ele'])(
    '%j não é este motivo', (texto) => { expect(conversoesDesnecessarias(texto)).toBeNull() })
})

describe('a frase para o Ivan', () => {
  it('curta, com o item, o nome e o número, e a recomendação', () => {
    expect(fraseConversaoDesnecessaria({ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' })).toBe(
      'Item 5 (LONG WAY GUIOZA LW LEGUMES 240G): o número 0,24 que foi informado não serve como conversão, porque a nota e o produto já estão na mesma unidade. Recomendo tirar esse número.')
  })
  it('explicarMotivoDoRobo e textoDoEstado deixam de mostrar o texto cru', () => {
    const e = explicarMotivoDoRobo(GUIOZA)
    expect(e?.porque).toBe('Item 5 (LONG WAY GUIOZA LW LEGUMES 240G): o número 0,24 que foi informado não serve como conversão, porque a nota e o produto já estão na mesma unidade.')
    expect(e?.fazer).toBe('Tire esse número (deixe a conversão vazia) e lance de novo.')
    const t = textoDoEstado('revisar', GUIOZA) ?? ''
    expect(t).not.toContain('CÓD. FOR')
    expect(t).not.toContain('embalagem é maior que 1')
  })
  it('misturado com outro motivo: não explica (a tela mostra o texto do robô inteiro)', () => {
    expect(explicarMotivoDoRobo(`item 3 (X): outra coisa; ${GUIOZA}`)).toBeNull()
  })
})

const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '7'.repeat(44), emitente: 'LONG WAY ALIMENTOS LTDA', numero: '000012345', emissao: '2026-11-13', valor_nf: 500, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [
    { n: 4, descricao: 'CÓD. FOR: 2890 LONG WAY HARUMAKI 300G', qtd: 5, unidade_sischef: 'UN', produto_id: 111, associacao: 'sischef', produto_nome: 'HARUMAKI - INSUMOS' },
    { n: 5, descricao: 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G', qtd: 10, unidade_sischef: 'UN', produto_id: null },
  ],
  associacoes_app: { '5': { produto_id: 3971031, produto_nome: 'GUIOZA DE LEGUMES - INSUMOS', unidade: 'un', conversao: 0.24, origem: 'lista' } },
  parcelas: [], forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: GUIOZA, ...extra,
} as unknown as NotaSefazLista)

describe('planoTirarConversao — o que o toque vai apagar', () => {
  it('item escolhido no app: regrava o MESMO produto sem a conversão (via "associar"); a nota de depois fica sem o número', () => {
    const p = planoTirarConversao(nota())
    expect(p?.alvos).toEqual([{ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24', via: 'associar', produtoId: 3971031 }])
    expect(p?.notaDepois.associacoes_app?.['5']).toMatchObject({ produto_id: 3971031, conversao: null })
    expect(p?.resto).toBe('')
  })
  it('conversão de item que já vem associado do SisChef (origem "sischef"): apaga pela função da conversão (via "converter")', () => {
    const n = nota({
      itens: [{ n: 5, descricao: 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G', qtd: 10, unidade_sischef: 'UN', produto_id: 3971031, associacao: 'sischef' }],
      associacoes_app: { '5': { produto_id: 3971031, produto_nome: 'GUIOZA', unidade: null, conversao: 0.24, origem: 'sischef' } },
    } as unknown as Partial<NotaSefazLista>)
    const p = planoTirarConversao(n)
    expect(p?.alvos.map((a) => a.via)).toEqual(['converter'])
    expect(p?.notaDepois.associacoes_app?.['5']).toBeUndefined()
  })
  it('a conversão já foi tirada (ou não há decisão): nenhum alvo, mas o motivo continua reconhecido', () => {
    const p = planoTirarConversao(nota({ associacoes_app: { '5': { produto_id: 3971031, produto_nome: 'GUIOZA', unidade: 'un', conversao: null } } } as unknown as Partial<NotaSefazLista>))
    expect(p?.itens).toHaveLength(1)
    expect(p?.alvos).toEqual([])
    expect(planoTirarConversao(nota({ associacoes_app: null }))?.alvos).toEqual([])
  })
  it('só vale para nota que o robô devolveu (revisar) com este motivo', () => {
    expect(planoTirarConversao(nota({ lancamento_estado: 'lancando' }))).toBeNull()
    expect(planoTirarConversao(nota({ lancamento_estado: 'erro' }))).toBeNull()
    expect(planoTirarConversao(nota({ lancamento_motivo: 'sem boletos na nota — pagamento manual' }))).toBeNull()
  })
})
