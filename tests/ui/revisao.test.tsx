import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Revisao from '../../src/admin/Revisao'
import { item } from '../fabricas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const sp = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

const semana = { id: 7, data_referencia: '2026-09-22', status: 'rascunho' as const, aprovada_por: null, aprovada_em: null }
const itens = [
  item({ id: 1, produto: 'COCA COLA 350 ML', estoque: 41, qtd_sugerida: 52, qtd_aprovada: 52, preco_estimado: 2.79, fornecedor_ultima: 'ATACADAO S.A.', data_ultima_compra: '2026-09-11' }),
  item({ id: 2, produto: 'MOSTARDA - INSUMO (KG)', bebida: false, unidade: 'kg', estoque: 0.8, qtd_sugerida: 1.2, qtd_aprovada: 1.2, preco_estimado: 18.5 }),
  item({ id: 3, produto: 'CEBOLA EM PÓ - INSUMOS (KG)', bebida: false, unidade: 'kg', negativo: true, incluido: false, qtd_sugerida: 0.04 }),
  item({ id: 4, produto: 'COCA COLA KS 290ML', incluido: false, qtd_sugerida: 0 }),
]

beforeEach(() => {
  vi.resetAllMocks()
  m.semanaParaRevisar.mockResolvedValue(semana)
  m.itensDaSemana.mockResolvedValue(itens)
  m.ajustarItem.mockResolvedValue()
  m.aprovarSemana.mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Revisão da lista', () => {
  it('mostra abas com contagem, cartão com dados e total estimado', async () => {
    render(<Revisao />)
    expect(await screen.findByRole('button', { name: 'Bebidas 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insumos 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Negativos 1' })).toBeInTheDocument()
    expect(screen.getByText('COCA COLA 350 ML')).toBeInTheDocument()
    expect(screen.getByText(/Fornecedor: ATACADAO S.A./)).toBeInTheDocument()
    expect(sp(screen.getByTestId('total').textContent)).toBe('R$ 167,28') // 52×2,79 + 1,2×18,5
  })

  it('+ aumenta a quantidade e grava', async () => {
    render(<Revisao />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Mais' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, 53, true)
    expect(within(cartao).getByRole('textbox')).toHaveValue('53')
  })

  it('digitar 1,5 em insumo em kg grava 1.5', async () => {
    render(<Revisao />)
    await userEvent.click(await screen.findByRole('button', { name: 'Insumos 1' }))
    const campo = within((screen.getByText('MOSTARDA - INSUMO (KG)').closest('.cartao')) as HTMLElement).getByRole('textbox')
    await userEvent.clear(campo)
    await userEvent.type(campo, '1,5')
    await userEvent.tab()
    expect(m.ajustarItem).toHaveBeenLastCalledWith(2, 1.5, true)
  })

  it('Tirar remove da aba e Incluir traz de volta um negativo', async () => {
    render(<Revisao />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Tirar' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, 52, false)
    expect(screen.queryByText('COCA COLA 350 ML')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Negativos 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Incluir' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(3, 0.04, true)
  })

  it('busca item fora da lista e inclui com quantidade 1', async () => {
    render(<Revisao />)
    await userEvent.type(await screen.findByPlaceholderText(/incluir item/i), 'ks 290')
    await userEvent.click(screen.getByRole('button', { name: /COCA COLA KS 290ML/ }))
    expect(m.ajustarItem).toHaveBeenCalledWith(4, 1, true)
  })

  it('se gravar falhar, desfaz e mostra o erro', async () => {
    m.ajustarItem.mockRejectedValue(new Error('só dá para ajustar a lista enquanto ela está em rascunho'))
    render(<Revisao />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Mais' }))
    expect(await screen.findByText(/enquanto ela está em rascunho/)).toBeInTheDocument()
    expect(within(cartao).getByRole('textbox')).toHaveValue('52')
  })

  it('aprovar libera a lista e trava edição', async () => {
    render(<Revisao />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(m.aprovarSemana).toHaveBeenCalledWith(7)
    expect(await screen.findByText('Em compra')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mais' })).not.toBeInTheDocument()
  })

  it('mostra o motivo quando não pode aprovar', async () => {
    m.aprovarSemana.mockRejectedValue(new Error('encerre a semana anterior antes de aprovar esta'))
    render(<Revisao />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(await screen.findByText(/encerre a semana anterior/)).toBeInTheDocument()
  })

  it('sem lista nova mostra aviso', async () => {
    m.semanaParaRevisar.mockResolvedValue(null)
    render(<Revisao />)
    expect(await screen.findByText(/segunda às 6h/)).toBeInTheDocument()
  })
})
