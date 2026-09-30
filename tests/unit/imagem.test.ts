import { ErroImagem, reduzirImagem } from '../../src/cotacao/imagem'

// Fase 2, Bloco B — reduzirImagem (B.14.3) com canvas falso (jsdom não tem canvas 2d).

interface CanvasFalso { width: number; height: number; getContext: () => unknown; toDataURL: (t: string, q: number) => string }
let ultimoCanvas: CanvasFalso
let qualidades: number[] = []
let tamanhoBase64 = 100 // caracteres devolvidos por toDataURL

function prepararCanvas() {
  const orig = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      ultimoCanvas = {
        width: 0, height: 0, getContext: () => ({ drawImage: () => {} }),
        toDataURL: (_t: string, q: number) => { qualidades.push(q); return 'data:image/jpeg;base64,' + 'A'.repeat(tamanhoBase64) },
      }
      return ultimoCanvas as unknown as HTMLCanvasElement
    }
    return orig(tag)
  })
}

beforeEach(() => {
  qualidades = []
  tamanhoBase64 = 100
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: unknown) => {
    const b = blob as { largura?: number; altura?: number }
    if (b.largura === 0) throw new Error('não abre')
    return { width: b.largura ?? 3000, height: b.altura ?? 1500, close: () => {} }
  }))
  prepararCanvas()
})
afterEach(() => vi.restoreAllMocks())

const blob = (largura: number, altura: number) => ({ largura, altura } as unknown as Blob)

it('3000×1500 → 1568×784 em JPEG', async () => {
  const r = await reduzirImagem(blob(3000, 1500))
  expect(r.media_type).toBe('image/jpeg')
  expect([ultimoCanvas.width, ultimoCanvas.height]).toEqual([1568, 784])
})

it('imagem que não abre dá a mensagem exata', async () => {
  await expect(reduzirImagem(blob(0, 0))).rejects.toBeInstanceOf(ErroImagem)
  await reduzirImagem(blob(3000, 1500)).catch(() => undefined) // sanity
  await expect(reduzirImagem(blob(0, 0))).rejects.toThrow('Não consegui abrir esta imagem. Mande um print (JPG ou PNG).')
})

it('acima de 600 kB refaz com qualidade 0,70', async () => {
  tamanhoBase64 = 900_000 // ~675 kB > 600 kB
  await reduzirImagem(blob(3000, 1500))
  expect(qualidades).toEqual([0.85, 0.7])
})

it('abaixo de 600 kB fica na qualidade 0,85', async () => {
  tamanhoBase64 = 100
  await reduzirImagem(blob(3000, 1500))
  expect(qualidades).toEqual([0.85])
})
