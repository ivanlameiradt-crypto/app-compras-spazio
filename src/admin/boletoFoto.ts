// Ler o código de barras do boleto a partir de uma FOTO (pedido do Ivan, 25/11/2026). Tudo roda no aparelho: a foto não sai do celular nem do computador.
// A biblioteca de leitura (ZXing) só é baixada quando alguém toca em "Ler boleto pela foto" (import dinâmico): o app abre igual para quem não usa.
// A conta do valor e do vencimento está em boletoRegras.ts; aqui só se acham os dígitos na imagem.

/** Lado maior da imagem usada na leitura: foto de celular tem 12 megapixels, e reduzir deixa a leitura mais rápida e mais firme. */
const LADO_MAXIMO = 1600

export type LeitorDeBarras = (cinza: Uint8ClampedArray, largura: number, altura: number) => string | null

/**
 * Monta o leitor de código ITF (o formato do boleto) UMA vez, para a câmera ao vivo chamar muitas vezes por segundo sem recriar nada. Cada chamada recebe uma imagem em
 * tons de cinza (um byte por ponto), tenta de pé e girada 90 graus (boleto deitado ou em pé) e devolve os 44 dígitos ou null.
 */
export async function criarLeitorDeBarras(): Promise<LeitorDeBarras> {
  const { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } = await import('@zxing/library')
  const leitor = new MultiFormatReader()
  const dicas = new Map<number, unknown>()
  dicas.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.ITF])
  dicas.set(DecodeHintType.TRY_HARDER, true)
  leitor.setHints(dicas as never)
  const tentar = (fonte: InstanceType<typeof RGBLuminanceSource>): string | null => {
    try {
      const texto = leitor.decode(new BinaryBitmap(new HybridBinarizer(fonte))).getText()
      return /^\d{44}$/.test(texto) ? texto : null
    } catch {
      return null
    }
  }
  return (cinza, largura, altura) => {
    const direta = tentar(new RGBLuminanceSource(cinza, largura, altura))
    if (direta) return direta
    const girada = new Uint8ClampedArray(cinza.length)
    for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) girada[x * altura + (altura - 1 - y)] = cinza[y * largura + x]
    return tentar(new RGBLuminanceSource(girada, altura, largura))
  }
}

/** Uma imagem só (a foto): o mesmo leitor, uma vez. */
export async function lerDigitosDaImagem(cinza: Uint8ClampedArray, largura: number, altura: number): Promise<string | null> {
  return (await criarLeitorDeBarras())(cinza, largura, altura)
}

/** Imagem desenhada num canvas -> tons de cinza, reduzida para o lado maior caber em `ladoMaximo`. */
export function cinzaDoDesenho(fonte: CanvasImageSource, larguraOrigem: number, alturaOrigem: number, ladoMaximo = LADO_MAXIMO): { cinza: Uint8ClampedArray; largura: number; altura: number } | null {
  const escala = Math.min(1, ladoMaximo / Math.max(larguraOrigem, alturaOrigem))
  const largura = Math.max(1, Math.round(larguraOrigem * escala))
  const altura = Math.max(1, Math.round(alturaOrigem * escala))
  const tela = document.createElement('canvas')
  tela.width = largura
  tela.height = altura
  const ctx = tela.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(fonte, 0, 0, largura, altura)
  const rgba = ctx.getImageData(0, 0, largura, altura).data
  const cinza = new Uint8ClampedArray(largura * altura)
  for (let i = 0; i < cinza.length; i++) cinza[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000
  return { cinza, largura, altura }
}

/** Abre o arquivo de foto, reduz e lê. Devolve os 44 dígitos ou null quando não achou código de barras na foto. */
export async function lerDigitosDaFoto(arquivo: File): Promise<string | null> {
  const figura = await createImageBitmap(arquivo)
  try {
    const q = cinzaDoDesenho(figura, figura.width, figura.height)
    return q ? await lerDigitosDaImagem(q.cinza, q.largura, q.altura) : null
  } finally {
    figura.close()
  }
}
