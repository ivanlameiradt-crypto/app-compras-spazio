// Ler o código de barras do boleto a partir de uma FOTO ou de quadros da câmera ao vivo (pedido do Ivan, 25 e 27/11/2026). Tudo roda no aparelho: a imagem não sai do celular nem do computador.
// A biblioteca de leitura (ZXing) só é baixada quando alguém abre o leitor (import dinâmico): o app abre igual para quem não usa.
// A conta do valor e do vencimento está em boletoRegras.ts; aqui só se acham os dígitos na imagem.
import { lerBoleto } from './boletoRegras'

/** Lado maior da imagem usada na leitura de UMA FOTO (tentativas): a foto de celular tem 8 a 12 megapixels e o código do boleto é fino; reduzir demais o apaga. */
const LADOS_DA_FOTO = [2400, 1600, 3600]

export type LeitorDeBarras = (cinza: Uint8ClampedArray, largura: number, altura: number) => string | null

/** Só vale o que é um código de boleto de cobrança de verdade: 44 dígitos e o dígito verificador conferindo (leitura com um dígito trocado é descartada e o laço tenta o quadro seguinte). */
const codigoDeBoleto = (texto: string): string | null => (/^\d{44}$/.test(texto) && lerBoleto(texto).ok ? texto : null)

/** Estica o contraste (2% mais escuros viram preto, 2% mais claros viram branco): papel cinzento, sombra e reflexo deixam as barras finas parecidas com o fundo. */
export function esticarContraste(cinza: Uint8ClampedArray): Uint8ClampedArray {
  const hist = new Uint32Array(256)
  for (let i = 0; i < cinza.length; i++) hist[cinza[i]]++
  const corte = cinza.length * 0.02
  let baixo = 0
  let soma = 0
  while (baixo < 255 && soma + hist[baixo] < corte) soma += hist[baixo++]
  let alto = 255
  soma = 0
  while (alto > 0 && soma + hist[alto] < corte) soma += hist[alto--]
  if (alto - baixo < 16) return cinza
  const saida = new Uint8ClampedArray(cinza.length)
  const k = 255 / (alto - baixo)
  for (let i = 0; i < cinza.length; i++) saida[i] = (cinza[i] - baixo) * k
  return saida
}

/** Recorta a faixa horizontal do meio (o boleto é lido no sentido da largura; o código quase nunca ocupa a altura toda). */
export function faixaDoMeio(cinza: Uint8ClampedArray, largura: number, altura: number, fracao = 0.4): { cinza: Uint8ClampedArray; largura: number; altura: number } {
  const h = Math.max(1, Math.round(altura * fracao))
  const y0 = Math.floor((altura - h) / 2)
  return { cinza: cinza.slice(y0 * largura, (y0 + h) * largura), largura, altura: h }
}

/**
 * Monta o leitor de código ITF (o formato do boleto) UMA vez, para a câmera ao vivo chamar muitas vezes por segundo sem recriar nada. Cada chamada recebe uma imagem em
 * tons de cinza (um byte por ponto), tenta de pé e girada 90 graus (boleto deitado ou em pé) e devolve os 44 dígitos ou null.
 * ATENÇÃO (revisão de 27/11): `decode(imagem)` do ZXing APAGA as dicas guardadas em `setHints`; só `decodeWithState(imagem)` as usa. Com `decode` o leitor rodava com todos os
 * formatos e SEM o modo "esforço máximo", e lia pouco no celular. É por isso que aqui é `decodeWithState`.
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
      return codigoDeBoleto(leitor.decodeWithState(new BinaryBitmap(new HybridBinarizer(fonte))).getText())
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

/** Uma imagem só: o mesmo leitor, uma vez. */
export async function lerDigitosDaImagem(cinza: Uint8ClampedArray, largura: number, altura: number): Promise<string | null> {
  return (await criarLeitorDeBarras())(cinza, largura, altura)
}

type DetectorDoNavegador = { detect: (f: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/** Leitor nativo do navegador (Android/Chrome costuma ter, e lê melhor que a biblioteca: foco e várias escalas). null quando o aparelho não tem ou não lê ITF. */
export async function criarDetectorNativo(): Promise<((fonte: CanvasImageSource) => Promise<string | null>) | null> {
  try {
    const Detector = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): DetectorDoNavegador; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
    if (!Detector) return null
    const formatos = (await Detector.getSupportedFormats?.()) ?? []
    if (!formatos.includes('itf')) return null
    const detector = new Detector({ formats: ['itf'] })
    return async (fonte) => {
      try {
        for (const r of await detector.detect(fonte)) {
          const c = codigoDeBoleto(r.rawValue)
          if (c) return c
        }
      } catch { /* quadro ruim: tenta o próximo */ }
      return null
    }
  } catch {
    return null
  }
}

// Um canvas só, reaproveitado (criar um por quadro, várias vezes por segundo, pesa e enche a memória do celular).
let telaDeLeitura: HTMLCanvasElement | null = null

/** Imagem desenhada num canvas -> tons de cinza, reduzida só se o lado maior passar de `ladoMaximo` (nunca aumentada). */
export function cinzaDoDesenho(fonte: CanvasImageSource, larguraOrigem: number, alturaOrigem: number, ladoMaximo = 1920): { cinza: Uint8ClampedArray; largura: number; altura: number } | null {
  const escala = Math.min(1, ladoMaximo / Math.max(larguraOrigem, alturaOrigem))
  const largura = Math.max(1, Math.round(larguraOrigem * escala))
  const altura = Math.max(1, Math.round(alturaOrigem * escala))
  const tela = (telaDeLeitura ??= document.createElement('canvas'))
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

/**
 * Um quadro da câmera ao vivo: alterna a cada chamada (contador `n`) entre a imagem inteira e a faixa do meio com contraste esticado, as duas na resolução do vídeo.
 * Devolve os 44 dígitos ou null.
 */
export function lerQuadroAoVivo(leitor: LeitorDeBarras, fonte: CanvasImageSource, largura: number, altura: number, n: number): string | null {
  const q = cinzaDoDesenho(fonte, largura, altura)
  if (!q) return null
  if (n % 2 === 0) return leitor(q.cinza, q.largura, q.altura)
  const f = faixaDoMeio(q.cinza, q.largura, q.altura)
  return leitor(esticarContraste(f.cinza), f.largura, f.altura)
}

/** Abre o arquivo de foto e lê em até 3 tamanhos (sem encolher a foto boa), cada um inteiro e pela faixa do meio com contraste esticado. Devolve os 44 dígitos ou null. */
export async function lerDigitosDaFoto(arquivo: File): Promise<string | null> {
  const figura = await createImageBitmap(arquivo)
  try {
    const nativo = await criarDetectorNativo()
    if (nativo) {
      const c = await nativo(figura)
      if (c) return c
    }
    const leitor = await criarLeitorDeBarras()
    for (const lado of LADOS_DA_FOTO) {
      if (lado > 1600 && Math.max(figura.width, figura.height) <= lado / 1.5) continue // a foto é menor que esse tamanho: ampliar não ajuda
      const q = cinzaDoDesenho(figura, figura.width, figura.height, lado)
      if (!q) continue
      const inteira = leitor(q.cinza, q.largura, q.altura)
      if (inteira) return inteira
      const f = faixaDoMeio(q.cinza, q.largura, q.altura)
      const faixa = leitor(esticarContraste(f.cinza), f.largura, f.altura)
      if (faixa) return faixa
    }
    return null
  } finally {
    figura.close()
  }
}
