import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Resumo from '../../src/admin/Resumo'
import { item, linha } from '../fabricas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const s = (id: number, data: string, status: 'em_compra' | 'encerrada') => ({ id, data_referencia: data, status, aprovada_por: null, aprovada_em: null })

beforeEach(() => {
  vi.resetAllMocks()
  m.listarSemanas.mockResolvedValue([s(8, '2026-09-29', 'encerrada'), s(7, '2026-09-22', 'em_compra')].sort((a, b) => b.data_referencia.localeCompare(a.data_referencia)))
  m.itensDaSemana.mockResolvedValue([
    item({ id: 1, produto: 'COCA COLA 350 ML', qtd_aprovada: 52, preco_estimado: 2.79 }),
    item({ id: 2, produto: 'MOSTARDA - INSUMO (KG)', unidade: 'kg', qtd_aprovada: 1.2, preco_estimado: 18.5 }),
    item({ id: 3, produto: 'SCHWEPPES CITRUS', qtd_aprovada: 3, preco_estimado: 4 }),
  ])
  m.linhasDaSemana.mockResolvedValue([
    linha({ item_semana_id: 1, qtd: 52, preco_unit: 2.79 }),
    linha({ item_semana_id: 2, qtd: 1, preco_unit: 21.9, resultado: 'parcial' }),
    linha({ item_semana_id: 3, qtd: 0, resultado: 'nao_achei' }),
  ])
  m.encerrarSemana.mockResolvedValue()
  m.comprasAbertas.mockResolvedValue([])
  m.cancelarCompra.mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Resumo', () => {
  it('abre na semana em compra e mostra os números', async () => {
    render(<Resumo />)
    expect(await screen.findByText('1 de 3')).toBeInTheDocument()
    expect(m.itensDaSemana).toHaveBeenCalledWith(7)
    expect(screen.getByText(/SCHWEPPES CITRUS/)).toBeInTheDocument()
    expect(screen.getByText(/\+18%/)).toBeInTheDocument()
  })

  it('encerrar semana', async () => {
    render(<Resumo />)
    await userEvent.click(await screen.findByRole('button', { name: 'Encerrar semana' }))
    expect(m.encerrarSemana).toHaveBeenCalledWith(7)
  })

  it('trocar para uma semana do histórico', async () => {
    render(<Resumo />)
    await screen.findByText('1 de 3')
    await userEvent.selectOptions(screen.getByLabelText('Semana'), '8')
    expect(m.itensDaSemana).toHaveBeenLastCalledWith(8)
  })

  it('I2: lista compras em aberto (loja, comprador, desde quando) enquanto a semana está em compra', async () => {
    m.comprasAbertas.mockResolvedValue([
      { id: 'c1', loja: 'ATACADÃO', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-22T10:00:00Z' },
      { id: 'c2', loja: 'FEIRA', comprador: 'maria@spazio.com', comprador_nome: 'Maria', aberta_em: '2026-09-22T11:00:00Z' },
    ])
    render(<Resumo />)
    expect(await screen.findByText(/ATACADÃO/)).toBeInTheDocument()
    expect(screen.getByText(/João/)).toBeInTheDocument()
    expect(screen.getByText(/FEIRA/)).toBeInTheDocument()
    expect(screen.getByText(/Maria/)).toBeInTheDocument()
    expect(m.comprasAbertas).toHaveBeenCalledWith(7)
  })

  it('I2: cancela uma compra em aberto (pede confirmação)', async () => {
    m.comprasAbertas.mockResolvedValue([
      { id: 'c1', loja: 'ATACADÃO', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-22T10:00:00Z' },
    ])
    render(<Resumo />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(m.cancelarCompra).toHaveBeenCalledWith('c1')
    expect(screen.queryByText(/ATACADÃO/)).not.toBeInTheDocument()
  })

  it('I2: erro ao cancelar (compra com item marcado) aparece na tela', async () => {
    m.comprasAbertas.mockResolvedValue([
      { id: 'c1', loja: 'ATACADÃO', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-22T10:00:00Z' },
    ])
    m.cancelarCompra.mockRejectedValue(new Error('esta compra já tem item marcado; feche-a em vez de cancelar'))
    render(<Resumo />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText('esta compra já tem item marcado; feche-a em vez de cancelar')).toBeInTheDocument()
  })

  it('I2: sem semana em compra, não lista (nem chama) compras em aberto', async () => {
    m.listarSemanas.mockResolvedValue([s(8, '2026-09-29', 'encerrada')])
    render(<Resumo />)
    await screen.findByText(/SCHWEPPES CITRUS/)
    expect(screen.queryByText('Compras em aberto')).not.toBeInTheDocument()
    expect(m.comprasAbertas).not.toHaveBeenCalled()
  })
})
