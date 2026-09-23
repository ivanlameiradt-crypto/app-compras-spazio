import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Lancamentos from '../../src/admin/Lancamentos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const base = { semana_id: 7, comprador: 'joao@spazio.com', comprador_nome: 'João', foto_cupom: null, aberta_em: '2026-09-23T13:00:00Z', fechada_em: '2026-09-23T14:00:00Z' }
const fila: api.CompraNaFila[] = [
  { ...base, id: 'c1', loja: 'ATACADÃO', com_nota: true, total_pago: 4310.55, status: 'fechada', itens: 18, foto_cupom: 'c1/x.jpg' },
  { ...base, id: 'c2', loja: 'MATEUS', com_nota: false, total_pago: 2357.45, status: 'aprovada', itens: 3 },
]

beforeEach(() => {
  vi.resetAllMocks()
  m.filaLancamentos.mockResolvedValue(fila)
  m.aprovarCompra.mockResolvedValue()
  m.marcarLancada.mockResolvedValue()
  m.corrigirItemCompra.mockResolvedValue()
  m.corrigirCompra.mockResolvedValue()
  m.itensDaCompra.mockResolvedValue([
    { id: 'l1', compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79, resultado: 'comprado', marcado_por: 'joao@spazio.com', marcado_em: '', produto: 'COCA COLA 350 ML', unidade: 'un', preco_estimado: 2.79 },
  ])
  m.urlCupom.mockResolvedValue('https://x/cupom')
})

const cartao = async (loja: string) => (await screen.findByText(new RegExp(loja))).closest('.cartao') as HTMLElement

describe('Lançamentos', () => {
  it('lista compras com loja, comprador, itens, total e nota', async () => {
    render(<Lancamentos />)
    const c = await cartao('ATACADÃO')
    expect(within(c).getByText(/João/)).toBeInTheDocument()
    expect(within(c).getByText(/18 itens/)).toBeInTheDocument()
    expect(within(c).getByText('Com nota')).toBeInTheDocument()
    expect(within(await cartao('MATEUS')).getByText('Sem nota')).toBeInTheDocument()
  })

  it('aprovar passa para Pronta para lançar', async () => {
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Aprovar' }))
    expect(m.aprovarCompra).toHaveBeenCalledWith('c1')
    expect(within(await cartao('ATACADÃO')).getByText('Pronta para lançar')).toBeInTheDocument()
  })

  it('aprovada pode ser marcada como lançada e sai da fila', async () => {
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('MATEUS')).getByRole('button', { name: /marcar como lançada/i }))
    expect(m.marcarLancada).toHaveBeenCalledWith('c2')
    expect(screen.queryByText(/MATEUS/)).not.toBeInTheDocument()
  })

  it('ver itens mostra a tabela e permite corrigir', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('50').mockReturnValueOnce('2,90')
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).toHaveBeenCalledWith('l1', 50, 2.9)
  })

  it('cancelar o prompt do preço não apaga o preço nem chama corrigir (M2)', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('50').mockReturnValueOnce(null)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).not.toHaveBeenCalled()
    expect(screen.getByText('R$ 2,79')).toBeInTheDocument()
  })

  it('cancelar o prompt da quantidade também aborta', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).not.toHaveBeenCalled()
  })

  it('I4: corrige total e com/sem nota', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('1.250')
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).toHaveBeenCalledWith('c1', false, 1250)
    expect(within(await cartao('ATACADÃO')).getByText('Sem nota')).toBeInTheDocument()
    expect(within(await cartao('ATACADÃO')).getByText(/R\$ 1\.250,00/)).toBeInTheDocument()
  })

  it('I4: cancelar o prompt do total não muda nada', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce(null)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).not.toHaveBeenCalled()
    expect(within(await cartao('ATACADÃO')).getByText('Com nota')).toBeInTheDocument()
  })

  it('I4: cancelar o prompt de com/sem nota aborta antes de perguntar o total', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).not.toHaveBeenCalled()
    expect(window.prompt).toHaveBeenCalledTimes(1)
  })

  it('abre a aba do cupom já no clique e só depois manda a URL assinada (M4)', async () => {
    const janela = { location: { href: '' } } as unknown as Window
    const abrir = vi.spyOn(window, 'open').mockReturnValue(janela)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    expect(abrir).toHaveBeenCalledWith('', '_blank')
    expect(m.urlCupom).toHaveBeenCalledWith('c1/x.jpg')
    await waitFor(() => expect(janela.location.href).toBe('https://x/cupom'))
  })

  it('falha ao gerar o link do cupom: fecha a aba em branco e mostra o erro (M-c)', async () => {
    const janela = { location: { href: '' }, close: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(janela)
    m.urlCupom.mockRejectedValue(new Error('Object not found'))
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    expect(await screen.findByText(/Object not found/)).toBeInTheDocument()
    expect(janela.close).toHaveBeenCalled()
  })

  it('aba bloqueada (window.open null): mostra o cupom embutido no cartão (M4)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    render(<Lancamentos />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    const img = await within(await cartao('ATACADÃO')).findByRole('img')
    expect(img).toHaveAttribute('src', 'https://x/cupom')
  })

  it('fila vazia', async () => {
    m.filaLancamentos.mockResolvedValue([])
    render(<Lancamentos />)
    expect(await screen.findByText(/nenhuma compra aguardando/i)).toBeInTheDocument()
  })
})
