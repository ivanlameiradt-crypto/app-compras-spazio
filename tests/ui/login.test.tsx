import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Login from '../../src/auth/Login'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

beforeEach(() => { vi.resetAllMocks() })

describe('Login (P1 — usuário + senha)', () => {
  it('entra com usuário e senha', async () => {
    m.entrarComSenha.mockResolvedValue()
    render(<Login />)
    await userEvent.type(screen.getByLabelText('Usuário ou e-mail'), 'joana')
    await userEvent.type(screen.getByLabelText('Senha'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(m.entrarComSenha).toHaveBeenCalledWith('joana', '123456')
  })

  it('credenciais erradas', async () => {
    m.entrarComSenha.mockRejectedValue(new Error('Invalid login credentials'))
    render(<Login />)
    await userEvent.type(screen.getByLabelText('Usuário ou e-mail'), 'joao')
    await userEvent.type(screen.getByLabelText('Senha'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Usuário ou senha incorretos.')).toBeInTheDocument()
  })

  it('sem internet', async () => {
    m.entrarComSenha.mockRejectedValue(new Error('TypeError: Failed to fetch'))
    render(<Login />)
    await userEvent.type(screen.getByLabelText('Usuário ou e-mail'), 'joao')
    await userEvent.type(screen.getByLabelText('Senha'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Sem internet. Tente de novo.')).toBeInTheDocument()
  })

  it('não há mais login por Google nem por link de e-mail', () => {
    render(<Login />)
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar link/i })).not.toBeInTheDocument()
  })
})
