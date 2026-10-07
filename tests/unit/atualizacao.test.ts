import { conferirVersao } from '../../src/lib/atualizacao'

declare const __BUILD_ID__: string

// A troca de versão em si (apagar o cache e abrir ?v=) mexe em location.replace e não roda no jsdom: aqui o que importa é o que a conferência DECIDE.
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
