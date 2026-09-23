import { clear } from 'idb-keyval'
import { AuthRetryableFetchError } from '@supabase/supabase-js'

const rpc = vi.fn()
const upload = vi.fn()
const signOut = vi.fn()
const getSession = vi.fn()
const signInWithPassword = vi.fn()
const updateUser = vi.fn()
const refreshSession = vi.fn()
const invoke = vi.fn()
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a) }) },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: {
      signOut: () => signOut(),
      getSession: () => getSession(),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      refreshSession: (...a: unknown[]) => refreshSession(...a),
    },
  },
}))
import {
  ErroApi, aprovarCompra, criarAcesso, entrarComSenha, escolherSenhaInicial, executarOp, enviarOp,
  redefinirSenha, sair, trocarMinhaSenha,
} from '../../src/lib/api'
import { ErroRede, pendentes, type Op } from '../../src/lib/fila'
import { EVENTO_SAIU, guardarUsuario, ultimoUsuario, usuarioGuardado } from '../../src/auth/usuarioGuardado'

beforeEach(async () => {
  rpc.mockReset(); upload.mockReset(); signOut.mockReset(); getSession.mockReset()
  signInWithPassword.mockReset(); updateUser.mockReset(); refreshSession.mockReset(); invoke.mockReset()
  getSession.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })
  localStorage.clear()
  await clear()
})

describe('sair', () => {
  const joao = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador' as const, ativo: true }

  it('esquece o usuário guardado e avisa o app', async () => {
    guardarUsuario(joao)
    signOut.mockResolvedValue({ error: null })
    const aviso = vi.fn()
    window.addEventListener(EVENTO_SAIU, aviso)
    await sair()
    window.removeEventListener(EVENTO_SAIU, aviso)
    expect(signOut).toHaveBeenCalled()
    expect(usuarioGuardado(joao.email)).toBeNull()
    expect(ultimoUsuario()).toBeNull()
    expect(aviso).toHaveBeenCalled()
  })

  it('sem internet (signOut devolve erro) também esquece o usuário', async () => {
    guardarUsuario(joao)
    signOut.mockResolvedValue({ error: new Error('Failed to fetch') })
    await sair()
    expect(ultimoUsuario()).toBeNull()
  })
})

describe('executarOp', () => {
  it('chama a função com os argumentos da operação', async () => {
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o', tipo: 'abrir_compra', args: { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' } })
    expect(rpc).toHaveBeenCalledWith('abrir_compra', { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' })
  })

  it('envia a foto antes de fechar e passa o caminho', async () => {
    upload.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    expect(upload.mock.calls[0][0]).toBe('c/o1.jpg')
    expect(rpc).toHaveBeenCalledWith('fechar_compra', { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: 'c/o1.jpg' })
  })

  it('foto que já tinha subido numa tentativa anterior não é erro', async () => {
    upload.mockResolvedValue({ error: { message: 'The resource already exists' } })
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: false, p_total: 1, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    expect(rpc).toHaveBeenCalled()
  })

  const desmarcar: Op = { id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } }

  it('sem sessão não chama a função (nunca como anônimo): ErroRede para tentar depois', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(executarOp(desmarcar)).rejects.toBeInstanceOf(ErroRede)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['sem resposta (status 0)', 0, ''],
    ['401 sem login', 401, '42501'],
    ['408 tempo esgotado', 408, ''],
    ['429 limite de pedidos', 429, ''],
    ['500 erro no servidor', 500, ''],
    ['503 fora do ar', 503, ''],
    ['JWT vencido (PGRST301)', 401, 'PGRST301'],
    ['JWT inválido (PGRST303)', 400, 'PGRST303'],
  ])('temporário → ErroRede: %s', async (_nome, status, code) => {
    rpc.mockResolvedValue({ error: { message: 'algo deu errado', code }, status })
    await expect(executarOp(desmarcar)).rejects.toBeInstanceOf(ErroRede)
  })

  it.each([
    ['regra de negócio (P0001)', 400, 'P0001', 'esta compra já foi fechada'],
    ['sem acesso (42501 → 403)', 403, '42501', 'usuário sem acesso ao app'],
    ['função não existe (404)', 404, 'PGRST202', 'Could not find the function'],
    ['P0001 com texto que parece de rede', 400, 'P0001', 'token inválido na regra'],
  ])('definitivo → erro normal: %s', async (_nome, status, code, message) => {
    rpc.mockResolvedValue({ error: { message, code }, status })
    const p = executarOp(desmarcar)
    await expect(p).rejects.toThrow(message)
    await expect(p).rejects.not.toBeInstanceOf(ErroRede)
  })

  it('erro da função guarda status e código', async () => {
    rpc.mockResolvedValue({ error: { message: 'só dá para aprovar compra fechada', code: 'P0001' }, status: 400 })
    const e = await aprovarCompra('c').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroApi)
    expect(e).toMatchObject({ message: 'só dá para aprovar compra fechada', status: 400, code: 'P0001' })
  })

  it('foto: falha 5xx no envio é temporária; 4xx é definitiva', async () => {
    const fechar: Op = { id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } }
    upload.mockResolvedValue({ error: { message: 'Internal Server Error', status: 502 } })
    await expect(executarOp(fechar)).rejects.toBeInstanceOf(ErroRede)
    upload.mockResolvedValue({ error: { message: 'mime type not supported', status: 415 } })
    await expect(executarOp(fechar)).rejects.not.toBeInstanceOf(ErroRede)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('falha de rede vira ErroRede; erro de regra passa como erro normal', async () => {
    rpc.mockResolvedValue({ error: { message: 'TypeError: Failed to fetch' } })
    await expect(executarOp({ id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } })).rejects.toBeInstanceOf(ErroRede)
    rpc.mockResolvedValue({ error: { message: 'esta compra já foi fechada' } })
    const p = executarOp({ id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } })
    await expect(p).rejects.toThrow('esta compra já foi fechada')
    await expect(p).rejects.not.toBeInstanceOf(ErroRede)
  })
})

describe('enviarOp', () => {
  it('não espera o envio: resolve assim que a operação entra na fila', async () => {
    let liberar: (v: { error: null }) => void = () => {}
    rpc.mockReturnValue(new Promise((r) => { liberar = r }))
    const op = { id: 'z', tipo: 'abrir_compra', args: { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' } } as const
    await expect(enviarOp(op)).resolves.toBeUndefined()
    expect((await pendentes()).map((o) => o.id)).toEqual(['z'])
    liberar({ error: null })
  })
})

describe('entrarComSenha (P1)', () => {
  it('mapeia o usuário digitado para o e-mail interno', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await entrarComSenha(' Joana ', 'segredo123')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'joana@spazio.invalid', password: 'segredo123' })
  })

  it('credenciais erradas: erro repassado', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await expect(entrarComSenha('joao', 'errada')).rejects.toThrow('Invalid login credentials')
  })
})

describe('criarAcesso / redefinirSenha (Edge Function)', () => {
  it('criarAcesso chama a função com a ação certa e devolve o e-mail', async () => {
    invoke.mockResolvedValue({ data: { email: 'nova@spazio.invalid' }, error: null })
    const r = await criarAcesso({ login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' })
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' },
    })
    expect(r).toEqual({ email: 'nova@spazio.invalid' })
  })

  it('criarAcesso: erro da função (corpo JSON) vira a mensagem certa', async () => {
    const context = { json: async () => ({ erro: 'esse usuário já existe' }) } as unknown as Response
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context } })
    await expect(criarAcesso({ login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' })).rejects.toThrow('esse usuário já existe')
  })

  it('redefinirSenha chama a função com o e-mail e a senha', async () => {
    invoke.mockResolvedValue({ data: { ok: true, email: 'joao@spazio.invalid' }, error: null })
    await redefinirSenha('joao@spazio.invalid', '123456')
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123456' },
    })
  })

  it('redefinirSenha sem senha explícita usa a senha padrão', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await redefinirSenha('joao@spazio.invalid')
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123456' },
    })
  })
})

describe('trocarMinhaSenha (P2)', () => {
  it('confere a senha atual e troca', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    signInWithPassword.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })
    await trocarMinhaSenha('atual123', 'nova12345')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'joao@spazio.invalid', password: 'atual123' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'nova12345' })
  })

  it('senha atual errada: não troca', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await expect(trocarMinhaSenha('errada', 'nova12345')).rejects.toThrow('Senha atual incorreta.')
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('sem internet ao conferir a senha atual: repassa o erro de rede, não "Senha atual incorreta." (M-b)', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    const semRede = new AuthRetryableFetchError('Failed to fetch', 0)
    signInWithPassword.mockResolvedValue({ error: semRede })
    await expect(trocarMinhaSenha('atual123', 'nova12345')).rejects.toBe(semRede)
    expect(updateUser).not.toHaveBeenCalled()
  })
})

describe('escolherSenhaInicial (P3 — primeiro acesso)', () => {
  it('troca a senha sem pedir a atual e limpa a marca de troca obrigatória', async () => {
    updateUser.mockResolvedValue({ error: null })
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    await escolherSenhaInicial('minhaSenhaSó123')
    expect(updateUser).toHaveBeenCalledWith({ password: 'minhaSenhaSó123', data: { trocar_senha: false } })
    expect(refreshSession).toHaveBeenCalled()
  })
})
