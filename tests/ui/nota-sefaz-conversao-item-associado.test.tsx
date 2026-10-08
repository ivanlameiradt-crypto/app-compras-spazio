import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '1'.repeat(44)
const CREME = 1855900
const MOTIVO_UN_DIFERE = 'parou antes de gerar o pedido (nada lançado): UN DIFERE sem conversão na tela: CÓD. FOR 376611 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)'
const ROTULO = 'Quanto vale 1 unidade da nota em KG?'
/** A MATEUS 000089284 de 07/10: o creme de leite já vem associado do SisChef (nota em UN, cadastro em KG) mas o SisChef o marcou UN DIFERE. */
const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089284', emissao: '2026-10-06', valor_nf: 1794.49,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [
    { n: 1, descricao: 'CÓD. FOR: 281948 ## AGUA SEM GÁS 500ML', qtd: 60, unidade_sischef: 'UN', produto_id: '1836957', produto_nome: 'AGUA SEM GAS - INSUMOS', associacao: 'sischef' },
    { n: 3, descricao: 'CÓD. FOR: 376611 CREME DE LEITE - INSUMOS', qtd: 10, unidade_sischef: 'KG', produto_id: String(CREME), produto_nome: 'CREME DE LEITE - INSUMOS', associacao: 'sischef' },
  ],
  associacoes_app: null, lancamento_estado: 'revisar', lancamento_motivo: MOTIVO_UN_DIFERE,
  ...extra,
} as unknown as NotaSefazLista)
const conversaoGravada = (conversao: number) => ({
  '3': { produto_id: CREME, produto_nome: 'CREME DE LEITE - INSUMOS', unidade: null, conversao, origem: 'sischef', por: 'ivan@spazio.invalid', em: '2026-10-08T02:30:00Z' },
})

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — item que já vem associado do SisChef com UN DIFERE: o Ivan informa a conversão no app (08/10)', () => {
  it('só o item que o robô apontou ganha a caixa (vazia); os outros itens não mostram nada a mais', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const itens = await within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item')
    expect(within(itens[0]).queryByTestId('conversao-item-pendente')).not.toBeInTheDocument()
    const caixa = within(itens[1]).getByTestId('conversao-item-pendente')
    expect(caixa).toHaveTextContent('UN DIFERE')
    expect(within(caixa).getByLabelText(ROTULO)).toHaveValue('')   // vazio: quem define é o Ivan
    expect(within(caixa).getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(screen.getByTestId('conferir')).toHaveAttribute('open')  // abre sozinho: é o que falta
  })

  it('sem o robô ter pedido (nota sem esse motivo) nenhuma caixa aparece', async () => {
    m.notasALancar.mockResolvedValue([mateus({ lancamento_estado: null, lancamento_motivo: null })])
    render(<NotaSefaz />)
    await screen.findByTestId('conferir')
    expect(screen.queryByTestId('conversao-item-pendente')).not.toBeInTheDocument()
  })

  it('digita 1 e confirma: grava pela função nova, relê e passa a mostrar "Conversão informada"', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([mateus({ associacoes_app: conversaoGravada(1) })]) })
    render(<NotaSefaz />)
    await userEvent.type(await screen.findByLabelText(ROTULO), '1')
    expect(await screen.findByTestId('conversao-item-eco')).toHaveTextContent('1 unidade da nota = 1 KG')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 1))
    expect(await screen.findByTestId('conversao-item-informada')).toHaveTextContent('1 unidade da nota = 1 KG')
    expect(screen.queryByTestId('conversao-item-pendente')).not.toBeInTheDocument()
  })

  it('a releitura falha logo depois de gravar: a caixa mostra o que foi gravado mesmo assim', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockRejectedValue(new Error('rede')) })
    render(<NotaSefaz />)
    await userEvent.type(await screen.findByLabelText(ROTULO), '0,5')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByTestId('conversao-item-informada')).toHaveTextContent('1 unidade da nota = 0,5 KG')
  })

  it('número inválido (0, 5 casas, ponto e vírgula juntos) não deixa confirmar', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const campo = await screen.findByLabelText(ROTULO)
    for (const ruim of ['0', '0,12345', '1.000,5', 'abc']) {
      await userEvent.clear(campo); await userEvent.type(campo, ruim)
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    }
    expect(screen.getByTestId('conversao-item-invalida')).toBeInTheDocument()
    expect(m.converterItem).not.toHaveBeenCalled()
  })

  it('já informada: mostra o número com "Trocar"; trocar e confirmar grava o novo; "Desfazer a conversão" grava nulo', async () => {
    m.notasALancar.mockResolvedValue([mateus({ associacoes_app: conversaoGravada(1) })])
    m.converterItem.mockResolvedValue(undefined)
    render(<NotaSefaz />)
    expect(await screen.findByTestId('conversao-item-informada')).toHaveTextContent('1 unidade da nota = 1 KG')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar' }))
    const campo = screen.getByLabelText(ROTULO)
    expect(campo).toHaveValue('1')
    await userEvent.clear(campo); await userEvent.type(campo, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenLastCalledWith(CHAVE, 3, 2))
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer a conversão' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenLastCalledWith(CHAVE, 3, null))
  })

  it('erro do banco aparece na caixa e nada é dado como gravado', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    m.converterItem.mockRejectedValue(new Error('O robô está lançando esta nota agora: aguarde terminar.'))
    render(<NotaSefaz />)
    await userEvent.type(await screen.findByLabelText(ROTULO), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('aguarde terminar')
    expect(screen.queryByTestId('conversao-item-informada')).not.toBeInTheDocument()
  })
})
