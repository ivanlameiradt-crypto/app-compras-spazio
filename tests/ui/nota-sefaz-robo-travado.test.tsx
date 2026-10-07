import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const minutosAtras = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const lancando = (min: number, extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, emitente: 'MERCURIO ALIMENTOS S/A', numero: '002270833', emissao: '2026-10-07', valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [{ descricao: 'LAGARTO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196, associacao: 'sischef' }],
  parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }],
  lancamento_estado: 'lancando', lancamento_estado_em: minutosAtras(min), ...extra,
})
const botaoVerificar = () => screen.getByRole('button', { name: 'Verificar o robô' })

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — nota "lançando" cujo robô pode ter caído (07/10: a execução da MERCURIO travou e a nota ficou apagada por 30 min)', () => {
  it('nota lançando há pouco: mostra "Verificar o robô" e NÃO pergunta sozinha ao servidor', async () => {
    m.notasALancar.mockResolvedValue([lancando(1)])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(botaoVerificar()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
    expect(m.verificarRobo).not.toHaveBeenCalled()
  })

  it('nota que não está lançando: sem o botão', async () => {
    m.notasALancar.mockResolvedValue([lancando(1, { lancamento_estado: null })])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.queryByRole('button', { name: 'Verificar o robô' })).not.toBeInTheDocument()
  })

  it('o botão pergunta ao servidor pela nota certa e mostra a resposta (robô ainda rodando: nada muda e a lista não recarrega)', async () => {
    m.notasALancar.mockResolvedValue([lancando(1)])
    m.verificarRobo.mockResolvedValue({ situacao: 'rodando', mensagem: 'O robô ainda está trabalhando nesta nota. Aguarde.', mudou: false })
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const chamadasAntes = m.notasALancar.mock.calls.length
    await userEvent.click(botaoVerificar())
    expect(m.verificarRobo).toHaveBeenCalledWith(CHAVE)
    expect(await screen.findByTestId('verificacao-msg')).toHaveTextContent('O robô ainda está trabalhando nesta nota. Aguarde.')
    expect(m.notasALancar.mock.calls.length).toBe(chamadasAntes)
  })

  it('o robô caiu antes de lançar: a tela recarrega, mostra a explicação e o Lançar volta', async () => {
    const motivo = 'O robô não chegou a começar: a execução no GitHub foi cancelada antes de tocar no SisChef (por exemplo, travou ao preparar o navegador). Nada foi criado no SisChef; pode lançar de novo.'
    m.notasALancar
      .mockResolvedValueOnce([lancando(8)])
      .mockResolvedValue([lancando(8, { lancamento_estado: 'revisar', lancamento_motivo: motivo })])
    m.verificarRobo.mockResolvedValue({ situacao: 'liberada', mensagem: motivo, mudou: true })
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(botaoVerificar())
    const status = await screen.findByTestId('status-nota')
    expect(status).toHaveTextContent('Precisa de você: O robô não chegou a começar')
    expect(status).toHaveTextContent('Nada foi criado no SisChef; pode lançar de novo.')
    expect(screen.queryByRole('button', { name: 'Verificar o robô' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })

  it('o robô caiu no meio: a nota vira "pela metade" e o Lançar continua apagado', async () => {
    const motivo = 'A execução do robô foi cancelada depois de começar a lançar, sem avisar o resultado: a nota pode ter ficado pela metade. Confira no SisChef antes de qualquer coisa. Não lance de novo.'
    m.notasALancar
      .mockResolvedValueOnce([lancando(8)])
      .mockResolvedValue([lancando(8, { lancamento_estado: 'erro', lancamento_motivo: motivo })])
    m.verificarRobo.mockResolvedValue({ situacao: 'pela_metade', mensagem: motivo, mudou: true })
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(botaoVerificar())
    expect(await screen.findByTestId('status-nota')).toHaveTextContent('Ficou pela metade')
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
  })

  it('lançando há 5 min ou mais: a tela pergunta sozinha, uma vez, ao abrir', async () => {
    m.notasALancar.mockResolvedValue([lancando(6)])
    m.verificarRobo.mockResolvedValue({ situacao: 'sem_execucao', mensagem: 'Não achei a execução desta nota no GitHub (disparada há 6 min).', mudou: false })
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await waitFor(() => expect(m.verificarRobo).toHaveBeenCalledTimes(1))
    expect(m.verificarRobo).toHaveBeenCalledWith(CHAVE)
    expect(await screen.findByTestId('verificacao-msg')).toHaveTextContent('Não achei a execução desta nota no GitHub')
  })

  it('servidor fora do ar ao tocar no botão: mostra o erro em português e deixa tentar de novo', async () => {
    m.notasALancar.mockResolvedValue([lancando(1)])
    m.verificarRobo.mockRejectedValueOnce(new Error('Não consegui consultar o GitHub agora — tente de novo em instantes.'))
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(botaoVerificar())
    expect(await screen.findByTestId('verificacao-msg')).toHaveTextContent('Não consegui consultar o GitHub agora')
    expect(botaoVerificar()).toBeEnabled()
  })
})
