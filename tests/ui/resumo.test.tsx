import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Resumo, { avisosEncerrar, linhaEconomia } from '../../src/admin/Resumo'
import { cotacao, item, linha, vendedor } from '../fabricas'

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

describe('Resumo — Fase 1B (cotações)', () => {
  const eco = (p: Partial<import('../../src/lib/tipos').EconomiaSemana>) => ({
    semana_id: 7, data_referencia: '2026-09-22', pedidos: 1, itens_pedido: 13, itens_com_referencia: 11, itens_sem_comparacao: 2,
    total_pedido: 2380, total_ultimo: 2520, diferenca: -140, ...p,
  })

  it('item com pedido aparece como "Pedido com X", não como "faltou"', async () => {
    m.marcasDaSemana.mockResolvedValue([{ item_semana_id: 3, estado: 'pedido', vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: null, qtd: 3 }])
    render(<Resumo />)
    expect(await screen.findByText(/Pedido com FORNECEDOR A · 3 un/)).toBeInTheDocument()
    expect(screen.getByText('Pedidos com vendedores')).toBeInTheDocument()
    const faltou = screen.getByText('Faltou').parentElement as HTMLElement
    expect(faltou.textContent).toContain('MOSTARDA')
    expect(screen.getAllByText('SCHWEPPES CITRUS')).toHaveLength(1) // só no bloco do pedido
  })

  it('pedido que cobre só parte do item: o resto é da loja e, sem compra, entra em "Faltou" e em "sem marcação" (D63)', async () => {
    m.itensDaSemana.mockResolvedValue([
      item({ id: 1, produto: 'COCA COLA 350 ML', qtd_aprovada: 52, preco_estimado: 2.79 }),
      item({ id: 3, produto: 'SCHWEPPES CITRUS', qtd_aprovada: 3, preco_estimado: 4 }),
      item({ id: 4, produto: 'AÇÚCAR CRISTAL', unidade: 'kg', qtd_aprovada: 8, preco_estimado: 5 }),
      item({ id: 5, produto: 'ÁGUA MINERAL', qtd_aprovada: 60, preco_estimado: 2.4 }),
    ])
    m.linhasDaSemana.mockResolvedValue([
      linha({ item_semana_id: 1, qtd: 52, preco_unit: 2.79 }),
      linha({ item_semana_id: 3, qtd: 0, resultado: 'nao_achei' }),
    ])
    const ped = (item_semana_id: number, qtd: number) => ({ item_semana_id, estado: 'pedido' as const, vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: null, qtd })
    m.marcasDaSemana.mockResolvedValue([ped(3, 1), ped(4, 1), ped(5, 60)])
    render(<Resumo />)
    expect(await screen.findByText('Pedido com FORNECEDOR A: 1 un de 3 un · o resto (2 un) é da loja')).toBeInTheDocument()
    expect(screen.getByText('Pedido com FORNECEDOR A: 1 kg de 8 kg · o resto (7 kg) é da loja')).toBeInTheDocument()
    expect(screen.getByText('Pedido com FORNECEDOR A · 60 un')).toBeInTheDocument()
    // o "não achei" do resto é falta; o AÇÚCAR sem marcação continua pendente (só o ÁGUA, todo no pedido, sai da conta)
    expect(screen.getByText('Faltou')).toBeInTheDocument()
    expect(screen.getByText('Comprado 0 un de 2 un · 1 un vem no pedido com FORNECEDOR A')).toBeInTheDocument()
    expect(screen.getAllByText('SCHWEPPES CITRUS')).toHaveLength(2) // no pedido e em "Faltou"
    expect(screen.getAllByText('AÇÚCAR CRISTAL')).toHaveLength(1) // só no pedido
    expect(screen.getAllByText('ÁGUA MINERAL')).toHaveLength(1)
    expect(screen.getByText(/Ainda sem marcação: 1 · com pedido a vendedor: 3/)).toBeInTheDocument()
  })

  it('linha de economia: percentual, acumulado "Desde" e itens sem comparação', async () => {
    m.economiaSemanas.mockResolvedValue([eco({ semana_id: 5, data_referencia: '2026-09-08', diferenca: -270 }), eco({}), eco({ semana_id: 8, data_referencia: '2026-09-29', diferenca: 999 })])
    render(<Resumo />)
    expect(await screen.findByTestId('economia')).toHaveTextContent(
      'Cotações da semana: pedidos R$ 2.380,00 em 11 itens com referência; pelo último preço seriam R$ 2.520,00 (−5,6%). Desde 08/09: −R$ 410,00. · 2 itens sem comparação',
    )
  })

  it('sem a view (ou sem pedido na semana) o Resumo não quebra e não mostra a linha', async () => {
    m.economiaSemanas.mockRejectedValue(new Error('relation "cot_economia" does not exist'))
    render(<Resumo />)
    expect(await screen.findByText('1 de 3')).toBeInTheDocument()
    expect(screen.queryByTestId('economia')).not.toBeInTheDocument()
  })

  it('linhaEconomia: sem linha da semana → null; sem último preço → sem percentual; um item no singular', () => {
    expect(linhaEconomia([eco({ semana_id: 9 })], 7)).toBeNull()
    expect(linhaEconomia([eco({ total_ultimo: 0, total_pedido: 0, itens_com_referencia: 1, itens_sem_comparacao: 0, diferenca: 0 })], 7))
      .toBe('Cotações da semana: pedidos R$ 0,00 em 1 item com referência; pelo último preço seriam R$ 0,00. Desde 22/09: R$ 0,00.')
    expect(linhaEconomia([eco({ total_pedido: 2600, diferenca: 80, itens_sem_comparacao: 1 })], 7))
      .toContain('(+3,2%). Desde 22/09: +R$ 80,00. · 1 item sem comparação')
  })

  it('aviso antes de encerrar: cotação ainda com o vendedor e pedido confirmado (texto honesto)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T18:00:00Z'))
    try {
      m.listarVendedores.mockResolvedValue([vendedor({ empresa: 'MATEUS (Mix)' }), vendedor({ id: 2, empresa: 'ATACADÃO (Centro)' })])
      m.cotacoesDaSemana.mockResolvedValue([
        cotacao({ id: 5, vendedor_id: 1, status: 'enviada', enviada_em: '2026-10-09T18:00:00Z', prazo: '2026-10-13T15:00:00Z', fechamento: '2026-10-13T20:00:00Z' }),
        cotacao({ id: 6, vendedor_id: 2, status: 'fechada', resultado: 'pedido', prazo: '2026-10-07T15:00:00Z', fechamento: '2026-10-07T20:00:00Z' }),
        cotacao({ id: 4, vendedor_id: 1, status: 'substituida', substituida_por: 5 }),
      ])
      render(<Resumo />)
      await userEvent.click(await screen.findByRole('button', { name: 'Encerrar semana' }))
      expect(window.confirm).toHaveBeenCalledWith([
        "Há cotação aberta com MATEUS (fecha ter 13/10 às 17h): na semana nova os itens dela continuam 'Em cotação' até você decidir.",
        'Há pedido com ATACADÃO confirmado nesta semana: ele só entra no estoque quando a NF-e for lançada no SisChef.',
        'Encerrar assim mesmo?',
      ].join('\n\n'))
      expect(m.cotacoesDaSemana).toHaveBeenCalledWith(7)
      expect(m.encerrarSemana).toHaveBeenCalledWith(7)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sem cotação aberta nem pedido (ou sem a migration): a pergunta de sempre', async () => {
    m.cotacoesDaSemana.mockRejectedValue(new Error('Could not find the table'))
    render(<Resumo />)
    await userEvent.click(await screen.findByRole('button', { name: 'Encerrar semana' }))
    expect(window.confirm).toHaveBeenCalledWith('Encerrar a semana? Os compradores deixam de ver esta lista.')
  })

  it('avisosEncerrar: pronta sem sinal, cotação já fechada e dispensada não avisam', () => {
    const agora = new Date('2026-10-09T18:00:00Z')
    const futuro = { prazo: '2026-10-13T15:00:00Z', fechamento: '2026-10-13T20:00:00Z' }
    expect(avisosEncerrar([
      cotacao({ id: 1, status: 'pronta', ...futuro }),
      cotacao({ id: 2, status: 'fechada', ...futuro }),
      cotacao({ id: 3, status: 'fechada', resultado: 'dispensado', ...futuro }),
      cotacao({ id: 4, status: 'enviada', prazo: '2026-10-08T15:00:00Z', fechamento: '2026-10-08T20:00:00Z' }),
    ], [vendedor()], agora)).toEqual([])
    // pronta com link aberto já está com o vendedor
    expect(avisosEncerrar([cotacao({ id: 1, status: 'pronta', primeiro_acesso: '2026-10-09T18:00:00Z', ...futuro })], [vendedor()], agora))
      .toHaveLength(1)
  })
})
