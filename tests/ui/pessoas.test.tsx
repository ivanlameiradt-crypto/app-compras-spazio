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
  it('o campo de senha inicial vem VAZIO: o administrador combina a senha com a pessoa', async () => {
    render(<Pessoas usuario={ivan} />)
    expect(await screen.findByLabelText('Senha inicial')).toHaveValue('')
  })

  it('não cadastra sem senha, com senha curta nem com a senha padrão antiga', async () => {
    render(<Pessoas usuario={ivan} />)
    await userEvent.type(screen.getByLabelText('Nome'), 'Maria')
    await userEvent.type(await screen.findByLabelText('Usuário (ou e-mail)'), 'maria')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByText('A senha provisória precisa ter pelo menos 6 caracteres.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Senha inicial'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByText('Escolha uma senha provisória diferente de 123456.')).toBeInTheDocument()
    expect(m.criarAcesso).not.toHaveBeenCalled()
  })

  it('cadastra pelo usuário (login mapeado no servidor) e mostra a senha inicial uma vez', async () => {
    m.criarAcesso.mockResolvedValue({ email: 'maria@spazio.invalid' })
    render(<Pessoas usuario={ivan} />)
    await userEvent.type(screen.getByLabelText('Nome'), 'Maria')
    await userEvent.type(await screen.findByLabelText('Usuário (ou e-mail)'), 'Maria')
    await userEvent.type(screen.getByLabelText('Senha inicial'), 'combinada1')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(m.criarAcesso).toHaveBeenCalledWith({ login: 'Maria', nome: 'Maria', papel: 'comprador', senha: 'combinada1' })
    expect(await screen.findByText(
      'Acesso criado: usuário maria, senha inicial combinada1 — no primeiro acesso a pessoa escolhe a própria senha.',
    )).toBeInTheDocument()
    expect(screen.getByLabelText('Senha inicial')).toHaveValue('')
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
    await userEvent.type(screen.getByLabelText('Senha inicial'), 'combinada1')
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByText('esse usuário já existe')).toBeInTheDocument()
  })

  it('a tabela mostra o usuário (sem @spazio.invalid), não o e-mail interno', async () => {
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    expect(within(linhaJoao).getByText('joao')).toBeInTheDocument()
    expect(within(linhaJoao).queryByText(/@spazio\.invalid/)).not.toBeInTheDocument()
  })

  it('redefinir senha pede a senha provisória, chama a api com ela e avisa uma vez', async () => {
    m.redefinirSenha.mockResolvedValue()
    vi.spyOn(window, 'prompt').mockReturnValue(' provisoria1 ')
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Redefinir senha' }))
    expect(window.prompt).toHaveBeenCalledWith(
      'Digite a senha provisória de joao (mínimo 6 caracteres). Ela terá que trocar no próximo acesso.',
    )
    expect(m.redefinirSenha).toHaveBeenCalledWith('joao@spazio.invalid', 'provisoria1')
    expect(await screen.findByText('Senha de joao redefinida para provisoria1.')).toBeInTheDocument()
  })

  it('redefinir senha recusa senha curta e a senha padrão antiga, sem chamar a api', async () => {
    const pergunta = vi.spyOn(window, 'prompt').mockReturnValue('123')
    render(<Pessoas usuario={ivan} />)
    const linhaJoao = (await screen.findByText('João')).closest('tr') as HTMLElement
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Redefinir senha' }))
    expect(await screen.findByText('A senha provisória precisa ter pelo menos 6 caracteres.')).toBeInTheDocument()
    pergunta.mockReturnValue('123456')
    await userEvent.click(within(linhaJoao).getByRole('button', { name: 'Redefinir senha' }))
    expect(await screen.findByText('Escolha uma senha provisória diferente de 123456.')).toBeInTheDocument()
    expect(m.redefinirSenha).not.toHaveBeenCalled()
  })

  it('cancelar a pergunta da senha não chama a api', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
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
