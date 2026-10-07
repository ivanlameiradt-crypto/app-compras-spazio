import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const NUGGETS = 3469754
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: NUGGETS, nome: 'NUGGETS SUPREME - INSUMOS (KG)', nome_sischef: 'NUGGSTES SUPREME - INSUMOS (KG)', unidade: 'kg' },
]
const decisao = (conversao?: number) => ({
  produto_id: NUGGETS, produto_nome: 'NUGGSTES SUPREME - INSUMOS (KG)', unidade: 'kg', origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-07T10:51:34Z',
  ...(conversao === undefined ? {} : { conversao }),
})
/** A SEARA 000187105 de 07/10: nota em CX, produto confirmado no app em KG, sem a conversão ainda. */
const seara = (conversao?: number): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '02914460000150', emitente: 'SEARA ALIMENTOS LTDA', numero: '000187105', emissao: '2026-10-05', valor_nf: 223.3,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  parcelas: [{ numero: '001', vencimento: '2026-10-26', valor: 111.65 }, { numero: '002', vencimento: '2026-11-02', valor: 111.65 }],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 031647 CHICKEN SUPREME FS 2,5KG', qtd: 2, unidade_sischef: 'CX', produto_id: null }],
  associacoes_app: { '1': decisao(conversao) },
})
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — SEARA: informar a conversão (1 CX = X kg) libera o Lançar na mesma tela, sem sair do app (07/10)', () => {
  async function informarConversao(valor: string) {
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar' }))
    await userEvent.type(await screen.findByLabelText('Produto do SisChef'), 'nuggets')
    await userEvent.click(within(await screen.findByTestId('achados')).getByRole('button', { name: /NUGGETS SUPREME/ }))
    await userEvent.type(screen.getByLabelText('Quanto vale 1 CX em KG?'), valor)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  }

  it('antes: sem a conversão o Lançar fica apagado e o aviso diz o que falta', async () => {
    m.notasALancar.mockResolvedValue([seara()])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(botaoLancar()).toBeDisabled()
    expect(await screen.findByTestId('lancar-travado')).toHaveTextContent('informe quanto vale 1 CX em KG')
  })

  it('digita 5, confirma: guarda a conversão e, na mesma tela, o aviso some e o Lançar acende', async () => {
    m.notasALancar.mockResolvedValue([seara()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([seara(5)]) })
    render(<NotaSefaz />)
    await informarConversao('5')
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, NUGGETS, 5))
    await waitFor(() => expect(botaoLancar()).toBeEnabled())
    expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
    expect(within(await screen.findByTestId('conferir')).getByTestId('conferir-item')).toHaveTextContent('1 CX = 5 KG')
  })

  it('a releitura da lista falha logo depois de gravar (rede oscilou): a tela NÃO pode ficar velha — usa o que acabou de gravar', async () => {
    m.notasALancar.mockResolvedValue([seara()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockRejectedValue(new Error('rede')) })
    render(<NotaSefaz />)
    await informarConversao('5')
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, NUGGETS, 5))
    await waitFor(() => expect(botaoLancar()).toBeEnabled())
    expect(within(await screen.findByTestId('conferir')).getByTestId('conferir-item')).toHaveTextContent('1 CX = 5 KG')
  })
})
