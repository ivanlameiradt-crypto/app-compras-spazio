import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'
import { barras, linha } from '../unit/boletoAjuda'

vi.mock('../../src/lib/api')
vi.mock('../../src/admin/boletoFoto', () => ({ lerDigitosDaFoto: vi.fn(), lerDigitosDaImagem: vi.fn() }))
const m = vi.mocked(api)

/** MATEUS (R$ 469,74): o XML veio sem boletos; a Marilane lê o boleto pela foto ou pelo número. */
const mateus = (): NotaSefazLista => ({
  chave: '0'.repeat(44), cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000090565', emissao: '2026-11-24', valor_nf: 469.74,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [{ n: 1, descricao: 'ARROZ PARBOLIZADO', qtd: 6, unidade_sischef: 'KG', produto_id: 1836986, associacao: 'sischef' }],
})
// 10/12/2026 = fator 1656; valor R$ 469,74. O fator é lido pela data de hoje, então o teste vale enquanto "hoje" estiver entre 2024 e 2038.
const CODIGO = barras('341', '1656', '46974')
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })

beforeEach(async () => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([mateus()])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  try { localStorage.clear() } catch { /* sem armazenamento */ }
})

describe('NotaSefaz — boleto lido pela foto ou pelo número (25/11)', () => {
  it('a foto lida preenche a parcela e o Lançar acende (soma bate com a nota)', async () => {
    const { lerDigitosDaFoto } = await import('../../src/admin/boletoFoto')
    vi.mocked(lerDigitosDaFoto).mockResolvedValue(CODIGO)
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    expect(botaoLancar()).toBeDisabled()
    await userEvent.upload(screen.getByTestId('boleto-foto-arquivo'), new File(['x'], 'boleto.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByTestId('boleto-aviso')).toHaveTextContent('Boleto lido: vence 10/12/2026')
    expect(screen.getAllByTestId('linha-parcela')).toHaveLength(1)
    expect(screen.getByLabelText('Vencimento da parcela 1')).toHaveValue('2026-12-10')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('469,74')
    expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('bate')
  })

  it('foto sem código: avisa em vermelho e não mexe nas parcelas', async () => {
    const { lerDigitosDaFoto } = await import('../../src/admin/boletoFoto')
    vi.mocked(lerDigitosDaFoto).mockResolvedValue(null)
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await userEvent.upload(screen.getByTestId('boleto-foto-arquivo'), new File(['x'], 'boleto.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByTestId('boleto-aviso')).toHaveClass('erro')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('')
  })

  it('cada boleto tem o seu botão: digita o 1º, "Existe mais um boleto" abre o 2º com o próprio leitor; o mesmo boleto de novo é recusado', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await userEvent.click(screen.getByTestId('boleto-digitar-botao'))
    await userEvent.type(screen.getByPlaceholderText(/Cole ou digite/), linha(CODIGO))
    await userEvent.click(screen.getByRole('button', { name: 'Usar este número' }))
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('469,74')
    expect(screen.getByText('Boleto 1 de 1')).toBeInTheDocument()
    // existe mais um boleto: a parcela 2 nasce com o botão de foto dela
    await userEvent.click(screen.getByRole('button', { name: 'Existe mais um boleto' }))
    expect(screen.getByText('Boleto 2 de 2')).toBeInTheDocument()
    expect(screen.getAllByTestId('boleto-foto-botao')).toHaveLength(2)
    const outro = barras('001', '1670', '10000')
    await userEvent.click(screen.getAllByTestId('boleto-digitar-botao')[1])
    await userEvent.type(screen.getByPlaceholderText(/Cole ou digite/), linha(outro))
    await userEvent.click(screen.getByRole('button', { name: 'Usar este número' }))
    expect(screen.getByLabelText('Valor da parcela 2')).toHaveValue('100,00')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('469,74')
    // o 1º boleto lido de novo na linha 2: já está na lista
    await userEvent.click(screen.getAllByTestId('boleto-digitar-botao')[1])
    await userEvent.type(screen.getByPlaceholderText(/Cole ou digite/), CODIGO)
    await userEvent.click(screen.getByRole('button', { name: 'Usar este número' }))
    expect(screen.getAllByTestId('boleto-aviso').map((e) => e.textContent).join(' ')).toContain('já está na lista')
    expect(screen.getByLabelText('Valor da parcela 2')).toHaveValue('100,00')
  })

  it('número errado: mostra o motivo e não preenche nada', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await userEvent.click(screen.getByTestId('boleto-digitar-botao'))
    await userEvent.type(screen.getByPlaceholderText(/Cole ou digite/), '12345')
    await userEvent.click(screen.getByRole('button', { name: 'Usar este número' }))
    expect(screen.getByTestId('boleto-aviso')).toHaveClass('erro')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('')
  })

  it('depois do Lançar + Confirmar o cartão da nota recolhe sozinho (27/11)', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    const cartao = screen.getByTestId('nota-recolhivel') as HTMLDetailsElement
    cartao.open = true
    await userEvent.click(screen.getByTestId('boleto-digitar-botao'))
    await userEvent.type(screen.getByPlaceholderText(/Cole ou digite/), linha(CODIGO))
    await userEvent.click(screen.getByRole('button', { name: 'Usar este número' }))
    await userEvent.click(botaoLancar())
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar/ }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(cartao.open).toBe(false))
  })
})
