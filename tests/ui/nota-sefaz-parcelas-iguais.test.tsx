import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const CAT: ProdutoCatalogo[] = [
  { produto_id: 3469626, nome: 'LEITE CONDENSADO - INSUMOS (KG)', unidade: 'kg' },
  { produto_id: 3138573, nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' },
]
const dec = (id: number, nome: string, unidade: string | null, conversao?: number) =>
  ({ produto_id: id, produto_nome: nome, unidade, origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-07T23:30:00Z', ...(conversao === undefined ? {} : { conversao }) })
/** MATEUS 000089284 (R$ 1.794,49): todos os itens já decididos, XML sem boletos — só falta o financeiro. */
const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089284', emissao: '2026-10-06', valor_nf: 1794.49,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [
    { n: 1, descricao: 'CÓD. FOR: 1 AGUA SEM GAS 500ML', qtd: 60, unidade_sischef: 'UN', produto_id: 1836986, associacao: 'sischef' },
    { n: 5, descricao: 'CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', qtd: 27, unidade_sischef: 'UN', produto_id: null },
    { n: 7, descricao: 'CÓD. FOR: 454513 OLEO SOJA VITALIV PET 900ML', qtd: 60, unidade_sischef: 'UN', produto_id: null },
  ],
  associacoes_app: { '5': dec(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395), '7': dec(3138573, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un') },
  ...extra,
})
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })
const resumo = () => screen.getByTestId('resumo-parcelas')
const digitar = async (i: number, data: string, valor: string) => {
  fireEvent.change(screen.getByLabelText(`Vencimento da parcela ${i}`), { target: { value: data } })
  const campo = screen.getByLabelText(`Valor da parcela ${i}`)
  await userEvent.clear(campo)
  if (valor) await userEvent.type(campo, valor)
}
const tresParcelas = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
  for (const [i, d] of [[1, '2026-10-16'], [2, '2026-10-23'], [3, '2026-10-30']] as const) fireEvent.change(screen.getByLabelText(`Vencimento da parcela ${i}`), { target: { value: d } })
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([mateus()])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CAT)
})
afterEach(() => { vi.restoreAllMocks() })

describe('NotaSefaz — parcelas iguais: R$ 1.794,49 não divide em 3 partes iguais ao centavo (MATEUS 000089284, 07/10)', () => {
  it('3 parcelas "iguais" de 598,16: soma 1.794,48, falta 1 centavo — o Lançar fica apagado e a tela diz por quê e como resolver', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await tresParcelas()
    for (const i of [1, 2, 3]) await digitar(i, ['2026-10-16', '2026-10-23', '2026-10-30'][i - 1], '598,16')
    expect(botaoLancar()).toBeDisabled()
    expect(resumo()).toHaveTextContent('Faltam 0,01 para fechar com o valor da nota')
    expect(screen.getByTestId('dica-centavo')).toHaveTextContent('1.794,49 não divide em 3 partes iguais')
    expect(screen.getByTestId('dica-centavo')).toHaveTextContent('a última leva o centavo que sobra')
  })

  it('3 parcelas de 598,17: passa 2 centavos — também trava, e oferece ajustar a última', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await tresParcelas()
    for (const i of [1, 2, 3]) await digitar(i, ['2026-10-16', '2026-10-23', '2026-10-30'][i - 1], '598,17')
    expect(botaoLancar()).toBeDisabled()
    expect(resumo()).toHaveTextContent('Passou 0,02 do valor da nota')
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar a última parcela' }))
    expect(screen.getByLabelText('Valor da parcela 3')).toHaveValue('598,15')
    expect(resumo()).toHaveTextContent('bate')
    expect(botaoLancar()).toBeEnabled()
  })

  it('"Dividir em parcelas iguais": com 3 linhas e as datas, preenche 598,16 + 598,16 + 598,17 e o Lançar acende sozinho', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await tresParcelas()
    expect(botaoLancar()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Dividir em parcelas iguais' }))
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('598,16')
    expect(screen.getByLabelText('Valor da parcela 2')).toHaveValue('598,16')
    expect(screen.getByLabelText('Valor da parcela 3')).toHaveValue('598,17')   // a última leva o centavo que sobra
    expect(resumo()).toHaveTextContent('bate')
    expect(botaoLancar()).toBeEnabled()
  })

  it('com o Lançar aceso, Lançar → Confirmar manda as 3 parcelas (somando o valor da nota ao centavo)', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await tresParcelas()
    await userEvent.click(screen.getByRole('button', { name: 'Dividir em parcelas iguais' }))
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('parcelas-confirmar')).toHaveTextContent('Parcela 3 · vence 30/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [
      { vencimento: '2026-10-16', valor: 598.16 }, { vencimento: '2026-10-23', valor: 598.16 }, { vencimento: '2026-10-30', valor: 598.17 },
    ]))
  })

  it('valor que divide certinho (R$ 100 em 4): todas iguais, sem centavo sobrando', async () => {
    m.notasALancar.mockResolvedValue([mateus({ valor_nf: 100 })])
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    for (let k = 0; k < 3; k++) await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dividir em parcelas iguais' }))
    for (const i of [1, 2, 3, 4]) expect(screen.getByLabelText(`Valor da parcela ${i}`)).toHaveValue('25,00')
  })

  it('uma parcela só: recebe o valor total; sem a dica do centavo quando não falta nada', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await userEvent.click(screen.getByRole('button', { name: 'Dividir em parcelas iguais' }))
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('1.794,49')
    expect(screen.queryByTestId('dica-centavo')).not.toBeInTheDocument()
  })

  it('o Lançar acende SOZINHO assim que a soma bate (sem outro toque), inclusive digitando à mão a última parcela', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await tresParcelas()
    await digitar(1, '2026-10-16', '598,16')
    await digitar(2, '2026-10-23', '598,16')
    expect(botaoLancar()).toBeDisabled()
    await digitar(3, '2026-10-30', '598,17')
    expect(resumo()).toHaveTextContent('bate')
    expect(botaoLancar()).toBeEnabled()
  })

  it('o painel de conferir mostra tudo certo (leite com 0,395) e nenhum aviso de item trava o Lançar', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('conferir')).getAllByTestId('conferir-item').length).toBe(3)
  })
})
