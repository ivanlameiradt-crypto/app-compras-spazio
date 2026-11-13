import { act, renderHook, waitFor } from '@testing-library/react'
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

// Abertura segura (revisão de 13/11): a troca sozinha da ABERTURA só vale se a resposta do version.json chega logo (limite de 3 s) E a pessoa ainda não mexeu na página.
// Com internet lenta a resposta podia chegar quando ela já estava digitando (login, lançamento) e o location.replace apagaria o que ela digitou.
describe('abertura segura: resposta lenta ou pessoa que já mexeu na página não recarregam', () => {
  const ID_NO_AR = 'versao-do-ar-9'
  type Modulo = typeof import('../../src/lib/atualizacao')
  const carregar = async (): Promise<Modulo> => { vi.resetModules(); return import('../../src/lib/atualizacao') }
  /** version.json que só responde depois de `ms` e que respeita o cancelamento (AbortController), como o fetch de verdade. */
  const respondeEm = (ms: number) => (_url: string, init?: RequestInit) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok: true, json: async () => ({ id: ID_NO_AR }) }), ms)
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelado', 'AbortError')) })
  })
  const andar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  const trocas = () => vi.mocked(location.replace)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { pathname: '/', hash: '#/compra/lista', replace: vi.fn(), reload: vi.fn() })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (document as unknown as Record<string, unknown>).visibilityState
    sessionStorage.clear()
  })

  it('resposta lenta (mais de 3 s) na abertura: desiste sem trocar e sem erro ("sem_resposta"), cancelando a pergunta', async () => {
    const lib = await carregar()
    const f = vi.fn(respondeEm(10_000))
    vi.stubGlobal('fetch', f)
    const resultado = lib.conferirVersao('abertura')
    await andar(2_999)
    expect(trocas()).not.toHaveBeenCalled() // ainda dentro do limite: esperando
    await andar(1)
    await expect(resultado).resolves.toBe('sem_resposta')
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
    expect(trocas()).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('spazio_versao_tentada')).toBeNull()
  })

  it('o limite de 3 s é só da abertura: a conferência periódica e o botão (manual) esperam a resposta lenta', async () => {
    const lib = await carregar()
    vi.stubGlobal('fetch', vi.fn(respondeEm(8_000)))
    const periodica = lib.conferirVersao('periodica')
    await andar(8_000)
    await expect(periodica).resolves.toBe('nova')
    const manual = lib.conferirVersao('manual')
    await andar(8_000)
    await expect(manual).resolves.toBe('aplicando')
    expect(trocas()).toHaveBeenCalledTimes(1)
  })

  it('abertura lenta não deixa a pessoa sem aviso: a conferência de 60 s mostra a faixa depois, sem recarregar', async () => {
    const lib = await carregar()
    const { result } = renderHook(() => lib.useNovaVersao())
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(respondeEm(10_000)).mockImplementation(respondeEm(100)))
    lib.iniciarAtualizacao()
    await andar(3_000)
    expect(result.current).toBeNull() // a abertura desistiu e ainda não avisou nada
    await andar(60_000)
    expect(result.current).toBe(ID_NO_AR)
    expect(trocas()).not.toHaveBeenCalled()
  })

  it.each(['pointerdown', 'touchstart', 'keydown', 'input', 'focusin'])(
    '"%s" antes da resposta da abertura: a pessoa já está usando a página, então NÃO recarrega e só mostra a faixa',
    async (evento) => {
      const lib = await carregar()
      const { result } = renderHook(() => lib.useNovaVersao())
      vi.stubGlobal('fetch', vi.fn(respondeEm(1_000)))
      lib.iniciarAtualizacao()
      await andar(500)
      document.body.dispatchEvent(new Event(evento, { bubbles: true })) // chega ao document na fase de captura
      await andar(600)
      expect(result.current).toBe(ID_NO_AR)
      expect(trocas()).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('spazio_versao_tentada')).toBeNull()
    },
  )

  it('sem interação e com resposta rápida (menos de 3 s): a abertura continua trocando sozinha', async () => {
    const lib = await carregar()
    vi.stubGlobal('fetch', vi.fn(respondeEm(1_000)))
    lib.iniciarAtualizacao()
    await andar(1_000)
    await andar(0)
    expect(trocas()).toHaveBeenCalledWith(`/?v=${ID_NO_AR}#/compra/lista`)
  })

  it('o botão Atualizar (manual) continua trocando sempre, mesmo com a pessoa tendo mexido na página e a resposta sendo lenta (ela clicou)', async () => {
    const lib = await carregar()
    vi.stubGlobal('fetch', vi.fn(respondeEm(5_000)))
    lib.iniciarAtualizacao()
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }))
    await andar(3_000) // a abertura desistiu
    const manual = lib.conferirVersao('manual')
    await andar(5_000)
    await andar(0)
    await expect(manual).resolves.toBe('aplicando')
    expect(trocas()).toHaveBeenCalledTimes(1)
  })
})
