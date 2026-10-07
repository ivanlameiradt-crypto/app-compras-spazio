import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const MAUES = '37638932000174'
const item = (extra: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  ({ descricao: 'CÓD. FOR: 1 MASSA', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196, associacao: 'sischef', ...extra })
const maues = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: MAUES, emitente: 'MAUES FOOD BRASIL INDUSTRIA DE ALIMENTOS LTDA', numero: '000055100', emissao: '2026-10-07',
  valor_nf: 791.2, situacao: 'na_fila', lancada_em: null, nf_sischef: null, itens: [item()],
  parcelas: [{ numero: '001', vencimento: '2026-10-08', valor: 791.2 }], ...extra,
})
const aLancar = (...n: NotaSefazLista[]) => m.notasALancar.mockResolvedValue(n)
const comoPagar = () => screen.getByLabelText('Como pagar') as HTMLSelectElement
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })
const bloco = () => screen.getByTestId('pagamento-semanal')
const dataEditavel = (n = 1) => screen.getByLabelText(`Vencimento da parcela ${n}`) as HTMLInputElement

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.descartarNota.mockResolvedValue(undefined)
  m.restaurarNota.mockResolvedValue(undefined)
  m.catalogoProdutos.mockResolvedValue([])
  m.associarItem.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — MAUES: a quarta de pagamento aparece na tela e a data pode ser editada (pedido do Ivan, 07/10)', () => {
  it('abre já com a quarta da regra (14/10), a semana da compra e o aviso de que o XML trouxe outra data', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(bloco()).toHaveTextContent('Parcela 1 · vence quarta, 14/10/2026')
    expect(bloco()).toHaveTextContent(/R\$\s791,20/)
    expect(bloco()).toHaveTextContent('semana de 04/10 a 10/10')
    expect(bloco()).toHaveTextContent('O XML trouxe 08/10/2026; vale a quarta')
    expect(screen.queryByLabelText('Vencimento da parcela 1')).not.toBeInTheDocument() // a caixa de data só abre em "Mudar a data"
    expect(screen.getByRole('button', { name: 'Mudar a data' })).toBeInTheDocument()
  })

  it('o painel de conferir também mostra a quarta como vencimento (e não a data do XML como se fosse a que vale)', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    const parcela = within(screen.getByTestId('conferir')).getByTestId('conferir-parcela')
    expect(parcela).toHaveTextContent('vence 14/10/2026')
    expect(parcela).toHaveTextContent('o XML trouxe 08/10/2026')
  })

  it('Lançar → Confirmar manda a quarta de forma explícita (o que a tela mostrou é o que vale)', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('parcelas-confirmar')).toHaveTextContent('Parcela 1 · vence 14/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-10-14', valor: 791.2 }]))
  })

  it('"Mudar a data" abre a caixa já com a quarta; a data editada aparece, vai na confirmação e é a que o robô recebe', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByRole('button', { name: 'Mudar a data' }))
    expect(dataEditavel().value).toBe('2026-10-14')
    fireEvent.change(dataEditavel(), { target: { value: '2026-10-16' } })
    expect(bloco()).toHaveTextContent('Parcela 1 · vence 16/10/2026')
    expect(bloco()).toHaveTextContent('data alterada por você')
    expect(bloco()).toHaveTextContent('A quarta da regra é 14/10/2026')
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('parcelas-confirmar')).toHaveTextContent('Parcela 1 · vence 16/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-10-16', valor: 791.2 }]))
  })

  it('"Usar a quarta" desfaz a edição', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByRole('button', { name: 'Mudar a data' }))
    fireEvent.change(dataEditavel(), { target: { value: '2026-10-21' } })
    expect(bloco()).toHaveTextContent('vence 21/10/2026')
    await userEvent.click(screen.getByRole('button', { name: /Usar a quarta/ }))
    expect(bloco()).toHaveTextContent('Parcela 1 · vence quarta, 14/10/2026')
    expect(bloco()).not.toHaveTextContent('data alterada por você')
  })

  it('data apagada volta para a quarta; data anterior à emissão apaga o Lançar e diz por quê', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByRole('button', { name: 'Mudar a data' }))
    fireEvent.change(dataEditavel(), { target: { value: '' } })
    expect(bloco()).toHaveTextContent('vence quarta, 14/10/2026')
    expect(botaoLancar()).toBeEnabled()
    fireEvent.change(dataEditavel(), { target: { value: '2026-10-06' } })
    expect(botaoLancar()).toBeDisabled()
    expect(bloco()).toHaveTextContent('Parcela 1: o vencimento é anterior à emissão da nota')
  })

  it('com 2 boletos no XML: cada data é editada sozinha e os valores seguem os do XML', async () => {
    aLancar(maues({ valor_nf: 100, parcelas: [{ numero: '1', vencimento: '2026-10-08', valor: 60 }, { numero: '2', vencimento: '2026-10-15', valor: 40 }] }))
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(bloco()).toHaveTextContent('Parcela 1 · vence quarta, 14/10/2026')
    expect(bloco()).toHaveTextContent('Parcela 2 · vence quarta, 14/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Mudar a data' }))
    fireEvent.change(dataEditavel(2), { target: { value: '2026-10-21' } })
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-10-14', valor: 60 }, { vencimento: '2026-10-21', valor: 40 }]))
  })

  it('outro fornecedor com boleto no XML: nada disso aparece e o Lançar vai sem parcelas, como sempre', async () => {
    aLancar(maues({ cnpj_emitente: '12345678000190', emitente: 'OUTRO LTDA' }))
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.queryByTestId('pagamento-semanal')).not.toBeInTheDocument()
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
  })

  it('MAUES com outra forma de pagamento (PIX): o bloco da quarta some e o Lançar vai sem parcelas', async () => {
    aLancar(maues())
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByRole('button', { name: 'mudar forma de pagamento' }))
    await userEvent.selectOptions(comoPagar(), 'pix:pangbank|ij')
    expect(screen.queryByTestId('pagamento-semanal')).not.toBeInTheDocument()
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'pix:pangbank|ij'))
  })

  it('MAUES com o XML ainda por ler: sem bloco da quarta (vale o editor de parcelas de sempre)', async () => {
    aLancar(maues({ parcelas: null }))
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.queryByTestId('pagamento-semanal')).not.toBeInTheDocument()
    expect(screen.getByTestId('editor-parcelas')).toBeInTheDocument()
  })
})
