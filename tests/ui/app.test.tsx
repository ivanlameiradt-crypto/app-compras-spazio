import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EstadoSessao } from '../../src/auth/useSessao'

let estado: EstadoSessao = { carregando: true }
vi.mock('../../src/auth/useSessao', () => ({ useSessao: () => estado }))
vi.mock('../../src/lib/api')
import App from '../../src/App'

const sessao = { user: { email: 'joao@spazio.com' } } as never

beforeEach(async () => {
  const api = vi.mocked(await import('../../src/lib/api'))
  api.contarAguardando.mockResolvedValue(0)
  api.semanaParaRevisar.mockResolvedValue(null)
  api.semanaEmCompra.mockResolvedValue(null)
  api.lojasUsadas.mockResolvedValue([])
  api.nomesEquipe.mockResolvedValue({})
})

describe('App', () => {
  // isola cada teste (sem isso, HashRouters de renders anteriores disputam o mesmo window.location.hash)
  afterEach(() => { cleanup(); window.location.hash = '' })

  it('sem sessão mostra o login', () => {
    estado = { carregando: false, sessao: null }
    render(<App />)
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByLabelText('Usuário ou e-mail')).toBeInTheDocument()
  })

  it('logado mas não cadastrado pede acesso', () => {
    estado = { carregando: false, sessao, usuario: null }
    render(<App />)
    expect(screen.getByText(/peça acesso ao administrador/i)).toBeInTheDocument()
    expect(screen.getByText(/joao@spazio.com/)).toBeInTheDocument()
  })

  it('falha ao verificar acesso não mostra \'peça acesso\'', () => {
    estado = { carregando: false, sessao, usuario: null, erro: 'Failed to fetch' }
    render(<App />)
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
    expect(screen.queryByText(/peça acesso ao administrador/i)).not.toBeInTheDocument()
  })

  it('comprador não vê o menu do administrador', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    expect(screen.queryByRole('link', { name: /lançamentos/i })).not.toBeInTheDocument()
  })

  it('admin vê o menu com Lançamentos', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    render(<App />)
    expect(await screen.findByRole('link', { name: /lançamentos/i })).toBeInTheDocument()
  })

  it('Fase 1 app unificado: a barra tem 5 abas e a Compra abre o menu em grade com 4 telas (etapa 5, 12/11/2026)', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    render(<App />)
    // 5 abas na barra: Compra · Lançamentos (a fila, que saiu do menu Compra em 12/11) · Lançamento de cupom · Lançamento fiscal (a nota da SEFAZ; renomeada em 06/10) · Compras avulsas (10/10)
    const topo = (await screen.findByRole('link', { name: 'Lançamento de cupom' })).closest('nav') as HTMLElement
    expect([...topo.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/compra', '#/lancamentos', '#/cupom', '#/nota-sefaz', '#/compra-avulsa'])
    expect(within(topo).getByRole('link', { name: 'Lançamentos' })).toHaveAttribute('href', '#/lancamentos')        // a aba nova: a fila de compras esperando lançamento
    expect(within(topo).getByRole('link', { name: /Lançamento fiscal/ })).toHaveAttribute('href', '#/nota-sefaz')   // o nome da 4ª aba
    expect(within(topo).getByRole('link', { name: /Compras avulsas/ })).toHaveAttribute('href', '#/compra-avulsa')   // a 5ª: compra sem cupom e sem nota
    expect(within(topo).queryByText(/nota SEFAZ/)).not.toBeInTheDocument()                                          // e o nome antigo sumiu
    expect(within(topo).queryByText(/Lançamento de fiscal/)).not.toBeInTheDocument()                                // nem o de algumas horas atrás (com o "de")
    // a aba Compra (rota padrão do admin) abre o menu em grade com 4 telas: Lista · Pedidos · Receber · Resultados (findBy: espera o redirect p/ /compra)
    const grade = (await screen.findByRole('navigation', { name: 'Telas de compra' })) as HTMLElement
    expect([...grade.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/lista-semana', '#/pedidos', '#/receber', '#/resultados'])
    expect(within(grade).getByRole('link', { name: 'Resultados' })).toHaveAttribute('href', '#/resultados')
    // o que saiu da grade: Lançamentos (virou aba), Resumo e Economia (viraram Resultados), Cadastros (virou "Ajustes") e Fazer compra (o cartão Pedidos leva a ela)
    for (const nome of ['Lançamentos', 'Resumo', 'Economia', 'Cadastros', 'Fazer compra']) {
      expect(within(grade).queryByRole('link', { name: nome })).not.toBeInTheDocument()
    }
    // "Ajustes": link discreto abaixo da grade, para os Cadastros
    expect(screen.getByRole('link', { name: 'Ajustes (produtos, vendedores, feriados)' })).toHaveAttribute('href', '#/cadastros')
    expect(screen.queryByRole('link', { name: 'Comprar' })).not.toBeInTheDocument()
  })

  it('/resumo (rota antiga) leva para /resultados, aba Semana, com o título Resultados e o "Menu Compra"', async () => {
    const api = vi.mocked(await import('../../src/lib/api'))
    api.listarSemanas.mockResolvedValue([])
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/resumo'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Resultados' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/resultados')
    expect(screen.getByRole('tab', { name: 'Semana' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Menu Compra' })).toHaveAttribute('href', '#/compra')
  })

  it('/economia (rota antiga) leva para /resultados?aba=economia, na aba Economia', async () => {
    const api = vi.mocked(await import('../../src/lib/api'))
    api.painelEconomia.mockResolvedValue(null)
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/economia'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Resultados' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/resultados?aba=economia')
    expect(screen.getByRole('tab', { name: 'Economia' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/O painel ainda não foi instalado no banco/)).toBeInTheDocument()
  })

  it('/lancamentos acende a aba Lançamentos e não oferece "Menu Compra" (é aba própria, não subtela da Compra)', async () => {
    const api = vi.mocked(await import('../../src/lib/api'))
    api.filaLancamentos.mockResolvedValue([])
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/lancamentos'
    render(<App />)
    const barra = (await screen.findByRole('navigation', { name: 'Seções' })) as HTMLElement
    expect(within(barra).getByRole('link', { name: 'Lançamentos' })).toHaveClass('ativo')
    expect(within(barra).getByRole('link', { name: 'Compra' })).not.toHaveClass('ativo')
    expect(screen.queryByRole('link', { name: 'Menu Compra' })).not.toBeInTheDocument()
  })

  it('o contador vermelho das compras fechadas esperando aprovação fica na aba Lançamentos, não na Compra', async () => {
    const api = vi.mocked(await import('../../src/lib/api'))
    api.contarAguardando.mockResolvedValue(3)
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    render(<App />)
    const barra = (await screen.findByRole('navigation', { name: 'Seções' })) as HTMLElement
    await waitFor(() => expect(within(within(barra).getByRole('link', { name: /Lançamentos/ })).getByText('3')).toHaveClass('contador'))
    expect(within(barra).getAllByText('3')).toHaveLength(1)
    expect(within(within(barra).getByRole('link', { name: 'Compra' })).queryByText('3')).not.toBeInTheDocument()
  })

  it('/comprar continua existindo para o admin (só saiu da grade do menu Compra)', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/comprar'
    render(<App />)
    await screen.findByRole('navigation', { name: 'Seções' })
    expect(window.location.hash).toBe('#/comprar')
  })

  it('/cotacoes (rota antiga) leva para /pedidos, com o título Pedidos e o "Menu Compra" para voltar', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/cotacoes'
    render(<App />)
    expect(await screen.findByRole('heading', { name: /^Pedidos/ })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/pedidos')
    expect(screen.getByRole('link', { name: 'Menu Compra' })).toHaveAttribute('href', '#/compra')
  })

  it('comprador não vê a aba Cotações', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    expect(screen.queryByRole('link', { name: /cotações/i })).not.toBeInTheDocument()
  })

  it('enquanto confere o acesso mostra a tela de abertura do Comprar', () => {
    estado = { carregando: true }
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
    expect(screen.getByRole('img', { name: 'Comprar' })).toBeInTheDocument()
  })

  it('sem sessão, "Instalar o app neste aparelho" abre a tela de instalar e o Voltar traz de volta o login', async () => {
    estado = { carregando: false, sessao: null }
    render(<App />)
    const link = screen.getByRole('link', { name: 'Instalar o app neste aparelho' })
    expect(link).toHaveAttribute('href', '#/instalar')
    await userEvent.click(link)
    expect(await screen.findByRole('heading', { name: 'Instalar o app' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Voltar' }))
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('a barra de cima tem o logo e as ações Atualizar, Trocar minha senha e Sair', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    render(<App />)
    const barra = (await screen.findByRole('banner')) as HTMLElement
    expect(within(barra).getByRole('img', { name: 'Comprar' })).toBeInTheDocument()
    expect(within(barra).getByRole('button', { name: 'Atualizar' })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: 'Trocar minha senha' })).toHaveAttribute('href', '#/senha')
    expect(within(barra).getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('comprador vê a barra de baixo só com Fazer compra e Receber', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    const barra = (await screen.findByRole('navigation', { name: 'Seções' })) as HTMLElement
    expect([...barra.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/comprar', '#/receber'])
    expect(within(barra).getByRole('link', { name: 'Fazer compra' })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: 'Receber' })).toBeInTheDocument()
  })

  it('P3: senha padrão ainda não trocada mostra só "Escolha sua senha", sem menu', async () => {
    const sessaoPendente = { user: { email: 'joao@spazio.com', user_metadata: { trocar_senha: true } } } as never
    estado = { carregando: false, sessao: sessaoPendente, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    expect(await screen.findByText('Escolha sua senha')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /comprar/i })).not.toBeInTheDocument()
  })

  it('trocar_senha false (ou ausente) mostra o app normalmente', async () => {
    const sessaoOk = { user: { email: 'joao@spazio.com', user_metadata: { trocar_senha: false } } } as never
    estado = { carregando: false, sessao: sessaoOk, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    expect(screen.queryByText('Escolha sua senha')).not.toBeInTheDocument()
  })
})

// Sub-fase 3: a guarda por papel é só de UX (a segurança real é a RLS + a checagem de admin da Edge Function), mas tem de existir.
describe('rota /cupom (Sub-fase 3)', () => {
  // desmonta ANTES de zerar o hash (senão o roteador ainda montado reage à mudança) e não deixa a rota vazar para outros testes
  afterEach(() => { cleanup(); window.location.hash = '' })

  it('admin abre a tela "Lançar cupom" em #/cupom', async () => {
    const api = vi.mocked(await import('../../src/lib/api'))
    api.cuponsRecentes.mockResolvedValue([])
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    window.location.hash = '#/cupom'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Lançar cupom' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lançamento de cupom' })).toHaveClass('ativo') // a aba do topo fica marcada
    // o título da tela mora dentro da barra preta (celular e tablet), como título principal
    expect(within(screen.getByRole('banner')).getByRole('heading', { level: 1, name: 'Lançar cupom' })).toBeInTheDocument()
  })

  it('comprador não abre #/cupom: cai em Comprar e nem vê o item no menu', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    window.location.hash = '#/cupom'
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/comprar'))
    expect(screen.queryByRole('heading', { name: 'Lançar cupom' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /lançamento de cupom/i })).not.toBeInTheDocument()
  })
})
