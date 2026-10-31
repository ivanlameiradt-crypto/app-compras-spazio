// A conta de cada item já ligado ao produto do SisChef, a TELA (31/10/2026, pedido do Ivan, NF 000113752 da De Marchi): o Brioche vem como 48 PC e entra 720 UN; ele digitou ×1, ×15 e ×1
// sem precisar porque nada dizia que a conta já era automática. O painel "Conferir itens" passa a mostrar "48 PC × 15 = 720 UN" + a etiqueta "automático" + quem faz a conta.
// Tudo INVENTADO (repositório público).
import { act, render, screen, waitFor, within } from '@testing-library/react'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { ItemNotaSefaz, NfeAprendizado, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '4'.repeat(44)
const CNPJ = '12345678000190'
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: 9001, nome: 'PAO BRIOCHE - INSUMOS', unidade: 'un' },
  { produto_id: 9002, nome: 'PAO AUSTRALIANO - INSUMOS', unidade: 'un' },
  { produto_id: 9003, nome: 'QUEIJO CHEDDAR - INSUMOS', unidade: 'kg' },
]
const SISCHEF = 'O SisChef já faz esta conta: não precisa digitar nada. Se algo não bater, o robô para e avisa.'
const ROBO = 'O robô já tem a regra deste produto e multiplica ao lançar: não precisa digitar nada.'

const BRIOCHE: ItemNotaSefaz = { n: 1, descricao: 'CÓD. FOR: 1001 PAO BRIOCHE CLASSICO PCT/15', qtd: 720, unidade_sischef: 'UN', produto_id: 9001, produto_nome: 'PAO BRIOCHE - INSUMOS', associacao: 'sischef',
  qtd_nota: 48, unidade_nota: 'PC' }
const PAO: ItemNotaSefaz = { n: 2, descricao: 'CÓD. FOR: 1002 PAO AUSTRALIANO 380G PCT/15', qtd: 4, unidade_sischef: 'UN', produto_id: 9002, produto_nome: 'PAO AUSTRALIANO - INSUMOS', associacao: 'sischef',
  qtd_nota: 4, unidade_nota: 'UN', regra_embalagem: { fator: 15, unidade: 'UN', produto_id: 9002 } }
const CHEDDAR: ItemNotaSefaz = { n: 3, descricao: 'CÓD. FOR: 1003 PREPARADO DE QUEIJO CHEDDAR 2,27KG', qtd: 18.16, unidade_sischef: 'KG', produto_id: 9003, produto_nome: 'QUEIJO CHEDDAR - INSUMOS', associacao: 'sischef',
  qtd_nota: 8, unidade_nota: 'UN' }
/** Item de uma nota lida ANTES do robô novo: sem qtd_nota, unidade_nota nem regra_embalagem. */
const REQUEIJAO: ItemNotaSefaz = { n: 4, descricao: 'CÓD. FOR: 1004 REQUEIJAO CREMOSO 1,5KG', qtd: 6, unidade_sischef: 'UN', produto_id: 9004, produto_nome: 'REQUEIJAO - INSUMOS', associacao: 'sischef' }
const SEM_PRODUTO: ItemNotaSefaz = { n: 5, descricao: 'CÓD. FOR: 1005 PAO DE FORMA PCT/12', qtd: 20, unidade_sischef: 'PC', produto_id: null, associacao: null, qtd_nota: 20, unidade_nota: 'PC' }

const nota = (itens: ItemNotaSefaz[], extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: CNPJ, emitente: 'PADARIA EXEMPLO LTDA', numero: '000113752', emissao: '2026-10-30', valor_nf: 2639.44,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: 'boleto', parcelas: [{ numero: '001', vencimento: '2026-11-07', valor: 2639.44 }],
  itens, associacoes_app: null, lancamento_estado: null, lancamento_motivo: null,
  ...extra,
} as unknown as NotaSefazLista)

/** O item do painel Conferir pelo trecho da descrição. */
const itemDe = async (trecho: string) => {
  const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
  const li = itens.find((x) => x.textContent?.includes(trecho))
  if (!li) throw new Error(`item ${trecho} não achado entre ${itens.length} itens`)
  return { li, q: within(li) }
}
const memoriaLida = async () => {
  await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalled())
  await act(async () => { await Promise.allSettled(m.memoriaDeEmbalagem.mock.results.map((r) => r.value)) })
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.memoriaDeEmbalagem.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — a conta automática de cada item (De Marchi 000113752, 31/10/2026)', () => {
  it('os três itens da nota mostram a conta, a etiqueta "automático" e quem faz', async () => {
    m.notasALancar.mockResolvedValue([nota([BRIOCHE, PAO, CHEDDAR])])
    render(<NotaSefaz />)
    const brioche = await itemDe('PAO BRIOCHE')
    expect(brioche.q.getByTestId('conta-item-formula')).toHaveTextContent('48 PC × 15 = 720 UN')
    expect(brioche.q.getByTestId('conta-item-automatico')).toHaveTextContent('automático')
    expect(brioche.q.getByTestId('conta-item-quem')).toHaveTextContent(SISCHEF)
    expect(brioche.q.getByTestId('conta-item')).toHaveAttribute('data-quem', 'sischef')
    const pao = await itemDe('PAO AUSTRALIANO')
    expect(pao.q.getByTestId('conta-item-formula')).toHaveTextContent('4 UN × 15 = 60 UN')
    expect(pao.q.getByTestId('conta-item-quem')).toHaveTextContent(ROBO)
    expect(pao.q.getByTestId('conta-item')).toHaveAttribute('data-quem', 'robo')
    const cheddar = await itemDe('QUEIJO CHEDDAR')
    expect(cheddar.q.getByTestId('conta-item-formula')).toHaveTextContent('8 UN × 2,27 = 18,16 KG')
    expect(cheddar.q.getByTestId('conta-item-quem')).toHaveTextContent(SISCHEF)
  })

  it('a conta vem logo depois do nome do produto, e o "Editar" opcional continua no item', async () => {
    m.notasALancar.mockResolvedValue([nota([BRIOCHE])])
    render(<NotaSefaz />)
    const { li, q } = await itemDe('PAO BRIOCHE')
    const produto = li.querySelector('b.produto') as HTMLElement
    const conta = q.getByTestId('conta-item')
    expect(produto).not.toBeNull()
    expect(produto.compareDocumentPosition(conta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(q.getByRole('button', { name: 'Editar' })).toBeEnabled()
  })

  it('a primeira linha do item continua igual (a quantidade que o SisChef mostra, com o selo "da nota fiscal")', async () => {
    m.notasALancar.mockResolvedValue([nota([BRIOCHE])])
    render(<NotaSefaz />)
    const { li } = await itemDe('PAO BRIOCHE')
    expect((li.querySelector('span') as HTMLElement).textContent).toContain('720 UN')
  })

  it('item de nota lida antes do robô novo (sem os campos) segue como sempre: nenhuma conta, nenhuma etiqueta', async () => {
    m.notasALancar.mockResolvedValue([nota([REQUEIJAO])])
    render(<NotaSefaz />)
    const { q } = await itemDe('REQUEIJAO')
    expect(q.queryByTestId('conta-item')).not.toBeInTheDocument()
    expect(q.queryByText('automático')).not.toBeInTheDocument()
  })

  it('a nota inteira sem os campos novos não mostra conta em item nenhum', async () => {
    const antigos = [BRIOCHE, PAO, CHEDDAR].map(({ qtd_nota, unidade_nota, regra_embalagem, ...resto }) => { void qtd_nota; void unidade_nota; void regra_embalagem; return resto as ItemNotaSefaz })
    m.notasALancar.mockResolvedValue([nota(antigos)])
    render(<NotaSefaz />)
    await itemDe('PAO BRIOCHE')
    expect(screen.queryAllByTestId('conta-item')).toHaveLength(0)
  })

  it('item SEM produto no SisChef não mostra conta (ali quem manda é a caixa de associação)', async () => {
    m.notasALancar.mockResolvedValue([nota([SEM_PRODUTO])])
    render(<NotaSefaz />)
    const { q } = await itemDe('PAO DE FORMA')
    expect(q.queryByTestId('conta-item')).not.toBeInTheDocument()
  })

  it('o item que NÃO tem o que multiplicar (mesma quantidade e unidade) fica quieto, sem conta', async () => {
    const igual: ItemNotaSefaz = { ...REQUEIJAO, qtd_nota: 6, unidade_nota: 'UN' }
    m.notasALancar.mockResolvedValue([nota([igual])])
    render(<NotaSefaz />)
    const { q } = await itemDe('REQUEIJAO')
    expect(q.queryByTestId('conta-item')).not.toBeInTheDocument()
  })

  it('quando o Ivan JÁ informou o número dele no item, só a linha "Conversão informada" fala: a conta automática some', async () => {
    const informada = { '1': { produto_id: 9001, produto_nome: 'PAO BRIOCHE - INSUMOS', unidade: null, conversao: 15, origem: 'sischef', por: 'ivan@spazio.invalid', em: '2026-10-31T02:53:00Z' } }
    m.notasALancar.mockResolvedValue([nota([BRIOCHE, CHEDDAR], { associacoes_app: informada })])
    render(<NotaSefaz />)
    const brioche = await itemDe('PAO BRIOCHE')
    expect(brioche.q.getByTestId('conversao-item-informada')).toBeInTheDocument()
    expect(brioche.q.queryByTestId('conta-item')).not.toBeInTheDocument()
    const cheddar = await itemDe('QUEIJO CHEDDAR')                                  // o outro item não foi mexido: continua com a conta
    expect(cheddar.q.getByTestId('conta-item')).toBeInTheDocument()
  })

  it('quando o robô LEMBRA a embalagem do código (caixa "O robô lembra…"), a conta automática some: uma explicação só', async () => {
    const lembrada: NfeAprendizado = {
      emitente_cnpj: CNPJ, cod_forn: '1001', unidade_nota: 'UN', produto_id: 9001, produto_nome: 'PAO BRIOCHE - INSUMOS', fator: 15, preco_ref: 30,
      descricao_exemplo: 'PAO BRIOCHE CLASSICO PCT/15', vezes: 2, ultima_chave: null, atualizado_em: '2026-10-28T20:15:00+00:00',
    }
    m.memoriaDeEmbalagem.mockResolvedValue([lembrada])
    m.notasALancar.mockResolvedValue([nota([BRIOCHE, CHEDDAR])])
    render(<NotaSefaz />)
    await memoriaLida()
    const brioche = await itemDe('PAO BRIOCHE')
    await waitFor(() => expect(brioche.q.getByText(/O robô lembra/)).toBeInTheDocument())
    expect(brioche.q.queryByTestId('conta-item')).not.toBeInTheDocument()
    expect((await itemDe('QUEIJO CHEDDAR')).q.getByTestId('conta-item')).toBeInTheDocument()
  })

  it('é só leitura: a conta não tem botão nem campo, e nada é gravado ao abrir a nota', async () => {
    m.notasALancar.mockResolvedValue([nota([BRIOCHE, PAO, CHEDDAR])])
    render(<NotaSefaz />)
    const { q } = await itemDe('PAO BRIOCHE')
    const conta = q.getByTestId('conta-item')
    expect(within(conta).queryByRole('button')).not.toBeInTheDocument()
    expect(within(conta).queryByRole('textbox')).not.toBeInTheDocument()
    expect(m.associarItem).not.toHaveBeenCalled()
    expect(m.converterItem).not.toHaveBeenCalled()
  })
})
