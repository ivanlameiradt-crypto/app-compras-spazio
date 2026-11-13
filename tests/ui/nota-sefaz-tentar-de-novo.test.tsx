// A5 (reanálise de 13/11/2026): quando a primeira carga das notas falhava, a tela mostrava "Não consegui carregar as notas." e não tinha saída
// (só fechando e abrindo o app). Agora o aviso traz o botão "Tentar de novo", que refaz a carga.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const nota = (): NotaSefazLista => ({
  chave: '0'.repeat(44), emitente: 'ATACADAO S.A.', numero: '123', emissao: '2026-10-03', valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [{ descricao: 'TOMATE ITALIANO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196, associacao: 'sischef' }],
  parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }],
} as NotaSefazLista)

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([nota()])
  m.notasLancadas.mockResolvedValue([])
  m.notasDescartadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.catalogoProdutos.mockResolvedValue([])
  m.fantasiasDosFornecedores.mockResolvedValue({})
})

describe('NotaSefaz: a carga das notas falhou', () => {
  it('mostra o aviso com o botão "Tentar de novo"; o toque refaz a carga e a lista aparece', async () => {
    m.notasALancar.mockRejectedValueOnce(new Error('sem rede'))
    render(<NotaSefaz />)
    expect(await screen.findByText(/Não consegui carregar as notas\./)).toBeInTheDocument()
    expect(screen.queryByTestId('nota-a-lancar')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(m.notasALancar).toHaveBeenCalledTimes(2)
    expect(await screen.findByTestId('nota-a-lancar')).toBeInTheDocument()
    expect(screen.queryByText(/Não consegui carregar as notas\./)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })

  it('a nova tentativa também falha: o aviso e o botão continuam; enquanto tenta, o botão fica travado', async () => {
    let falhar!: (e: Error) => void
    m.notasALancar.mockRejectedValueOnce(new Error('sem rede')).mockReturnValueOnce(new Promise((_ok, ko) => { falhar = ko }))
    render(<NotaSefaz />)
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' })
    await userEvent.click(botao)
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(m.notasALancar).toHaveBeenCalledTimes(2) // o toque repetido no meio não dispara outra carga
    falhar(new Error('sem rede'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled())
    expect(screen.getByText(/Não consegui carregar as notas\./)).toBeInTheDocument()
  })
})
