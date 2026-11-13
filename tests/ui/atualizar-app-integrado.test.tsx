import { act, fireEvent, render, screen } from '@testing-library/react'
import AvisoNovaVersao from '../../src/components/AvisoNovaVersao'
import { iniciarAtualizacao } from '../../src/lib/atualizacao'

declare const __BUILD_ID__: string

// Teste "de ponta a ponta" do módulo de verdade (sem mock): a conferência automática liga UMA vez (iniciarAtualizacao) e os testes seguem em ordem, com relógio falso.
// Regra do dono (13/11/2026): o app NUNCA recarrega sozinho com a pessoa trabalhando; a faixa "Tem uma versão nova do app." aparece e só o clique em Atualizar troca.
// Cobre também a "regra C" (procurar versão nova a cada 10 min e ao voltar a ficar visível): aqui a conferência é a cada 60 s com a aba visível, ao voltar
// do fundo e quando a internet volta, que é MAIS frequente que os 10 minutos pedidos.
describe('conferência automática de versão (módulo real, relógio falso)', () => {
  let idNoAr = __BUILD_ID__
  let visivel = true
  const urlsConsultadas: string[] = [] // todas as idas à rede por version.json, em ordem (fora do histórico dos mocks, que o vitest zera entre os testes)
  const recargas: string[] = [] // toda vez que o app mandou recarregar/trocar a página, em ordem
  const buscar = async (url: string) => { urlsConsultadas.push(url); return { ok: true, json: async () => ({ id: idNoAr }) } }
  const localizacao = {
    pathname: '/',
    hash: '#/compra/lista',
    replace: (url: string) => { recargas.push(`replace ${url}`) },
    reload: () => { recargas.push('reload') },
  }

  const passar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  const mudarVisibilidade = async (v: boolean) => {
    visivel = v
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  }
  const conferencias = () => urlsConsultadas.length

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', buscar)
    vi.stubGlobal('location', localizacao)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visivel ? 'visible' : 'hidden') })
    iniciarAtualizacao()
    await passar(0)
  })
  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (document as unknown as Record<string, unknown>).visibilityState
    sessionStorage.clear()
  })

  it('na abertura confere a versão do ar uma vez, na rede e sem cache; igual à que roda: nada aparece e nada recarrega', () => {
    expect(urlsConsultadas).toHaveLength(1)
    expect(urlsConsultadas[0]).toMatch(/version\.json\?t=\d+$/)
    render(<AvisoNovaVersao />)
    expect(screen.queryByTestId('aviso-nova-versao')).not.toBeInTheDocument()
    expect(recargas).toEqual([])
  })

  it('a cada 60 s com a aba visível confere de novo (em 10 minutos são 10 conferências, mais que o pedido)', async () => {
    const antes = conferencias()
    await passar(60_000)
    expect(conferencias()).toBe(antes + 1)
    await passar(9 * 60_000)
    expect(conferencias()).toBe(antes + 10)
  })

  it('com a aba escondida não gasta rede; ao voltar a ficar visível confere na hora', async () => {
    await mudarVisibilidade(false)
    const escondida = conferencias()
    await passar(5 * 60_000)
    expect(conferencias()).toBe(escondida) // aba escondida: nenhuma conferência periódica
    await mudarVisibilidade(true)
    expect(conferencias()).toBe(escondida + 1) // voltou a ficar visível: conferiu na hora
  })

  it('quando a internet volta confere na hora', async () => {
    const antes = conferencias()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(conferencias()).toBe(antes + 1)
  })

  it('ao voltar do fundo depois de bastante tempo com versão nova no ar: a página NÃO recarrega, a faixa aparece e nada é "tentado"', async () => {
    render(<AvisoNovaVersao />)
    expect(screen.queryByTestId('aviso-nova-versao')).not.toBeInTheDocument()
    idNoAr = 'versao-nova-13-11'
    await mudarVisibilidade(false)
    await passar(10 * 60_000) // dez minutos no bolso
    await mudarVisibilidade(true)
    expect(screen.getByRole('status')).toHaveTextContent('Tem uma versão nova do app.')
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument()
    expect(recargas).toEqual([])
    expect(sessionStorage.getItem('spazio_versao_tentada')).toBeNull()
  })

  it('com a faixa na tela e o app em uso por mais um tempo: continua só avisando, nunca recarrega sozinho', async () => {
    render(<AvisoNovaVersao />) // a versão nova já vista continua guardada: a faixa aparece de novo
    await passar(30 * 60_000)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(screen.getByTestId('aviso-nova-versao')).toBeInTheDocument()
    expect(recargas).toEqual([])
  })

  it('só ao clicar em "Atualizar" a troca acontece, mantendo a tela em que a pessoa está', async () => {
    render(<AvisoNovaVersao />)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await passar(0)
    expect(recargas).toEqual(['replace /?v=versao-nova-13-11#/compra/lista'])
    expect(sessionStorage.getItem('spazio_versao_tentada')).toBe('versao-nova-13-11')
  })
})
