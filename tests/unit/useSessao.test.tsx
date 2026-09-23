import { act, renderHook, waitFor } from '@testing-library/react'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import type { EstadoSessao } from '../../src/auth/useSessao'

const sessao = (token = 't1') => ({ access_token: token, user: { email: 'Joao@Spazio.com' } }) as never
const getSession = vi.fn()
let ouvinte: ((evento: string, s: unknown) => void) | null = null

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (f: (evento: string, s: unknown) => void) => {
        ouvinte = f
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
  },
}))
vi.mock('../../src/lib/api')

import * as api from '../../src/lib/api'
import { useSessao } from '../../src/auth/useSessao'
import { EVENTO_SAIU, esquecerUsuario, guardarUsuario, trocaSenhaPendente, ultimoUsuario, usuarioGuardado } from '../../src/auth/usuarioGuardado'

const m = vi.mocked(api)
const joao = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador' as const, ativo: true }
type Logado = Extract<EstadoSessao, { sessao: object }>

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  ouvinte = null
  getSession.mockResolvedValue({ data: { session: sessao() }, error: null })
})
afterEach(() => { vi.restoreAllMocks() })

async function pronto() {
  const r = renderHook(() => useSessao())
  await waitFor(() => expect(r.result.current.carregando).toBe(false))
  return r
}
async function emitir(evento: string, s: unknown) {
  await act(async () => {
    ouvinte!(evento, s)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('useSessao', () => {
  it('falha ao verificar acesso vira erro, não "sem acesso"', async () => {
    m.buscarUsuario.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = await pronto()
    const estado = result.current as Logado
    expect(estado.usuario).toBeNull()
    expect(estado.erro).toContain('Failed to fetch')
  })

  it('usuário ativo encontrado não tem erro e fica guardado no celular', async () => {
    m.buscarUsuario.mockResolvedValue(joao)
    const { result } = await pronto()
    const estado = result.current as Logado
    expect(estado.usuario).toEqual(joao)
    expect(estado.erro).toBeUndefined()
    expect(usuarioGuardado('JOAO@spazio.com')).toEqual(joao)
    expect(ultimoUsuario()).toEqual(joao)
  })

  it('P3: sessão com trocar_senha pendente guarda a marca (sobrevive offline depois)', async () => {
    m.buscarUsuario.mockResolvedValue(joao)
    getSession.mockResolvedValue({
      data: { session: { access_token: 't1', user: { email: joao.email, user_metadata: { trocar_senha: true } } } },
      error: null,
    })
    await pronto()
    expect(trocaSenhaPendente(joao.email)).toBe(true)
  })

  it('sessão sem trocar_senha pendente não marca (e limpa uma marca antiga)', async () => {
    m.buscarUsuario.mockResolvedValue(joao)
    const { result } = await pronto() // sessao() default não tem user_metadata
    expect((result.current as Logado).usuario).toEqual(joao)
    expect(trocaSenhaPendente(joao.email)).toBe(false)
  })

  it('sem internet para verificar: usa o usuário guardado, sem tela de erro', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = await pronto()
    const estado = result.current as Logado
    expect(estado.usuario).toEqual(joao)
    expect(estado.erro).toBeUndefined()
  })

  it('servidor diz que não tem acesso: apaga o guardado e mostra "sem acesso"', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockResolvedValue(null)
    const { result } = await pronto()
    const estado = result.current as Logado
    expect(estado.usuario).toBeNull()
    expect(estado.erro).toBeUndefined()
    expect(usuarioGuardado(joao.email)).toBeNull()
    expect(ultimoUsuario()).toBeNull()
  })

  it('usuário desativado perde o acesso quando está online', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockResolvedValue({ ...joao, ativo: false })
    const { result } = await pronto()
    expect((result.current as Logado).usuario).toBeNull()
    expect(usuarioGuardado(joao.email)).toBeNull()
  })

  it('TOKEN_REFRESHED só troca a sessão, sem buscar o usuário de novo', async () => {
    m.buscarUsuario.mockResolvedValue(joao)
    const { result } = await pronto()
    expect(m.buscarUsuario).toHaveBeenCalledTimes(1)
    await emitir('TOKEN_REFRESHED', sessao('t2'))
    expect(m.buscarUsuario).toHaveBeenCalledTimes(1)
    const estado = result.current as Logado
    expect((estado.sessao as unknown as { access_token: string }).access_token).toBe('t2')
    expect(estado.usuario).toEqual(joao)
  })

  it('SIGNED_IN busca o usuário de novo', async () => {
    m.buscarUsuario.mockResolvedValue(joao)
    await pronto()
    await emitir('SIGNED_IN', sessao('t2'))
    expect(m.buscarUsuario).toHaveBeenCalledTimes(2)
  })

  it('token vencido sem internet: abre com o usuário guardado (modo offline)', async () => {
    guardarUsuario(joao)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    expect(result.current).toEqual({ carregando: false, sessao: null, usuario: joao, offline: true })
    expect(m.buscarUsuario).not.toHaveBeenCalled()
  })

  it('sem sessão com o aparelho offline também usa o usuário guardado', async () => {
    guardarUsuario(joao)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const { result } = await pronto()
    expect(result.current).toEqual({ carregando: false, sessao: null, usuario: joao, offline: true })
  })

  it('sem sessão, com internet e sem falha de rede: vai para o login', async () => {
    guardarUsuario(joao)
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const { result } = await pronto()
    expect(result.current).toEqual({ carregando: false, sessao: null })
  })

  it('sem usuário guardado, token vencido sem internet vai para o login', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    expect(result.current).toEqual({ carregando: false, sessao: null })
  })

  it('internet volta e o token renova: sai do modo offline e confirma o usuário no servidor (M-a)', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockResolvedValue(joao)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    await emitir('TOKEN_REFRESHED', sessao('t2'))
    const estado = result.current as Logado
    expect(estado.sessao).not.toBeNull()
    expect(estado.usuario).toEqual(joao)
    expect(m.buscarUsuario).toHaveBeenCalledWith(joao.email)
  })

  it('desativado enquanto estava offline: quando a internet volta, perde o acesso (M-a)', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockResolvedValue({ ...joao, ativo: false })
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    expect(result.current).toMatchObject({ sessao: null, usuario: joao, offline: true })
    await emitir('TOKEN_REFRESHED', sessao('t2'))
    await waitFor(() => expect((result.current as Logado).usuario).toBeNull())
    expect(usuarioGuardado(joao.email)).toBeNull()
  })

  it('voltando do offline, se a confirmação falhar por rede, segue com o usuário guardado', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockRejectedValue(new Error('Failed to fetch'))
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    await emitir('TOKEN_REFRESHED', sessao('t2'))
    await waitFor(() => expect(m.buscarUsuario).toHaveBeenCalled())
    const estado = result.current as Logado
    expect(estado.usuario).toEqual(joao)
    expect(estado.erro).toBeUndefined()
  })

  it('SIGNED_OUT vai para o login mesmo com usuário guardado', async () => {
    guardarUsuario(joao)
    m.buscarUsuario.mockResolvedValue(joao)
    const { result } = await pronto()
    await emitir('SIGNED_OUT', null)
    expect(result.current).toEqual({ carregando: false, sessao: null })
  })

  it('sair no modo offline volta para o login mesmo sem evento do Supabase', async () => {
    guardarUsuario(joao)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = await pronto()
    await act(async () => {
      esquecerUsuario()
      window.dispatchEvent(new Event(EVENTO_SAIU))
    })
    expect(result.current).toEqual({ carregando: false, sessao: null })
  })
})
