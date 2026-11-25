// Ler o código de barras do boleto a partir de uma FOTO (pedido do Ivan, 25/11/2026). Tudo roda no aparelho: a foto não sai do celular nem do computador.
// A biblioteca de leitura (ZXing) só é baixada quando alguém toca em "Ler boleto pela foto" (import dinâmico): o app abre igual para quem não usa.
// A conta do valor e do vencimento está em boletoRegras.ts; aqui só se acham os dígitos na imagem.

/** Lado maior da imagem usada na leitura: foto de celular tem 12 megapixels, e reduzir deixa a leitura mais rápida e mais firme. */
const LADO_MAXIMO = 1600

/**
 * Procura um código ITF (o formato do boleto) numa imagem em tons de cinza (um byte por ponto). Tenta a imagem de pé e girada, porque o boleto
 * costuma sair deitado na foto. Devolve os dígitos (44) ou null.
 */
export async function lerDigitosDaImagem(cinza: Uint8ClampedArray, largura: number, altura: number): Promise<string | null> {
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
  const direta = tentar(new RGBLuminanceSource(cinza, largura, altura))
  if (direta) return direta
  // girada 90 graus (boleto fotografado em pé)
  const girada = new Uint8ClampedArray(cinza.length)
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) girada[x * altura + (altura - 1 - y)] = cinza[y * largura + x]
  return tentar(new RGBLuminanceSource(girada, altura, largura))
}

/** Abre o arquivo de foto, reduz e lê. Devolve os 44 dígitos ou null quando não achou código de barras na foto. */
export async function lerDigitosDaFoto(arquivo: File): Promise<string | null> {
  const figura = await createImageBitmap(arquivo)
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(figura.width, figura.height))
    const largura = Math.max(1, Math.round(figura.width * escala))
    const altura = Math.max(1, Math.round(figura.height * escala))
    const tela = document.createElement('canvas')
    tela.width = largura
    tela.height = altura
    const ctx = tela.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(figura, 0, 0, largura, altura)
    const rgba = ctx.getImageData(0, 0, largura, altura).data
    const cinza = new Uint8ClampedArray(largura * altura)
    for (let i = 0; i < cinza.length; i++) cinza[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000
    return await lerDigitosDaImagem(cinza, largura, altura)
  } finally {
    figura.close()
  }
}
