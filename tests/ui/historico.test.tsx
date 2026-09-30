import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as cad from '../../src/cadastros/api'
import * as api from '../../src/lib/api'
import type { HistoricoSemana } from '../../src/lib/tipos'
import Historico from '../../src/admin/Historico'

vi.mock('../../src/cadastros/api')
vi.mock('../../src/lib/api')
const mc = vi.mocked(cad)
const ma = vi.mocked(api)

const semana: HistoricoSemana = {
  semana_id: 1, data_referencia: '2026-10-19', vendedor_id: 1, versoes: 1, desfecho: 'pedido',
  itens: 14, respondidos: 11, tem: 11, pedido_itens: 11, comparados: 9,
  total_pedido: 140, total_ultimo: 148.31, diferenca: -8.31, pct: -0.056,
  enviada_em: null, primeira_resposta_em: null, canais: ['vendedor'],
}

beforeEach(() => {
  vi.resetAllMocks()
  ma.listarVendedores.mockResolvedValue([{ id: 1, codigo: 'fulano', nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', ativo: true }])
  mc.historicoSemanas.mockResolvedValue([semana])
  mc.historicoItens.mockResolvedValue([])
})

describe('Histórico (C.5)', () => {
  it('a semana com pedido mostra o total do pedido e o Δ%', async () => {
    render(<MemoryRouter><Historico /></MemoryRouter>)
    expect(await screen.findByText('2026-10-19')).toBeInTheDocument()
    const total = await screen.findByText((t) => t.includes('R$') && t.includes('140,00'))
    expect(total).toBeInTheDocument()
    expect(screen.getByText(/-5,6%/)).toBeInTheDocument()
  })

  it('abrir a linha lê os itens pela semana e pelo vendedor (não pelo vendedor_id como se fosse a cotação)', async () => {
    mc.historicoItens.mockResolvedValue([])
    render(<MemoryRouter><Historico /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /ATACADÃO/ }))
    expect(mc.historicoItens).toHaveBeenCalledWith(1, 1) // (semana_id, vendedor_id), não .eq('cotacao_id', vendedor_id)
  })
})
