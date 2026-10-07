import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
/** MATEUS 000089284 (R$ 1.794,49): tudo decidido, XML sem boletos — só falta o que o Ivan define no financeiro. */
const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089284', emissao: '2026-10-06', valor_nf: 1794.49,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 1 AGUA SEM GAS 500ML', qtd: 60, unidade_sischef: 'UN', produto_id: 1836986, associacao: 'sischef' }],
  ...extra,
})
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })
const resumo = () => screen.getByTestId('resumo-parcelas')
const adicionar = () => userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
const data = (i: number, d: string) => fireEvent.change(screen.getByLabelText(`Vencimento da parcela ${i}`), { target: { value: d } })
const valor = async (i: number, v: string) => { const c = screen.getByLabelText(`Valor da parcela ${i}`); await userEvent.clear(c); if (v) await userEvent.type(c, v) }

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([mateus()])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  try { localStorage.clear() } catch { /* sem armazenamento */ }
})
afterEach(() => { vi.restoreAllMocks() })

describe('NotaSefaz — financeiro definido pelo Ivan: o que ele digita é o que vale; nada vem preenchido (MATEUS 000089284, 07/10)', () => {
  it('o editor abre ZERADO: uma linha sem data e sem valor (nada é preenchido sozinho)', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    expect(screen.getAllByTestId('linha-parcela')).toHaveLength(1)
    expect(screen.getByLabelText('Vencimento da parcela 1')).toHaveValue('')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('')
    expect(botaoLancar()).toBeDisabled()
  })

  it('o caso da tela: parcela 1 com o valor todo e as linhas 2 e 3 só com data — trava, em VERMELHO, dizendo qual linha falta o valor', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06'); data(3, '2026-11-16')
    await valor(1, '1.794,49')
    expect(botaoLancar()).toBeDisabled()
    expect(resumo()).toHaveClass('erro')
    expect(resumo()).toHaveTextContent('Parcela 2: informe o valor')
  })

  it('apagando as linhas 2 e 3 (ou deixando-as totalmente em branco) o Lançar acende com 1 boleto de 1.794,49', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()          // duas linhas abertas e em BRANCO: não contam
    data(1, '2026-10-27')
    await valor(1, '1.794,49')
    expect(resumo()).toHaveTextContent('bate')
    expect(resumo()).toHaveClass('ok')
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('parcelas-confirmar')).toHaveTextContent('Parcela 1 · vence 27/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-10-27', valor: 1794.49 }]))
  })

  it('3 boletos de valores DIFERENTES que somam o valor da nota: o Lançar acende sozinho e manda exatamente o que ele digitou', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06'); data(3, '2026-11-16')
    await valor(1, '1.000,00'); await valor(2, '500,00')
    expect(botaoLancar()).toBeDisabled()
    await valor(3, '294,49')
    expect(resumo()).toHaveTextContent('bate')
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [
      { vencimento: '2026-10-27', valor: 1000 }, { vencimento: '2026-11-06', valor: 500 }, { vencimento: '2026-11-16', valor: 294.49 },
    ]))
  })

  it('soma que não fecha: vermelho e o Lançar apagado (o valor total da nota é o que prevalece)', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06')
    await valor(1, '1.000,00'); await valor(2, '700,00')
    expect(botaoLancar()).toBeDisabled()
    expect(resumo()).toHaveClass('erro')
    expect(resumo()).toHaveTextContent('Faltam 94,49 para fechar com o valor da nota')
  })

  it('"Dividir em parcelas iguais" só age quando ele toca, e ignora a linha em branco (não cria valor sem data)', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06')          // a linha 3 fica em branco
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('')   // nada foi preenchido sozinho
    await userEvent.click(screen.getByRole('button', { name: 'Dividir em parcelas iguais' }))
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('897,24')
    expect(screen.getByLabelText('Valor da parcela 2')).toHaveValue('897,25')
    expect(screen.getByLabelText('Valor da parcela 3')).toHaveValue('')   // em branco continua em branco
    expect(botaoLancar()).toBeEnabled()
  })

  it('"Preencher o que falta na última" usa a última linha EM USO, não uma linha em branco depois dela', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06')
    await valor(1, '1.000,00'); await valor(2, '500,00')                  // a linha 3 em branco
    await userEvent.click(screen.getByRole('button', { name: 'Preencher o que falta na última' }))
    expect(screen.getByLabelText('Valor da parcela 2')).toHaveValue('794,49')
    expect(screen.getByLabelText('Valor da parcela 3')).toHaveValue('')
    expect(botaoLancar()).toBeEnabled()
  })

  it('"Limpar parcelas" recomeça com uma linha só, sem data e sem valor', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('editor-parcelas')
    await adicionar(); await adicionar()
    data(1, '2026-10-27'); data(2, '2026-11-06'); data(3, '2026-11-16')
    await valor(1, '1.794,49')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar parcelas' }))
    expect(screen.getAllByTestId('linha-parcela')).toHaveLength(1)
    expect(screen.getByLabelText('Vencimento da parcela 1')).toHaveValue('')
    expect(screen.getByLabelText('Valor da parcela 1')).toHaveValue('')
    expect(botaoLancar()).toBeDisabled()
  })
})
