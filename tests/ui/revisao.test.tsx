import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import * as cad from '../../src/cadastros/api'
import Revisao, { inicioPedidosRecentes } from '../../src/admin/Revisao'
import { item, vendedor } from '../fabricas'

vi.mock('../../src/lib/api')
vi.mock('../../src/cadastros/api')
const m = vi.mocked(api)
const mcad = vi.mocked(cad)
const sp = (s: string | null) => (s ?? '').replace(/\s/g, ' ')
const admin = { email: 'admin@spazio.com', nome: 'Admin', papel: 'admin' as const, ativo: true }

const semana = { id: 7, data_referencia: '2026-09-22', status: 'rascunho' as const, aprovada_por: null, aprovada_em: null }
const itens = [
  item({ id: 1, produto: 'COCA COLA 350 ML', estoque: 41, qtd_sugerida: 52, qtd_aprovada: 52, preco_estimado: 2.79, fornecedor_ultima: 'ATACADAO S.A.', data_ultima_compra: '2026-09-11' }),
  item({ id: 2, produto: 'MOSTARDA - INSUMO (KG)', bebida: false, unidade: 'kg', estoque: 0.8, qtd_sugerida: 1.2, qtd_aprovada: 1.2, preco_estimado: 18.5 }),
  item({ id: 3, produto: 'CEBOLA EM PÓ - INSUMOS (KG)', bebida: false, unidade: 'kg', negativo: true, incluido: false, qtd_sugerida: 0.04 }),
  item({ id: 4, produto: 'COCA COLA KS 290ML', incluido: false, qtd_sugerida: 0 }),
]

beforeEach(() => {
  vi.resetAllMocks()
  m.semanaParaRevisar.mockResolvedValue(semana)
  m.itensDaSemana.mockResolvedValue(itens)
  m.ajustarItem.mockResolvedValue()
  m.aprovarSemana.mockResolvedValue()
  m.semanaEmCompra.mockResolvedValue(null)
  m.comprasAbertas.mockResolvedValue([])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Revisão da lista', () => {
  it('mostra abas com contagem, cartão com dados e total estimado', async () => {
    render(<Revisao usuario={admin} />)
    expect(await screen.findByRole('button', { name: 'Bebidas 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insumos 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Negativos 1' })).toBeInTheDocument()
    expect(screen.getByText('COCA COLA 350 ML')).toBeInTheDocument()
    expect(screen.getByText(/Fornecedor: ATACADAO S.A./)).toBeInTheDocument()
    expect(sp(screen.getByTestId('total').textContent)).toBe('R$ 167,28') // 52×2,79 + 1,2×18,5
  })

  it('+ aumenta a quantidade e grava', async () => {
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Mais' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, 53, true)
    expect(within(cartao).getByRole('textbox')).toHaveValue('53')
  })

  it('digitar 1,5 em insumo em kg grava 1.5', async () => {
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Insumos 1' }))
    const campo = within((screen.getByText('MOSTARDA - INSUMO (KG)').closest('.cartao')) as HTMLElement).getByRole('textbox')
    await userEvent.clear(campo)
    await userEvent.type(campo, '1,5')
    await userEvent.tab()
    expect(m.ajustarItem).toHaveBeenLastCalledWith(2, 1.5, true)
  })

  it('Tirar remove da aba e Incluir traz de volta um negativo', async () => {
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Tirar' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, 52, false)
    expect(screen.queryByText('COCA COLA 350 ML')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Negativos 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Incluir' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(3, 0.5, true) // Fase 1A: negativo entra com max(estoque mínimo, passo)
  })

  it('busca item fora da lista e inclui com quantidade 1', async () => {
    render(<Revisao usuario={admin} />)
    await userEvent.type(await screen.findByPlaceholderText(/incluir item/i), 'ks 290')
    await userEvent.click(screen.getByRole('button', { name: /COCA COLA KS 290ML/ }))
    expect(m.ajustarItem).toHaveBeenCalledWith(4, 1, true)
  })

  it('se gravar falhar, desfaz e mostra o erro', async () => {
    m.ajustarItem.mockRejectedValue(new Error('só dá para ajustar a lista enquanto ela está em rascunho'))
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Mais' }))
    expect(await screen.findByText(/enquanto ela está em rascunho/)).toBeInTheDocument()
    expect(within(cartao).getByRole('textbox')).toHaveValue('52')
  })

  it('aprovar libera a lista e trava edição', async () => {
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(m.aprovarSemana).toHaveBeenCalledWith(7)
    expect(await screen.findByText('Em compra')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mais' })).not.toBeInTheDocument()
  })

  it('mostra o motivo quando não pode aprovar', async () => {
    m.aprovarSemana.mockRejectedValue(new Error('encerre a semana anterior antes de aprovar esta'))
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(await screen.findByText(/encerre a semana anterior/)).toBeInTheDocument()
  })

  it('sem lista nova mostra aviso', async () => {
    m.semanaParaRevisar.mockResolvedValue(null)
    render(<Revisao usuario={admin} />)
    expect(await screen.findByText(/segunda às 6h/)).toBeInTheDocument()
  })
})

// Fase 1A: selos "conferir" do robô, incluir negativo com o mínimo e a semana anterior ainda em compra.
// Valores e textos de selo inventados (repositório público).
describe('Revisão — aba Conferir, negativos e semana anterior (Fase 1A)', () => {
  const leite = item({
    id: 11, produto: 'LEITE EM PÓ - INSUMOS (KG)', bebida: false, unidade: 'kg', estoque: 2, estoque_minimo: 42,
    qtd_sugerida: 40, qtd_aprovada: 0, incluido: false, preco_estimado: 30, custo_medio: 10, data_ultima_compra: '2026-09-10',
    selos: [
      { codigo: 'linha_alta', texto: '≈ R$ 1.200,00 nesta linha (acima de R$ 1.000)' },
      { codigo: 'preco_fora', texto: 'Última compra R$ 30,00/kg é 3,0× o custo médio (R$ 10,00) — confira a unidade no SisChef' },
    ],
  })
  const farinha = item({
    id: 12, produto: 'FARINHA DE TRIGO - INSUMOS (KG)', bebida: false, unidade: 'kg', estoque: 5, qtd_sugerida: 80,
    qtd_aprovada: 0, incluido: false, preco_estimado: 13, selos: [{ codigo: 'linha_alta', texto: '≈ R$ 1.040,00 nesta linha (acima de R$ 1.000)' }],
  })
  const agua = item({
    id: 13, produto: 'AGUA MINERAL 500 ML', estoque: 3, qtd_sugerida: 7.5, qtd_aprovada: 7.5, preco_estimado: 1,
    selos: [{ codigo: 'fracao_un', texto: 'Quantidade fracionada (7,5 un) em item por unidade — confira o estoque' }],
  })
  const pao = item({
    id: 14, produto: 'PÃO DE HAMBÚRGUER - INSUMOS (UN)', bebida: false, unidade: 'un', estoque: -4021, estoque_minimo: 300,
    qtd_sugerida: 4321, situacao: 'ESTOQUE NEGATIVO', negativo: true, incluido: false,
  })
  const comConferir = [...itens, leite, farinha, agua, pao]
  const anterior = { id: 6, data_referencia: '2026-09-15', status: 'em_compra' as const, aprovada_por: 'admin@spazio.com', aprovada_em: '2026-09-15T11:00:00Z' }

  it('aba Conferir é a primeira e abre sozinha; cartão mostra os selos, estoque, sugerido e último preço', async () => {
    m.itensDaSemana.mockResolvedValue(comConferir)
    render(<Revisao usuario={admin} />)
    const abaConferir = await screen.findByRole('button', { name: 'Conferir 2' })
    const botoesAbas = within(abaConferir.parentElement as HTMLElement).getAllByRole('button')
    expect(botoesAbas[0]).toBe(abaConferir)
    expect(abaConferir).toHaveAttribute('aria-pressed', 'true')
    const cartao = screen.getByText('LEITE EM PÓ - INSUMOS (KG)').closest('.cartao') as HTMLElement
    expect(within(cartao).getByText('≈ R$ 1.200,00 nesta linha (acima de R$ 1.000)')).toBeInTheDocument()
    expect(within(cartao).getByText(/3,0× o custo médio/)).toBeInTheDocument()
    expect(sp(cartao.textContent)).toMatch(/Estoque 2 kg · Sugerido 40 kg · Últ\. compra R\$ 30,00 em 10\/09/)
    expect(within(cartao).getByRole('button', { name: 'Incluir (40 kg)' })).toBeInTheDocument()
    expect(screen.getByText('FARINHA DE TRIGO - INSUMOS (KG)')).toBeInTheDocument()
    // só itens com selo e fora da lista: a água (incluída, com selo) não está aqui
    expect(screen.queryByText('AGUA MINERAL 500 ML')).not.toBeInTheDocument()
  })

  it('sem item para conferir não há aba Conferir', async () => {
    render(<Revisao usuario={admin} />)
    expect(await screen.findByRole('button', { name: 'Bebidas 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Conferir/ })).not.toBeInTheDocument()
  })

  it('Incluir na aba Conferir usa a quantidade sugerida; o item vai para a aba dele com os selos como etiquetas', async () => {
    m.itensDaSemana.mockResolvedValue(comConferir)
    render(<Revisao usuario={admin} />)
    await userEvent.click(within((await screen.findByText('LEITE EM PÓ - INSUMOS (KG)')).closest('.cartao') as HTMLElement)
      .getByRole('button', { name: 'Incluir (40 kg)' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(11, 40, true)
    expect(screen.getByRole('button', { name: 'Conferir 1' })).toBeInTheDocument()
    expect(screen.queryByText('LEITE EM PÓ - INSUMOS (KG)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Insumos 2' }))
    const cartao = screen.getByText('LEITE EM PÓ - INSUMOS (KG)').closest('.cartao') as HTMLElement
    const etiquetas = cartao.querySelectorAll('.etiquetas .pill')
    expect([...etiquetas].map((e) => e.textContent)).toEqual([
      '≈ R$ 1.200,00 nesta linha (acima de R$ 1.000)',
      'Última compra R$ 30,00/kg é 3,0× o custo médio (R$ 10,00) — confira a unidade no SisChef',
    ])
    expect(within(cartao).getByRole('textbox')).toHaveValue('40')
  })

  it('incluído o último item da aba Conferir, a aba some e a tela volta para Bebidas', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, farinha])
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Incluir (80 kg)' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(12, 80, true)
    expect(screen.queryByRole('button', { name: /Conferir/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bebidas 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('item incluído que tem selo mostra os selos como etiquetas na aba dele', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, agua])
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('AGUA MINERAL 500 ML')).closest('.cartao') as HTMLElement
    expect(within(cartao).getByText(/Quantidade fracionada \(7,5 un\)/)).toHaveClass('pill')
    expect(within(cartao).getByRole('button', { name: 'Tirar' })).toBeInTheDocument()
  })

  it('Tirar um item com selo devolve para a aba Conferir', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, agua])
    render(<Revisao usuario={admin} />)
    await userEvent.click(within((await screen.findByText('AGUA MINERAL 500 ML')).closest('.cartao') as HTMLElement)
      .getByRole('button', { name: 'Tirar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Conferir 1' }))
    expect(screen.getByRole('button', { name: 'Incluir (7,5 un)' })).toBeInTheDocument()
  })

  it('incluir insumo da aba Negativos usa o estoque mínimo, não o buraco do SisChef', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, pao])
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Negativos 2' }))
    await userEvent.click(within(screen.getByText('PÃO DE HAMBÚRGUER - INSUMOS (UN)').closest('.cartao') as HTMLElement)
      .getByRole('button', { name: 'Incluir' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(14, 300, true)
    expect(m.ajustarItem).not.toHaveBeenCalledWith(14, 4321, true)
  })

  it('negativo sem estoque mínimo entra com um passo (0,5 kg)', async () => {
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Negativos 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Incluir' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(3, 0.5, true)
  })

  it('insumo negativo achado pela busca "+ Incluir item" também entra com o estoque mínimo', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, pao])
    render(<Revisao usuario={admin} />)
    await userEvent.type(await screen.findByPlaceholderText(/incluir item/i), 'hambúrguer')
    await userEvent.click(screen.getByRole('button', { name: 'PÃO DE HAMBÚRGUER - INSUMOS (UN)' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(14, 300, true)
  })

  it('Aprovar com itens na aba Conferir: a confirmação diz quais; sem confirmar, não aprova', async () => {
    m.itensDaSemana.mockResolvedValue(comConferir)
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(confirmar).toHaveBeenCalledWith(
      'Ainda há 2 itens para conferir fora da lista (FARINHA DE TRIGO - INSUMOS (KG), LEITE EM PÓ - INSUMOS (KG)). '
      + 'Aprovar e liberar para os compradores assim mesmo?',
    )
    expect(m.aprovarSemana).not.toHaveBeenCalled()
  })

  it('Aprovar com 1 item na aba Conferir (singular) e confirmado: aprova', async () => {
    m.itensDaSemana.mockResolvedValue([...itens, farinha])
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(confirmar).toHaveBeenCalledWith(
      'Ainda há 1 item para conferir fora da lista (FARINHA DE TRIGO - INSUMOS (KG)). Aprovar e liberar para os compradores assim mesmo?',
    )
    expect(m.aprovarSemana).toHaveBeenCalledWith(7)
  })

  it('Aprovar sem nada para conferir mantém a pergunta de sempre', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(confirmar).toHaveBeenCalledWith('Aprovar a lista e liberar para os compradores?')
  })

  it('outra semana em compra: o botão vira "Antes, encerre a semana dd/mm (Resumo)" e mostra a compra aberta que trava', async () => {
    m.semanaEmCompra.mockResolvedValue(anterior)
    m.comprasAbertas.mockResolvedValue([
      { id: 'c9', loja: 'FEIRA', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-16T13:05:00Z' },
    ])
    render(<Revisao usuario={admin} />)
    const atalho = await screen.findByRole('link', { name: 'Antes, encerre a semana 15/09 (Resumo)' })
    expect(atalho).toHaveAttribute('href', '#/resumo')
    expect(screen.queryByRole('button', { name: 'Aprovar lista' })).not.toBeInTheDocument()
    expect(m.comprasAbertas).toHaveBeenCalledWith(6)
    const bloco = screen.getByTestId('semana-anterior')
    expect(within(bloco).getByText(/A semana 15\/09 ainda está em compra/)).toBeInTheDocument()
    expect(within(bloco).getByText(/FEIRA · João · aberta em 16\/09 às 10h05/)).toBeInTheDocument()
    expect(within(bloco).getByRole('link', { name: /Lançamentos/ })).toHaveAttribute('href', '#/lancamentos')
    // a lista continua editável enquanto isso
    expect(screen.getAllByRole('button', { name: 'Mais' }).length).toBeGreaterThan(0)
  })

  it('compra aberta do próprio admin: aponta para a tela Comprar (Lançamentos a esconde), não para Lançamentos', async () => {
    m.semanaEmCompra.mockResolvedValue(anterior)
    m.comprasAbertas.mockResolvedValue([
      { id: 'c8', loja: 'AÇOUGUE', comprador: 'admin@spazio.com', comprador_nome: 'Admin', aberta_em: '2026-09-16T14:00:00Z' },
    ])
    render(<Revisao usuario={admin} />)
    const bloco = await screen.findByTestId('semana-anterior')
    expect(within(bloco).getByText(/AÇOUGUE · Admin/)).toBeInTheDocument()
    expect(within(bloco).getByRole('link', { name: 'A compra aberta é sua: feche-a você mesmo em Comprar' })).toHaveAttribute('href', '#/comprar')
    expect(within(bloco).queryByRole('link', { name: /Lançamentos/ })).not.toBeInTheDocument()
  })

  it('compra aberta do admin e de outra pessoa: os dois caminhos aparecem', async () => {
    m.semanaEmCompra.mockResolvedValue(anterior)
    m.comprasAbertas.mockResolvedValue([
      { id: 'c9', loja: 'FEIRA', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-16T13:05:00Z' },
      { id: 'c8', loja: 'AÇOUGUE', comprador: 'admin@spazio.com', comprador_nome: 'Admin', aberta_em: '2026-09-16T14:00:00Z' },
    ])
    render(<Revisao usuario={admin} />)
    const bloco = await screen.findByTestId('semana-anterior')
    expect(within(bloco).getByRole('link', { name: /Lançamentos/ })).toHaveAttribute('href', '#/lancamentos')
    expect(within(bloco).getByRole('link', { name: /feche-a você mesmo em Comprar/ })).toHaveAttribute('href', '#/comprar')
  })

  it('outra semana em compra sem compra aberta: só o atalho para o Resumo', async () => {
    m.semanaEmCompra.mockResolvedValue(anterior)
    render(<Revisao usuario={admin} />)
    expect(await screen.findByRole('link', { name: 'Antes, encerre a semana 15/09 (Resumo)' })).toBeInTheDocument()
    expect(within(screen.getByTestId('semana-anterior')).queryByText(/Compra aberta/)).not.toBeInTheDocument()
    expect(within(screen.getByTestId('semana-anterior')).queryByRole('link', { name: /Lançamentos/ })).not.toBeInTheDocument()
  })

  it('falha ao ler a semana em compra: fica o "Aprovar lista" de sempre (o banco recusa com o motivo)', async () => {
    m.semanaEmCompra.mockRejectedValue(new Error('Failed to fetch'))
    render(<Revisao usuario={admin} />)
    expect(await screen.findByRole('button', { name: 'Aprovar lista' })).toBeInTheDocument()
    expect(screen.queryByTestId('semana-anterior')).not.toBeInTheDocument()
  })

  it('aba Conferir com a lista já aprovada: abre nela, mostra os selos e não tem botão Incluir nem "+ Incluir item"', async () => {
    m.semanaParaRevisar.mockResolvedValue({ ...semana, status: 'em_compra' })
    m.itensDaSemana.mockResolvedValue(comConferir)
    render(<Revisao usuario={admin} />)
    const abaConferir = await screen.findByRole('button', { name: 'Conferir 2' })
    expect(abaConferir).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Lista aprovada e liberada/)).toBeInTheDocument()
    const cartao = screen.getByText('LEITE EM PÓ - INSUMOS (KG)').closest('.cartao') as HTMLElement
    expect(within(cartao).getByText('≈ R$ 1.200,00 nesta linha (acima de R$ 1.000)')).toBeInTheDocument()
    expect(within(cartao).getByText(/3,0× o custo médio/)).toBeInTheDocument()
    expect(screen.getByText('≈ R$ 1.040,00 nesta linha (acima de R$ 1.000)')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /Incluir/ })).toHaveLength(0)
    expect(screen.queryByPlaceholderText(/incluir item/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar lista' })).not.toBeInTheDocument()
  })

  it('lista já aprovada não procura outra semana em compra', async () => {
    m.semanaParaRevisar.mockResolvedValue({ ...semana, status: 'em_compra' })
    render(<Revisao usuario={admin} />)
    expect(await screen.findByText(/Lista aprovada e liberada/)).toBeInTheDocument()
    expect(m.semanaEmCompra).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /Antes, encerre/ })).not.toBeInTheDocument()
  })
})

describe('Revisão — Fase 1B', () => {
  it('depois de aprovar, oferece "Ir para Cotações"', async () => {
    render(<Revisao usuario={admin} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar lista' }))
    expect(await screen.findByRole('link', { name: 'Ir para Cotações' })).toHaveAttribute('href', '#/cotacoes')
  })

  it('item de pedido recente a vendedor ganha a etiqueta "a NF-e já entrou no SisChef?" (sem mudar a lista)', async () => {
    m.pedidosRecentes.mockResolvedValue([
      { cotacao_id: 4, semana_id: 6, vendedor_id: 1, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-09-16T13:00:00Z',
        itens: [{ numero: 1, produto_id: 1, qtd: 52, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5, preco_convertido: 2.5, marca: null }] },
      // mais de um pedido com o mesmo produto: vale o mais recente
      { cotacao_id: 5, semana_id: 6, vendedor_id: 2, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-09-17T13:00:00Z',
        itens: [{ numero: 3, produto_id: 1, qtd: 52, base: 'un', embalagens: null, fator: null, preco_combinado: 2.4, preco_convertido: 2.4, marca: null }] },
    ])
    m.listarVendedores.mockResolvedValue([vendedor({ empresa: 'MATEUS (Mix)' }), vendedor({ id: 2, empresa: 'FORNECEDOR B (Bairro)' })])
    render(<Revisao usuario={admin} />)
    expect(await screen.findByTestId('pedido-anterior-1')).toHaveTextContent('Pedido com FORNECEDOR B em qui 17/09: a NF-e já entrou no SisChef?')
    // janela: 00:00 de Brasília de (data da semana − 7 dias)
    expect(m.pedidosRecentes).toHaveBeenCalledWith(7, '2026-09-15T03:00:00.000Z')
    expect(m.ajustarItem).not.toHaveBeenCalled()
  })

  it('sem a tabela de pedidos (App antes da migration) a Revisão não quebra', async () => {
    m.pedidosRecentes.mockRejectedValue(new Error('Could not find the table'))
    render(<Revisao usuario={admin} />)
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    expect(screen.queryByText(/a NF-e já entrou no SisChef/)).not.toBeInTheDocument()
  })

  it('inicioPedidosRecentes: 00:00 BRT sete dias antes, virando mês', () => {
    expect(inicioPedidosRecentes('2026-10-05')).toBe('2026-09-28T03:00:00.000Z')
  })
})

describe('Revisão — regras da lista (C2)', () => {
  it('"Tirar sempre…" cria a regra de barrar e o item vai para "Fora da lista por regra"', async () => {
    mcad.listaRegraSalvar.mockResolvedValue({ semana_rascunho: 7, efeito: 'tirado' })
    vi.spyOn(window, 'prompt').mockReturnValue('É da Kūkan')
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('COCA COLA 350 ML')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Tirar sempre…' }))
    expect(mcad.listaRegraSalvar).toHaveBeenCalledWith(1, 'barrar', 'É da Kūkan')
    const bloco = await screen.findByTestId('fora-por-regra')
    expect(within(bloco).getByText(/COCA COLA 350 ML — É da Kūkan/)).toBeInTheDocument()
  })

  it('item barrado não aparece em Conferir nem em Negativos', async () => {
    m.itensDaSemana.mockResolvedValue([
      item({ id: 1, produto: 'KANI (KG)', bebida: false, unidade: 'kg', negativo: true, incluido: false, regra: 'barrar', regra_motivo: 'É da Kūkan' }),
      item({ id: 2, produto: 'CACHACA', selos: [{ codigo: 'linha_alta', texto: 'valor alto' }], incluido: false, regra: 'barrar', regra_motivo: 'não usar' }),
      item({ id: 3, produto: 'ÁGUA', incluido: true }),
    ])
    render(<Revisao usuario={admin} />)
    await screen.findByText('ÁGUA')
    expect(screen.getByRole('button', { name: 'Negativos 0' })).toBeInTheDocument() // KANI barrado saiu
    expect(screen.queryByRole('button', { name: /Conferir/ })).not.toBeInTheDocument() // CACHACA barrada não vai a Conferir
  })

  it('"Incluir só nesta semana" chama ajustarItem', async () => {
    m.itensDaSemana.mockResolvedValue([
      item({ id: 1, produto: 'KANI (KG)', bebida: false, unidade: 'kg', incluido: false, qtd_sugerida: 2, regra: 'barrar', regra_motivo: 'É da Kūkan' }),
    ])
    render(<Revisao usuario={admin} />)
    const bloco = await screen.findByTestId('fora-por-regra')
    await userEvent.click(within(bloco).getByRole('button', { name: 'Incluir só nesta semana' }))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, 2, true)
  })

  it('com a lista aprovada, o bloco "Fora da lista por regra" é só leitura', async () => {
    m.semanaParaRevisar.mockResolvedValue({ ...semana, status: 'em_compra' })
    m.itensDaSemana.mockResolvedValue([
      item({ id: 1, produto: 'KANI (KG)', bebida: false, unidade: 'kg', incluido: false, regra: 'barrar', regra_motivo: 'É da Kūkan' }),
    ])
    render(<Revisao usuario={admin} />)
    const bloco = await screen.findByTestId('fora-por-regra')
    expect(within(bloco).queryByRole('button')).not.toBeInTheDocument()
  })

  it('sem as colunas regra, a Revisão fica sem o bloco (igual à de hoje)', async () => {
    render(<Revisao usuario={admin} />) // os itens padrão têm regra = null
    await screen.findByText('COCA COLA 350 ML')
    expect(screen.queryByTestId('fora-por-regra')).not.toBeInTheDocument()
  })

  it('o cartão cujo único selo é linha_alta ganha "Incluir sempre" e cria a regra de incluir', async () => {
    mcad.listaRegraSalvar.mockResolvedValue({ semana_rascunho: 7, efeito: 'incluido' })
    m.itensDaSemana.mockResolvedValue([
      // bebida: fica na aba Conferir e, depois de incluída, volta para Bebidas (visível para a pílula)
      item({ id: 5, produto: 'REFRI ALTO 2L', produto_id: 55, incluido: false, qtd_sugerida: 10,
        selos: [{ codigo: 'linha_alta', texto: '≈ R$ 1.040,00 nesta linha (acima de R$ 1.000)' }] }),
    ])
    render(<Revisao usuario={admin} />)
    const cartaoConferir = (await screen.findByText('REFRI ALTO 2L')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartaoConferir).getByRole('button', { name: 'Incluir sempre (sem pedir conferência de valor alto)' }))
    expect(mcad.listaRegraSalvar).toHaveBeenCalledWith(55, 'incluir', null)
    // some da aba Conferir e aparece na aba dele com a pílula
    const cartao = (await screen.findByText('REFRI ALTO 2L')).closest('.cartao') as HTMLElement
    expect(within(cartao).getByText('na lista pela sua regra')).toBeInTheDocument()
  })

  it('o cartão com dois selos NÃO ganha "Incluir sempre"', async () => {
    m.itensDaSemana.mockResolvedValue([
      item({ id: 6, produto: 'LEITE ALTO', produto_id: 66, incluido: false, qtd_sugerida: 40,
        selos: [
          { codigo: 'linha_alta', texto: 'valor alto' },
          { codigo: 'preco_fora', texto: 'preço fora' },
        ] }),
    ])
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('LEITE ALTO')).closest('.cartao') as HTMLElement
    expect(within(cartao).getByRole('button', { name: /^Incluir/ })).toBeInTheDocument() // tem o Incluir normal
    expect(within(cartao).queryByRole('button', { name: /Incluir sempre/ })).not.toBeInTheDocument()
  })

  it('item já com regra de incluir mostra a pílula "na lista pela sua regra"', async () => {
    m.itensDaSemana.mockResolvedValue([
      item({ id: 7, produto: 'ÁGUA COM REGRA', produto_id: 77, incluido: true, regra: 'incluir' }),
    ])
    render(<Revisao usuario={admin} />)
    const cartao = (await screen.findByText('ÁGUA COM REGRA')).closest('.cartao') as HTMLElement
    expect(within(cartao).getByText('na lista pela sua regra')).toBeInTheDocument()
  })
})
