import { renderHook, waitFor } from '@testing-library/react'
import { conferirVersao } from '../../src/lib/atualizacao'

declare const __BUILD_ID__: string

// A troca de versão em si (apagar o cache e abrir ?v=) mexe em location.replace e não roda no jsdom: aqui o que importa é o que a conferência DECIDE.
// (O segundo bloco, mais abaixo, troca o `location` por um falso para ver QUANDO o app recarrega.)
describe('conferirVersao: o que o app faz ao saber a versão que está no ar', () => {
  const resposta = (id: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => ({ id }) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('versão do ar igual à que roda: "igual" (o botão Atualizar então só recarrega a tela)', async () => {
    vi.stubGlobal('fetch', resposta(__BUILD_ID__))
    expect(await conferirVersao('manual')).toBe('igual')
    expect(await conferirVersao('periodica')).toBe('igual')
  })

  it('com o app em uso (periódica): versão nova só é AVISADA ("nova"), sem recarregar', async () => {
    vi.stubGlobal('fetch', resposta('versao-nova-1'))
    expect(await conferirVersao('periodica')).toBe('nova')
  })

  it('pergunta sempre à rede, sem cache, com um carimbo na URL', async () => {
    const f = resposta(__BUILD_ID__)
    vi.stubGlobal('fetch', f)
    await conferirVersao('abertura')
    const [url, opcoes] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/version\.json\?t=\d+$/)
    expect(opcoes).toMatchObject({ cache: 'no-store' })
  })

  it('offline, servidor com erro ou resposta sem id: "sem_resposta" e nenhum erro (o app segue na versão atual)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await conferirVersao('manual')).toBe('sem_resposta')
    vi.stubGlobal('fetch', resposta(__BUILD_ID__, false))
    expect(await conferirVersao('manual')).toBe('sem_resposta')
    vi.stubGlobal('fetch', resposta(undefined))
    expect(await conferirVersao('manual')).toBe('sem_resposta')
  })
})

// Regra do dono (13/11/2026): o app NUNCA recarrega sozinho com a pessoa trabalhando (digitando, lançando, comprando). Só recarrega na ABERTURA (a página acabou de
// abrir) e quando a pessoa CLICA em Atualizar. Cada teste usa uma cópia nova do módulo (o estado "já está trocando" e "versão nova vista" não vaza entre eles).
describe('quando o app recarrega sozinho (location falso para ver se recarregou)', () => {
  const ID_NO_AR = 'versao-do-ar-9'
  type Modulo = typeof import('../../src/lib/atualizacao')
  const carregar = async (): Promise<Modulo> => { vi.resetModules(); return import('../../src/lib/atualizacao') }
  const recargas = () => ({ replace: vi.mocked(location.replace), reload: vi.mocked(location.reload) })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: ID_NO_AR }) }))
    vi.stubGlobal('location', { pathname: '/', hash: '#/compra/lista', replace: vi.fn(), reload: vi.fn() })
    sessionStorage.clear()
  })
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

  it('na abertura (nada digitado a perder): troca sozinha, mantendo a tela (#) e lembrando a tentativa', async () => {
    const lib = await carregar()
    expect(await lib.conferirVersao('abertura')).toBe('aplicando')
    expect(recargas().replace).toHaveBeenCalledWith(`/?v=${ID_NO_AR}#/compra/lista`)
    expect(sessionStorage.getItem('spazio_versao_tentada')).toBe(ID_NO_AR)
  })

  it('ao voltar do fundo: NÃO recarrega; só guarda a versão nova para a faixa aparecer', async () => {
    const lib = await carregar()
    const { result } = renderHook(() => lib.useNovaVersao())
    expect(await lib.conferirVersao('voltou')).toBe('nova')
    await waitFor(() => expect(result.current).toBe(ID_NO_AR))
    expect(recargas().replace).not.toHaveBeenCalled()
    expect(recargas().reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('spazio_versao_tentada')).toBeNull()
  })

  it('com o app em uso (periódica): NÃO recarrega; só mostra a faixa', async () => {
    const lib = await carregar()
    const { result } = renderHook(() => lib.useNovaVersao())
    expect(await lib.conferirVersao('periodica')).toBe('nova')
    await waitFor(() => expect(result.current).toBe(ID_NO_AR))
    expect(recargas().replace).not.toHaveBeenCalled()
    expect(recargas().reload).not.toHaveBeenCalled()
  })

  it('no clique (botão Atualizar do topo ou da faixa): troca, mesmo depois de a faixa já ter avisado', async () => {
    const lib = await carregar()
    await lib.conferirVersao('voltou') // a faixa aparece
    expect(await lib.conferirVersao('manual')).toBe('aplicando')
    expect(recargas().replace).toHaveBeenCalledWith(`/?v=${ID_NO_AR}#/compra/lista`)
  })

  it('o service worker novo assumiu a tela aberta: o plugin do PWA recarregaria sozinho; aqui NÃO recarrega, só mostra a faixa', async () => {
    const lib = await carregar()
    const { result } = renderHook(() => lib.useNovaVersao())
    lib.aoServiceWorkerNovoAssumir()
    await waitFor(() => expect(result.current).toBe(ID_NO_AR))
    expect(recargas().replace).not.toHaveBeenCalled()
    expect(recargas().reload).not.toHaveBeenCalled()
  })

  it('o service worker novo assumiu mas a versão do ar é a que já roda: nada aparece', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: __BUILD_ID__ }) }))
    const lib = await carregar()
    const { result } = renderHook(() => lib.useNovaVersao())
    lib.aoServiceWorkerNovoAssumir()
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(result.current).toBeNull()
    expect(recargas().replace).not.toHaveBeenCalled()
    expect(recargas().reload).not.toHaveBeenCalled()
  })
})
