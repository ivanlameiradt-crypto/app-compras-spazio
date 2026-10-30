import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { ItemNotaSefaz, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

// Pedido do Ivan (30/10/2026), olhando a NF 000970395 da OLIVEIRA E OLIVEIRA no app: o texto de baixo da conversão era genérico ("A lista do app não sabe ao certo…"). Ele quer ler,
// para ESTA entrada: "este pedido, Guaraná Antártica sem açúcar, cód. 3324211, vai entrar 120 unidades no SisChef, porque o SisChef controla o estoque deste produto por unidade".
const CHAVE = '0'.repeat(44)
const GUARANA = 3324211
const LEITE = 3469626
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: GUARANA, nome: 'GUARANÁ ANTARCTICA S/ AÇÚCAR 350ML', nome_sischef: 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', unidade: 'un' },
  { produto_id: LEITE, nome: 'LEITE CONDENSADO - INSUMOS (KG)', unidade: 'kg' },
]
const decisao = (id: number, nome: string, unidade: string, conversao?: number | null) =>
  ({ produto_id: id, produto_nome: nome, unidade, origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-29T22:26:43Z', ...(conversao === undefined ? {} : { conversao }) })
const ITEM_GUARANA: ItemNotaSefaz = { n: 1, descricao: 'CÓD. FOR: 0009085 GUARANA CHP ANTARCTICA DIET LATA 350ML SH 32,7000', qtd: 10, unidade_sischef: 'CX', produto_id: null }
const ITEM_LEITE: ItemNotaSefaz = { n: 2, descricao: 'CÓD. FOR: 884 LEITE COND TIROL SEMIDES TP 395G', qtd: 24, unidade_sischef: 'UN', produto_id: null }
const oliveira = (itens: ItemNotaSefaz[], associacoes_app: NotaSefazLista['associacoes_app'] = null): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '04372975000100', emitente: 'OLIVEIRA E OLIVEIRA LTDA.', numero: '000970395', emissao: '2026-10-28', valor_nf: 327,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 327 }], itens, associacoes_app,
})
const painel = async () => within(await screen.findByTestId('conferir'))
const CAMPO_OPCIONAL = 'Quanto vale 1 CX na unidade do produto no SisChef? (opcional)'

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

describe('NotaSefaz — a leitura clara do que entra no SisChef (Oliveira 000970395, 30/10/2026)', () => {
  it('Guaraná em CX: Editar abre o cartão com a ajuda curta e SEM a frase da entrada; ao digitar 12 a tela diz "Vão entrar 120 UN…", o porquê e a conta', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_GUARANA], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
    render(<NotaSefaz />)
    const p = await painel()
    await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
    expect(p.queryByTestId('conversao-entrada')).not.toBeInTheDocument()                      // campo vazio: ainda não há o que dizer
    expect(await p.findByTestId('conversao-ajuda')).toHaveTextContent(
      'Digite quantas UN tem cada CX da nota (caixa, pacote ou fardo). Deixe vazio só se, no SisChef, este produto também for controlado em CX. Se o robô parar pedindo a conversão, volte aqui (Editar) e informe.')
    expect(p.getByTestId('pedir-conversao')).not.toHaveTextContent('não sabe ao certo')         // o texto genérico saiu
    await userEvent.type(p.getByLabelText(CAMPO_OPCIONAL), '12')
    expect(p.getByTestId('conversao-entrada')).toHaveTextContent(
      'Vão entrar 120 UN de GUARANÁ ANTARCTICA S/ AÇÚCAR 350ML (cód. 3324211) no SisChef, porque o SisChef controla o estoque deste produto por UN (o robô confere isso no SisChef antes de lançar). Conta: 10 CX × 12 = 120 UN.')
    expect(p.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 CX = 12 na unidade do produto no SisChef')   // o eco de sempre continua
  })

  it('a frase acompanha o que o Ivan digita (vírgula ou ponto) e some com texto inválido ou campo vazio', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_GUARANA], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
    render(<NotaSefaz />)
    const p = await painel()
    await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
    const campo = p.getByLabelText(CAMPO_OPCIONAL)
    await userEvent.type(campo, '12,5')
    expect(p.getByTestId('conversao-entrada')).toHaveTextContent('Vão entrar 125 UN de GUARANÁ')
    expect(p.getByTestId('conversao-entrada')).toHaveTextContent('Conta: 10 CX × 12,5 = 125 UN.')
    await userEvent.clear(campo)
    await userEvent.type(campo, 'abc')
    expect(p.queryByTestId('conversao-entrada')).not.toBeInTheDocument()                      // inválido: o Confirmar trava e não há conta
    await userEvent.clear(campo)
    expect(p.queryByTestId('conversao-entrada')).not.toBeInTheDocument()                      // vazio: idem
  })

  it('a frase é só leitura: o Confirmar continua gravando só o número (chave, item, produto, 12)', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_GUARANA], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
    render(<NotaSefaz />)
    const p = await painel()
    await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
    await userEvent.type(p.getByLabelText(CAMPO_OPCIONAL), '12')
    await userEvent.click(p.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, GUARANA, 12))
  })

  it('leite condensado (nota em UN × produto em KG, conversão obrigatória): o 0,395 sugerido já mostra "Vão entrar 9,48 KG…", sem o aviso do robô (a unidade em KG é certa)', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_LEITE], { '2': decisao(LEITE, 'LEITE CONDENSADO - INSUMOS (KG)', 'kg') })])
    render(<NotaSefaz />)
    const p = await painel()
    expect(await p.findByLabelText('Quanto vale 1 UN em KG?')).toHaveValue('0,395')
    const entrada = p.getByTestId('conversao-entrada')
    expect(entrada).toHaveTextContent('Vão entrar 9,48 KG de LEITE CONDENSADO - INSUMOS (KG) (cód. 3469626) no SisChef, porque o SisChef controla o estoque deste produto por KG. Conta: 24 UN × 0,395 = 9,48 KG.')
    expect(entrada).not.toHaveTextContent('o robô confere')
  })

  it('produto novo (sem unidade na lista): a frase não inventa unidade — diz "na unidade que o produto tem lá"', async () => {
    const novo: ItemNotaSefaz = { ...ITEM_GUARANA, sugestao: { id: '3999999', nome: 'PRODUTO NOVO NO SISCHEF' } }
    m.notasALancar.mockResolvedValue([oliveira([novo])])
    render(<NotaSefaz />)
    const p = await painel()
    expect(await p.findByTestId('produto-escolhido')).toHaveTextContent('PRODUTO NOVO NO SISCHEF')
    await userEvent.type(p.getByLabelText(CAMPO_OPCIONAL), '12')
    expect(p.getByTestId('conversao-entrada')).toHaveTextContent('Vão entrar 120 de PRODUTO NOVO NO SISCHEF (cód. 3999999) no SisChef, na unidade que o produto tem lá. Conta: 10 CX × 12 = 120.')
    expect(p.getByTestId('pedir-conversao')).toHaveTextContent('Produto fora da lista semanal: o app não conhece a unidade dele no SisChef.')   // a explicação própria do produto novo fica
  })

  it('item sem quantidade lida: sem frase da entrada (não há conta a fazer), mas o eco "Vai gravar" continua', async () => {
    const semQtd: ItemNotaSefaz = { ...ITEM_GUARANA, qtd: null }
    m.notasALancar.mockResolvedValue([oliveira([semQtd], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
    render(<NotaSefaz />)
    const p = await painel()
    await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
    await userEvent.type(p.getByLabelText(CAMPO_OPCIONAL), '12')
    expect(p.queryByTestId('conversao-entrada')).not.toBeInTheDocument()
    expect(p.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 CX = 12 na unidade do produto no SisChef')
  })
})
