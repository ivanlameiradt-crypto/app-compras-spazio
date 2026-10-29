// Preço fora do normal na NOTA FISCAL, a TELA (pedido do Ivan, 29/10/2026). Caso real parecido: o KETCHUP SACHE 168UN da Mateus — a nota traz 10 UN a R$ 28,60 (cada UN é uma CAIXA de 168 sachês) e o sachê
// sempre custou R$ 0,17. Sem a conversão, o SisChef gravaria R$ 28,60 por sachê. A tela avisa (amarelo, no título, no item e perto do Lançar), NUNCA trava, e o aviso some sozinho quando o Ivan informa 168.
// Tudo INVENTADO (repositório público).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { ItemNotaSefaz, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '3'.repeat(44)
const KETCHUP = 3469734
const OLEO = 3469755
const ROTULO_UN = 'Quanto vale 1 unidade da nota em UN?'
const ULTIMAS = [{ preco: 0.17, data: '2026-10-23', unidade: 'un' }, { preco: 0.17, data: '2026-10-03', unidade: 'un' }]
const catalogo = (compras: ProdutoCatalogo['compras'] = ULTIMAS): ProdutoCatalogo[] => [
  { produto_id: KETCHUP, nome: 'KETCHUP SACHE 168UN - INSUMOS', unidade: 'un', compras },
  { produto_id: OLEO, nome: 'ÓLEO DE ALGODÃO - INSUMOS', unidade: 'un', compras: [{ preco: 9, data: '2026-10-20', unidade: 'un' }] },
]
/** `valor` null = o item SEM a chave (nota lida antes do robô novo). */
/** O robô de leitura manda o código do produto como TEXTO ("3469734"); por isso o `as unknown as`. */
const ketchup = (valor: number | null = 286): ItemNotaSefaz => ({
  n: 3, descricao: 'CÓD. FOR: 594614 KETCHUP SACHE 168UN - INSUMOS', qtd: 10, unidade_sischef: 'UN', produto_id: String(KETCHUP), produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', associacao: 'sischef',
  ...(valor === null ? {} : { valor }),
} as unknown as ItemNotaSefaz)
const oleo = (valor: number | null = 180): ItemNotaSefaz => ({
  n: 2, descricao: 'CÓD. FOR: 473185 ÓLEO DE ALGODÃO - INSUMOS', qtd: 20, unidade_sischef: 'UN', produto_id: String(OLEO), produto_nome: 'ÓLEO DE ALGODÃO - INSUMOS', associacao: 'sischef',
  ...(valor === null ? {} : { valor }),
} as unknown as ItemNotaSefaz)
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089465', emissao: '2026-10-20', valor_nf: 466,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: null, lancamento_estado: null, lancamento_motivo: null,
  parcelas: [{ numero: '1', vencimento: '2026-11-20', valor: 466 }], associacoes_app: null,
  itens: [oleo(), ketchup()], ...extra,
} as unknown as NotaSefazLista)
const embalagemGravada = (conversao: number) => ({
  '3': { produto_id: KETCHUP, produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', unidade: null, conversao, origem: 'sischef', por: 'ivan@spazio.invalid', em: '2026-10-29T20:10:00Z' },
})
const etiqueta = () => screen.getByTestId('nota-etiqueta')
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })
const abrir = async (n: NotaSefazLista, c: ProdutoCatalogo[] = catalogo()) => {
  m.notasALancar.mockResolvedValue([n])
  m.catalogoProdutos.mockResolvedValue(c)
  render(<NotaSefaz />)
  return screen.findByTestId('nota-a-lancar')
}
const itemKetchup = async () => (await within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item'))[1]

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  m.memoriaDeEmbalagem.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — preço fora do normal: o ketchup sachê a R$ 28,60 (preço da caixa) contra R$ 0,17', () => {
  it('o título fechado deixa de dizer "Pronta" e passa a dizer "Confira os preços", em amarelo', async () => {
    await abrir(nota())
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Confira os preços'))
    expect(etiqueta()).toHaveClass('etq-aviso')
  })

  it('o resumo fica FORA do painel recolhido: diz quantos itens, qual item, o preço, a última compra e quantas vezes', async () => {
    await abrir(nota())
    const quadro = await screen.findByTestId('precos-fora-do-normal')
    expect(quadro).toHaveClass('amarelo')
    expect(quadro).toHaveTextContent('Um item está com o preço fora do normal: confira antes de lançar.')
    const linhas = within(quadro).getAllByTestId('preco-fora-item')
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toHaveTextContent('KETCHUP SACHE 168UN - INSUMOS: R$ 28,60 por UN. Na última compra custou R$ 0,17 (23/10): 168 vezes mais caro.')
    expect(quadro).toHaveTextContent('Quase sempre é a embalagem')
    expect(screen.getByTestId('conferir')).not.toContainElement(quadro)        // não mora dentro do painel "Conferir itens e financeiro"
  })

  it('no painel, o aviso fica no item certo (o do ketchup) e o item normal (o óleo) não tem nenhum', async () => {
    await abrir(nota())
    const [doOleo, doKetchup] = await within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item')
    expect(within(doKetchup).getByTestId('preco-fora-do-normal')).toHaveTextContent('Preço fora do normal: R$ 28,60 por UN.')
    expect(within(doKetchup).getByTestId('preco-fora-do-normal')).toHaveTextContent('Confira a embalagem (fardo, caixa, pacote) e a conversão.')
    expect(within(doOleo).queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('NUNCA trava: o Lançar segue liberado; a confirmação repete o aviso; Confirmar lança uma vez só', async () => {
    await abrir(nota())
    await screen.findByTestId('precos-fora-do-normal')
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('confirmar-precos')).toHaveTextContent('Atenção: 1 item está com o preço fora do normal (veja acima). Confirme só se estiver certo.')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto')
  })

  it('o Ivan informa 168 no Editar do item: o aviso some sozinho (resumo, item, confirmação) e o título volta a "Pronta"', async () => {
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([nota({ associacoes_app: embalagemGravada(168) })]) })
    await abrir(nota())
    await screen.findByTestId('precos-fora-do-normal')
    const item = within(await itemKetchup())
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    await userEvent.type(item.getByLabelText(ROTULO_UN), '168')
    await userEvent.click(item.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168))
    await waitFor(() => expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument())
    expect(item.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Pronta'))
    await userEvent.click(botaoLancar())
    expect(screen.queryByTestId('confirmar-precos')).not.toBeInTheDocument()
  })

  it('a embalagem que o robô já lembra (168) conta como aplicada: sem aviso', async () => {
    m.memoriaDeEmbalagem.mockResolvedValue([{
      emitente_cnpj: '03995515011363', cod_forn: '594614', unidade_nota: 'UN', produto_id: KETCHUP, produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', fator: 168, preco_ref: 28.6,
      descricao_exemplo: null, vezes: 3, ultima_chave: null, atualizado_em: '2026-10-28T20:15:00+00:00',
    }])
    await abrir(nota())
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Pronta'))
    expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — preço fora do normal: quando a tela fica calada', () => {
  it('preço normal (R$ 0,17 por sachê já convertido): nada, título "Pronta"', async () => {
    await abrir(nota({ itens: [oleo(), ketchup(286)], associacoes_app: embalagemGravada(168) }))
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Pronta'))
    expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('nota lida antes do robô novo (itens sem o total da linha): nada, e tudo segue como sempre', async () => {
    await abrir(nota({ itens: [oleo(null), ketchup(null)] }))
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Pronta'))
    expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument()
    expect(botaoLancar()).toBeEnabled()
  })

  it('produto sem compras na lista (novo) ou lista que não carregou: nada', async () => {
    await abrir(nota(), catalogo([]))
    await waitFor(() => expect(etiqueta()).toHaveTextContent('Pronta'))
    expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument()
  })

  it.each([
    ['lancando', 'Lançando…'],
    ['erro', 'Ficou pela metade'],
  ] as const)('o robô já mexeu na nota (%s): o quadro "confira antes de lançar" não aparece, e o título diz o que o robô faz', async (estado, titulo) => {
    await abrir(nota({ lancamento_estado: estado, lancamento_estado_em: new Date().toISOString(), lancamento_motivo: estado === 'erro' ? 'erro no lançamento (pedido JÁ gerado)' : null }))
    await waitFor(() => expect(etiqueta()).toHaveTextContent(titulo))
    expect(screen.queryByTestId('precos-fora-do-normal')).not.toBeInTheDocument()
  })

  it('o que falta decidir ou o financeiro vem antes no título: o aviso de preço não esconde a pendência', async () => {
    await abrir(nota({ parcelas: [{ numero: '1', vencimento: '2026-11-20', valor: 100 }] }))   // boleto que não fecha com o valor da nota
    await screen.findByTestId('precos-fora-do-normal')
    expect(etiqueta()).toHaveTextContent('Confira o financeiro')
  })
})

describe('NotaSefaz — preço fora do normal: mais de um item', () => {
  it('dois itens com preço estranho: o texto vai ao plural e lista os dois, na ordem da nota', async () => {
    await abrir(nota({ itens: [oleo(1800), ketchup()] }))      // o óleo a R$ 90 por UN contra R$ 9: dez vezes
    const quadro = await screen.findByTestId('precos-fora-do-normal')
    expect(quadro).toHaveTextContent('2 itens estão com o preço fora do normal: confira antes de lançar.')
    const linhas = within(quadro).getAllByTestId('preco-fora-item')
    expect(linhas[0]).toHaveTextContent('ÓLEO DE ALGODÃO - INSUMOS: R$ 90,00 por UN. Na última compra custou R$ 9,00 (20/10): 10 vezes mais caro.')
    expect(linhas[1]).toHaveTextContent('KETCHUP SACHE 168UN - INSUMOS')
    await userEvent.click(botaoLancar())
    expect(screen.getByTestId('confirmar-precos')).toHaveTextContent('2 itens estão com o preço fora do normal')
  })
})
