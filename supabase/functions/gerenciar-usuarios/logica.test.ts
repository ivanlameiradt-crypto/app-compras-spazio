import { tratar, type Deps, type UsuarioLinha } from './logica'

const ADMIN: UsuarioLinha = { email: 'ivan@spazio.com', nome: 'Ivan', papel: 'admin', ativo: true }
const ADMIN_INATIVO: UsuarioLinha = { email: 'ex-admin@spazio.com', nome: 'Ex', papel: 'admin', ativo: false }
const COMPRADOR: UsuarioLinha = { email: 'joao@spazio.invalid', nome: 'João', papel: 'comprador', ativo: true }

type ContaAuth = { id: string; senha: string; nome: string; trocarSenha: boolean }

function fakeDeps(usuarios: UsuarioLinha[] = [ADMIN, ADMIN_INATIVO, COMPRADOR]): Deps & { auth: Map<string, ContaAuth> } {
  const auth = new Map<string, ContaAuth>()
  let seq = 0
  return {
    auth,
    async buscarUsuario(email) { return usuarios.find((u) => u.email === email) ?? null },
    async criarAuth(email, senha, nome, opcoes) {
      const id = `auth-${++seq}`
      auth.set(email, { id, senha, nome, trocarSenha: opcoes.trocarSenha })
      return { id }
    },
    async removerAuth(id) {
      for (const [email, v] of auth) if (v.id === id) auth.delete(email)
    },
    async inserirUsuario(u) { usuarios.push(u) },
    async acharAuthPorEmail(email) {
      const v = auth.get(email)
      return v ? { id: v.id } : null
    },
    async trocarSenha(id, senha, opcoes) {
      for (const v of auth.values()) if (v.id === id) { v.senha = senha; v.trocarSenha = opcoes.trocarSenha }
    },
  }
}

describe('tratar — quem chama precisa ser admin ativo', () => {
  it('não-admin: 403', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' }, COMPRADOR.email, deps)
    expect(r).toEqual({ status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } })
  })

  it('admin desativado: 403', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' }, ADMIN_INATIVO.email, deps)
    expect(r.status).toBe(403)
  })

  it('e-mail desconhecido: 403', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' }, 'ninguem@spazio.com', deps)
    expect(r.status).toBe(403)
  })
})

describe('tratar — criar', () => {
  it('cria o usuário no auth e na tabela, com o login mapeado', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'criar', login: ' Joana ', nome: 'Joana', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 200, corpo: { ok: true, email: 'joana@spazio.invalid' } })
    expect(deps.auth.get('joana@spazio.invalid')).toMatchObject({ senha: '123456', nome: 'Joana' })
  })

  it('login duplicado: 409, não chama criarAuth de novo', async () => {
    const deps = fakeDeps()
    await tratar({ acao: 'criar', login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    const r = await tratar({ acao: 'criar', login: 'joao', nome: 'João de novo', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 409, corpo: { erro: 'esse usuário já existe' } })
  })

  it('falha ao inserir em usuarios: remove o usuário criado no auth e devolve o erro', async () => {
    const deps = fakeDeps()
    deps.inserirUsuario = async () => { throw new Error('e-mail inválido para a tabela') }
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 400, corpo: { erro: 'e-mail inválido para a tabela' } })
    expect(deps.auth.has('nova@spazio.invalid')).toBe(false)
  })

  it('senha curta: 400', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123' }, ADMIN.email, deps)
    expect(r.status).toBe(400)
  })

  it('M-f: cria a conta já marcada para trocar a senha no primeiro acesso', async () => {
    const deps = fakeDeps()
    await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    expect(deps.auth.get('nova@spazio.invalid')).toMatchObject({ trocarSenha: true })
  })

  it.each(['!!!', '@exemplo.com'])('M-g: usuário vazio depois de normalizar (%j): 400, sem chegar ao auth', async (login) => {
    const deps = fakeDeps()
    const acharAuth = vi.spyOn(deps, 'acharAuthPorEmail')
    const criarAuth = vi.spyOn(deps, 'criarAuth')
    const r = await tratar({ acao: 'criar', login, nome: 'Nova', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 400, corpo: { erro: 'usuário inválido: use letras ou números' } })
    expect(acharAuth).not.toHaveBeenCalled()
    expect(criarAuth).not.toHaveBeenCalled()
  })

  it('papel inválido: 400', async () => {
    const deps = fakeDeps()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await tratar({ acao: 'criar', login: 'nova', nome: 'Nova', papel: 'gerente' as any, senha: '123456' }, ADMIN.email, deps)
    expect(r.status).toBe(400)
  })
})

describe('tratar — redefinir_senha', () => {
  it('troca a senha de quem existe', async () => {
    const deps = fakeDeps()
    await tratar({ acao: 'criar', login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    const r = await tratar({ acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '654321' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 200, corpo: { ok: true, email: 'joao@spazio.invalid' } })
    expect(deps.auth.get('joao@spazio.invalid')?.senha).toBe('654321')
  })

  it('M-f: redefinir marca a conta para trocar a senha de novo', async () => {
    const deps = fakeDeps()
    await tratar({ acao: 'criar', login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    deps.auth.get('joao@spazio.invalid')!.trocarSenha = false // já tinha escolhido a própria senha
    await tratar({ acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123456' }, ADMIN.email, deps)
    expect(deps.auth.get('joao@spazio.invalid')).toMatchObject({ senha: '123456', trocarSenha: true })
  })

  it('e-mail desconhecido: 404', async () => {
    const deps = fakeDeps()
    const r = await tratar({ acao: 'redefinir_senha', email: 'fantasma@spazio.invalid', senha: '123456' }, ADMIN.email, deps)
    expect(r).toEqual({ status: 404, corpo: { erro: 'usuário não encontrado' } })
  })

  it('senha curta: 400', async () => {
    const deps = fakeDeps()
    await tratar({ acao: 'criar', login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' }, ADMIN.email, deps)
    const r = await tratar({ acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123' }, ADMIN.email, deps)
    expect(r.status).toBe(400)
  })
})
