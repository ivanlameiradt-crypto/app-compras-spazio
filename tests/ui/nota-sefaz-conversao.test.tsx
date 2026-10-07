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
  // Desde 07/10 (pedido do Ivan) o item com decisão sem a conversão já abre no cartão "Produto que eu indiquei" + Confirmar: sem Trocar, sem procurar de novo.
  async function informarConversao(valor: string) {
    await userEvent.type(await screen.findByLabelText('Quanto vale 1 CX em KG?'), valor)
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

// Cartão do item (07/10, pedido do Ivan): "Na nota" em cima, "Produto que eu indiquei no SisChef", a conversão no mesmo cartão (já preenchida com o peso do nome
// da nota quando dá) e UM botão Confirmar — sem "Trocar" para confirmar o que já está certo.
describe('NotaSefaz — cartão do item: conferir o produto indicado e confirmar com um botão (MATEUS 000089284, 07/10)', () => {
  const LEITE = 3469626
  const BIS = 3476455
  const OLEO = 3138573
  const CAT: ProdutoCatalogo[] = [
    { produto_id: LEITE, nome: 'LEITE CONDENSADO - INSUMOS (KG)', nome_sischef: 'LEITE CONDESSADO - INSUMOS (KG)', unidade: 'kg', palavras: 'leite condensado leite cond' },
    { produto_id: OLEO, nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' },
  ]
  const dec = (id: number, nome: string, unidade: string | null, conversao?: number) =>
    ({ produto_id: id, produto_nome: nome, unidade, origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-06T23:46:26Z', ...(conversao === undefined ? {} : { conversao }) })
  const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
    chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089284', emissao: '2026-10-06', valor_nf: 1794.49,
    situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
    itens: [
      { n: 2, descricao: 'CÓD. FOR: 515972 CHOC LACTA BIS ORIGINAL PACK 302,4G', qtd: 15, unidade_sischef: 'UN', produto_id: null },
      { n: 5, descricao: 'CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', qtd: 27, unidade_sischef: 'UN', produto_id: null },
      { n: 7, descricao: 'CÓD. FOR: 454513 OLEO SOJA VITALIV PET 900ML', qtd: 60, unidade_sischef: 'UN', produto_id: null },
    ],
    associacoes_app: {
      '2': dec(BIS, 'CHOCOLATE BIS ORIGINAL - INSUMOS', null, 1),
      '5': dec(LEITE, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg'),
      '7': dec(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un'),
    },
    ...extra,
  })
  const itemDe = async (n: number) => {
    const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
    return within(itens[n])
  }
  beforeEach(() => { m.catalogoProdutos.mockResolvedValue(CAT); m.associarItem.mockResolvedValue(undefined) })

  it('leite condensado (decisão sem a conversão): cartão com o produto indicado, 0,395 sugerido pelo nome (395G) e um Confirmar — sem Trocar nem busca', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const leite = await itemDe(1)
    const cartao = await leite.findByTestId('produto-escolhido')
    expect(cartao).toHaveTextContent('Produto que eu indiquei no SisChef')
    expect(cartao).toHaveTextContent('LEITE CONDENSADO - INSUMOS (KG)')
    expect(leite.queryByTestId('item-confirmado')).not.toBeInTheDocument()                 // ainda não vale: sem ✓ "confirmado"
    expect(leite.queryByRole('button', { name: 'Trocar' })).not.toBeInTheDocument()
    expect(leite.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
    expect(leite.getByLabelText('Quanto vale 1 UN em KG?')).toHaveValue('0,395')
    expect(leite.getByTestId('conversao-sugerida')).toHaveTextContent('Sugestão tirada do nome da nota (395G = 0,395)')
    expect(leite.getByRole('button', { name: /Escolher outro/ })).toBeInTheDocument()
    await userEvent.click(leite.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 5, LEITE, 0.395))
  })

  it('o Ivan pode corrigir o número sugerido antes de confirmar (a sugestão é só um palpite do nome)', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const leite = await itemDe(1)
    const campoConv = await leite.findByLabelText('Quanto vale 1 UN em KG?')
    await userEvent.clear(campoConv)
    await userEvent.type(campoConv, '0,4')
    expect(leite.queryByTestId('conversao-sugerida')).not.toBeInTheDocument()
    await userEvent.click(leite.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 5, LEITE, 0.4))
  })

  it('campo da conversão apagado (obrigatória): o Confirmar apaga e o Lançar segue travado', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const leite = await itemDe(1)
    await userEvent.clear(await leite.findByLabelText('Quanto vale 1 UN em KG?'))
    expect(leite.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
  })

  it('a lista de produtos ainda carregando: nenhum cartão (nem o palpite cru do robô) — só depois que a lista chega', async () => {
    let liberar!: (c: ProdutoCatalogo[]) => void
    m.catalogoProdutos.mockReturnValue(new Promise<ProdutoCatalogo[]>((r) => { liberar = r }))
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.queryByTestId('produto-escolhido')).not.toBeInTheDocument()
    liberar(CAT)
    expect(await screen.findAllByTestId('produto-escolhido')).not.toHaveLength(0)
  })

  it('Trocar (decisão completa) reabre o cartão do MESMO produto, com a conversão gravada para editar: o "1" do BIS (unidades iguais) sai apagando o campo', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const bis = await itemDe(0)
    expect(await bis.findByTestId('associacao-confirmada')).toHaveTextContent('confirmado no app · cód. 3476455 · 1 UN = 1 na unidade do produto no SisChef')
    await userEvent.click(bis.getByRole('button', { name: 'Trocar' }))
    expect(await bis.findByTestId('produto-escolhido')).toHaveTextContent('CHOCOLATE BIS ORIGINAL - INSUMOS')
    const campoConv = bis.getByLabelText('Quanto vale 1 UN na unidade do produto no SisChef? (opcional)')
    expect(campoConv).toHaveValue('1')
    await userEvent.clear(campoConv)
    await userEvent.click(bis.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 2, BIS, null))
  })

  it('Trocar → Cancelar volta para "confirmado no app" sem gravar nada', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const bis = await itemDe(0)
    await userEvent.click(await bis.findByRole('button', { name: 'Trocar' }))
    await userEvent.click(await bis.findByRole('button', { name: 'Cancelar' }))
    expect(await bis.findByTestId('associacao-confirmada')).toBeInTheDocument()
    expect(m.associarItem).not.toHaveBeenCalled()
  })

  it('óleo (decisão completa, UN × UN): "confirmado no app" e Trocar; o Trocar abre o cartão do mesmo produto', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const oleo = await itemDe(2)
    expect(await oleo.findByTestId('associacao-confirmada')).toHaveTextContent('confirmado no app · cód. 3138573')
    await userEvent.click(oleo.getByRole('button', { name: 'Trocar' }))
    expect(await oleo.findByTestId('produto-escolhido')).toHaveTextContent('ÓLEO DE SOJA - INSUMOS (UN)')
  })

  it('item sem decisão, mas com produto indicado pelas palavras-chave (óleo): cartão com Confirmar e "Sem conversão"; "Escolher outro" abre a busca', async () => {
    m.notasALancar.mockResolvedValue([mateus({ associacoes_app: null })])
    render(<NotaSefaz />)
    const oleo = await itemDe(2)
    const cartao = await oleo.findByTestId('produto-escolhido')
    expect(cartao).toHaveTextContent('Produto que eu indiquei no SisChef')
    expect(cartao).toHaveTextContent('ÓLEO DE SOJA - INSUMOS (UN)')
    expect(oleo.getByTestId('sem-conversao')).toHaveTextContent('Sem conversão: a nota e o produto estão na mesma unidade (UN).')
    await userEvent.click(oleo.getByRole('button', { name: /Escolher outro/ }))
    expect(await oleo.findByLabelText('Produto do SisChef')).toBeInTheDocument()
  })

  it('confirma o leite: o ✓ aparece com "1 UN = 0,395 KG" e o aviso amarelo some', async () => {
    const completa = mateus({ associacoes_app: {
      '2': dec(BIS, 'CHOCOLATE BIS ORIGINAL - INSUMOS', null), '5': dec(LEITE, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395), '7': dec(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un'),
    } })
    m.notasALancar.mockResolvedValue([mateus()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([completa]) })
    render(<NotaSefaz />)
    const leite = await itemDe(1)
    await userEvent.click(await leite.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument())
    const leite2 = await itemDe(1)
    expect(await leite2.findByTestId('item-confirmado')).toBeInTheDocument()
    expect(await leite2.findByTestId('associacao-confirmada')).toHaveTextContent('1 UN = 0,395 KG')
  })
})
