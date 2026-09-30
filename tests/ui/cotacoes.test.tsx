// Aba Cotações (spec 8.2; contrato 8.3; testes 15.4). A api é simulada por um "banco" em memória que as ações mudam,
// para a tela reler como no App de verdade. Dados INVENTADOS (repositório público).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Cotacoes from '../../src/admin/Cotacoes'
import type { Cotacao, IaStatus, ItemCotacao, LeituraIA, Pedido, Preparo, ResumoCotacao } from '../../src/lib/tipos'
import {
  dadosEnvioDe, linkCotacao, linkWhatsApp, mensagemCobranca, mensagemCotacao, mensagemObrigado,
} from '../../src/cotacao/mensagens'
import { cotacao, itemCotacao, PREPARADA, preparo, resumo, vendedor } from '../fabricas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CODIGO = 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG'
const CODIGO_NOVO = 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp'
const SEMANA = { id: 3, data_referencia: '2026-10-19', status: 'em_compra' as const, aprovada_por: 'ivan@spazio.com', aprovada_em: '2026-10-19T11:02:00Z' }
const FULANO = vendedor()
const BELTRANO = vendedor({ id: 2, codigo: 'beltrano', nome: 'Beltrano', empresa: 'FORNECEDOR B (Bairro)', whatsapp: '5511900000002' })
/** seg 19/10 15h10 BRT, antes do prazo */
const SEG_15H = '2026-10-19T18:10:00Z'

interface Banco {
  preparo: Preparo; cotacoes: Cotacao[]; anteriores: Cotacao[]; itens: ItemCotacao[]; resumos: ResumoCotacao[]
  codigos: Record<number, string>; pedidos: Record<number, Pedido | null>
}
let banco: Banco

const cotDe = (id: number) => [...banco.cotacoes, ...banco.anteriores].find((c) => c.id === id)!
function mudarCot(id: number, p: Partial<Cotacao>) {
  banco.cotacoes = banco.cotacoes.map((c) => (c.id === id ? { ...c, ...p } : c))
  banco.anteriores = banco.anteriores.map((c) => (c.id === id ? { ...c, ...p } : c))
}
const cartao = (cot: number) => screen.findByTestId(`cotacao-${cot}`)

/** Rascunho do Fulano com dois itens. */
function comRascunho(itens: Partial<ItemCotacao>[] = [
  { id: 100, produto_id: 10, nome: 'AGUA MINERAL 500ML', numero: null },
  { id: 101, produto_id: 11, item_semana_id: 1001, nome: 'FERMENTO SECO', unidade: 'kg', rotulo: 'kg', qtd: 0.5, qtd_sugerida: 0.5, numero: null },
]) {
  banco.cotacoes = [cotacao({ id: 7, status: 'rascunho' })]
  banco.itens = itens.map((p) => itemCotacao(p))
  banco.preparo = preparo({ agora: SEG_15H, cartoes: [{ vendedor_id: 1, itens: itens.length, estimado: 150, cotacoes: [7] }] })
}

/** Cotação do Fulano já preparada (prazo ter 20/10 12h, fechamento 17h). */
function comViva(p: Partial<Cotacao>, itens: Partial<ItemCotacao>[], agora = SEG_15H) {
  banco.cotacoes = [cotacao({ id: 7, ...PREPARADA, ...p })]
  banco.itens = itens.map((x, k) => itemCotacao({ id: 100 + k, numero: k + 1, produto_id: 10 + k, item_semana_id: 1000 + k, ...x }))
  banco.codigos = { 7: CODIGO }
  banco.preparo = preparo({ agora, cartoes: [{ vendedor_id: 1, itens: itens.length, estimado: 150, cotacoes: [7] }] })
}

beforeEach(() => {
  vi.resetAllMocks()
  banco = { preparo: preparo({ agora: SEG_15H }), cotacoes: [], anteriores: [], itens: [], resumos: [], codigos: {}, pedidos: {} }
  m.semanaEmCompra.mockResolvedValue(SEMANA)
  m.prepararCotacoes.mockImplementation(async () => banco.preparo)
  m.listarVendedores.mockResolvedValue([FULANO, BELTRANO])
  m.cotacoesDaSemana.mockImplementation(async (s) => [...banco.cotacoes, ...banco.anteriores].filter((c) => c.semana_id === s))
  // como o banco: de outras semanas, só as vivas (ou fechadas sem resultado)
  m.cotacoesAnterioresVivas.mockImplementation(async () => banco.anteriores
    .filter((c) => ['pronta', 'enviada', 'respondida'].includes(c.status) || (c.status === 'fechada' && c.resultado == null)))
  m.cotacoesSubstituidasPor.mockImplementation(async (ids) => [...banco.cotacoes, ...banco.anteriores]
    .filter((c) => c.substituida_por != null && ids.includes(c.substituida_por)))
  m.itensDaSemana.mockResolvedValue([])
  m.itensDasCotacoes.mockImplementation(async (ids) => banco.itens.filter((i) => ids.includes(i.cotacao_id)))
  m.resumosDasCotacoes.mockImplementation(async () => banco.resumos)
  m.codigosDasCotacoes.mockImplementation(async () => banco.codigos)
  m.pedidoDaCotacao.mockImplementation(async (id) => banco.pedidos[id] ?? null)
  m.congelarCotacao.mockImplementation(async (id) => {
    mudarCot(id, { status: 'pronta', ...PREPARADA })
    let n = 0
    banco.itens = banco.itens.map((i) => (i.cotacao_id === id && i.incluido ? { ...i, numero: ++n } : i))
    banco.codigos = { ...banco.codigos, [id]: CODIGO }
    return dadosEnvioDe(cotDe(id), banco.itens, FULANO, CODIGO, { data_referencia: SEMANA.data_referencia })
  })
  m.abrirComoVendedor.mockImplementation(async () => ({
    ok: true, estado: 'aberta', texto: null, itens: banco.itens.filter((i) => i.incluido && i.numero != null),
  }) as never)
  m.confirmarEnvio.mockImplementation(async (id) => { mudarCot(id, { status: 'enviada', enviada_em: SEG_15H }) })
  m.descongelarCotacao.mockImplementation(async (id) => {
    mudarCot(id, { status: 'rascunho', prazo: null, fechamento: null, congelada_em: null })
    banco.itens = banco.itens.map((i) => (i.cotacao_id === id ? { ...i, numero: null } : i))
  })
  m.cancelarCotacao.mockResolvedValue()
  m.definirVendedor.mockResolvedValue()
  m.definirNota.mockResolvedValue()
  m.marcarItemCotacao.mockResolvedValue()
  m.liberarLoja.mockResolvedValue()
  m.voltarACotar.mockResolvedValue()
  // Fase 2 D: o cartão do pedido monta <EntregaNfe>, que lê estas funções; vazias por padrão nos testes de cotação.
  m.conferencia.mockResolvedValue([])
  m.nfesDosPedidos.mockResolvedValue([])
  m.desempenho.mockResolvedValue([])
  m.nfesSemPedido.mockResolvedValue([])
  m.novaVersao.mockResolvedValue(8)
  m.dispensarCotacao.mockImplementation(async (id) => { mudarCot(id, { status: 'fechada', resultado: 'dispensado' }) })
  m.trocarCodigo.mockImplementation(async (id) => {
    banco.codigos = { ...banco.codigos, [id]: CODIGO_NOVO }
    return dadosEnvioDe(cotDe(id), banco.itens, FULANO, CODIGO_NOVO)
  })
  m.responderComoAdmin.mockResolvedValue({ ok: true, reenvio: false, recebido_em: SEG_15H, itens: [], gerais: null })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

// o jsdom não navega: o toque num link só dispara o onClick
beforeAll(() => document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest?.('a')) e.preventDefault() }))

const textoDoLink = (a: HTMLElement) => decodeURIComponent(new URL(a.getAttribute('href')!).searchParams.get('text') ?? '')

describe('Cotações — abrir e atualizar', () => {
  it('sem semana em compra: pede para aprovar a lista', async () => {
    m.semanaEmCompra.mockResolvedValue(null)
    render(<Cotacoes />)
    expect(await screen.findByText('Aprove a lista da semana para montar as cotações.')).toBeInTheDocument()
    expect(m.prepararCotacoes).not.toHaveBeenCalled()
  })

  it('ao abrir chama cot_preparar e relê; botão Atualizar de novo; rodapé com os horários das coletas', async () => {
    comRascunho()
    render(<Cotacoes />)
    expect(await screen.findByText('AGUA MINERAL 500ML')).toBeInTheDocument()
    expect(m.prepararCotacoes).toHaveBeenCalledWith(3)
    expect(m.itensDasCotacoes).toHaveBeenCalledWith([7])
    expect(screen.getByTestId('rodape')).toHaveTextContent('O e-mail avisa nas coletas de seg a sex (8h17, 12h17, 16h17)')
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(m.prepararCotacoes).toHaveBeenCalledTimes(2))
  })

  it('atualiza sozinha a cada 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] })
    try {
      comRascunho()
      render(<Cotacoes />)
      await screen.findByText('AGUA MINERAL 500ML')
      expect(m.prepararCotacoes).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      await waitFor(() => expect(m.prepararCotacoes).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('cartão do vendedor: empresa, nome, telefone curto e o estimado', async () => {
    comRascunho()
    render(<Cotacoes />)
    const c = await screen.findByTestId('vendedor-1')
    expect(c).toHaveTextContent('FORNECEDOR A (Centro) · Fulano · +55 11 9…')
    expect(c).toHaveTextContent('2 itens · ≈ R$ 150,00')
  })
})

describe('Cotações — rascunho e Preparar', () => {
  it('Preparar → checagem pelo caminho do vendedor (prévia) → link wa.me de verdade, sem window.open', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    const abrir = await screen.findByRole('link', { name: 'Abrir WhatsApp' })
    expect(m.congelarCotacao).toHaveBeenCalledWith(7)
    expect(m.abrirComoVendedor).toHaveBeenCalledWith(CODIGO)
    expect(abrir.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5511900000001\?text=/)
    expect(abrir).toHaveAttribute('target', '_blank')
    expect(textoDoLink(abrir)).toContain(`#c=${CODIGO}`)
    expect(textoDoLink(abrir)).toContain('Prazo: terça, 20/10, até 12h.')
    expect(screen.getByTestId('envio')).toHaveTextContent('Prazo: terça, 20/10, até 12h · fecha às 17h')
    await userEvent.click(abrir)
    expect(await screen.findByText('Enviou no WhatsApp?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir o WhatsApp de novo' }).getAttribute('href')).toBe(abrir.getAttribute('href'))
    expect(window.open).not.toHaveBeenCalled()
  })

  it('"Já enviei" grava o envio', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Já enviei' }))
    expect(m.confirmarEnvio).toHaveBeenCalledWith(7)
    await waitFor(() => expect(screen.queryByText('Enviou no WhatsApp?')).not.toBeInTheDocument())
  })

  it('preparada aqui e relida depois do fechamento (aba aberta de um dia para o outro): sem WhatsApp nem "Já enviei"; vai ao "Não enviada?"', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))
    expect(await screen.findByRole('button', { name: 'Já enviei' })).toBeInTheDocument()
    // ter 20/10 18h: o fechamento (17h) passou e o Ivan não tocou "Já enviei"
    banco.preparo = { ...banco.preparo, agora: '2026-10-20T21:00:00Z' }
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    const bloco = await screen.findByTestId('nao-enviada-7')
    expect(screen.queryByTestId('envio')).not.toBeInTheDocument()
    expect(screen.queryByTestId('refeita')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Abrir (o )?WhatsApp/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Já enviei' })).not.toBeInTheDocument()
    for (const a of screen.queryAllByRole('link')) expect(a.getAttribute('href')).not.toMatch(/^https:\/\/wa\.me/)
    // o caminho é Desfazer ou Cancelar (spec 5.2)
    expect(within(bloco).getByRole('button', { name: 'Desfazer (não enviei)' })).toBeInTheDocument()
    expect(within(bloco).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(await cartao(7)).getByText(/veja "Não enviada\?" acima/)).toBeInTheDocument()
  })

  it('"Desfazer (não enviei)" avisa que o link deixa de funcionar e volta ao rascunho', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer (não enviei)' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Se você mandou a mensagem, o link que o Fulano recebeu deixa de funcionar.'))
    expect(m.descongelarCotacao).toHaveBeenCalledWith(7)
    expect(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' })).toBeInTheDocument()
  })

  it('checagem de saúde que falha: mostra o erro e não oferece o WhatsApp', async () => {
    comRascunho()
    m.abrirComoVendedor.mockResolvedValue({ ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' })
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    expect(await screen.findByText(/A checagem do link falhou: Este link não vale mais/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir WhatsApp' })).not.toBeInTheDocument()
  })

  it('mensagem acima de 1.300 caracteres (notas longas): aviso amarelo antes do link, sem bloquear', async () => {
    const nota = 'N'.repeat(80)
    comRascunho(Array.from({ length: 13 }, (_, k) => ({ id: 100 + k, produto_id: 10 + k, item_semana_id: 1000 + k, nome: `ITEM INVENTADO ${k + 1}`, numero: null, nota_vendedor: nota })))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    const aviso = await screen.findByTestId('aviso-tamanho')
    expect(aviso.textContent).toMatch(/^Mensagem com \d{4} caracteres: o WhatsApp pode não abrir\. Encurte as notas ou use Copiar mensagem\.$/)
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' })).toBeInTheDocument()
  })

  it('sem notas longas não há aviso de tamanho', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await screen.findByRole('link', { name: 'Abrir WhatsApp' })
    expect(screen.queryByTestId('aviso-tamanho')).not.toBeInTheDocument()
  })

  it('marcar/desmarcar item, Trocar vendedor e Comprar na loja nesta semana', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Cotar FERMENTO SECO' }))
    expect(m.marcarItemCotacao).toHaveBeenCalledWith(101, false)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Trocar vendedor de AGUA MINERAL 500ML' }), '2')
    expect(m.definirVendedor).toHaveBeenCalledWith(10, 2)
    await userEvent.click(screen.getByRole('button', { name: 'Comprar na loja nesta semana' }))
    expect(m.liberarLoja).toHaveBeenCalledWith(7)
  })

  it('Nota: grava no catálogo e relê a aba (cot_preparar de novo); a nota aparece abaixo do nome', async () => {
    comRascunho([{ id: 100, produto_id: 10, nome: 'AGUA MINERAL 500ML', numero: null, nota_vendedor: 'sem gás' }])
    vi.spyOn(window, 'prompt').mockReturnValue('  fardo c/12 ')
    render(<Cotacoes />)
    expect(await screen.findByText('Nota: sem gás')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Nota de AGUA MINERAL 500ML' }))
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('até 80 caracteres'), 'sem gás')
    expect(m.definirNota).toHaveBeenCalledWith(10, 'fardo c/12')
    expect(window.confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(m.prepararCotacoes).toHaveBeenCalledTimes(2))
  })

  it('Nota com "R$" ou número com vírgula: pergunta antes de gravar (e não grava se o Ivan desistir)', async () => {
    comRascunho()
    vi.spyOn(window, 'prompt').mockReturnValue('R$ 31,50 o fardo')
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Nota de AGUA MINERAL 500ML' }))
    expect(window.confirm).toHaveBeenCalledWith("A nota tem 'R$' ou número com vírgula e o vendedor vai ver. Gravar assim mesmo?")
    expect(m.definirNota).not.toHaveBeenCalled()
    vi.mocked(window.prompt).mockReturnValue('caixa com 1,5 kg')
    vi.mocked(window.confirm).mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Nota de AGUA MINERAL 500ML' }))
    expect(m.definirNota).toHaveBeenCalledWith(10, 'caixa com 1,5 kg')
  })

  it('Nota vazia apaga (null); prompt cancelado não grava', async () => {
    comRascunho()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('   ')
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Nota de AGUA MINERAL 500ML' }))
    expect(m.definirNota).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Nota de AGUA MINERAL 500ML' }))
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(m.definirNota).toHaveBeenCalledWith(10, null)
  })

  it('erro do banco aparece no cartão com a mensagem exata', async () => {
    comRascunho()
    m.congelarCotacao.mockRejectedValue(new Error('marque pelo menos um item antes de preparar a mensagem'))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('marque pelo menos um item antes de preparar a mensagem')
  })
})

describe('Cotações — Copiar mensagem e Copiar link', () => {
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('no Preparar: copia no próprio toque (sem esperar nada) o mesmo texto do link; depois pergunta "Enviou no WhatsApp?"', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    const abrir = await screen.findByRole('link', { name: 'Abrir WhatsApp' })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))
    expect(writeText).toHaveBeenCalledWith(textoDoLink(abrir)) // síncrono: ainda dentro do toque
    expect(await screen.findByText('Enviou no WhatsApp?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(writeText).toHaveBeenLastCalledWith(linkCotacao(CODIGO))
    expect(await screen.findByText('Link copiado.')).toBeInTheDocument()
  })

  it('cópia negada: mostra o texto já selecionado para copiar à mão', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    const abrir = await screen.findByRole('link', { name: 'Abrir WhatsApp' })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))
    const area = await screen.findByRole('textbox', { name: 'Texto para copiar' })
    expect(area).toHaveValue(textoDoLink(abrir))
    expect(area).toHaveAttribute('readonly')
    expect(document.activeElement).toBe(area)
    expect(screen.getByText('Copie o texto abaixo (segure e escolha Copiar)')).toBeInTheDocument()
    // a pergunta aparece e o texto continua lá para copiar
    expect(screen.getByText('Enviou no WhatsApp?')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Texto para copiar' })).toBeInTheDocument()
  })

  it('"Abrir o WhatsApp de novo": mesmo link, mesma mensagem e mesmo prazo, com Copiar mensagem e Copiar link', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    const de = await screen.findByRole('link', { name: 'Abrir o WhatsApp de novo' })
    const esperado = mensagemCotacao(dadosEnvioDe(banco.cotacoes[0], banco.itens, FULANO, CODIGO))
    expect(de.getAttribute('href')).toBe(linkWhatsApp(FULANO.whatsapp, esperado))
    expect(esperado).toContain('Prazo: terça, 20/10, até 12h.')
    const secao = await cartao(7)
    fireEvent.click(within(secao).getByRole('button', { name: 'Copiar mensagem' }))
    expect(writeText).toHaveBeenCalledWith(esperado)
    fireEvent.click(within(secao).getByRole('button', { name: 'Copiar link' }))
    expect(writeText).toHaveBeenLastCalledWith(linkCotacao(CODIGO))
    expect(within(secao).getByRole('link', { name: 'Ver como o vendedor vê' })).toHaveAttribute('href', linkCotacao(CODIGO, true))
  })
})

describe('Cotações — Cobrar só entre o prazo e o fechamento', () => {
  const semResposta = [{ nome: 'AGUA MINERAL 500ML' }]
  it('antes do prazo: sem Cobrar', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, semResposta, '2026-10-20T14:00:00Z')
    render(<Cotacoes />)
    await cartao(7)
    expect(screen.queryByRole('link', { name: 'Cobrar no WhatsApp' })).not.toBeInTheDocument()
  })
  it('entre o prazo e o fechamento, sem resposta: Cobrar com "até as 17h de hoje"', async () => {
    const agora = '2026-10-20T16:00:00Z'
    comViva({ status: 'enviada', enviada_em: SEG_15H }, semResposta, agora)
    render(<Cotacoes />)
    const cobrar = await screen.findByRole('link', { name: 'Cobrar no WhatsApp' })
    expect(textoDoLink(cobrar)).toBe(mensagemCobranca('Fulano', PREPARADA.fechamento, new Date(agora)))
    expect(textoDoLink(cobrar)).toContain('até as 17h de hoje')
  })
  it('com resposta: sem Cobrar', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [{ estado: 'tem', preco_digitado: 2, base: 'un', preco_convertido: 2 }], '2026-10-20T16:00:00Z')
    banco.resumos = [resumo({ respondidos: 1, tem: 1 })]
    render(<Cotacoes />)
    await cartao(7)
    expect(screen.queryByRole('link', { name: 'Cobrar no WhatsApp' })).not.toBeInTheDocument()
  })
  it('depois do fechamento: sem Cobrar; no lugar, "Nova versão (prazo novo)"', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, semResposta, '2026-10-20T21:00:00Z')
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova versão (prazo novo)' }))
    expect(m.novaVersao).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('link', { name: 'Cobrar no WhatsApp' })).not.toBeInTheDocument()
  })
})

describe('Cotações — blocos da semana', () => {
  it('"Não enviada?": pronta sem sinal, com Abrir WhatsApp, Copiar mensagem, Copiar link, Já enviei, Desfazer e Cancelar', async () => {
    comViva({ status: 'pronta' }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    const bloco = await screen.findByTestId('nao-enviada-7')
    expect(bloco).toHaveTextContent('Preparada às 15h02 e sem sinal de envio')
    for (const nome of ['Copiar mensagem', 'Copiar link', 'Já enviei', 'Desfazer (não enviei)', 'Cancelar']) {
      expect(within(bloco).getByRole('button', { name: nome })).toBeInTheDocument()
    }
    expect(within(bloco).getByRole('link', { name: 'Abrir WhatsApp' })).toBeInTheDocument()
    // pronta sem sinal: Nova versão e Obrigado ficam de fora (o caminho é Desfazer ou Cancelar)
    const secao = await cartao(7)
    expect(within(secao).queryByRole('button', { name: /Nova versão/ })).not.toBeInTheDocument()
    expect(within(secao).queryByRole('button', { name: 'Obrigado, desta vez não' })).not.toBeInTheDocument()
    await userEvent.click(within(bloco).getByRole('button', { name: 'Desfazer (não enviei)' }))
    expect(m.descongelarCotacao).toHaveBeenCalledWith(7)
  })

  it('sem semana em compra: a pronta sem sinal de uma semana anterior aparece em "Não enviada?", com Já enviei e Desfazer', async () => {
    // seg 19/10 de manhã: a semana dela já encerrou e a nova ainda não foi aprovada
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
    try {
      m.semanaEmCompra.mockResolvedValue(null)
      banco.anteriores = [cotacao({ id: 5, semana_id: 2, status: 'pronta', ...PREPARADA })]
      banco.itens = [itemCotacao({ id: 300, cotacao_id: 5, numero: 1, produto_id: 80, nome: 'OVO' })]
      banco.codigos = { 5: CODIGO }
      render(<Cotacoes />)
      const bloco = await screen.findByTestId('nao-enviada-5')
      expect(screen.getByText('Aprove a lista da semana para montar as cotações.')).toBeInTheDocument()
      expect(within(await cartao(5)).getByText(/veja "Não enviada\?" acima/)).toBeInTheDocument()
      expect(within(bloco).getByRole('link', { name: 'Abrir WhatsApp' })).toBeInTheDocument()
      expect(within(bloco).getByRole('button', { name: 'Desfazer (não enviei)' })).toBeInTheDocument()
      await userEvent.click(within(bloco).getByRole('button', { name: 'Já enviei' }))
      expect(m.confirmarEnvio).toHaveBeenCalledWith(5)
      expect(m.prepararCotacoes).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pronta com sinal (link aberto, ou que substituiu outra versão) não está em "Não enviada?" e aceita Nova versão e Obrigado', async () => {
    comViva({ status: 'pronta', primeiro_acesso: SEG_15H, ultimo_acesso: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    const secao = await cartao(7)
    expect(screen.queryByTestId('nao-enviada-7')).not.toBeInTheDocument()
    expect(within(secao).getByRole('button', { name: 'Nova versão' })).toBeInTheDocument()
    expect(within(secao).getByRole('button', { name: 'Obrigado, desta vez não' })).toBeInTheDocument()
  })

  it('v2 pronta que substituiu a v1 conta como enviada', async () => {
    comViva({ status: 'pronta', versao: 2 }, [{ nome: 'AGUA MINERAL 500ML' }])
    banco.cotacoes.push(cotacao({ id: 6, status: 'substituida', substituida_por: 7, ...PREPARADA }))
    render(<Cotacoes />)
    await cartao(7)
    expect(screen.queryByTestId('nao-enviada-7')).not.toBeInTheDocument()
  })

  it('v2 de semana anterior que substituiu a v1 (sem "Já enviei") conta como enviada: sem "Não enviada?", com Obrigado e o "substitui a v1"', async () => {
    comRascunho()
    // sexta: Nova versão (prazo novo) de uma v1 sem resposta, sem tocar "Já enviei"; a semana nova aprovada na segunda
    banco.anteriores = [
      cotacao({ id: 5, semana_id: 2, versao: 2, status: 'pronta', ...PREPARADA }),
      cotacao({ id: 4, semana_id: 2, versao: 1, status: 'substituida', substituida_por: 5, ...PREPARADA }),
    ]
    banco.itens.push(itemCotacao({ id: 300, cotacao_id: 5, numero: 1, produto_id: 80, nome: 'OVO' }))
    banco.codigos = { 5: CODIGO }
    render(<Cotacoes />)
    const antiga = await cartao(5)
    expect(m.cotacoesSubstituidasPor).toHaveBeenCalledWith([5])
    expect(screen.queryByTestId('nao-enviada-5')).not.toBeInTheDocument()
    expect(antiga).not.toHaveTextContent('sem sinal de envio')
    expect(within(antiga).getByRole('button', { name: 'Obrigado, desta vez não' })).toBeInTheDocument()
    const abrir = within(antiga).getByRole('link', { name: 'Abrir o WhatsApp de novo' })
    expect(textoDoLink(abrir)).toContain('Cotação v2 — substitui a v1; números iguais, itens novos no fim · Obrigado!')
    expect(textoDoLink(abrir)).toContain(`#c=${CODIGO}`)
  })

  it('Sem vendedor: motivo e "Pedir a:"', async () => {
    comRascunho()
    banco.preparo.sem_vendedor = [{ item_semana_id: 150, produto_id: 50, produto: 'ALHO - INSUMOS (KG)', nome: 'ALHO', unidade: 'kg', qtd: 2, motivo: 'nunca_comprado', fornecedor: null, vendedor_id: null }]
    render(<Cotacoes />)
    const bloco = await screen.findByTestId('sem-vendedor-50')
    expect(bloco).toHaveTextContent('2 kg · nunca comprado')
    await userEvent.selectOptions(within(bloco).getByRole('combobox', { name: 'Pedir ALHO a' }), '1')
    expect(m.definirVendedor).toHaveBeenCalledWith(50, 1)
  })

  it('Fora da cotação já enviada: "Gerar v2 para FORNECEDOR A incluindo"', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    banco.preparo.fora_da_enviada = [{ vendedor_id: 1, cotacao_id: 7, item_semana_id: 160, produto_id: 60, nome: 'OVO', unidade: 'un', qtd: 30 }]
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar v2 para FORNECEDOR A incluindo' }))
    expect(m.novaVersao).toHaveBeenCalledWith(7)
  })

  it('Da semana anterior: "Já em cotação … (v1, fecha ter 13/10 17h)" e "Pedido com … na semana anterior"; a cotação antiga aparece com as ações dela', async () => {
    comRascunho()
    banco.anteriores = [cotacao({ id: 5, semana_id: 2, status: 'enviada', enviada_em: '2026-10-09T18:00:00Z', prazo: '2026-10-13T15:00:00Z', fechamento: '2026-10-13T20:00:00Z', congelada_em: '2026-10-09T18:00:00Z' })]
    banco.itens.push(itemCotacao({ id: 300, cotacao_id: 5, numero: 1, produto_id: 80, nome: 'OVO' }))
    banco.preparo.atravessados = [
      { item_semana_id: 180, produto_id: 80, nome: 'OVO', vendedor_id: 1, cotacao_id: 5, semana_id: 2, estado: 'em_cotacao' },
      { item_semana_id: 181, produto_id: 81, nome: 'LIMAO', vendedor_id: 1, cotacao_id: 4, semana_id: 2, estado: 'pedido' },
    ]
    render(<Cotacoes />)
    expect(await screen.findByTestId('atravessado-80')).toHaveTextContent('Já em cotação da semana anterior com FORNECEDOR A (v1, fecha ter 13/10 17h)')
    expect(screen.getByTestId('atravessado-81')).toHaveTextContent('Pedido com FORNECEDOR A na semana anterior')
    const antiga = await cartao(5)
    expect(within(antiga).getByRole('button', { name: 'Obrigado, desta vez não' })).toBeInTheDocument()
    // Nova versão só na semana em compra
    expect(within(antiga).queryByRole('button', { name: /Nova versão/ })).not.toBeInTheDocument()
  })
})

describe('Cotações — cartão com resposta', () => {
  it('linha de condições, coluna Marca, nota, Δ% com cores e texto do vendedor como texto', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2, gerais_rev: 1, gerais_origem: 'vendedor',
      pagamento: 'boleto 28 d', pedido_minimo: 300, frete: 30, entrega: '1 dia', validade: '2026-10-21', observacao: '<script>alert(1)</script>' }, [
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', estado: 'tem', preco_digitado: 18.5, base: 'kg', preco_convertido: 18.5, ref_preco: 15.68, delta: 0.1798, marca_informada: 'Marca A', origem: 'vendedor', nota_vendedor: 'pote 3 kg' },
      { nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', estado: 'tem', preco_digitado: 3, base: 'kg', preco_convertido: 3, ref_preco: 4, delta: -0.25, origem: 'ivan_colou' },
    ])
    banco.resumos = [resumo({ itens: 2, respondidos: 2, tem: 2, gerais_respondidas: true })]
    render(<Cotacoes />)
    expect(await screen.findByTestId('condicoes')).toHaveTextContent('boleto 28 d · mín. R$ 300,00 · frete R$ 30,00 · entrega 1 dia · válido até qua 21/10')
    expect(screen.getByRole('columnheader', { name: 'Marca' })).toBeInTheDocument()
    const l1 = screen.getByTestId('item-1')
    expect(within(l1).getByText('Marca A')).toBeInTheDocument()
    expect(within(l1).getByText('Nota: pote 3 kg')).toBeInTheDocument()
    expect(within(l1).getByText('+18%')).toHaveClass('sobe')
    expect(within(screen.getByTestId('item-2')).getByText('−25%')).toHaveClass('desce')
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText(/2 de 2 respondidos/)).toBeInTheDocument()
  })

  it('Colar resposta: lê por número, mostra "11 de 13" e "item 20 não está na v2", e só grava depois da conferência', async () => {
    const nomes = ['AGUA', 'REFRIGERANTE', 'GELO', 'FERMENTO', 'LEITE', 'MOSTARDA', 'LIMAO', 'OVO', 'CEBOLA', 'VINAGRE', 'ACUCAR', 'GUARDANAPO', 'PAO']
    comViva({ status: 'enviada', enviada_em: SEG_15H, versao: 2 }, nomes.map((nome) => ({ nome })))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    const colagem = [
      '[05/10, 09:14] Fulano: bom dia',
      // as linhas da lista como a mensagem mandou (60 un = a quantidade dos itens), com o preço no fim
      ...Array.from({ length: 11 }, (_, k) => `${11 - k}. ${nomes[10 - k]} – 60 un – R$ ${k + 1},00`),
      'item 20 - 5,00',
    ].join('\n')
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste(colagem)
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    expect(screen.getByTestId('contagem')).toHaveTextContent('11 de 13 itens reconhecidos; linhas não entendidas:')
    expect(screen.getByText('item 20 não está na v2')).toBeInTheDocument()
    expect(screen.getByText('bom dia')).toBeInTheDocument()
    // a conferência mostra a linha colada de cada item ao lado do que foi lido
    expect(screen.getByRole('columnheader', { name: 'Linha' })).toBeInTheDocument()
    expect(screen.getByTestId('linha-colada-3')).toHaveTextContent('3. GELO – 60 un – R$ 9,00')
    expect(m.responderComoAdmin).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 11 itens' }))
    expect(m.responderComoAdmin).toHaveBeenCalledTimes(1)
    const [id, envio, itens, gerais, origem] = m.responderComoAdmin.mock.calls[0]
    expect([id, typeof envio, gerais, origem]).toEqual([7, 'string', null, 'ivan_colou'])
    expect(itens.map((i) => [i.numero, i.preco, i.base])).toEqual(Array.from({ length: 11 }, (_, k) => [k + 1, 11 - k, 'un']))
  })

  /** item 9 respondido pelo link às 15h com "tem só", "a partir de" e marca; item 2 sem resposta */
  const RESPONDIDO_PELO_LINK: Partial<ItemCotacao>[] = [
    { numero: 2, nome: 'AGUA MINERAL 500ML' },
    { numero: 9, nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', qtd: 5, ref_preco: 3, estado: 'tem', preco_digitado: 3.2, base: 'kg',
      preco_convertido: 3.2, tenho_so: 3, a_partir_de: 10, marca_informada: 'Marca X', origem: 'vendedor',
      respondido_em: '2026-10-19T18:00:00Z', rev: 2 },
  ]

  it('Colar resposta por cima da resposta do link: "Antes" mostra ela inteira e o item só grava com "substituir" marcado', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, RESPONDIDO_PELO_LINK)
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('[05/10, 09:14] Fulano: 9 - 3,20')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    const linha = screen.getByTestId('colar-item-9')
    // o "Antes" traz o que o Gravar apagaria e de onde/quando veio; a Linha, a hora da mensagem colada
    expect(within(linha).getByTestId('antes-9')).toHaveTextContent('R$ 3,20 o kg · tem só 3 kg · preço a partir de 10 kg · marca Marca X · pelo link às 15h')
    expect(within(linha).getByTestId('linha-colada-9')).toHaveTextContent('[05/10, 09:14] 9 - 3,20')
    expect(within(linha).getByText('substitui a resposta do link')).toBeInTheDocument()
    expect(screen.getByTestId('aviso-substituir')).toHaveTextContent('Um item já tem resposta pelo link')
    expect(screen.getByRole('button', { name: 'Gravar 0 itens' })).toBeDisabled()
    await userEvent.click(within(linha).getByRole('checkbox', { name: 'Substituir a resposta gravada do item 9' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String), [expect.objectContaining({ numero: 9, rev_lida: 2, preco: 3.2 })], null, 'ivan_colou')
  })

  it('Colar resposta: sem "substituir", o item com resposta do link fica fora do envio e os outros gravam', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, RESPONDIDO_PELO_LINK)
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('2 - 2,50\n9 - 3,20')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    expect(screen.getByTestId('contagem')).toHaveTextContent('2 de 2 itens reconhecidos')
    // o item sem resposta não tem o que substituir
    expect(within(screen.getByTestId('colar-item-2')).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('antes-2')).toHaveTextContent(/^$/)
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    expect(m.responderComoAdmin).toHaveBeenCalledTimes(1)
    expect(m.responderComoAdmin.mock.calls[0][2].map((e) => e.numero)).toEqual([2])
  })

  it('Colar resposta: "tem só", "a partir de", similar ou marca digitados pelo Ivan também pedem "substituir"; o colado antes, não', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2 }, [
      { numero: 1, nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2.4, base: 'un', preco_convertido: 2.4, origem: 'ivan_colou',
        respondido_em: '2026-10-19T17:30:00Z', rev: 1 },
      { numero: 2, nome: 'OVO', estado: 'nao_tem', similar_desc: 'ovo vermelho', similar_preco: 0.9, origem: 'ivan_digitou',
        respondido_em: '2026-10-19T17:40:00Z', rev: 1 },
    ])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('1 - 2,50\n2 - 0,80')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    expect(screen.getByTestId('antes-1')).toHaveTextContent('R$ 2,40 a un · colado às 14h30')
    expect(within(screen.getByTestId('colar-item-1')).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('antes-2')).toHaveTextContent('não tem · similar: ovo vermelho a R$ 0,90 · digitado às 14h40')
    expect(within(screen.getByTestId('colar-item-2')).getByText('substitui a resposta gravada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    expect(m.responderComoAdmin.mock.calls[0][2].map((e) => e.numero)).toEqual([1])
  })

  it('Colar resposta: a resposta que chega pelo link depois do Ler (releitura de 30 s) também sai do Gravar até marcar "substituir"', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ numero: 9, nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', qtd: 5 }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('9 - 3,20')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    expect(screen.getByRole('button', { name: 'Gravar 1 item' })).toBeEnabled()
    banco.itens = banco.itens.map((i) => ({ ...i, estado: 'tem' as const, preco_digitado: 3.5, base: 'kg' as const, preco_convertido: 3.5,
      tenho_so: 2, origem: 'vendedor' as const, respondido_em: SEG_15H, rev: 1 }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByRole('button', { name: 'Gravar 0 itens' })).toBeDisabled()
    expect(screen.getByTestId('antes-9')).toHaveTextContent('R$ 3,50 o kg · tem só 2 kg · pelo link às 15h10')
  })

  it('Digitar preços: grava com origem ivan_digitou, com a Marca', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML', rev: 3 }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Digitar preços' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Resposta do item 1' }), 'tem')
    await userEvent.type(screen.getByRole('textbox', { name: 'Preço do item 1' }), '2,50')
    await userEvent.type(screen.getByRole('textbox', { name: 'Marca do item 1' }), 'Marca A')
    await userEvent.click(screen.getByRole('button', { name: 'Gravar preços digitados' }))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String), [expect.objectContaining({
      numero: 1, rev_lida: 3, estado: 'tem', preco: 2.5, base: 'un', marca: 'Marca A',
    })], null, 'ivan_digitou')
  })

  it('Digitar preços: a releitura com o formulário aberto não muda a base; o que o vendedor mandou no meio não é apagado', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [
      { nome: 'AGUA MINERAL 500ML' }, { nome: 'OVO', qtd: 30 }, { nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', qtd: 5 },
    ])
    m.responderComoAdmin.mockResolvedValue({ ok: true, reenvio: false, recebido_em: SEG_15H, gerais: null, itens: [
      { numero: 1, resultado: 'gravado', rev: 1, erro: null, avisos_vendedor: [], valor_atual: null },
      { numero: 3, resultado: 'conflito', rev: 1, erro: null, avisos_vendedor: [],
        valor_atual: { estado: 'tem', preco_digitado: 3, base: 'kg', emb_unidades: null, emb_gramas: null, emb_ml: null, preco_convertido: 3, tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null, marca_informada: null, confirmado_pelo_vendedor: false, avisos_vendedor: [] } },
    ] })
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Digitar preços' }))
    // com o formulário aberto, o vendedor responde os itens 2 e 3 e as condições pelo link, e a aba relê (30 s)
    banco.itens = banco.itens.map((i) => (i.numero === 2 || i.numero === 3
      ? { ...i, estado: 'tem', preco_digitado: 3, base: i.unidade, preco_convertido: 3, origem: 'vendedor', rev: 1 } : i))
    mudarCot(7, { status: 'respondida', respostas_rev: 2, gerais_rev: 1, gerais_origem: 'vendedor', pagamento: 'Pix' })
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByTestId('condicoes')).toHaveTextContent('Pix')
    // o formulário continua com o que foi aberto; o Ivan digita os itens 1 e 3 e não mexe no 2 nem nas condições
    const form = screen.getByTestId('digitar-precos')
    expect(within(form).getByRole('combobox', { name: 'Resposta do item 2' })).toHaveValue('sem_resposta')
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Resposta do item 1' }), 'tem')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Preço do item 1' }), '2,50')
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Resposta do item 3' }), 'tem')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Preço do item 3' }), '4')
    await userEvent.click(within(form).getByRole('button', { name: 'Gravar preços digitados' }))
    // o item 2 não vai (nada mudou na tela) e o 3 vai com o rev da abertura: o banco acusa o conflito, nada se apaga
    const [, , itens, gerais] = m.responderComoAdmin.mock.calls[0]
    expect(itens.map((i) => [i.numero, i.rev_lida, i.estado, i.preco])).toEqual([[1, 0, 'tem', 2.5], [3, 0, 'tem', 4]])
    expect(gerais).toBeNull()
    expect(await screen.findByTestId('resultado')).toHaveTextContent('item 3: mudou antes de gravar (agora R$ 3,00')
  })

  it('Digitar preços: condições que o vendedor mandou com o formulário aberto vão com o gerais_rev da abertura', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H, gerais_rev: 0 }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Digitar preços' }))
    mudarCot(7, { gerais_rev: 1, gerais_origem: 'vendedor', pagamento: 'Pix' })
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByTestId('condicoes')).toHaveTextContent('Pix')
    const form = screen.getByTestId('digitar-precos')
    expect(within(form).getByRole('textbox', { name: 'Pagamento' })).toHaveValue('')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Entrega' }), 'amanhã')
    await userEvent.click(within(form).getByRole('button', { name: 'Gravar preços digitados' }))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String), [], {
      rev_lida: 0, pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: 'amanhã', observacao: null,
    }, 'ivan_digitou')
  })

  it('Trocar link: mensagem do link novo com Copiar link, e "Limpar respostas do link antigo" só com o que o Ivan marcar', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 3, gerais_rev: 2, gerais_origem: 'vendedor', pagamento: 'Pix' }, [
      { nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2, base: 'un', preco_convertido: 2, origem: 'vendedor', rev: 1, respondido_em: '2026-10-19T18:42:00Z' },
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', estado: 'tem', preco_digitado: 1, base: 'kg', preco_convertido: 1, origem: 'vendedor', rev: 4, respondido_em: '2026-10-19T18:50:00Z' },
      { nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', estado: 'tem', preco_digitado: 3, base: 'kg', preco_convertido: 3, origem: 'ivan_colou', rev: 1 },
    ])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar link' }))
    expect(m.trocarCodigo).toHaveBeenCalledWith(7)
    const novo = await screen.findByTestId('link-novo')
    expect(novo).toHaveTextContent(`Fulano, o link da cotação mudou. Use este: ${linkCotacao(CODIGO_NOVO)}. O anterior não vale mais.`)
    fireEvent.click(within(novo).getByRole('button', { name: 'Copiar link' }))
    expect(writeText).toHaveBeenCalledWith(linkCotacao(CODIGO_NOVO))

    const limpar = screen.getByTestId('limpar-respostas')
    expect(limpar).toHaveTextContent('Se o link antigo foi usado por outra pessoa, marque as respostas que não são do vendedor e limpe')
    expect(within(limpar).getByRole('checkbox', { name: 'Limpar item 1' })).not.toBeChecked()
    expect(within(limpar).getByRole('checkbox', { name: 'Limpar item 2' })).not.toBeChecked()
    expect(within(limpar).queryByRole('checkbox', { name: 'Limpar item 3' })).not.toBeInTheDocument() // veio colado pelo Ivan
    expect(within(limpar).getByRole('button', { name: 'Limpar respostas do link antigo' })).toBeDisabled()
    await userEvent.click(within(limpar).getByRole('checkbox', { name: 'Limpar item 2' }))
    await userEvent.click(within(limpar).getByRole('button', { name: 'Limpar respostas do link antigo' }))
    expect(m.responderComoAdmin).toHaveBeenLastCalledWith(7, expect.any(String), [{ numero: 2, rev_lida: 4, estado: 'sem_resposta' }], null, 'ivan_digitou')

    await userEvent.click(within(screen.getByTestId('limpar-respostas')).getByRole('checkbox', { name: 'Limpar condições gerais' }))
    await userEvent.click(within(screen.getByTestId('limpar-respostas')).getByRole('button', { name: 'Limpar respostas do link antigo' }))
    expect(m.responderComoAdmin).toHaveBeenLastCalledWith(7, expect.any(String), [], {
      rev_lida: 2, pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null,
    }, 'ivan_digitou')
    // cada limpeza é um envio novo (o mesmo envio_id devolveria o resultado anterior)
    expect(m.responderComoAdmin.mock.calls[0][1]).not.toBe(m.responderComoAdmin.mock.calls[1][1])
  })

  it('Limpar: conflito (o vendedor mandou de novo) aparece como no Digitar preços', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [
      { nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2, base: 'un', preco_convertido: 2, origem: 'vendedor', rev: 1 },
    ])
    m.responderComoAdmin.mockResolvedValue({ ok: true, reenvio: false, recebido_em: SEG_15H, gerais: null, itens: [{
      numero: 1, resultado: 'conflito', rev: 2, erro: null, avisos_vendedor: [],
      valor_atual: { estado: 'tem', preco_digitado: 3, base: 'un', emb_unidades: null, emb_gramas: null, emb_ml: null, preco_convertido: 3, tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null, marca_informada: null, confirmado_pelo_vendedor: false, avisos_vendedor: [] },
    }] })
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar link' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Limpar item 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Limpar respostas do link antigo' }))
    expect(await screen.findByTestId('resultado')).toHaveTextContent('item 1: mudou antes de gravar (agora R$ 3,00 a un)')
    await waitFor(() => expect(m.prepararCotacoes).toHaveBeenCalledTimes(3)) // abrir, trocar link, limpar
  })

  it('Limpar: o que o vendedor mandou pelo link novo depois da marca vai com o rev de quando o Ivan marcou (vira conflito, não some)', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1, gerais_rev: 1, gerais_origem: 'vendedor', pagamento: 'Pix' }, [
      { nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2, base: 'un', preco_convertido: 2, origem: 'vendedor', rev: 1 },
    ])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar link' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Limpar item 1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Limpar condições gerais' }))
    // o vendedor responde pelo link novo com a caixa marcada, e a aba relê (30 s)
    banco.itens = banco.itens.map((i) => ({ ...i, preco_digitado: 3, preco_convertido: 3, rev: 2 }))
    mudarCot(7, { gerais_rev: 2, pagamento: 'boleto 28 d' })
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByTestId('condicoes')).toHaveTextContent('boleto 28 d')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar respostas do link antigo' }))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String), [{ numero: 1, rev_lida: 1, estado: 'sem_resposta' }], {
      rev_lida: 1, pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null,
    }, 'ivan_digitou')
  })

  it('Limpar: nova tentativa sem mudança repete o envio_id; marcar outra coisa gera um novo', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2 }, [
      { nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2, base: 'un', preco_convertido: 2, origem: 'vendedor', rev: 1 },
      { nome: 'OVO', estado: 'tem', preco_digitado: 1, base: 'un', preco_convertido: 1, origem: 'vendedor', rev: 1 },
    ])
    m.responderComoAdmin.mockRejectedValueOnce(new Error('sem rede')).mockRejectedValueOnce(new Error('sem rede'))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar link' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Limpar item 1' }))
    const botao = screen.getByRole('button', { name: 'Limpar respostas do link antigo' })
    await userEvent.click(botao)
    await waitFor(() => expect(botao).toBeEnabled())
    await userEvent.click(botao)
    await waitFor(() => expect(botao).toBeEnabled())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Limpar item 2' }))
    await userEvent.click(botao)
    const ids = m.responderComoAdmin.mock.calls.map((x) => x[1])
    expect(ids).toHaveLength(3)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('Digitar preços: nova tentativa sem mudança repete o envio_id; depois de corrigir um preço, envio_id novo', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    // o Gravar chega ao banco, mas a resposta se perde (rede do celular): o formulário continua aberto
    m.responderComoAdmin.mockRejectedValueOnce(new Error('sem rede')).mockRejectedValueOnce(new Error('sem rede'))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Digitar preços' }))
    const form = screen.getByTestId('digitar-precos')
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Resposta do item 1' }), 'tem')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Preço do item 1' }), '2,50')
    const gravar = within(form).getByRole('button', { name: 'Gravar preços digitados' })
    await userEvent.click(gravar)
    await waitFor(() => expect(gravar).toBeEnabled())
    await userEvent.click(gravar)
    await waitFor(() => expect(gravar).toBeEnabled())
    const preco = within(form).getByRole('textbox', { name: 'Preço do item 1' })
    await userEvent.clear(preco)
    await userEvent.type(preco, '2,60')
    await userEvent.click(gravar)
    const chamadas = m.responderComoAdmin.mock.calls
    expect(chamadas.map((x) => x[2][0].preco)).toEqual([2.5, 2.5, 2.6])
    expect(chamadas[1][1]).toBe(chamadas[0][1])
    expect(chamadas[2][1]).not.toBe(chamadas[0][1])
  })

  it('Colar resposta: nova tentativa sem mudança repete o envio_id; um Ler com outro texto gera um novo', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    m.responderComoAdmin.mockRejectedValueOnce(new Error('sem rede')).mockRejectedValueOnce(new Error('sem rede'))
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    const caixa = screen.getByRole('textbox', { name: 'Resposta colada' })
    await userEvent.click(caixa)
    await userEvent.paste('1 - 2,50')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gravar 1 item' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gravar 1 item' })).toBeEnabled())
    await userEvent.clear(caixa)
    await userEvent.paste('1 - 2,60')
    await userEvent.click(screen.getByRole('button', { name: 'Ler' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    const chamadas = m.responderComoAdmin.mock.calls
    expect(chamadas.map((x) => x[2][0].preco)).toEqual([2.5, 2.5, 2.6])
    expect(chamadas[1][1]).toBe(chamadas[0][1])
    expect(chamadas[2][1]).not.toBe(chamadas[0][1])
  })

  it('recém-preparada: sem "Trocar link" (a mensagem na tela leva o código do Preparar); ele volta depois do "Já enviei"', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))
    expect(within(await cartao(7)).queryByRole('button', { name: 'Trocar link' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Já enviei' }))
    expect(await within(await cartao(7)).findByRole('button', { name: 'Trocar link' })).toBeInTheDocument()
    expect(m.trocarCodigo).not.toHaveBeenCalled()
  })

  it('Trocar link, Desfazer e Preparar de novo: a mensagem do link novo (já morto) sai da tela', async () => {
    comViva({ status: 'pronta' }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    await userEvent.click(within(await cartao(7)).getByRole('button', { name: 'Trocar link' }))
    expect(await screen.findByTestId('link-novo')).toBeInTheDocument()
    await userEvent.click(within(await screen.findByTestId('nao-enviada-7')).getByRole('button', { name: 'Desfazer (não enviei)' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    expect(await screen.findByRole('link', { name: 'Abrir WhatsApp' })).toBeInTheDocument()
    expect(screen.queryByTestId('link-novo')).not.toBeInTheDocument()
  })

  it('preparada aqui e refeita em outro aparelho (Trocar link lá): a mensagem daqui, com o link morto, sai da tela', async () => {
    comRascunho()
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    expect(textoDoLink(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))).toContain(`#c=${CODIGO}`)
    // no PC, o Ivan tocou Trocar link (ou Desfazer e Preparar de novo): o código no banco mudou
    banco.codigos = { 7: CODIGO_NOVO }
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByTestId('refeita')).toHaveTextContent(
      'A mensagem foi refeita em outro aparelho: a que estava aqui leva um link que não vale mais. Use a de "Não enviada?", acima.')
    expect(screen.queryByTestId('envio')).not.toBeInTheDocument()
    // nenhum link da tela leva o código velho; o "Não enviada?" oferece a mensagem com o código relido
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).not.toContain(CODIGO)
    const bloco = await screen.findByTestId('nao-enviada-7')
    expect(textoDoLink(within(bloco).getByRole('link', { name: 'Abrir WhatsApp' }))).toContain(`#c=${CODIGO_NOVO}`)
    // um Trocar link feito aqui tira de vez a mensagem velha (e o aviso dela)
    await userEvent.click(within(await cartao(7)).getByRole('button', { name: 'Trocar link' }))
    expect(await screen.findByTestId('link-novo')).toBeInTheDocument()
    expect(screen.queryByTestId('refeita')).not.toBeInTheDocument()
  })

  it('v2 preparada aqui que substituiu a v1: sem "Desfazer (não enviei)" (o banco recusa), com o caminho da Nova versão', async () => {
    banco.cotacoes = [
      cotacao({ id: 7, versao: 2, status: 'rascunho' }),
      cotacao({ id: 6, versao: 1, status: 'enviada', enviada_em: SEG_15H, ...PREPARADA }),
    ]
    banco.itens = [
      itemCotacao({ id: 100, cotacao_id: 7, numero: null, nome: 'AGUA MINERAL 500ML' }),
      itemCotacao({ id: 90, cotacao_id: 6, numero: 1, nome: 'AGUA MINERAL 500ML' }),
    ]
    banco.codigos = { 6: CODIGO }
    banco.preparo = preparo({ agora: SEG_15H, cartoes: [{ vendedor_id: 1, itens: 1, estimado: 150, cotacoes: [7, 6] }] })
    m.congelarCotacao.mockImplementation(async (id) => {
      mudarCot(id, { status: 'pronta', ...PREPARADA })
      mudarCot(6, { status: 'substituida', substituida_por: id })
      banco.itens = banco.itens.map((i) => (i.cotacao_id === id ? { ...i, numero: 1 } : i))
      banco.codigos = { [id]: CODIGO_NOVO }
      return dadosEnvioDe(cotDe(id), banco.itens, FULANO, CODIGO_NOVO, { data_referencia: SEMANA.data_referencia, substitui_versao: 1 })
    })
    m.abrirComoVendedor.mockImplementation(async () => ({
      ok: true, estado: 'aberta', texto: null, itens: banco.itens.filter((i) => i.cotacao_id === 7),
    }) as never)
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Abrir WhatsApp' }))
    const secao = await cartao(7)
    expect(await within(secao).findByText('Enviou no WhatsApp?')).toBeInTheDocument()
    expect(within(secao).queryByRole('button', { name: 'Desfazer (não enviei)' })).not.toBeInTheDocument()
    expect(within(secao).getByTestId('sem-desfazer')).toHaveTextContent('Esta versão já substituiu a v1: para mudar, use Nova versão.')
    expect(within(secao).getByRole('button', { name: 'Nova versão' })).toBeInTheDocument()
    // o Cancelar avisa que o link da v1 também morre e aponta a Nova versão
    vi.mocked(window.confirm).mockReturnValue(false)
    await userEvent.click(within(secao).getByRole('button', { name: 'Cancelar cotação' }))
    expect(window.confirm).toHaveBeenLastCalledWith('Cancelar a cotação v2 de FORNECEDOR A? O link deixa de abrir a lista (e o da v1, que o vendedor já tem, também).'
      + '\n\nPara mudar os itens, use Nova versão.\n\nCancelar assim mesmo?')
    expect(m.cancelarCotacao).not.toHaveBeenCalled()
  })

  it('v2 que substituiu a v1 com a checagem do link falhando: sem "Desfazer (não enviei)"', async () => {
    banco.cotacoes = [
      cotacao({ id: 7, versao: 2, status: 'rascunho' }),
      cotacao({ id: 6, versao: 1, status: 'enviada', enviada_em: SEG_15H, ...PREPARADA }),
    ]
    banco.itens = [itemCotacao({ id: 100, cotacao_id: 7, numero: null }), itemCotacao({ id: 90, cotacao_id: 6, numero: 1 })]
    banco.preparo = preparo({ agora: SEG_15H, cartoes: [{ vendedor_id: 1, itens: 1, estimado: 150, cotacoes: [7, 6] }] })
    m.congelarCotacao.mockImplementation(async (id) => {
      mudarCot(id, { status: 'pronta', ...PREPARADA })
      mudarCot(6, { status: 'substituida', substituida_por: id })
      banco.codigos = { [id]: CODIGO_NOVO }
      return dadosEnvioDe(cotDe(id), banco.itens, FULANO, CODIGO_NOVO, { substitui_versao: 1 })
    })
    m.abrirComoVendedor.mockResolvedValue({ ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' })
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar mensagem para Fulano' }))
    expect(await screen.findByText(/A checagem do link falhou/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checar o link de novo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desfazer (não enviei)' })).not.toBeInTheDocument()
    expect(screen.getByTestId('sem-desfazer')).toHaveTextContent('Esta versão já substituiu a v1: para mudar, use Nova versão.')
  })

  it('Cancelar cotação com respostas: diz que elas somem e que não dá mais para fazer pedido com elas; aponta a Nova versão', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H }, [
      { nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2.5, base: 'un', preco_convertido: 2.5 },
      { nome: 'OVO', estado: 'tem', preco_digitado: 0.8, base: 'un', preco_convertido: 0.8 },
      { nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', estado: 'nao_tem' },
    ])
    banco.resumos = [resumo({ itens: 3, respondidos: 3, tem: 2, nao_tem: 1 })]
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar cotação' }))
    expect(window.confirm).toHaveBeenCalledWith('Cancelar a cotação v1 de FORNECEDOR A? O link deixa de abrir a lista.'
      + '\n\nAs 3 respostas desta cotação somem da tela e não dá mais para fazer pedido com elas. '
      + 'Para mudar os itens sem perder as respostas, use Nova versão.\n\nCancelar assim mesmo?')
    expect(m.cancelarCotacao).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar cotação' }))
    expect(m.cancelarCotacao).toHaveBeenCalledWith(7)
  })

  it('Obrigado, desta vez não: grava e oferece a mensagem 10.4 (Copiar mensagem, sem Copiar link)', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Obrigado, desta vez não' }))
    expect(m.dispensarCotacao).toHaveBeenCalledWith(7)
    const bloco = await screen.findByTestId('obrigado')
    expect(textoDoLink(within(bloco).getByRole('link', { name: 'Abrir WhatsApp com o agradecimento' }))).toBe(mensagemObrigado('Fulano'))
    expect(within(bloco).getByRole('button', { name: 'Copiar mensagem' })).toBeInTheDocument()
    expect(within(bloco).queryByRole('button', { name: 'Copiar link' })).not.toBeInTheDocument()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('cotação da semana anterior: depois do "Obrigado" ela sai das vivas, mas o link do agradecimento continua na tela', async () => {
    comRascunho()
    banco.anteriores = [cotacao({ id: 5, semana_id: 2, status: 'enviada', enviada_em: '2026-10-09T18:00:00Z', prazo: '2026-10-13T15:00:00Z', fechamento: '2026-10-13T20:00:00Z' })]
    banco.itens.push(itemCotacao({ id: 300, cotacao_id: 5, numero: 1, produto_id: 80, nome: 'OVO' }))
    render(<Cotacoes />)
    await userEvent.click(within(await cartao(5)).getByRole('button', { name: 'Obrigado, desta vez não' }))
    expect(m.dispensarCotacao).toHaveBeenCalledWith(5)
    const bloco = await screen.findByTestId('obrigado')
    expect(within(bloco).getByRole('link', { name: 'Abrir WhatsApp com o agradecimento' })).toBeInTheDocument()
    expect(m.cotacoesDaSemana).toHaveBeenCalledWith(2) // relida pela semana dela
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(m.prepararCotacoes).toHaveBeenCalledTimes(3))
    expect(screen.getByTestId('obrigado')).toBeInTheDocument()
  })

  /** Pedido confirmado com o Fulano (a mensagem 10.3 ainda na tela), à espera do "Pode confirmar?" dele. */
  function comPedido() {
    comViva({ status: 'fechada', resultado: 'pedido', enviada_em: SEG_15H, respostas_rev: 1, fechada_em: '2026-10-20T13:00:00Z' },
      [{ nome: 'AGUA MINERAL 500ML', estado: 'tem', preco_digitado: 2.5, base: 'un', preco_convertido: 2.5 }])
    banco.pedidos[7] = { cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-10-20T13:00:00Z',
      itens: [{ produto_id: 10, numero: 1, embalagens: null, fator: null, qtd: 600, preco_combinado: 2.5, base: 'un', preco_convertido: 2.5, marca: null }] }
    // como o banco (D67): antes do fechamento volta a respondida, sem resultado e sem pedido
    m.desfazerPedido.mockImplementation(async (id) => {
      mudarCot(id, { status: 'respondida', resultado: null, fechada_em: null })
      delete banco.pedidos[id]
    })
  }
  const DESFAZER_PEDIDO = 'O vendedor não confirmou — desfazer pedido'

  it('pedido confirmado: "O vendedor não confirmou — desfazer pedido" pergunta, desfaz e a cotação volta com Confirmar pedido e Obrigado', async () => {
    comPedido()
    render(<Cotacoes />)
    const cot = await cartao(7)
    expect(within(cot).getByTestId('mensagem-pedido')).toHaveTextContent('600 un')
    // com o pedido, só a mensagem e o desfazer: nada de Confirmar de novo nem Obrigado
    expect(within(cot).queryByRole('button', { name: 'Confirmar pedido com Fulano' })).not.toBeInTheDocument()
    expect(within(cot).queryByRole('button', { name: 'Obrigado, desta vez não' })).not.toBeInTheDocument()
    await userEvent.click(within(cot).getByRole('button', { name: DESFAZER_PEDIDO }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Desfazer o pedido com Fulano? Use quando ele não confirmou ou a quantidade estava errada.'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Se já mandou o pedido no WhatsApp, avise o Fulano.'))
    expect(m.desfazerPedido).toHaveBeenCalledWith(7)
    await waitFor(() => expect(within(cot).queryByTestId('mensagem-pedido')).not.toBeInTheDocument())
    expect(within(cot).queryByRole('button', { name: DESFAZER_PEDIDO })).not.toBeInTheDocument()
    expect(within(cot).getByRole('button', { name: 'Confirmar pedido com Fulano' })).toBeInTheDocument()
    expect(within(cot).getByRole('button', { name: 'Obrigado, desta vez não' })).toBeInTheDocument()
  })

  it('desfazer pedido: sem o OK na pergunta, nada muda', async () => {
    comPedido()
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<Cotacoes />)
    await userEvent.click(within(await cartao(7)).getByRole('button', { name: DESFAZER_PEDIDO }))
    expect(m.desfazerPedido).not.toHaveBeenCalled()
    expect(screen.getByTestId('mensagem-pedido')).toBeInTheDocument()
  })

  it('desfazer pedido: o erro do banco aparece no cartão (ex.: a complementar já preparada)', async () => {
    comPedido()
    m.desfazerPedido.mockRejectedValue(new Error('há outra cotação em andamento com este vendedor (v2): resolva a v2 antes de desfazer este pedido'))
    render(<Cotacoes />)
    await userEvent.click(within(await cartao(7)).getByRole('button', { name: DESFAZER_PEDIDO }))
    expect(await within(await cartao(7)).findByRole('alert')).toHaveTextContent('há outra cotação em andamento com este vendedor (v2)')
  })

  it('pedido numa cotação de semana anterior: sem o desfazer (o banco só desfaz na semana em compra)', async () => {
    comRascunho()
    banco.anteriores = [cotacao({ id: 5, semana_id: 2, status: 'respondida', enviada_em: '2026-10-09T18:00:00Z', respostas_rev: 1,
      prazo: '2026-10-13T15:00:00Z', fechamento: '2026-10-13T20:00:00Z' })]
    banco.itens.push(itemCotacao({ id: 300, cotacao_id: 5, numero: 1, produto_id: 80, nome: 'OVO', qtd: 30, estado: 'tem',
      preco_digitado: 0.8, base: 'un', preco_convertido: 0.8 }))
    m.gravarPedido.mockImplementation(async (id, itens) => {
      const p: Pedido = { cotacao_id: id, confirmado_por: 'ivan@spazio.com', confirmado_em: SEG_15H,
        itens: itens.map((l) => ({ ...l, produto_id: 80, preco_convertido: l.preco_combinado, marca: null })) }
      mudarCot(id, { status: 'fechada', resultado: 'pedido' })
      banco.pedidos[id] = p
      return p
    })
    render(<Cotacoes />)
    await userEvent.click(within(await cartao(5)).getByRole('button', { name: 'Confirmar pedido com Fulano' }))
    await userEvent.click(within(screen.getByTestId('confirmar-pedido')).getByRole('button', { name: 'Confirmar pedido' }))
    expect(await screen.findByTestId('mensagem-pedido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: DESFAZER_PEDIDO })).not.toBeInTheDocument()
  })

  it('Cancelar cotação pede confirmação', async () => {
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar cotação' }))
    // sem resposta e sem ter substituído outra versão: a pergunta curta de sempre
    expect(window.confirm).toHaveBeenCalledWith('Cancelar a cotação v1 de FORNECEDOR A? O link deixa de abrir a lista.')
    expect(m.cancelarCotacao).toHaveBeenCalledWith(7)
  })
})

describe('Cotações — mapa do pedido', () => {
  /** 7 itens: 2 acima de +10% (ok), 1 não tem, 1 sem resposta, 1 fardo, 1 referência antiga, 1 líquido em caixa de ml com kg por litro. */
  function comMapa(gerais: Partial<Cotacao> = { frete: 30, pedido_minimo: 1000, entrega: 'dia seguinte', pagamento: 'boleto 28 dias' }) {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 6, gerais_rev: 1, ...gerais }, [
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', qtd: 1.2, estado: 'tem', preco_digitado: 18.5, base: 'kg', preco_convertido: 18.5, ref_preco: 15.68, delta: 0.18, marca_informada: 'Marca A' },
      { nome: 'LIMAO SICILIANO', unidade: 'kg', rotulo: 'kg', qtd: 2, estado: 'tem', preco_digitado: 10, base: 'kg', preco_convertido: 10, ref_preco: 8, delta: 0.25 },
      { nome: 'FERMENTO SECO', unidade: 'kg', rotulo: 'kg', qtd: 0.5, estado: 'nao_tem' },
      { nome: 'OVO', qtd: 30 },
      { nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, estado: 'tem', preco_digitado: 42, base: 'embalagem', emb_unidades: 12, preco_convertido: 3.5, ref_preco: 3.4, delta: 0.0294 },
      { nome: 'GENGIBRE', unidade: 'kg', rotulo: 'kg', qtd: 1, estado: 'tem', preco_digitado: 30, base: 'kg', preco_convertido: 30, ref_preco: 20, ref_situacao: 'antiga', ref_data: '2026-03-11', delta: 0.5 },
      { nome: 'LEITE LIQUIDO INTEGRAL', unidade: 'kg', rotulo: 'kg', qtd: 19.9, vende_por_litro: true, kg_por_litro: 1, estado: 'tem', preco_digitado: 6, base: 'embalagem', emb_ml: 1000, preco_convertido: 6, ref_preco: null, ref_situacao: 'sem_referencia' },
    ])
    m.gravarPedido.mockImplementation(async (id, itens) => {
      const p: Pedido = { cotacao_id: id, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-10-21T13:00:00Z',
        itens: itens.map((l) => ({ ...l, produto_id: 10 + l.numero - 1, preco_convertido: l.base === 'embalagem' && l.fator ? l.preco_combinado / l.fator : l.preco_combinado, marca: null })) }
      mudarCot(id, { status: 'fechada', resultado: 'pedido' })
      banco.pedidos[id] = p
      return p
    })
  }
  const abrirMapa = async () => {
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar pedido com Fulano' }))
    return screen.getByTestId('confirmar-pedido')
  }

  it('sugestão só com Δ > +10% e referência ok; não tem e sem resposta fixos em "Comprar na loja"; antiga e sem referência no pedido, em cinza', async () => {
    comMapa()
    const mapa = await abrirMapa()
    expect(within(mapa).getByTestId('sugestao')).toHaveTextContent('Sugestão: deixar 2 itens para a loja (MOSTARDA +18%, LIMAO SICILIANO +25%)')
    expect(within(mapa).getByTestId('sugestao')).toHaveTextContent('FERMENTO SECO: não tem · OVO: sem resposta')
    expect(within(mapa).getByTestId('mapa-3')).toHaveTextContent('Comprar na loja (não tem)')
    expect(within(mapa).getByTestId('mapa-4')).toHaveTextContent('Comprar na loja (sem resposta)')
    expect(within(within(mapa).getByTestId('mapa-3')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(mapa).getByTestId('mapa-6')).toHaveClass('cinza')
    expect(within(mapa).getByTestId('mapa-7')).toHaveClass('cinza')
    expect(within(mapa).getByRole('button', { name: 'Item 6: No pedido' })).toBeInTheDocument()
    expect(within(mapa).getByRole('button', { name: 'Item 7: No pedido' })).toBeInTheDocument()
    expect(within(mapa).getByTestId('mapa-1')).toHaveTextContent('Marca A')
    // itens 22,20 + 20,00 + 378,00 (9 fardos) + 30,00 + 120,00 (20 caixas de 1 L = 1 kg)
    expect(within(mapa).getByTestId('total-pedido')).toHaveTextContent('Itens R$ 570,20 · Frete R$ 30,00 · Total com frete R$ 600,20')
    // o mínimo compara a mercadoria, sem o frete
    expect(within(mapa).getByTestId('aviso-minimo')).toHaveTextContent('Abaixo do mínimo do FORNECEDOR A (R$ 1.000,00): faltam R$ 429,80')
  })

  it('[Aceitar sugestão] passa os sugeridos para a loja; o Ivan pode voltar um; dois toques abaixo do mínimo; só "No pedido" vai ao banco', async () => {
    comMapa()
    const mapa = await abrirMapa()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Aceitar sugestão' }))
    expect(within(mapa).queryByTestId('sugestao')).not.toBeInTheDocument()
    expect(within(mapa).getByRole('button', { name: 'Item 1: Comprar na loja' })).toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Item 2: Comprar na loja' }))
    expect(within(mapa).getByRole('button', { name: 'Item 2: No pedido' })).toBeInTheDocument()
    expect(within(mapa).getByTestId('total-pedido')).toHaveTextContent('Itens R$ 548,00')
    expect(within(mapa).getByTestId('aviso-minimo')).toHaveTextContent('faltam R$ 452,00')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 5' })).toHaveTextContent('108 un no pedido × 104 aprovados')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar mesmo abaixo do mínimo' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [
      { numero: 2, qtd: 2, base: 'kg', embalagens: null, fator: null, preco_combinado: 10 },
      { numero: 5, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco_combinado: 42 },
      { numero: 6, qtd: 1, base: 'kg', embalagens: null, fator: null, preco_combinado: 30 },
      // caixa em ml de item em kg com kg por litro confirmado: fator em kg por caixa (D44)
      { numero: 7, qtd: 20, base: 'embalagem', embalagens: 20, fator: 1, preco_combinado: 6 },
    ])
    // depois de gravar: a mensagem do pedido, com o horário de recebimento, Copiar mensagem e nada de Copiar link
    const bloco = await screen.findByTestId('mensagem-pedido')
    const texto = textoDoLink(within(bloco).getByRole('link', { name: 'Abrir WhatsApp com o pedido' }))
    expect(texto).toContain('Fulano, vamos fechar! PEDIDO Spazio Gourmet (cotação v1):')
    expect(texto).toContain('5. REFRIGERANTE COLA 350 ML – 9 embalagens c/12 (108 un) – R$ 42,00 a embalagem')
    expect(texto).toContain('Total com frete: R$ 578,00 (itens R$ 548,00 + frete R$ 30,00) · Pagamento: boleto 28 dias')
    expect(texto).toContain('Entrega: dia seguinte, seg a sex, 7h–11h e 14h–18h; sáb, 7h–11h e 14h–16h.')
    expect(texto).not.toContain('MOSTARDA')
    expect(within(bloco).getByRole('button', { name: 'Copiar mensagem' })).toBeInTheDocument()
    expect(within(bloco).queryByRole('button', { name: 'Copiar link' })).not.toBeInTheDocument()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('campo Entrega editável vai na mensagem do pedido; acima do mínimo grava no primeiro toque', async () => {
    comMapa({ frete: 0, pedido_minimo: 0, entrega: 'dia seguinte' })
    const mapa = await abrirMapa()
    expect(within(mapa).queryByTestId('aviso-minimo')).not.toBeInTheDocument()
    const entrega = within(mapa).getByRole('textbox', { name: 'Entrega' })
    expect(entrega).toHaveValue('dia seguinte')
    await userEvent.clear(entrega)
    await userEvent.type(entrega, 'qua 21/10')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledTimes(1)
    const texto = textoDoLink(within(await screen.findByTestId('mensagem-pedido')).getByRole('link', { name: 'Abrir WhatsApp com o pedido' }))
    expect(texto).toContain('Total: R$ 570,20 (sem frete)')
    expect(texto).toContain('Entrega: qua 21/10, seg a sex')
  })

  it('quantidade editável com a diferença para o aprovado', async () => {
    comMapa()
    const mapa = await abrirMapa()
    const campo = within(mapa).getByRole('textbox', { name: 'Quantidade do item 5' })
    expect(campo).toHaveValue('9')
    await userEvent.clear(campo)
    await userEvent.type(campo, '10')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 5' })).toHaveTextContent('120 un no pedido × 104 aprovados · R$ 420,00')
  })

  it('quantidade 10 vezes maior (90 fardos no lugar de 9): "Confira a quantidade" na linha e no topo, e segundo toque (D67)', async () => {
    comMapa({ frete: 0, pedido_minimo: 0 })
    const mapa = await abrirMapa()
    const campo = within(mapa).getByRole('textbox', { name: 'Quantidade do item 5' })
    await userEvent.clear(campo)
    await userEvent.type(campo, '90')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 5' })).toHaveTextContent('1.080 un no pedido × 104 aprovados · R$ 3.780,00')
    expect(within(mapa).getByTestId('qtd-alta-5')).toHaveTextContent('Confira a quantidade: mais de 1,5 vez o aprovado (90 embalagens)')
    expect(within(mapa).getByTestId('confira-quantidade'))
      .toHaveTextContent('Confira a quantidade: REFRIGERANTE COLA 350 ML (1.080 un no pedido × 104 aprovados)')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar mesmo assim' }))
    expect(m.gravarPedido).toHaveBeenCalledTimes(1)
    expect(m.gravarPedido.mock.calls[0][1].find((l) => l.numero === 5))
      .toEqual({ numero: 5, qtd: 1080, base: 'embalagem', embalagens: 90, fator: 12, preco_combinado: 42 })
  })

  it('quantidade alta: corrigir para 9 tira o aviso e grava no primeiro toque; outro número depois do primeiro toque pede de novo', async () => {
    comMapa({ frete: 0, pedido_minimo: 0 })
    const mapa = await abrirMapa()
    const campo = within(mapa).getByRole('textbox', { name: 'Quantidade do item 5' })
    await userEvent.clear(campo)
    await userEvent.type(campo, '90')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(within(mapa).getByRole('button', { name: 'Confirmar mesmo assim' })).toBeInTheDocument()
    // o "mesmo assim" era para 90: digitar 900 volta ao primeiro toque
    await userEvent.clear(campo)
    await userEvent.type(campo, '900')
    expect(within(mapa).getByTestId('confira-quantidade')).toHaveTextContent('10.800 un no pedido × 104 aprovados')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    // corrigido para 9 (108 un, as embalagens inteiras que cobrem os 104): sem aviso
    await userEvent.clear(campo)
    await userEvent.type(campo, '9')
    expect(within(mapa).queryByTestId('qtd-alta-5')).not.toBeInTheDocument()
    expect(within(mapa).queryByTestId('confira-quantidade')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledTimes(1)
    expect(m.gravarPedido.mock.calls[0][1].find((l) => l.numero === 5)).toMatchObject({ qtd: 108, embalagens: 9 })
  })

  it('quantidade alta em kg: 12 kg de mostarda com 1,2 kg aprovado pede conferência; arredondar para 2 kg (ou 3) não', async () => {
    comMapa({ frete: 0, pedido_minimo: 0 })
    const mapa = await abrirMapa()
    const campo = within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' })
    await userEvent.clear(campo)
    await userEvent.type(campo, '3')
    expect(within(mapa).queryByTestId('qtd-alta-1')).not.toBeInTheDocument()
    await userEvent.clear(campo)
    await userEvent.type(campo, '12')
    expect(within(mapa).getByTestId('qtd-alta-1')).toHaveTextContent('Confira a quantidade: mais de 1,5 vez o aprovado')
    expect(within(mapa).getByTestId('confira-quantidade')).toHaveTextContent('MOSTARDA (12 kg no pedido × 1,2 aprovados)')
  })

  it('caixa em ml sem kg por litro: o Ivan digita quantas caixas antes de confirmar', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [
      { nome: 'VINAGRE BRANCO', unidade: 'kg', rotulo: 'kg', qtd: 2, vende_por_litro: true, estado: 'tem', preco_digitado: 8, base: 'embalagem', emb_ml: 1000, preco_convertido: null, ref_situacao: 'sem_referencia', ref_preco: null },
    ])
    m.gravarPedido.mockResolvedValue({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [] })
    const mapa = await abrirMapa()
    expect(within(mapa).getByTestId('total-pedido')).toHaveTextContent('Itens R$ 0,00')
    expect(within(mapa).getByText('+ item 1 sem total (falta dizer quantas embalagens)')).toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.type(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' }), '2')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [{ numero: 1, qtd: 2, base: 'embalagem', embalagens: 2, fator: null, preco_combinado: 8 }])
  })

  /** Refrigerante cotado a R$ 3,50 a un (104 un) e mostarda; o vendedor troca o 1 por "R$ 42,00 fardo c/12" com o mapa aberto. */
  async function mapaComMudanca() {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2 }, [
      { nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, estado: 'tem', preco_digitado: 3.5, base: 'un', preco_convertido: 3.5, ref_preco: 3.4, delta: 0.0294, rev: 1 },
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', qtd: 1.2, estado: 'tem', preco_digitado: 18.5, base: 'kg', preco_convertido: 18.5, ref_preco: 18, delta: 0.0278, rev: 1 },
    ])
    m.gravarPedido.mockResolvedValue({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [] })
    const mapa = await abrirMapa()
    expect(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' })).toHaveValue('104')
    await userEvent.clear(within(mapa).getByRole('textbox', { name: 'Quantidade do item 2' }))
    await userEvent.type(within(mapa).getByRole('textbox', { name: 'Quantidade do item 2' }), '2')
    banco.itens = banco.itens.map((i) => (i.numero === 1
      ? { ...i, preco_digitado: 42, base: 'embalagem', emb_unidades: 12, preco_convertido: 3.5, rev: 2 } : i))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await within(mapa).findByTestId('mudou-1')).toHaveTextContent('O vendedor mudou o item 1 depois que você abriu o pedido: confira')
    return mapa
  }

  it('releitura com o mapa aberto: item que o vendedor mudou tem a quantidade refeita na base nova, aviso e segundo toque', async () => {
    const mapa = await mapaComMudanca()
    // "104" un não vira 104 fardos: o campo passa a 9 fardos (108 un); a quantidade que o Ivan digitou no 2 fica
    expect(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' })).toHaveValue('9')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 1' })).toHaveTextContent('108 un no pedido × 104 aprovados · R$ 378,00')
    expect(within(mapa).getByRole('textbox', { name: 'Quantidade do item 2' })).toHaveValue('2')
    expect(within(mapa).queryByTestId('mudou-2')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar com as mudanças do vendedor' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [
      { numero: 1, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco_combinado: 42 },
      { numero: 2, qtd: 2, base: 'kg', embalagens: null, fator: null, preco_combinado: 18.5 },
    ])
  })

  it('releitura com o mapa aberto: depois que o Ivan mexe no item mudado, o aviso sai e o Confirmar grava no primeiro toque', async () => {
    const mapa = await mapaComMudanca()
    await userEvent.clear(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' }))
    await userEvent.type(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' }), '10')
    expect(within(mapa).queryByTestId('mudou-1')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [
      { numero: 1, qtd: 120, base: 'embalagem', embalagens: 10, fator: 12, preco_combinado: 42 },
      { numero: 2, qtd: 2, base: 'kg', embalagens: null, fator: null, preco_combinado: 18.5 },
    ])
  })

  it('item parcial ("tenho só 0,5 kg"): o aviso aparece no mapa e o pedido começa no que o vendedor tem, nunca na aprovada', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2 }, [
      { nome: 'LIMAO SICILIANO', unidade: 'kg', rotulo: 'kg', qtd: 2, estado: 'tem', preco_digitado: 9.9, base: 'kg', preco_convertido: 9.9, ref_preco: 9.5, delta: 0.0421, tenho_so: 0.5, avisos_ivan: ['parcial'] },
      { nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, estado: 'tem', preco_digitado: 42, base: 'embalagem', emb_unidades: 12, preco_convertido: 3.5, ref_preco: 3.4, delta: 0.0294, tenho_so: 30, avisos_ivan: ['parcial'] },
    ])
    m.gravarPedido.mockResolvedValue({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [] })
    const mapa = await abrirMapa()
    // a pílula da tabela na linha do item, sem precisar rolar até a coluna Avisos
    expect(within(mapa).getByTestId('avisos-1')).toHaveTextContent('tem só 0,5 kg')
    expect(within(mapa).getByTestId('avisos-2')).toHaveTextContent('tem só 30 un')
    expect(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' })).toHaveValue('0,5')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 1' })).toHaveTextContent('0,5 kg no pedido × 2 aprovados · R$ 4,95')
    expect(within(mapa).getByTestId('parcial-1')).toHaveTextContent('O vendedor disse que tem só 0,5 kg (de 2 aprovados): o pedido começa aí')
    // fardo c/12 com 30 un: 2 fardos (24 un), nunca mais do que ele tem
    expect(within(mapa).getByRole('textbox', { name: 'Quantidade do item 2' })).toHaveValue('2')
    expect(within(mapa).getByRole('group', { name: 'Pedido item 2' })).toHaveTextContent('24 un no pedido × 104 aprovados')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [
      { numero: 1, qtd: 0.5, base: 'kg', embalagens: null, fator: null, preco_combinado: 9.9 },
      { numero: 2, qtd: 24, base: 'embalagem', embalagens: 2, fator: 12, preco_combinado: 42 },
    ])
  })

  /** Refrigerante com o preço da LATA digitado como fardo c/12: R$ 3,50 o fardo = 0,2917/un, Δ −92% e unidade suspeita. */
  function mapaComUnidadeSuspeita() {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 2 }, [
      { nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, embalagem: 'fardo', fator: 12, fator_confirmado: true, estado: 'tem', preco_digitado: 3.5, base: 'embalagem', emb_unidades: 12, fator_informado: 12, preco_convertido: 0.2917, ref_preco: 3.5, delta: -0.9167, avisos_ivan: ['unidade_suspeita'] },
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', qtd: 1.2, estado: 'tem', preco_digitado: 18.5, base: 'kg', preco_convertido: 18.5, ref_preco: 18, delta: 0.0278 },
    ])
    m.gravarPedido.mockResolvedValue({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [] })
  }

  it('unidade suspeita (−92%): não sai verde, a pílula aparece no mapa, entra em "Confira" e o Confirmar pede segundo toque', async () => {
    mapaComUnidadeSuspeita()
    const mapa = await abrirMapa()
    const linha = within(mapa).getByTestId('mapa-1')
    expect(within(linha).getByText('−92%')).toHaveClass('delta', 'suspeita')
    expect(within(linha).getByText('−92%')).not.toHaveClass('desce')
    expect(within(mapa).getByTestId('avisos-1')).toHaveTextContent('unidade suspeita: muito longe do último preço')
    expect(within(mapa).getByTestId('confira'))
      .toHaveTextContent('Confira antes de confirmar: REFRIGERANTE COLA 350 ML (−92%, unidade suspeita: muito longe do último preço)')
    // não é "deixar para a loja": o Aceitar sugestão não aparece só por causa dele
    expect(within(mapa).queryByRole('button', { name: 'Aceitar sugestão' })).not.toBeInTheDocument()
    expect(within(mapa).queryByTestId('avisos-2')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar mesmo assim' }))
    expect(m.gravarPedido).toHaveBeenCalledTimes(1)
  })

  it('unidade suspeita: depois que o Ivan mexe no item, o "Confira" sai e o Confirmar grava no primeiro toque', async () => {
    mapaComUnidadeSuspeita()
    const mapa = await abrirMapa()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Item 1: No pedido' }))
    expect(within(mapa).queryByTestId('confira')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [{ numero: 2, qtd: 1.2, base: 'kg', embalagens: null, fator: null, preco_combinado: 18.5 }])
  })

  it('"preço só a partir de 20 kg": aviso e "Confira" enquanto a quantidade está abaixo; subir a quantidade tira o aviso', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [
      { nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', qtd: 5, estado: 'tem', preco_digitado: 3.2, base: 'kg', preco_convertido: 3.2, ref_preco: 3.5, delta: -0.0857, a_partir_de: 20, avisos_ivan: ['a_partir_de'] },
    ])
    m.gravarPedido.mockResolvedValue({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [] })
    const mapa = await abrirMapa()
    expect(within(mapa).getByTestId('avisos-1')).toHaveTextContent('preço a partir de 20 kg')
    expect(within(mapa).getByTestId('a-partir-1')).toHaveTextContent('Preço só a partir de 20 kg')
    expect(within(mapa).getByTestId('confira')).toHaveTextContent('CEBOLA (preço só a partir de 20 kg)')
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).not.toHaveBeenCalled()
    await userEvent.clear(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' }))
    await userEvent.type(within(mapa).getByRole('textbox', { name: 'Quantidade do item 1' }), '20')
    expect(within(mapa).queryByTestId('a-partir-1')).not.toBeInTheDocument()
    expect(within(mapa).queryByTestId('confira')).not.toBeInTheDocument()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Confirmar pedido' }))
    expect(m.gravarPedido).toHaveBeenCalledWith(7, [{ numero: 1, qtd: 20, base: 'kg', embalagens: null, fator: null, preco_combinado: 3.2 }])
  })

  it('validade do preço vencida: aviso vermelho "Preço vencido em dd/mm" no topo do mapa', async () => {
    comMapa({ validade: '2026-10-18' })
    let mapa = await abrirMapa()
    expect(within(mapa).getByTestId('preco-vencido')).toHaveTextContent('Preço vencido em 18/10')
    expect(within(mapa).getByTestId('preco-vencido')).toHaveClass('erro')
    cleanup()
    comMapa({ validade: '2026-10-19' })
    mapa = await abrirMapa()
    expect(within(mapa).queryByTestId('preco-vencido')).not.toBeInTheDocument()
  })

  it('nenhum item no pedido: botão desabilitado com "use Obrigado, desta vez não"', async () => {
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [
      { nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', qtd: 1.2, estado: 'tem', preco_digitado: 18.5, base: 'kg', preco_convertido: 18.5 },
    ])
    const mapa = await abrirMapa()
    await userEvent.click(within(mapa).getByRole('button', { name: 'Item 1: No pedido' }))
    expect(within(mapa).getByRole('button', { name: 'Nenhum item no pedido: use Obrigado, desta vez não' })).toBeDisabled()
  })
})

// ---------- Fase 2, Bloco B: leitura com IA (B.14.3)
function statusLigada(over: Partial<IaStatus> = {}): IaStatus {
  return { ligada: true, liberada: true, liberada_em: '2026-10-01T00:00:00Z', modelo: 'claude-opus-5',
    uso: { hoje: 1, limite_dia: 30, mes: 1, limite_mes: 150, custo_mes_usd: 0.07 }, ...over }
}
function iaLinha(numero: number, preco: number, base = 'un'): LeituraIA['itens'][number] {
  return { numero, fonte: 'texto', casou_por: 'numero', trecho: `${numero} item ${preco}`, certeza: 'alta', duvida: null, sinais: [],
    entrada: { estado: 'tem', preco, base: base as 'un', emb_unidades: null, emb_gramas: null, emb_ml: null,
      tenho_so: null, a_partir_de: null, similar_desc: null, similar_preco: null, marca: null } }
}
function leituraMock(itens: LeituraIA['itens']): LeituraIA {
  return { ok: true, leitura_id: 88, modelo: 'claude-opus-5', duracao_ms: 9000, custo_usd: 0.07, itens,
    gerais: { pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null },
    fora_da_lista: [], nao_entendidos: [], uso: statusLigada().uso }
}
async function abrirColar() {
  render(<Cotacoes />)
  await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
  await screen.findByTestId('ler-ia')
}
async function clicarLerIA() {
  await waitFor(() => expect(screen.getByTestId('ler-ia')).toBeEnabled())
  await userEvent.click(screen.getByTestId('ler-ia'))
}

describe('Cotações — leitura com IA', () => {
  it('Ler com IA: quando o leitor comum entende tudo, a IA não é chamada e grava como ivan_colou', async () => {
    m.iaStatus.mockResolvedValue(statusLigada())
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    await abrirColar()
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('1 - 2,50')
    await clicarLerIA()
    expect(m.lerComIA).not.toHaveBeenCalled()
    expect(screen.getByTestId('sem-custo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Gravar 1 item' }))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String),
      [expect.objectContaining({ numero: 1, preco: 2.5 })], null, 'ivan_colou')
  })

  it('Ler com IA: com linha não entendida chama a função, mostra os cartões e grava como ivan_ia', async () => {
    m.iaStatus.mockResolvedValue(statusLigada())
    m.lerComIA.mockResolvedValue(leituraMock([iaLinha(1, 2.5)]))
    m.iaGravada.mockResolvedValue()
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    await abrirColar()
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('cebola ta cara demais')
    await clicarLerIA()
    await screen.findByTestId('previa-ia')
    expect(m.lerComIA).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('cartao-ia-1')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('gravar-ia'))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String),
      [expect.objectContaining({ numero: 1, preco: 2.5, base: 'un' })], null, 'ivan_ia')
    expect(m.iaGravada).toHaveBeenCalledWith(88, expect.any(String), expect.objectContaining({ gravados: 1 }))
  })

  it('Ler com IA numa cotação grande (>25 itens): manda só os números que o leitor comum não leu (B.5.3)', async () => {
    m.iaStatus.mockResolvedValue(statusLigada())
    m.lerComIA.mockResolvedValue(leituraMock([]))
    m.iaGravada.mockResolvedValue()
    const itens = Array.from({ length: 30 }, (_, k) => ({ nome: `ITEM ${k + 1}`, unidade: 'un' as const, rotulo: 'un' as const }))
    comViva({ status: 'enviada', enviada_em: SEG_15H }, itens)
    await abrirColar()
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    // o leitor comum lê 1..27; sobra a linha "não entendida" (força a IA) e os itens 28..30 ficam pendentes
    const lidas = Array.from({ length: 27 }, (_, k) => `${k + 1} - 2,50`).join('\n')
    await userEvent.paste(`${lidas}\nxxxx nao entendi`)
    await clicarLerIA()
    await waitFor(() => expect(m.lerComIA).toHaveBeenCalledTimes(1))
    expect(m.lerComIA).toHaveBeenCalledWith(7, expect.objectContaining({ pendentes: [28, 29, 30] }), expect.anything())
  })

  it('Ler com IA numa cotação pequena: não manda pendentes (a IA lê e os dois leitores se conferem)', async () => {
    m.iaStatus.mockResolvedValue(statusLigada())
    m.lerComIA.mockResolvedValue(leituraMock([iaLinha(1, 2.5)]))
    m.iaGravada.mockResolvedValue()
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    await abrirColar()
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('cebola ta cara demais')
    await clicarLerIA()
    await waitFor(() => expect(m.lerComIA).toHaveBeenCalledTimes(1))
    expect(m.lerComIA).toHaveBeenCalledWith(7, expect.objectContaining({ pendentes: undefined }), expect.anything())
  })

  it('Ler com IA: item com resposta do link só entra no Gravar com "substituir"', async () => {
    m.iaStatus.mockResolvedValue(statusLigada())
    m.lerComIA.mockResolvedValue(leituraMock([iaLinha(1, 3.2, 'kg')]))
    m.iaGravada.mockResolvedValue()
    comViva({ status: 'respondida', enviada_em: SEG_15H, respostas_rev: 1 }, [
      { numero: 1, nome: 'CEBOLA', unidade: 'kg', rotulo: 'kg', qtd: 5, estado: 'tem', preco_digitado: 3, base: 'kg',
        preco_convertido: 3, origem: 'vendedor', respondido_em: SEG_15H, rev: 2 },
    ])
    await abrirColar()
    await userEvent.click(screen.getByRole('textbox', { name: 'Resposta colada' }))
    await userEvent.paste('xxxx nao entendi')
    await clicarLerIA()
    await screen.findByTestId('previa-ia')
    expect(screen.getByTestId('gravar-ia')).toBeDisabled() // protegido, desmarcado
    await userEvent.click(screen.getByRole('checkbox', { name: 'Substituir a resposta do link do item 1' }))
    await userEvent.click(screen.getByTestId('gravar-ia'))
    expect(m.responderComoAdmin).toHaveBeenCalledWith(7, expect.any(String),
      [expect.objectContaining({ numero: 1, rev_lida: 2 })], null, 'ivan_ia')
  })

  it('Cartão "Leitura com IA": mostra o estado e liga', async () => {
    m.iaStatus.mockResolvedValue(statusLigada({ ligada: false }))
    m.iaLigar.mockResolvedValue(statusLigada({ ligada: true }))
    comRascunho()
    render(<Cotacoes />)
    const chaves = await screen.findByTestId('chaves-ia')
    expect(within(chaves).getByTestId('chaves-linha')).toHaveTextContent('Desligada')
    await userEvent.click(within(chaves).getByRole('button', { name: 'Ligar' }))
    expect(m.iaLigar).toHaveBeenCalledWith(true)
    await waitFor(() => expect(within(chaves).getByTestId('chaves-linha')).toHaveTextContent('Ligada'))
  })

  it('Ler com IA desligada: o botão fica desabilitado', async () => {
    m.iaStatus.mockResolvedValue(statusLigada({ ligada: false, liberada: false }))
    comViva({ status: 'enviada', enviada_em: SEG_15H }, [{ nome: 'AGUA MINERAL 500ML' }])
    render(<Cotacoes />)
    await userEvent.click(await screen.findByRole('button', { name: 'Colar resposta' }))
    await waitFor(() => expect(screen.getByTestId('ler-ia')).toBeDisabled())
    expect(screen.getByText('Leitura com IA desligada')).toBeInTheDocument()
  })
})
