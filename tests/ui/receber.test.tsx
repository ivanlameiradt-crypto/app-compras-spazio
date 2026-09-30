import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Recebimento from '../../src/recebimento/Recebimento'
import type { PedidoAReceber, Usuario } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const JOAO: Usuario = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true }
const pedido = (): PedidoAReceber => ({
  cotacao_id: 7, vendedor: 'MATEUS', confirmado_em: '2026-10-21T13:00:00Z', confirmado_local: '2026-10-21 10:15',
  entrega_prevista: '2026-10-22', recebimento: 'aguardando', entregas: [],
  itens: [
    { numero: 2, nome: 'COCA COLA 350 ML', unidade: 'un', qtd: 108, embalagens: 9, fator: 12, embalagem: 'fardo', marca: 'Marca X', chegou: 0, avaria: 0, resto: null },
    { numero: 3, nome: 'QUEIJO', unidade: 'kg', qtd: 20, embalagens: null, fator: null, embalagem: 'embalagem', marca: null, chegou: 0, avaria: 0, resto: null },
  ],
})

beforeEach(() => {
  m.pedidosAReceber.mockResolvedValue([pedido()])
  m.registrarRecebimento.mockResolvedValue({ recebimento_id: 1, recebimento: 'completo', faltas: [], avarias: [] })
})

it('lista os pedidos e "Chegou tudo certo" grava tudo o que falta em um toque, sem preço', async () => {
  render(<Recebimento usuario={JOAO} />)
  const abrir = await screen.findByRole('button', { name: /MATEUS/ })
  expect(screen.getByText(/entrega prevista qui 22\/10/)).toBeTruthy()
  await userEvent.click(abrir)
  const botao = await screen.findByRole('button', { name: 'Chegou tudo certo' })
  // nenhum "R$" na tela
  expect(document.body.textContent).not.toContain('R$')
  // a marca combinada aparece (conferir na porta)
  expect(screen.getByText(/marca: Marca X/)).toBeTruthy()
  await userEvent.click(botao)
  await waitFor(() => expect(m.registrarRecebimento).toHaveBeenCalled())
  const args = m.registrarRecebimento.mock.calls[0]
  expect(args[0]).toBe(7)
  expect(args[3]).toEqual([{ numero: 2, chegou: 108 }, { numero: 3, chegou: 20 }])
  expect(args[4]).toBeNull()
})

it('mudar o campo Chegou faz o botão virar "Registrar com as diferenças"', async () => {
  render(<Recebimento usuario={JOAO} />)
  await userEvent.click(await screen.findByRole('button', { name: /MATEUS/ }))
  await screen.findByRole('button', { name: 'Chegou tudo certo' })
  const campos = screen.getAllByRole('textbox')
  await userEvent.clear(campos[0])
  await userEvent.type(campos[0], '7')          // 7 fardos = 84 un (< 108)
  expect(await screen.findByRole('button', { name: 'Registrar com as diferenças' })).toBeTruthy()
})
