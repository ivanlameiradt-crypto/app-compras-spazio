import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

// Mateus NF 000090049 (28/10/2026): os dois fardos "SIX PACK" (Coca 6 e Fanta 2) foram confirmados no app como COCA COLA 350 ML SEM a conversão (nota em UN e produto em UN:
// o SisChef não pede nada) e entraram no estoque como 6 e 2 latas, em vez de 36 e 12; a Fanta ainda foi para a Coca. O app agora exige o número do fardo e avisa do produto repetido.
vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '1'.repeat(44)
const COCA = 1836982
const FANTA = 2722189
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: COCA, nome: 'COCA COLA 350 ML', unidade: 'un' },
  { produto_id: FANTA, nome: 'FANTA LARANJA 350 ML', unidade: 'un' },
  { produto_id: 1836992, nome: 'COCA COLA 1L', unidade: 'un' },
]
const dec = (id: number, nome: string, conversao?: number | null) =>
  ({ produto_id: id, produto_nome: nome, unidade: 'un', origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-27T18:35:53Z', ...(conversao === undefined ? { conversao: null } : { conversao }) })
const mateus = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000090049', emissao: '2026-10-27', valor_nf: 1823.02,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: 'boleto',
  parcelas: [{ numero: '001', vencimento: '2026-11-18', valor: 1823.02 }],
  itens: [
    { n: 1, descricao: 'CÓD. FOR: 420713 REFRIG COCA COLA LT SIX PACK 350ML', qtd: 6, unidade_sischef: 'UN', produto_id: null },
    { n: 2, descricao: 'CÓD. FOR: 420718 ## COCA COLA 1L', qtd: 30, unidade_sischef: 'UN', produto_id: 1836992, produto_nome: 'COCA COLA 1L', associacao: 'sischef' },
    { n: 6, descricao: 'CÓD. FOR: 456548 REFRIG FANTA LAR SIX PACK 350ML', qtd: 2, unidade_sischef: 'UN', produto_id: null },
  ],
  associacoes_app: { '1': dec(COCA, 'COCA COLA 350 ML'), '6': dec(COCA, 'COCA COLA 350 ML') },
  ...extra,
})
// O item pelo trecho da descrição (o que FALTA confirmar vem na frente dos confirmados)
const itemDe = async (trecho: string) => {
  const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
  const li = itens.find((x) => x.textContent?.includes(trecho))
  if (!li) throw new Error(`item ${trecho} não achado entre ${itens.length} itens`)
  return within(li)
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.associarItem.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — fardo "SIX PACK": o número do fardo é pedido, já vem preenchido pelo nome e a decisão sem ele não vale (NF 90049, 28/10)', () => {
  it('decisão antiga SEM a conversão: o Lançar fica travado e o motivo diz o que falta, com o nome da nota', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    expect(await screen.findByRole('button', { name: 'Lançar' })).toBeDisabled()
    const motivo = await screen.findByTestId('lancar-travado')
    expect(motivo).toHaveTextContent('falta a conversão de unidade de algum item')
    expect(motivo).toHaveTextContent('o nome da nota diz SIX PACK: informe quantas unidades do produto tem 1 UN da nota (6; se o produto já é o fardo inteiro, digite 1)')
  })

  it('o cartão do item reabre com 6 já preenchido, o aviso do nome e o Confirmar grava 6', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const coca = await itemDe('COCA COLA LT SIX PACK')
    expect(await coca.findByTestId('produto-escolhido')).toHaveTextContent('COCA COLA 350 ML')
    expect(coca.getByLabelText('Quanto vale 1 UN na unidade do produto no SisChef?')).toHaveValue('6')
    expect(coca.getByTestId('conversao-fardo')).toHaveTextContent('O nome da nota diz SIX PACK: cada UN da nota é um fardo com 6 unidades, então deixei 6 aqui')
    expect(coca.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar:')
    await userEvent.click(coca.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, COCA, 6))
  })

  it('digitar 1 diz que o produto já é o fardo inteiro: vale e grava 1', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const coca = await itemDe('COCA COLA LT SIX PACK')
    const campo = await coca.findByLabelText('Quanto vale 1 UN na unidade do produto no SisChef?')
    await userEvent.clear(campo)
    await userEvent.type(campo, '1')
    await userEvent.click(coca.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, COCA, 1))
  })

  it('campo apagado: o Confirmar fica desabilitado (não existe "sem número" para fardo)', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const coca = await itemDe('COCA COLA LT SIX PACK')
    await userEvent.clear(await coca.findByLabelText('Quanto vale 1 UN na unidade do produto no SisChef?'))
    expect(coca.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('decisão COM a conversão 6: confirmada no app, sem pendência e sem o aviso de fardo', async () => {
    m.notasALancar.mockResolvedValue([mateus({ associacoes_app: { '1': dec(COCA, 'COCA COLA 350 ML', 6), '6': dec(FANTA, 'FANTA LARANJA 350 ML', 6) } })])
    render(<NotaSefaz />)
    const fanta = await itemDe('FANTA LAR SIX PACK')
    expect(await fanta.findByTestId('associacao-confirmada')).toHaveTextContent('1 UN = 6')
    expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversao-fardo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })

  it('item de nome comum (sem SIX PACK) em UN × UN continua como era: sem campo aberto e confirmado sem número', async () => {
    const comum = mateus({
      itens: [{ n: 4, descricao: 'CÓD. FOR: 515972 CHOC LACTA BIS ORIGINAL PACK 302,4G', qtd: 15, unidade_sischef: 'UN', produto_id: null }],
      associacoes_app: { '4': dec(COCA, 'COCA COLA 350 ML') },
    })
    m.notasALancar.mockResolvedValue([comum])
    render(<NotaSefaz />)
    const bis = await itemDe('CHOC LACTA BIS')
    expect(await bis.findByTestId('associacao-confirmada')).toBeInTheDocument()
    expect(bis.queryByTestId('conversao-fardo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — dois itens da nota no MESMO produto: aviso amarelo, nunca trava (a Fanta escolhida como Coca, NF 90049)', () => {
  it('os itens 1 e 6 na Coca 350 ML: o aviso nomeia os itens e o produto', async () => {
    m.notasALancar.mockResolvedValue([mateus()])
    render(<NotaSefaz />)
    const aviso = await screen.findByTestId('itens-no-mesmo-produto')
    expect(aviso).toHaveTextContent('Atenção: os itens 1 e 6 da nota estão no mesmo produto (COCA COLA 350 ML). Confira se não é engano.')
  })

  it('cada item no seu produto: nenhum aviso', async () => {
    m.notasALancar.mockResolvedValue([mateus({ associacoes_app: { '1': dec(COCA, 'COCA COLA 350 ML', 6), '6': dec(FANTA, 'FANTA LARANJA 350 ML', 6) } })])
    render(<NotaSefaz />)
    await screen.findByTestId('conferir')
    expect(screen.queryByTestId('itens-no-mesmo-produto')).not.toBeInTheDocument()
  })

  it('o aviso não trava o Lançar: com as duas conversões informadas, o botão fica liberado mesmo no mesmo produto', async () => {
    m.notasALancar.mockResolvedValue([mateus({ associacoes_app: { '1': dec(COCA, 'COCA COLA 350 ML', 6), '6': dec(COCA, 'COCA COLA 350 ML', 6) } })])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('itens-no-mesmo-produto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })
})
