import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import * as foto from '../../src/lib/foto'
import Cupom from '../../src/admin/Cupom'
import type { CupomRecente } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/foto')
const m = vi.mocked(api)

// Pedido do Ivan (07/10): o detalhe do cupom lançado mostra o dia e a hora do lançamento, como na aba Lançamento fiscal ("Lançada em: 07/10 às 17h45").
const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'c1', estado: 'LANCADO', emitente_nome: 'MATEUS SUPERMERCADOS SA', valor_a_pagar: 45.23, pedido_sischef: '163812710',
  criado_em: '2026-10-07T20:10:30Z', atualizado_em: '2026-10-07T20:25:32Z', motivo: null, teste: false,
  itens: [{ descricao: 'TOMATE SALADETE KG', quantidade: 3.74, unidade: 'kg', valor: 7.99 } as never], ...extra,
})
// a linha do cupom é o 1º botão do cartão (o de "Ver a foto" etc. vem depois)
const abrir = async () => userEvent.click(within(await screen.findByTestId('cupom-recente')).getAllByRole('button')[0])

beforeEach(() => {
  vi.resetAllMocks()
  m.cuponsRecentes.mockResolvedValue([cupom()])
})

describe('Cupom — "Lançado em" no detalhe do cupom lançado', () => {
  it('cupom LANCADO aberto mostra "Lançado em: dia às hora" (horário de Belém) e o pedido no SisChef', async () => {
    render(<Cupom />)
    await abrir()
    expect(await screen.findByTestId('detalhe-quando')).toHaveTextContent('Lançado em: 07/10 às 17h25')   // 20:25 UTC = 17h25 em Belém
    expect(screen.getByText(/Pedido no SisChef/)).toHaveTextContent('163812710')
  })

  it('o horário é o do LANÇAMENTO (atualizado_em), não o do envio da foto (criado_em)', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ criado_em: '2026-10-06T13:07:38Z', atualizado_em: '2026-10-07T10:59:39Z' })])
    render(<Cupom />)
    await abrir()
    expect(await screen.findByTestId('detalhe-quando')).toHaveTextContent('Lançado em: 07/10 às 07h59')
  })

  it('fechado, o detalhe (e a hora) não aparece; abrir e fechar de novo esconde', async () => {
    render(<Cupom />)
    await screen.findByTestId('cupom-recente')
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
    await abrir()
    expect(await screen.findByTestId('detalhe-quando')).toBeInTheDocument()
    await abrir()
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
  })

  it('sem atualizado_em (leitura antiga) não inventa hora', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ atualizado_em: null })])
    render(<Cupom />)
    await abrir()
    await screen.findByText(/Pedido no SisChef/)
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
  })

  it('cupom que não está lançado (precisa de você) não mostra hora de lançamento', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ estado: 'REVISAR', pedido_sischef: null, motivo: 'item sem casamento' })])
    render(<Cupom />)
    await abrir()
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
  })

  it('envio repetido ("já lançado ✓"): a hora do OUTRO envio não é a deste, então não mostra', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ estado: 'REVISAR', pedido_sischef: null, motivo: 'já lançado em outro envio' })])
    render(<Cupom />)
    await abrir()
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
  })
})
