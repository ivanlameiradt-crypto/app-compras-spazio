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

// Pedido do Ivan (30/10/2026), no mesmo print: ao lado da descrição que está na nota fiscal um sinal "da nota fiscal", e ao lado do produto ligado (o do ✓) um sinal "do SisChef" —
// para ele ver de relance o que o fornecedor escreveu e o que é cadastro. Vale também para o cupom (os testes dele estão em cupom.test.tsx). E a embalagem que o app mostra na pergunta da conversão
// é SEMPRE a da nota (caixa → CX, unidade → UN, pacote → PCT, fardo → FD), nunca uma palavra genérica.
describe('NotaSefaz — de onde vem cada texto do item: "da nota fiscal" e "do SisChef" (30/10/2026)', () => {
  it('item confirmado no app: a descrição da nota leva "da nota fiscal" (depois da quantidade) e o produto ligado, com o ✓, leva "do SisChef"', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_GUARANA], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', 12) })])
    render(<NotaSefaz />)
    const p = await painel()
    const item = within(await p.findByTestId('conferir-item'))
    expect(item.getByTestId('origem-nota')).toHaveTextContent('da nota fiscal')
    expect(item.getByTestId('origem-sischef')).toHaveTextContent('do SisChef')
    const li = item.getByTestId('origem-nota').closest('li') as HTMLElement
    expect(li).toHaveTextContent('GUARANA CHP ANTARCTICA DIET LATA 350ML SH 32,7000 · 10 CX da nota fiscal')   // o selo vem DEPOIS da quantidade e da embalagem, com espaço de verdade
    expect(li).toHaveTextContent('GUARANÁ ANTARCTICA S/ AÇÚCAR 350ML do SisChef')
  })

  it('item que já vem associado do SisChef: os dois selos; item sem produto nenhum: só "da nota fiscal" (não há produto do SisChef para marcar)', async () => {
    const jaAssociado: ItemNotaSefaz = { n: 3, descricao: 'CÓD. FOR: 594614 KETCHUP SACHE 168UN - INSUMOS', qtd: 10, unidade_sischef: 'UN', produto_id: 3469734, produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', associacao: 'sischef' }
    const semNada: ItemNotaSefaz = { n: 4, descricao: 'CÓD. FOR: 77 PRODUTO QUE NINGUÉM CONHECE', qtd: 2, unidade_sischef: 'UN', produto_id: null }
    m.notasALancar.mockResolvedValue([oliveira([jaAssociado, semNada])])
    render(<NotaSefaz />)
    const p = await painel()
    const itens = await p.findAllByTestId('conferir-item')
    const ketchup = within(itens.find((x) => x.textContent?.includes('KETCHUP')) as HTMLElement)
    expect(ketchup.getByTestId('origem-nota')).toBeInTheDocument()
    expect(ketchup.getByTestId('origem-sischef')).toBeInTheDocument()
    const vazio = within(itens.find((x) => x.textContent?.includes('NINGUÉM CONHECE')) as HTMLElement)
    expect(vazio.getByTestId('origem-nota')).toHaveTextContent('da nota fiscal')
    expect(vazio.queryByTestId('origem-sischef')).not.toBeInTheDocument()
  })

  it('na caixa de associação: o produto que o app INDICA já diz "no SisChef" no título (sem selo repetido); o que o Ivan ESCOLHE na lista leva "do SisChef"', async () => {
    m.notasALancar.mockResolvedValue([oliveira([ITEM_GUARANA], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
    render(<NotaSefaz />)
    const p = await painel()
    await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
    const indicado = within(await p.findByTestId('produto-escolhido'))
    expect(indicado.getByText('Produto que eu indiquei no SisChef')).toBeInTheDocument()
    expect(indicado.queryByTestId('origem-sischef')).not.toBeInTheDocument()
    await userEvent.click(p.getByRole('button', { name: /Escolher outro/ }))
    await userEvent.type(await p.findByLabelText('Produto do SisChef'), 'guarana')
    await userEvent.click(within(await p.findByTestId('achados')).getByRole('button', { name: /GUARANÁ ANTARCTICA/ }))
    const escolhido = within(await p.findByTestId('produto-escolhido'))
    expect(escolhido.getByText('Produto escolhido')).toBeInTheDocument()
    expect(escolhido.getByTestId('origem-sischef')).toHaveTextContent('do SisChef')
  })

  describe('a embalagem da pergunta é a que está na nota (nunca uma palavra genérica)', () => {
    const emUnidade = (un: string): ItemNotaSefaz => ({ ...ITEM_GUARANA, unidade_sischef: un })
    it.each(['CX', 'PCT', 'FD', 'UN', 'SC'])('nota em %s × produto "un": a pergunta e a conta falam em %s', async (un) => {
      m.notasALancar.mockResolvedValue([oliveira([emUnidade(un)], { '1': decisao(GUARANA, 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', 'un', null) })])
      render(<NotaSefaz />)
      const p = await painel()
      await userEvent.click(await p.findByRole('button', { name: 'Editar' }))
      // UN × UN: unidades iguais, o campo fica escondido atrás do link e o Editar o abre; nas outras a pergunta já está aberta
      const campo = await p.findByLabelText(`Quanto vale 1 ${un} na unidade do produto no SisChef? (opcional)`)
      await userEvent.type(campo, '12')
      expect(p.getByTestId('conversao-entrada')).toHaveTextContent(`Conta: 10 ${un} × 12 = 120 UN.`)
      expect(p.getByTestId('conversao-eco')).toHaveTextContent(`Vai gravar: 1 ${un} = 12`)
    })
  })
})
