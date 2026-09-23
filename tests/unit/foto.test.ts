import { reduzirFoto } from '../../src/lib/foto'

describe('reduzirFoto', () => {
  it('se o navegador não consegue reduzir, devolve a foto original', async () => {
    const f = new File([new Uint8Array(10)], 'cupom.jpg', { type: 'image/jpeg' })
    expect(await reduzirFoto(f)).toBe(f) // jsdom não tem createImageBitmap
  })
})
