import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const nota = (extra: Partial<NotaSefazLista>): NotaSefazLista => ({
  chave: '0'.repeat(44), emitente: 'ATACADAO S.A.', numero: '123', emissao: '2026-10-03',
  valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null, itens: [], ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
})

describe('NotaSefaz', () => {
  it('mostra o título e o modo "eu disparo"', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByRole('heading', { name: 'Lançamento de nota SEFAZ' })).toBeInTheDocument()
    expect(screen.getByText(/eu disparo/)).toBeInTheDocument()
  })

  it('sem notas: avisa que não há pendentes nem lançadas', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByText('Nenhuma nota pendente da SEFAZ agora.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma nota lançada ainda.')).toBeInTheDocument()
  })

  it('lista as notas a lançar (emitente, NF, valor)', async () => {
    m.notasALancar.mockResolvedValue([nota({ chave: '1'.repeat(44), emitente: 'MATEUS', numero: '555', valor_nf: 1291.3 })])
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    expect(linha).toHaveTextContent('MATEUS')
    expect(linha).toHaveTextContent('NF 555')
    expect(linha).toHaveTextContent(/R\$\s1\.291,30/)
  })

  it('clica numa nota lançada e abre o detalhe (NF no SisChef + itens)', async () => {
    m.notasLancadas.mockResolvedValue([nota({
      chave: '2'.repeat(44), emitente: 'ATACADAO', numero: '777', situacao: 'lancada',
      lancada_em: '2026-10-05T12:00:00Z', nf_sischef: '63980',
      itens: [{ descricao: 'TOMATE ITALIANO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196 }],
    })])
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-lancada')
    expect(screen.queryByText(/63980/)).not.toBeInTheDocument() // fechado
    await userEvent.click(within(linha).getByRole('button'))
    expect(await screen.findByText(/NF no SisChef/)).toBeInTheDocument()
    expect(screen.getByText(/63980/)).toBeInTheDocument()
    expect(screen.getByText('TOMATE ITALIANO')).toBeInTheDocument()
  })
})
