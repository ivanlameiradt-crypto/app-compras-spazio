import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('Fase 2 C + Sub-fase 3: menu do admin é Lista · Cotações · Receber · Lançamentos · Resumo · Economia · Cadastros · Cupom · Comprar', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true } }
    render(<App />)
    const menu = (await screen.findByRole('link', { name: /cotações/i })).closest('nav') as HTMLElement
    // §8.5: Pessoas deixa o menu e vira uma aba de Cadastros (#/pessoas continua abrindo)
    expect([...menu.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Lista', 'Cotações', 'Receber', 'Lançamentos', 'Resumo', 'Economia', 'Cadastros', 'Cupom', 'Comprar'])
    expect(screen.getByRole('link', { name: 'Cotações' })).toHaveAttribute('href', '#/cotacoes')
    expect(screen.getByRole('link', { name: 'Cupom' })).toHaveAttribute('href', '#/cupom')
  })

  it('comprador não vê a aba Cotações', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    render(<App />)
    expect(screen.queryByRole('link', { name: /cotações/i })).not.toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Cupom' })).toHaveClass('active') // o item do menu fica marcado
  })

  it('comprador não abre #/cupom: cai em Comprar e nem vê o item no menu', async () => {
    estado = { carregando: false, sessao, usuario: { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true } }
    window.location.hash = '#/cupom'
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/comprar'))
    expect(screen.queryByRole('heading', { name: 'Lançar cupom' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cupom' })).not.toBeInTheDocument()
  })
})
