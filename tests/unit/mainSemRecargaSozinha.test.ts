// Trava da regra do dono (13/11/2026): src/main.tsx precisa passar `onNeedReload: aoServiceWorkerNovoAssumir` ao registerSW. Sem isso o plugin do PWA
// (registerType 'autoUpdate', vite-plugin-pwa/dist/client/build/register.js) volta a recarregar a página sozinho quando o service worker novo assume a tela,
// mesmo com a pessoa digitando. Nenhum outro teste olha o main.tsx, então este roda o main de verdade com tudo em volta trocado por falsos.
const { registerSW } = vi.hoisted(() => ({ registerSW: vi.fn() }))
vi.mock('virtual:pwa-register', () => ({ registerSW }))
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render: vi.fn() })) }))
vi.mock('../../src/App', () => ({ default: () => null }))
vi.mock('../../src/lib/atualizacao', () => ({ iniciarAtualizacao: vi.fn(), aoServiceWorkerNovoAssumir: vi.fn() }))

describe('src/main.tsx: o service worker novo não recarrega a página sozinho', () => {
  it('registra o service worker com onNeedReload = aoServiceWorkerNovoAssumir (e liga a conferência de versão)', async () => {
    const raiz = document.createElement('div')
    raiz.id = 'root'
    document.body.append(raiz)
    const atualizacao = await import('../../src/lib/atualizacao')
    await import('../../src/main')
    expect(registerSW).toHaveBeenCalledTimes(1)
    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ onNeedReload: atualizacao.aoServiceWorkerNovoAssumir }))
    expect(atualizacao.iniciarAtualizacao).toHaveBeenCalledTimes(1)
  })
})
