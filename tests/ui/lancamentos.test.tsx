import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Lancamentos from '../../src/admin/Lancamentos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const admin = { email: 'admin@spazio.com', nome: 'Admin', papel: 'admin' as const, ativo: true }

const base = { semana_id: 7, comprador: 'joao@spazio.com', comprador_nome: 'João', foto_cupom: null, aberta_em: '2026-09-23T13:00:00Z', fechada_em: '2026-09-23T14:00:00Z' }
const fila: api.CompraNaFila[] = [
  { ...base, id: 'c1', loja: 'ATACADÃO', com_nota: true, total_pago: 4310.55, status: 'fechada', itens: 18, foto_cupom: 'c1/x.jpg' },
  { ...base, id: 'c2', loja: 'MATEUS', com_nota: false, total_pago: 2357.45, status: 'aprovada', itens: 3 },
]

beforeEach(() => {
  vi.resetAllMocks()
  m.filaLancamentos.mockResolvedValue(fila)
  m.aprovarCompra.mockResolvedValue()
  m.marcarLancada.mockResolvedValue()
  m.corrigirItemCompra.mockResolvedValue()
  m.corrigirCompra.mockResolvedValue()
  m.itensDaCompra.mockResolvedValue([
    { id: 'l1', compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79, resultado: 'comprado', marcado_por: 'joao@spazio.com', marcado_em: '', produto: 'COCA COLA 350 ML', unidade: 'un', preco_estimado: 2.79 },
  ])
  m.urlCupom.mockResolvedValue('https://x/cupom')
  m.semanaTravandoAprovacao.mockResolvedValue(null)
  m.comprasAbertasParaFechar.mockResolvedValue([])
  m.adminFecharCompra.mockResolvedValue(true)
  m.cancelarCompra.mockResolvedValue()
})

const cartao = async (loja: string) => (await screen.findByText(new RegExp(loja))).closest('.cartao') as HTMLElement

describe('Lançamentos', () => {
  it('lista compras com loja, comprador, itens, total e nota', async () => {
    render(<Lancamentos usuario={admin} />)
    const c = await cartao('ATACADÃO')
    expect(within(c).getByText(/João/)).toBeInTheDocument()
    expect(within(c).getByText(/18 itens/)).toBeInTheDocument()
    expect(within(c).getByText('Com nota')).toBeInTheDocument()
    expect(within(await cartao('MATEUS')).getByText('Sem nota')).toBeInTheDocument()
  })

  it('aprovar passa para Pronta para lançar', async () => {
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Aprovar' }))
    expect(m.aprovarCompra).toHaveBeenCalledWith('c1')
    expect(within(await cartao('ATACADÃO')).getByText('Pronta para lançar')).toBeInTheDocument()
  })

  it('aprovada pode ser marcada como lançada e sai da fila', async () => {
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('MATEUS')).getByRole('button', { name: /marcar como lançada/i }))
    expect(m.marcarLancada).toHaveBeenCalledWith('c2')
    expect(screen.queryByText(/MATEUS/)).not.toBeInTheDocument()
  })

  it('ver itens mostra a tabela e permite corrigir', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('50').mockReturnValueOnce('2,90')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).toHaveBeenCalledWith('l1', 50, 2.9)
  })

  it('cancelar o prompt do preço não apaga o preço nem chama corrigir (M2)', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('50').mockReturnValueOnce(null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).not.toHaveBeenCalled()
    expect(screen.getByText('R$ 2,79')).toBeInTheDocument()
  })

  it('cancelar o prompt da quantidade também aborta', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    expect(m.corrigirItemCompra).not.toHaveBeenCalled()
  })

  it('I4: corrige total e com/sem nota', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('1.250')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).toHaveBeenCalledWith('c1', false, 1250)
    expect(within(await cartao('ATACADÃO')).getByText('Sem nota')).toBeInTheDocument()
    expect(within(await cartao('ATACADÃO')).getByText(/R\$ 1\.250,00/)).toBeInTheDocument()
  })

  it('Corrigir total/nota com total inválido: avisa "Total inválido." e não chama corrigir_compra', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('abc')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(await screen.findByText('Total inválido.')).toBeInTheDocument()
    expect(m.corrigirCompra).not.toHaveBeenCalled()
    expect(within(await cartao('ATACADÃO')).getByText('Com nota')).toBeInTheDocument()
  })

  it('I4: cancelar o prompt do total não muda nada', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce(null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).not.toHaveBeenCalled()
    expect(within(await cartao('ATACADÃO')).getByText('Com nota')).toBeInTheDocument()
  })

  it('I4: cancelar o prompt de com/sem nota aborta antes de perguntar o total', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Corrigir total/nota' }))
    expect(m.corrigirCompra).not.toHaveBeenCalled()
    expect(window.prompt).toHaveBeenCalledTimes(1)
  })

  it('abre a aba do cupom já no clique e só depois manda a URL assinada (M4)', async () => {
    const janela = { location: { href: '' } } as unknown as Window
    const abrir = vi.spyOn(window, 'open').mockReturnValue(janela)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    expect(abrir).toHaveBeenCalledWith('', '_blank')
    expect(m.urlCupom).toHaveBeenCalledWith('c1/x.jpg')
    await waitFor(() => expect(janela.location.href).toBe('https://x/cupom'))
  })

  it('falha ao gerar o link do cupom: fecha a aba em branco e mostra o erro (M-c)', async () => {
    const janela = { location: { href: '' }, close: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(janela)
    m.urlCupom.mockRejectedValue(new Error('Object not found'))
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    expect(await screen.findByText(/Object not found/)).toBeInTheDocument()
    expect(janela.close).toHaveBeenCalled()
  })

  it('aba bloqueada (window.open null): mostra o cupom embutido no cartão (M4)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: /ver cupom/i }))
    const img = await within(await cartao('ATACADÃO')).findByRole('img')
    expect(img).toHaveAttribute('src', 'https://x/cupom')
  })

  it('fila vazia', async () => {
    m.filaLancamentos.mockResolvedValue([])
    render(<Lancamentos usuario={admin} />)
    expect(await screen.findByText(/nenhuma compra aguardando/i)).toBeInTheDocument()
  })
})

describe('Lançamentos — compra aberta de outra pessoa (Fase 1A)', () => {
  const abertas: api.CompraAbertaParaFechar[] = [
    { id: 'a1', loja: 'FEIRA', comprador: 'joao@spazio.com', comprador_nome: 'João', aberta_em: '2026-09-23T13:05:00Z', itens: 2, total_marcado: 123.4 },
    { id: 'a2', loja: 'PADARIA', comprador: 'maria@spazio.com', comprador_nome: 'Maria', aberta_em: '2026-09-23T15:30:00Z', itens: 0, total_marcado: 0 },
    { id: 'a3', loja: 'AÇOUGUE', comprador: 'admin@spazio.com', comprador_nome: 'Admin', aberta_em: '2026-09-23T16:00:00Z', itens: 1, total_marcado: 10 },
  ]
  const aberta = async (loja: string) =>
    (await screen.findAllByTestId('compra-aberta')).find((c) => c.textContent?.includes(loja)) as HTMLElement

  const emCompra = { id: 7, data_referencia: '2026-09-21', status: 'em_compra' as const, aprovada_por: null, aprovada_em: null }

  beforeEach(() => {
    // segunda-feira: a lista nova está em rascunho e a semana 21/09 continua em compra
    m.semanaTravandoAprovacao.mockResolvedValue(emCompra)
    m.comprasAbertasParaFechar.mockResolvedValue(abertas)
  })

  it('lista as compras abertas dos outros com comprador, loja e desde quando; a do próprio admin não aparece', async () => {
    render(<Lancamentos usuario={admin} />)
    const feira = await aberta('FEIRA')
    expect(m.comprasAbertasParaFechar).toHaveBeenCalledWith(7)
    expect(screen.getByText(/semana 21\/09 não pode ser\s+encerrada/)).toBeInTheDocument()
    expect(within(feira).getByText(/FEIRA · João/)).toBeInTheDocument()
    expect(within(feira).getByText(/Aberta em 23\/09 às 10h05/)).toBeInTheDocument()
    expect(within(feira).getByText(/2 itens marcados/)).toBeInTheDocument()
    expect(within(feira).getByRole('button', { name: 'Fechar pelo comprador' })).toBeInTheDocument()
    expect(within(feira).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    const padaria = await aberta('PADARIA')
    expect(within(padaria).getByText(/nenhum item marcado/)).toBeInTheDocument()
    expect(within(padaria).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(padaria).queryByRole('button', { name: 'Fechar pelo comprador' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('compra-aberta')).toHaveLength(2)
    expect(screen.queryByText(/AÇOUGUE/)).not.toBeInTheDocument()
  })

  it('Fechar pelo comprador: pergunta com/sem nota e o total (sugerido = soma dos itens marcados) e chama admin_fechar_compra', async () => {
    const pergunta = vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('130,50')
    const fechada: api.CompraNaFila = {
      ...fila[0], id: 'a1', loja: 'FEIRA', comprador_nome: 'João', status: 'fechada', itens: 2, com_nota: false, total_pago: 130.5, foto_cupom: null,
    }
    m.filaLancamentos.mockResolvedValueOnce(fila).mockResolvedValueOnce([...fila, fechada])
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(pergunta.mock.calls[0][0]).toMatch(/João \(FEIRA, aberta em 23\/09 às 10h05\)/)
    expect(pergunta.mock.calls[0][0]).toMatch(/com nota ou sem nota/)
    expect(pergunta.mock.calls[0][0]).toMatch(/pode ainda estar na loja: marcações feitas depois disto serão recusadas/)
    expect(pergunta.mock.calls[1][1]).toBe('123,40')
    expect(m.adminFecharCompra).toHaveBeenCalledWith('a1', false, 130.5)
    await waitFor(() => expect(screen.getAllByTestId('compra-aberta')).toHaveLength(1))
    // fechada, ela entra na fila de lançamento como qualquer compra fechada
    expect(await screen.findByText(/R\$ 130,50/)).toBeInTheDocument()
  })

  it('Fechar pelo comprador numa compra que o comprador já fechou: avisa que valem os valores dele', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('999')
    m.adminFecharCompra.mockResolvedValue(false) // o banco não mudou nada: já estava fechada
    const doComprador: api.CompraNaFila = {
      ...fila[0], id: 'a1', loja: 'FEIRA', comprador_nome: 'João', status: 'fechada', itens: 2, com_nota: true, total_pago: 140, foto_cupom: null,
    }
    m.filaLancamentos.mockResolvedValueOnce(fila).mockResolvedValueOnce([...fila, doComprador])
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(m.adminFecharCompra).toHaveBeenCalledWith('a1', false, 999)
    expect(await screen.findByTestId('aviso')).toHaveTextContent(
      'O comprador já tinha fechado esta compra; valores dele mantidos — confira em FEIRA · João, na fila abaixo.',
    )
    expect(document.querySelector('.erro')).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId('compra-aberta')).toHaveLength(1))
    // na fila ficam os valores do comprador (com nota, R$ 140), não os digitados agora
    expect(await screen.findByText(/R\$ 140,00/)).toBeInTheDocument()
    expect(screen.queryByText(/R\$ 999,00/)).not.toBeInTheDocument()
  })

  it('fechamento normal pelo admin não mostra o aviso de "já tinha fechado"', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce('10')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    await waitFor(() => expect(screen.getAllByTestId('compra-aberta')).toHaveLength(1))
    expect(screen.queryByTestId('aviso')).not.toBeInTheDocument()
  })

  it('Fechar pelo comprador com "com" nota e o total sugerido aceito como está', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Com nota').mockImplementationOnce((_t, sugerido) => sugerido ?? null)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(m.adminFecharCompra).toHaveBeenCalledWith('a1', true, 123.4)
  })

  it('resposta que não é "com" nem "sem": não fecha e avisa', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('talvez')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByText(/Responda "com" ou "sem"/)).toBeInTheDocument()
    expect(m.adminFecharCompra).not.toHaveBeenCalled()
    expect(window.prompt).toHaveBeenCalledTimes(1)
  })

  it('total inválido: não fecha e avisa', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce('abc')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByText(/Total inválido/)).toBeInTheDocument()
    expect(m.adminFecharCompra).not.toHaveBeenCalled()
  })

  it('cancelar qualquer uma das perguntas não fecha nada', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('com').mockReturnValueOnce(null)
    render(<Lancamentos usuario={admin} />)
    const botao = within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' })
    await userEvent.click(botao)
    await userEvent.click(botao)
    expect(window.prompt).toHaveBeenCalledTimes(3)
    expect(m.adminFecharCompra).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('compra-aberta')).toHaveLength(2)
  })

  it('erro do banco ao fechar aparece e a compra continua na lista', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce('10')
    m.adminFecharCompra.mockRejectedValue(new Error('compra sem itens: use Cancelar'))
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByText(/use Cancelar/)).toBeInTheDocument()
    expect(screen.getAllByTestId('compra-aberta')).toHaveLength(2)
  })

  it('Cancelar compra sem itens: confirma, chama cancelar_compra e tira da lista', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(confirmar.mock.calls[0][0]).toMatch(/Maria \(PADARIA\)/)
    expect(m.cancelarCompra).toHaveBeenCalledWith('a2')
    await waitFor(() => expect(screen.queryByText(/PADARIA/)).not.toBeInTheDocument())
  })

  it('Cancelar sem confirmar não mexe em nada', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(m.cancelarCompra).not.toHaveBeenCalled()
    expect(screen.getByText(/PADARIA/)).toBeInTheDocument()
  })

  it('sem lista nova esperando (compra em curso na semana corrente): nem busca as abertas, nem mostra o bloco', async () => {
    m.semanaTravandoAprovacao.mockResolvedValue(null)
    render(<Lancamentos usuario={admin} />)
    await cartao('ATACADÃO')
    await waitFor(() => expect(m.semanaTravandoAprovacao).toHaveBeenCalled())
    expect(m.comprasAbertasParaFechar).not.toHaveBeenCalled()
    expect(screen.queryByText('Compras abertas')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fechar pelo comprador' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('compra-aberta')).not.toBeInTheDocument()
  })

  it('erro ao ler as semanas: mostra o erro e não oferece fechar nada', async () => {
    m.semanaTravandoAprovacao.mockRejectedValue(new Error('Failed to fetch'))
    render(<Lancamentos usuario={admin} />)
    await cartao('ATACADÃO')
    expect(await screen.findByTestId('erro-abertas')).toHaveTextContent(/Failed to fetch/)
    expect(screen.queryByRole('button', { name: 'Fechar pelo comprador' })).not.toBeInTheDocument()
  })

  it('erro ao ler o bloco de compras abertas continua na tela depois de "Ver itens" e de outra ação', async () => {
    m.comprasAbertasParaFechar.mockRejectedValue(new Error('Failed to fetch'))
    render(<Lancamentos usuario={admin} />)
    expect(await screen.findByTestId('erro-abertas')).toHaveTextContent('Não consegui ler as compras abertas: Failed to fetch')
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Aprovar' }))
    expect(m.aprovarCompra).toHaveBeenCalledWith('c1')
    expect(screen.getByTestId('erro-abertas')).toHaveTextContent(/Failed to fetch/)
    expect(screen.queryByTestId('compra-aberta')).not.toBeInTheDocument()
  })

  it('aviso de "já tinha fechado" sobrevive a "Ver itens"; some quando o admin o fecha', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('999')
    m.adminFecharCompra.mockResolvedValue(false)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByTestId('aviso')).toHaveTextContent(/já tinha fechado/)
    await userEvent.click(within(await cartao('ATACADÃO')).getByRole('button', { name: 'Ver itens' }))
    expect(await screen.findByText('COCA COLA 350 ML')).toBeInTheDocument()
    expect(screen.getByTestId('aviso')).toHaveTextContent(/já tinha fechado/)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    expect(screen.queryByTestId('aviso')).not.toBeInTheDocument()
  })

  it('aviso de "já tinha fechado" é limpo no começo do próximo Fechar/Cancelar', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('sem').mockReturnValueOnce('999')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    m.adminFecharCompra.mockResolvedValue(false)
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByTestId('aviso')).toBeInTheDocument()
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByTestId('aviso')).not.toBeInTheDocument()
  })

  it('banco recusa o Fechar (o comprador desmarcou tudo): relê as abertas antes da mensagem e o cartão passa a oferecer Cancelar', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('com').mockReturnValueOnce('10')
    m.adminFecharCompra.mockRejectedValue(new Error('compra sem itens: use Cancelar'))
    let liberar!: (l: api.CompraAbertaParaFechar[]) => void
    m.comprasAbertasParaFechar
      .mockResolvedValueOnce(abertas)
      .mockReturnValueOnce(new Promise((r) => { liberar = r }))
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    await waitFor(() => expect(m.comprasAbertasParaFechar).toHaveBeenCalledTimes(2))
    expect(m.comprasAbertasParaFechar).toHaveBeenLastCalledWith(7)
    expect(screen.queryByText(/use Cancelar/)).not.toBeInTheDocument() // a mensagem só vem depois da releitura
    liberar([{ ...abertas[0], itens: 0, total_marcado: 0 }, abertas[1], abertas[2]])
    expect(await screen.findByText(/use Cancelar/)).toBeInTheDocument()
    const feira = await aberta('FEIRA')
    expect(within(feira).getByText(/nenhum item marcado/)).toBeInTheDocument()
    expect(within(feira).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(feira).queryByRole('button', { name: 'Fechar pelo comprador' })).not.toBeInTheDocument()
  })

  it('banco recusa o Cancelar (o comprador marcou item depois que a tela abriu): relê e o cartão passa a oferecer Fechar pelo comprador', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.cancelarCompra.mockRejectedValue(new Error('esta compra já tem item marcado; feche-a em vez de cancelar'))
    m.comprasAbertasParaFechar
      .mockResolvedValueOnce(abertas)
      .mockResolvedValueOnce([abertas[0], { ...abertas[1], itens: 1, total_marcado: 8.5 }, abertas[2]])
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/feche-a em vez de cancelar/)).toBeInTheDocument()
    expect(m.comprasAbertasParaFechar).toHaveBeenCalledTimes(2)
    const padaria = await aberta('PADARIA')
    expect(within(padaria).getByText(/1 item marcado/)).toBeInTheDocument()
    expect(within(padaria).getByRole('button', { name: 'Fechar pelo comprador' })).toBeInTheDocument()
    expect(within(padaria).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('banco recusa o Cancelar porque o comprador já fechou: relida, a compra some do bloco', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.cancelarCompra.mockRejectedValue(new Error('só dá para cancelar uma compra aberta'))
    m.comprasAbertasParaFechar.mockResolvedValueOnce(abertas).mockResolvedValueOnce([abertas[0], abertas[2]])
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/só dá para cancelar uma compra aberta/)).toBeInTheDocument()
    expect(screen.queryByText(/PADARIA/)).not.toBeInTheDocument()
    expect(screen.getAllByTestId('compra-aberta')).toHaveLength(1)
    // fechada pelo comprador, ela vai para a fila: a fila é relida junto
    await waitFor(() => expect(m.filaLancamentos).toHaveBeenCalledTimes(2))
  })

  it('banco recusa e a releitura também falha: mostra os dois erros e esconde os cartões desatualizados', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.cancelarCompra.mockRejectedValue(new Error('esta compra já tem item marcado; feche-a em vez de cancelar'))
    m.comprasAbertasParaFechar.mockResolvedValueOnce(abertas).mockRejectedValueOnce(new Error('Failed to fetch'))
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('PADARIA')).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText(/feche-a em vez de cancelar/)).toBeInTheDocument()
    expect(screen.getByTestId('erro-abertas')).toHaveTextContent(/Failed to fetch/)
    expect(screen.queryByTestId('compra-aberta')).not.toBeInTheDocument()
  })

  it('erro que não vem do banco (resposta inválida no prompt) não relê as abertas', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('talvez')
    render(<Lancamentos usuario={admin} />)
    await userEvent.click(within(await aberta('FEIRA')).getByRole('button', { name: 'Fechar pelo comprador' }))
    expect(await screen.findByText(/Responda "com" ou "sem"/)).toBeInTheDocument()
    expect(m.comprasAbertasParaFechar).toHaveBeenCalledTimes(1)
  })

  it('sem compra aberta dos outros, o bloco não aparece', async () => {
    m.comprasAbertasParaFechar.mockResolvedValue([abertas[2]])
    render(<Lancamentos usuario={admin} />)
    await cartao('ATACADÃO')
    expect(screen.queryByText('Compras abertas')).not.toBeInTheDocument()
  })
})
