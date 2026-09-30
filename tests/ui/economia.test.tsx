import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Economia from '../../src/admin/Economia'
import type {
  CategoriaPainel, CompraSischef, ItemEconomia, MesPainel, Metricas, PainelEconomia, SemanaPainel, VendedorPainel,
} from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const met = (x: Partial<Metricas> = {}): Metricas => ({
  pedidos: 1, itens: 1, comparados: 1, sem_comparacao: 0, acima: 0,
  total_pedido: 0, total_ultimo: 0, diferenca: 0, pct: null, ...x,
})
const semana = (data: string, x: Partial<SemanaPainel>): SemanaPainel => ({
  ...met(), semana_id: data.length, data_referencia: data, status: 'encerrada', acumulado: 0, acumulado_desde_inicio: 0, ...x,
})
const mes = (mesData: string, x: Partial<MesPainel>): MesPainel => ({ ...met(), mes: mesData, ...x })
const vend = (id: number, rotulo: string, x: Partial<VendedorPainel>): VendedorPainel => ({ ...met(), vendedor_id: id, rotulo, semanas: 1, ...x })
const cat = (categoria: string, x: Partial<CategoriaPainel>): CategoriaPainel => ({ ...met(), categoria, ...x })
const itemEco = (id: number, produto: string, x: Partial<ItemEconomia>): ItemEconomia => ({
  ...met(), produto_id: id, produto, unidade: 'un', categoria: 'Bebidas', qtd: 100,
  preco_primeiro: null, preco_ultimo: null, variacao: null, pontos: [], ...x,
})
const queda = (id: number, produto: string): CompraSischef => ({
  produto_id: id, produto, unidade: 'kg', compras: 2,
  primeiro: { data: '2026-09-20', preco: 6, fornecedor: 'FORNECEDOR B' },
  ultimo: { data: '2026-10-10', preco: 5, fornecedor: 'FORNECEDOR B' }, variacao: -0.1667,
})

const PAINEL: PainelEconomia = {
  de: '2026-09-01', ate: '2026-10-31', inicio: '2026-09-28',
  total: met({ pedidos: 2, itens: 2, comparados: 2, total_pedido: 460, total_ultimo: 480, diferenca: -20, pct: 460 / 480 - 1 }),
  desde_inicio: { diferenca: -20, semanas: 2 },
  semanas: [
    semana('2026-09-28', { total_pedido: 200, total_ultimo: 240, diferenca: -40, acumulado: -40, acumulado_desde_inicio: -40, pct: 200 / 240 - 1 }),
    semana('2026-10-05', { total_pedido: 260, total_ultimo: 240, diferenca: 20, acumulado: -20, acumulado_desde_inicio: -20, pct: 260 / 240 - 1 }),
  ],
  meses: [mes('2026-09-01', { pedidos: 1, total_pedido: 200, total_ultimo: 240, diferenca: -40, pct: 200 / 240 - 1 }),
    mes('2026-10-01', { pedidos: 1, total_pedido: 260, total_ultimo: 240, diferenca: 20, pct: 260 / 240 - 1 })],
  vendedores: [vend(1, 'FORNECEDOR A', { semanas: 2, comparados: 2, acima: 1, total_pedido: 460, total_ultimo: 480, diferenca: -20, pct: 460 / 480 - 1 })],
  categorias: [cat('Bebidas', { pedidos: 2, comparados: 2, total_pedido: 460, total_ultimo: 480, diferenca: -20, pct: 460 / 480 - 1 })],
  itens: [itemEco(101, 'ÁGUA MINERAL', {
    pedidos: 2, comparados: 2, diferenca: -20, variacao: -0.1, preco_primeiro: 2.0, preco_ultimo: 1.8,
    pontos: [{ data: '2026-09-28', vendedor: 'FORNECEDOR A', preco: 2.0, ultimo: 2.4 }, { data: '2026-10-05', vendedor: 'FORNECEDOR A', preco: 1.8, ultimo: 2.4 }],
  })],
  sem_comparacao: [{ produto_id: 104, produto: 'LEITE INTEGRAL', linhas: 1, motivo: 'ultimo_preco_antigo' }],
  sischef: { altas: [], quedas: [queda(106, 'FARINHA DE TRIGO')] },
}

beforeEach(() => {
  vi.resetAllMocks()
  m.painelEconomia.mockResolvedValue(PAINEL)
  m.historicoItem.mockResolvedValue({
    produto_id: 101, produto: 'ÁGUA MINERAL', unidade: 'un', categoria: 'Bebidas', de: '2026-09-01', ate: '2026-10-31',
    compras_sischef: [], cotacoes: [], pedidos: [],
  })
})

describe('Economia', () => {
  it('mostra o valor do cartão, o texto e os chips de período', async () => {
    render(<Economia />)
    expect(await screen.findByTestId('economia-valor')).toHaveTextContent('R$ 20,00')
    expect(screen.getByTestId('economia-texto')).toHaveTextContent('Economizou R$ 20,00 (4,2% abaixo do último preço pago)')
    for (const rotulo of ['Desde o piloto', 'Este mês', 'Mês passado', '3 meses']) {
      expect(screen.getByRole('tab', { name: rotulo })).toBeInTheDocument()
    }
    expect(screen.getByText(/Economia desde 28\/09/)).toBeInTheDocument()
  })

  it('trocar de período chama a API de novo', async () => {
    render(<Economia />)
    await screen.findByTestId('economia-valor')
    await userEvent.click(screen.getByRole('tab', { name: 'Este mês' }))
    expect(m.painelEconomia).toHaveBeenCalledTimes(2)
  })

  it('"Ver números" abre a tabela com os mesmos acumulados do gráfico', async () => {
    render(<Economia />)
    await userEvent.click(await screen.findByTestId('ver-numeros'))
    const tabela = screen.getByTestId('tabela-semanas')
    // acumulado economia = −acumulado: −(−40)=40 e −(−20)=20 (os mesmos valores da curva)
    expect(within(tabela).getByText('28/09')).toBeInTheDocument()
    expect(tabela.textContent).toContain('R$ 40,00')
    expect(tabela.textContent).toContain('05/10')
  })

  it('tocar num item abre o Histórico do item', async () => {
    render(<Economia />)
    await userEvent.click(await screen.findByText('ÁGUA MINERAL'))
    expect(m.historicoItem).toHaveBeenCalledWith(101, null, null)
    expect(await screen.findByRole('dialog', { name: /Histórico de ÁGUA MINERAL/ })).toBeInTheDocument()
  })

  it('o bloco SisChef aparece com as quedas', async () => {
    render(<Economia />)
    expect(await screen.findByTestId('sischef-queda')).toHaveTextContent('FARINHA DE TRIGO')
  })

  it('sem pedido no período: mensagem, mas o SisChef continua aparecendo', async () => {
    m.painelEconomia.mockResolvedValue({ ...PAINEL, total: met({ pedidos: 0, itens: 0, comparados: 0, total_ultimo: 0 }) })
    render(<Economia />)
    expect(await screen.findByText(/Ainda não há pedido confirmado pelas cotações neste período/)).toBeInTheDocument()
    expect(screen.getByTestId('sischef-queda')).toBeInTheDocument()
    expect(screen.queryByTestId('economia-valor')).not.toBeInTheDocument()
  })

  it('função ausente (App antes da migration): "ainda não foi instalado"', async () => {
    m.painelEconomia.mockResolvedValue(null)
    render(<Economia />)
    expect(await screen.findByText('O painel ainda não foi instalado no banco.')).toBeInTheDocument()
  })

  it('erro com [Tentar de novo] recarrega', async () => {
    m.painelEconomia.mockRejectedValueOnce(new Error('sem internet'))
    render(<Economia />)
    expect(await screen.findByText('Não consegui abrir o painel: sem internet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByTestId('economia-valor')).toBeInTheDocument()
  })
})
