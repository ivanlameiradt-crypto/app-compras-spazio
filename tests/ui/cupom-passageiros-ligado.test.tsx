import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Cupom from '../../src/admin/Cupom'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// Com a função do servidor pronta (BOTAO_TENTAR_DE_NOVO_LIGADO ligado aqui só para o teste), o motivo passageiro mostra o botão e ele chama o api; o que pode ter criado compra continua sem botão.
vi.mock('../../src/lib/api')
vi.mock('../../src/admin/cupomRegras', async (original) => ({ ...(await original<typeof import('../../src/admin/cupomRegras')>()), BOTAO_TENTAR_DE_NOVO_LIGADO: true }))
const m = vi.mocked(api)
const COM: ItemCupomRecente = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 13.472, sugestao_produto: { id: '3484974' }, casado_por: 'descricao', proposta: null, quantidade_cupom: 13.472 }
const cupom = (motivo: string): CupomRecente => ({
  id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 119.9, pedido_sischef: null, criado_em: '2026-11-14T12:00:00Z',
  motivo, teste: false, itens: [COM],
})

beforeEach(() => {
  vi.resetAllMocks()
  m.cuponsRecentes.mockResolvedValue([])
  m.cuponsExcluidos.mockResolvedValue([])
  m.fantasiasDosFornecedores.mockResolvedValue({})
  m.catalogoProdutos.mockResolvedValue([])
})

describe('Cupom — botão Tentar de novo ligado', () => {
  it('motivo passageiro: o botão chama o servidor e a lista recarrega', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom('falha ao montar o pedido no Sischef: TimeoutError: Page.click: Timeout 30000ms exceeded.')])
    m.tentarDeNovoCupom.mockResolvedValue({ cupom_id: 'c9', estado: 'PENDENTE', resumo: 'enviado', disparo_ok: true } as never)
    render(<Cupom />)
    await screen.findByTestId('cupom-problema')
    expect(screen.queryByTestId('tentar-de-novo-pelo-claude')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(m.tentarDeNovoCupom).toHaveBeenCalledWith('c9'))
    await waitFor(() => expect(m.cuponsRecentes.mock.calls.length).toBeGreaterThan(1))
  })

  it('pode ter criado compra: nunca tem o botão', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom('CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO — conferir no Sischef antes de repetir: TimeoutError: x')])
    render(<Cupom />)
    await screen.findByTestId('cupom-problema')
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })
})
