/** Reduz a foto do cupom (celular tira 5–10 MB) para ~1600 px em JPEG. Se não der, devolve a original. */
export async function reduzirFoto(arquivo: File, lado = 1600, qualidade = 0.7): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(arquivo)
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * escala)
    canvas.height = Math.round(bmp.height * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) return arquivo
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', qualidade))
    return blob ?? arquivo
  } catch {
    return arquivo
  }
}

/** Frase para a pessoa quando o envio da foto do cupom é recusado (item 2 da análise de 07/11/2026: bucket só aceita JPG, PNG e WEBP, até 10 MB). */
export function mensagemDeErroDaFoto(mensagem: string): string {
  const m = String(mensagem ?? '')
  if (/exceed|maximum|too large|payload|size/i.test(m)) return 'A foto é grande demais (limite de 10 MB). Tire outra foto ou mande um print.'
  if (/mime|content.?type|not supported|tipo/i.test(m)) return 'A foto precisa ser JPG, PNG ou WEBP. Tire outra foto ou mande um print.'
  return 'Não consegui enviar a foto. Tente de novo.'
}
