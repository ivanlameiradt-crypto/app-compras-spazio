import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LeitorAoVivo from '../../src/admin/LeitorAoVivo'
import LerBoletoPorFoto from '../../src/admin/LerBoletoPorFoto'
import { barras } from '../unit/boletoAjuda'

const CODIGO = barras('341', '1656', '46974')
const lerQuadro = vi.fn<(c: Uint8ClampedArray, l: number, a: number) => string | null>()

vi.mock('../../src/admin/boletoFoto', () => ({
  criarLeitorDeBarras: async () => (c: Uint8ClampedArray, l: number, a: number) => lerQuadro(c, l, a),
  cinzaDoDesenho: () => ({ cinza: new Uint8ClampedArray(4), largura: 2, altura: 2 }),
  lerDigitosDaFoto: vi.fn(async () => null),
  lerDigitosDaImagem: vi.fn(async () => null),
}))

function trilha(comLuz: boolean) {
  return {
    stop: vi.fn(),
    getCapabilities: () => (comLuz ? { torch: true } : {}),
    applyConstraints: vi.fn(async () => undefined),
  }
}
function camera(t: ReturnType<typeof trilha>) {
  const fluxo = { getTracks: () => [t], getVideoTracks: () => [t] }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => fluxo) } })
  return fluxo
}

beforeEach(() => {
  lerQuadro.mockReset()
  lerQuadro.mockReturnValue(null)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false })
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
})

describe('LeitorAoVivo — câmera ao vivo para o código de barras do boleto (27/11)', () => {
  it('abre a câmera, lê sozinho, entrega os 44 dígitos e desliga a câmera', async () => {
    const t = trilha(true)
    camera(t)
    const aoLer = vi.fn()
    render(<LeitorAoVivo aoLer={aoLer} aoFechar={vi.fn()} aoDigitar={vi.fn()} />)
    await screen.findByText(/Deixe o código de barras/)
    lerQuadro.mockReturnValue(CODIGO)
    await waitFor(() => expect(aoLer).toHaveBeenCalledWith(CODIGO), { timeout: 3000 })
    expect(aoLer).toHaveBeenCalledTimes(1)
    expect(t.stop).toHaveBeenCalled()
  })

  it('com lanterna no aparelho: o botão liga e apaga a luz', async () => {
    const t = trilha(true)
    camera(t)
    render(<LeitorAoVivo aoLer={vi.fn()} aoFechar={vi.fn()} aoDigitar={vi.fn()} />)
    const botao = await screen.findByTestId('leitor-vivo-luz')
    await userEvent.click(botao)
    expect(t.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
    expect(await screen.findByText('Apagar a luz')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('leitor-vivo-luz'))
    expect(t.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] })
  })

  it('sem lanterna (iPhone): não tem botão de luz e a tela diz por quê', async () => {
    camera(trilha(false))
    render(<LeitorAoVivo aoLer={vi.fn()} aoFechar={vi.fn()} aoDigitar={vi.fn()} />)
    expect(await screen.findByTestId('leitor-vivo-sem-luz')).toHaveTextContent('não deixa o app ligar a luz')
    expect(screen.queryByTestId('leitor-vivo-luz')).toBeNull()
  })

  it('câmera negada: mostra o aviso e deixa digitar o número', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }) } })
    const aoDigitar = vi.fn()
    render(<LeitorAoVivo aoLer={vi.fn()} aoFechar={vi.fn()} aoDigitar={aoDigitar} />)
    expect(await screen.findByText(/Permita o uso da câmera/)).toBeInTheDocument()
    expect(screen.queryByTestId('leitor-vivo-foto')).toBeNull()
    await userEvent.click(screen.getByTestId('leitor-vivo-digitar'))
    expect(aoDigitar).toHaveBeenCalled()
  })

  it('o botão de cada boleto abre o leitor ao vivo e o código lido preenche a parcela', async () => {
    camera(trilha(false))
    const onBoleto = vi.fn((_b: unknown) => ({ ok: true, texto: 'Boleto lido' }))
    render(<LerBoletoPorFoto desabilitado={false} onBoleto={onBoleto} />)
    await userEvent.click(screen.getByTestId('boleto-foto-botao'))
    await screen.findByTestId('leitor-vivo')
    lerQuadro.mockReturnValue(CODIGO)
    await waitFor(() => expect(onBoleto).toHaveBeenCalled(), { timeout: 3000 })
    expect(onBoleto.mock.calls[0][0]).toMatchObject({ valor: 469.74 })
    expect(screen.queryByTestId('leitor-vivo')).toBeNull()
  })
})
