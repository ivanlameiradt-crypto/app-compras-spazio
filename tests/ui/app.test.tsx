import { render, screen } from '@testing-library/react'
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
