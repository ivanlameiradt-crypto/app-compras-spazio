import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import * as api from '../../src/lib/api'
import TrocarSenha from '../../src/auth/TrocarSenha'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

beforeEach(() => { vi.resetAllMocks() })

describe('TrocarSenha — voluntária (P2)', () => {
  it('valida tamanho mínimo, confirmação e senha padrão antes de chamar a api', async () => {
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), '123')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), '123')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/pelo menos 6 caracteres/)).toBeInTheDocument()
    expect(m.trocarMinhaSenha).not.toHaveBeenCalled()
  })

  it('nova diferente da confirmação', async () => {
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'novasenha2')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/não coincidem/)).toBeInTheDocument()
    expect(m.trocarMinhaSenha).not.toHaveBeenCalled()
  })

  it('rejeita a senha padrão 123456 (P3)', async () => {
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), '123456')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/diferente da senha padrão/)).toBeInTheDocument()
    expect(m.trocarMinhaSenha).not.toHaveBeenCalled()
  })

  it('exige que a nova seja diferente da atual', async () => {
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'igualigual')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'igualigual')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'igualigual')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/diferente da atual/)).toBeInTheDocument()
    expect(m.trocarMinhaSenha).not.toHaveBeenCalled()
  })

  it('senha atual incorreta', async () => {
    m.trocarMinhaSenha.mockRejectedValue(new Error('Senha atual incorreta.'))
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'errada')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'novasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Senha atual incorreta.')).toBeInTheDocument()
  })

  it('sem internet', async () => {
    m.trocarMinhaSenha.mockRejectedValue(new Error('TypeError: Failed to fetch'))
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'novasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Sem internet. Tente de novo.')).toBeInTheDocument()
  })

  it('erro de rede do Supabase (servidor fora, sem texto de rede) também vira "Sem internet" (M-b)', async () => {
    m.trocarMinhaSenha.mockRejectedValue(new AuthRetryableFetchError('{}', 503))
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'novasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Sem internet. Tente de novo.')).toBeInTheDocument()
  })

  it('sucesso: chama trocarMinhaSenha e avisa', async () => {
    m.trocarMinhaSenha.mockResolvedValue()
    render(<TrocarSenha forcada={false} />)
    await userEvent.type(screen.getByLabelText('Senha atual'), 'atual123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'novasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(m.trocarMinhaSenha).toHaveBeenCalledWith('atual123', 'novasenha1')
    expect(await screen.findByText('Senha trocada.')).toBeInTheDocument()
  })
})

describe('TrocarSenha — forçada no primeiro acesso (P3)', () => {
  it('não mostra o campo de senha atual', () => {
    render(<TrocarSenha forcada />)
    expect(screen.getByText('Escolha sua senha')).toBeInTheDocument()
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument()
  })

  it('sucesso chama escolherSenhaInicial', async () => {
    m.escolherSenhaInicial.mockResolvedValue()
    render(<TrocarSenha forcada />)
    await userEvent.type(screen.getByLabelText('Nova senha'), 'minhasenha1')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), 'minhasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(m.escolherSenhaInicial).toHaveBeenCalledWith('minhasenha1')
    expect(await screen.findByText('Senha trocada.')).toBeInTheDocument()
  })

  it('rejeita a senha padrão também no modo forçado', async () => {
    render(<TrocarSenha forcada />)
    await userEvent.type(screen.getByLabelText('Nova senha'), '123456')
    await userEvent.type(screen.getByLabelText('Repita a nova senha'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/diferente da senha padrão/)).toBeInTheDocument()
    expect(m.escolherSenhaInicial).not.toHaveBeenCalled()
  })

  it('offline: mostra aviso e não o formulário, com Sair', async () => {
    const onSair = vi.fn()
    render(<TrocarSenha forcada offline onSair={onSair} />)
    expect(screen.getByText('Sem internet. Conecte para escolher sua senha.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(onSair).toHaveBeenCalled()
  })
})
