import { render, screen, waitFor } from '@testing-library/react'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, emitente: 'MERCURIO ALIMENTOS S/A', numero: '002270833', emissao: '2026-10-07', valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [{ descricao: 'LAGARTO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196, associacao: 'sischef' }],
  parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }], ...extra,
})
const visibilidade = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([nota()])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
})
afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); vi.restoreAllMocks() })

describe('NotaSefaz — relê as notas sozinha ao voltar para o app (pedido do Ivan, 07/10: não precisar sair e entrar)', () => {
  it('voltar para o app depois de um tempo: relê a lista e mostra o que mudou no banco', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(m.notasALancar).toHaveBeenCalledTimes(1)
    // o banco mudou enquanto o app ficava aberto: chegou uma 2ª nota (leitura das 12h40, por exemplo)
    m.notasALancar.mockResolvedValue([nota(), nota({ chave: '1'.repeat(44), emitente: 'SEARA ALIMENTOS LTDA', numero: '000187105' })])
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000)
    visibilidade('hidden')
    visibilidade('visible')
    await waitFor(() => expect(m.notasALancar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByTestId('nota-a-lancar')).toHaveLength(2))
  })

  it('não relê várias vezes seguidas: dois "voltou" em menos de 15 s releem uma vez só', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000)
    visibilidade('visible')
    visibilidade('visible')
    await waitFor(() => expect(m.notasALancar).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(m.notasALancar).toHaveBeenCalledTimes(2)
  })

  it('logo depois de abrir (menos de 15 s) um "voltou" não relê de novo', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    visibilidade('visible')
    await new Promise((r) => setTimeout(r, 50))
    expect(m.notasALancar).toHaveBeenCalledTimes(1)
  })

  it('app escondido (ficou no fundo): não relê', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000)
    visibilidade('hidden')
    await new Promise((r) => setTimeout(r, 50))
    expect(m.notasALancar).toHaveBeenCalledTimes(1)
  })

  it('falha passageira na releitura (rede oscilou) não esconde a lista que já está na tela', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    m.notasALancar.mockRejectedValue(new Error('rede'))
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000)
    visibilidade('visible')
    await waitFor(() => expect(m.notasALancar).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
  })

  it('ao sair da tela os ouvintes são removidos (não relê depois de desmontar)', async () => {
    const r = render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    r.unmount()
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000)
    visibilidade('visible')
    await new Promise((res) => setTimeout(res, 50))
    expect(m.notasALancar).toHaveBeenCalledTimes(1)
  })
})
