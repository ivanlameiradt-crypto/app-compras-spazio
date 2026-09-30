// Reduz um print no próprio aparelho antes de mandar à IA (B.8): lado maior até 1.568 px, JPEG de qualidade 0,85 (0,70
// se passar de 600 kB). A função não guarda nada; o base64 vai só na chamada da Edge Function. Imagem que não abre →
// ErroImagem (a tela mostra "Não consegui abrir esta imagem. Mande um print (JPG ou PNG).").
import type { ImagemIA } from '../lib/tipos'

export class ErroImagem extends Error {
  codigo = 'imagem'
  constructor(mensagem = 'Não consegui abrir esta imagem. Mande um print (JPG ou PNG).') {
    super(mensagem)
    this.name = 'ErroImagem'
  }
}

// Lado maior até 1.568 px (limite de nitidez da API). O teto de megapixel (guarda para prints quase quadrados/panorâmicos)
// fica acima do que o lado de 1.568 gera numa foto comum 2:1 (1568×784 ≈ 1,23 MP), para o lado ser o limite normal.
const LADO_MAX = 1568
const MP_MAX = 1_300_000
const BYTES_ALTA = 600_000

function dimensoes(largura: number, altura: number): { w: number; h: number } {
  const fator = Math.min(1, LADO_MAX / Math.max(largura, altura), Math.sqrt(MP_MAX / (largura * altura)))
  return { w: Math.max(1, Math.round(largura * fator)), h: Math.max(1, Math.round(altura * fator)) }
}

/** Tamanho em bytes de uma string base64 (sem o cabeçalho data:). */
function bytesBase64(base64: string): number {
  const semPad = base64.replace(/=+$/, '')
  return Math.floor((semPad.length * 3) / 4)
}

export async function reduzirImagem(arquivo: Blob): Promise<ImagemIA> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
  } catch {
    throw new ErroImagem()
  }
  try {
    const { w, h } = dimensoes(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ErroImagem()
    ctx.drawImage(bitmap, 0, 0, w, h)
    const base64De = (q: number) => {
      const url = canvas.toDataURL('image/jpeg', q)
      const virgula = url.indexOf(',')
      if (!url.startsWith('data:image/jpeg') || virgula < 0) throw new ErroImagem()
      return url.slice(virgula + 1)
    }
    let base64 = base64De(0.85)
    if (bytesBase64(base64) > BYTES_ALTA) base64 = base64De(0.7)
    return { media_type: 'image/jpeg', base64 }
  } finally {
    bitmap.close?.()
  }
}
