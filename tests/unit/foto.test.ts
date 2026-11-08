import { mensagemDeErroDaFoto, reduzirFoto } from '../../src/lib/foto'

describe('reduzirFoto', () => {
  it('se o navegador não consegue reduzir, devolve a foto original', async () => {
    const f = new File([new Uint8Array(10)], 'cupom.jpg', { type: 'image/jpeg' })
    expect(await reduzirFoto(f)).toBe(f) // jsdom não tem createImageBitmap
  })
})

// Item 2 da análise de 07/11/2026: o bucket de fotos de cupom passa a aceitar só JPG/PNG/WEBP e até 10 MB.
// Se o envio for recusado, a pessoa vê uma frase que diz o que fazer, e não a mensagem técnica do Supabase.
describe('mensagemDeErroDaFoto', () => {
  it('arquivo grande demais: diz o limite de 10 MB', () => {
    expect(mensagemDeErroDaFoto('The object exceeded the maximum allowed size'))
      .toBe('A foto é grande demais (limite de 10 MB). Tire outra foto ou mande um print.')
  })

  it('tipo de arquivo recusado (ex.: HEIC do iPhone): pede JPG, PNG ou WEBP', () => {
    expect(mensagemDeErroDaFoto('mime type image/heic is not supported'))
      .toBe('A foto precisa ser JPG, PNG ou WEBP. Tire outra foto ou mande um print.')
  })

  it('qualquer outro erro: frase genérica para tentar de novo', () => {
    expect(mensagemDeErroDaFoto('Failed to fetch')).toBe('Não consegui enviar a foto. Tente de novo.')
    expect(mensagemDeErroDaFoto('')).toBe('Não consegui enviar a foto. Tente de novo.')
  })
})
