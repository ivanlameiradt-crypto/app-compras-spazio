// Câmera ao vivo para ler o código de barras do boleto (pedido do Ivan, 27/11/2026: "igual os apps de banco"). Só funções pequenas sobre o que o navegador oferece;
// a tela está em LeitorAoVivo.tsx. Tudo roda no aparelho. Precisa de HTTPS (o app já é) e da permissão da câmera.

/** A câmera de trás, em boa resolução (o código de barras do boleto é fino: precisa de nitidez). */
export async function abrirCamera(): Promise<MediaStream> {
  const dispositivos = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!dispositivos?.getUserMedia) throw new Error('sem-camera')
  return dispositivos.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
}

export function pararCamera(fluxo: MediaStream | null | undefined): void {
  fluxo?.getTracks().forEach((t) => t.stop())
}

type TrilhaComLuz = { getCapabilities?: () => { torch?: boolean } }

/** Este aparelho deixa o app ligar a lanterna? Android (Chrome) sim; iPhone não: o navegador dele não oferece. */
export function lanternaDisponivel(trilha: MediaStreamTrack | null | undefined): boolean {
  try {
    return (trilha as unknown as TrilhaComLuz | null | undefined)?.getCapabilities?.().torch === true
  } catch {
    return false
  }
}

/** Liga ou apaga a lanterna. Devolve true se o aparelho aceitou. */
export async function trocarLanterna(trilha: MediaStreamTrack | null | undefined, ligada: boolean): Promise<boolean> {
  if (!trilha || !lanternaDisponivel(trilha)) return false
  try {
    await trilha.applyConstraints({ advanced: [{ torch: ligada } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

/**
 * Foto da câmera aberta, com FLASH AUTOMÁTICO quando o aparelho oferece (só dispara no escuro). Sem a função de foto do navegador (ImageCapture), devolve null e a tela
 * usa o quadro do vídeo. O flash da foto e a luz do leitor são o mesmo recurso do aparelho: se a luz já está ligada, a foto sai iluminada por ela.
 */
export async function fotoComFlashAutomatico(trilha: MediaStreamTrack | null | undefined): Promise<Blob | null> {
  try {
    const Captura = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: (o?: { fillLightMode?: string }) => Promise<Blob> } }).ImageCapture
    if (!Captura || !trilha) return null
    return await new Captura(trilha).takePhoto({ fillLightMode: 'auto' })
  } catch {
    return null
  }
}
