import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Pessoas from '../../src/admin/Pessoas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const ivan = { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin' as const, ativo: true }
const joao = { email: 'joao@spazio.invalid', nome: 'João', papel: 'comprador' as const, ativo: true }

beforeEach(() => {
  vi.resetAllMocks()
  m.listarUsuarios.mockResolvedValue([ivan, joao])
  m.salvarUsuario.mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Pessoas (P1 + P3 — login com usuário + senha padrão)', () => {
  it('o campo de senha inicial já vem preenchido com a senha padrão 123456', async () => {
    render(<Pessoas usuario={ivan} />)
    expect(await screen.findByLabelText('Senha inicial')).toHaveValue('123456')
  })

  it('cadastra pelo usuário (login mapeado no servidor) e mostra a senha inicial uma vez', async () => {
    m.criarAcesso.mockResolvedValue({ email: 'maria@spazio.invalid' })
    render(<Pessoas usuario={ivan} />)
    await userEvent.type(screen.getByLabelText('Nome'), 'Maria')
    await userEvent.type(await screen.findByLabelText('Usuário (ou e-mail)'), 'Maria')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(m.criarAcesso).toHaveBeenCalledWith({ login: 'Maria', nome: 'Maria', papel: 'comprador', senha: '123456' })
    expect(await screen.findByText(
      'Acesso criado: usuário maria, senha inicial 123456 — no primeiro acesso a pessoa escolhe a própria senha.',
    )).toBeInTheDocument()
  })

  it('senha inicial é editável (admin pode escolher outra)', async () => {
    m.criarAcesso.mockResolvedValue({ email: 'maria@spazio.invalid' })
    render(<Pessoas usuario={ivan} />)
    const campoSenha = await screen.findByLabelText('Senha inicial')
    await userEvent.clear(campoSenha)
    await userEvent.type(campoSenha, 'outraSenha1')
    await userEvent.type(screen.getByLabelText('Nome'), 'Maria')
    await userEvent.type(screen.getByLabelText('Usuário (ou e-mail)'), 'maria')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(m.criarAcesso).toHaveBeenCalledWith({ login: 'maria', nome: 'Maria', papel: 'comprador', senha: 'outraSenha1' })
  })

  it('erro do servidor (ex.: usuário duplicado) aparece na tela', async () => {
    m.criarAcesso.mockRejectedValue(new Error('esse usuário já existe'))
    render(<Pessoas usuario={ivan} />)
    await userEvent.type(screen.getByLabelText('Nome'), 'João de novo')
    await userEvent.type(await screen.findByLabelText('Usuário (ou e-mail)'), 'joao')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByText('esse usuário já existe')).toBeInTheDocument()
  })

  it('a tabela mostra o usuário (sem @spazio.invalid), não o e-mail interno', async () => {
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    expect(within(linhaJoao).getByText('joao')).toBeInTheDocument()
    expect(within(linhaJoao).queryByText(/@spazio\.invalid/)).not.toBeInTheDocument()
  })

  it('redefinir senha pede confirmação, chama a api com a senha padrão e avisa uma vez', async () => {
    m.redefinirSenha.mockResolvedValue()
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Redefinir senha' }))
    expect(window.confirm).toHaveBeenCalledWith(
      'A senha de joao volta para 123456 e ela terá que trocar no próximo acesso. Confirmar?',
    )
    expect(m.redefinirSenha).toHaveBeenCalledWith('joao@spazio.invalid')
    expect(await screen.findByText('Senha de joao redefinida para 123456.')).toBeInTheDocument()
  })

  it('cancelar a confirmação não chama a api', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Redefinir senha' }))
    expect(m.redefinirSenha).not.toHaveBeenCalled()
  })

  it('desativa outra pessoa, mas não a si mesmo (nem Redefinir senha para si mesmo)', async () => {
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Desativar' }))
    expect(m.salvarUsuario).toHaveBeenCalledWith({ ...joao, ativo: false })
    const linhaIvan = screen.getByText('Ivan').closest('tr') as HTMLElement
    expect(within(linhaIvan).queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()
    expect(within(linhaIvan).queryByRole('button', { name: 'Redefinir senha' })).not.toBeInTheDocument()
  })
})
