// "Copiar mensagem" / "Copiar link" (ajuste Foozi 4, contrato 8.3, D46).
import { copiarTexto } from '../../src/cotacao/copiar'

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
function comClipboard(valor: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value: valor, configurable: true })
}
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else delete (navigator as unknown as Record<string, unknown>).clipboard
})

describe('copiarTexto', () => {
  it('chama writeText na hora (antes de qualquer espera) e devolve true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    comClipboard({ writeText })
    const p = copiarTexto('Oi, Fulano!')
    expect(writeText).toHaveBeenCalledWith('Oi, Fulano!') // síncrono, ainda dentro do toque
    await expect(p).resolves.toBe(true)
  })

  it('navegador que nega a cópia → false', async () => {
    comClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    await expect(copiarTexto('x')).resolves.toBe(false)
  })

  it('navegador sem a API → false', async () => {
    comClipboard(undefined)
    await expect(copiarTexto('x')).resolves.toBe(false)
  })

  it('writeText que lança na hora → false', async () => {
    comClipboard({ writeText: () => { throw new Error('sem permissão') } })
    await expect(copiarTexto('x')).resolves.toBe(false)
  })
})
