// Leitor de código de barras ao vivo (pedido do Ivan, 27/11/2026): abre a câmera com uma linha no meio da tela, lê sozinho e entrega os 44 dígitos. Sem bater foto.
// Se não ler, "Tirar foto" (flash automático) e, por fora, "Digitar o número". A luz (lanterna) liga por um botão, quando o aparelho deixa.
import { useEffect, useRef, useState } from 'react'
import { cinzaDoDesenho, criarLeitorDeBarras, lerDigitosDaFoto, type LeitorDeBarras } from './boletoFoto'
import { abrirCamera, fotoComFlashAutomatico, lanternaDisponivel, pararCamera, trocarLanterna } from './cameraAoVivo'

/** Quantas vezes por segundo a tela tenta ler (a leitura pesa; o suficiente para parecer instantâneo). */
const INTERVALO_MS = 220

type Situacao = 'abrindo' | 'lendo' | 'sem-permissao' | 'sem-camera'

export default function LeitorAoVivo({ aoLer, aoFechar, aoDigitar }: {
  /** Recebe os 44 dígitos lidos. */
  aoLer: (digitos: string) => void
  aoFechar: () => void
  /** O leitor não serviu: o Ivan prefere digitar o número. */
  aoDigitar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const fluxo = useRef<MediaStream | null>(null)
  const leitor = useRef<LeitorDeBarras | null>(null)
  const encerrado = useRef(false)
  const [situacao, setSituacao] = useState<Situacao>('abrindo')
  const [temLuz, setTemLuz] = useState(false)
  const [luz, setLuz] = useState(false)
  const [tirando, setTirando] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    encerrado.current = false
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const entregar = (digitos: string) => {
      if (encerrado.current) return
      encerrado.current = true
      try { navigator.vibrate?.(80) } catch { /* sem vibração */ }
      pararCamera(fluxo.current)
      aoLer(digitos)
    }
    const quadro = async () => {
      if (encerrado.current) return
      const v = video.current
      if (v && leitor.current && v.videoWidth > 0 && !v.paused) {
        const q = cinzaDoDesenho(v, v.videoWidth, v.videoHeight, 1280)
        const digitos = q ? leitor.current(q.cinza, q.largura, q.altura) : null
        if (digitos) return entregar(digitos)
      }
      temporizador = setTimeout(() => void quadro(), INTERVALO_MS)
    }
    ;(async () => {
      try {
        const f = await abrirCamera()
        if (encerrado.current) { pararCamera(f); return }
        fluxo.current = f
        setTemLuz(lanternaDisponivel(f.getVideoTracks()[0]))
        if (video.current) { video.current.srcObject = f; void video.current.play().catch(() => undefined) } // sem esperar o play: em alguns aparelhos ele demora para responder
        setSituacao('lendo')
        leitor.current = await criarLeitorDeBarras()
        void quadro()
      } catch (e) {
        const nome = e instanceof Error ? e.name : ''
        setSituacao(nome === 'NotAllowedError' || nome === 'SecurityError' ? 'sem-permissao' : 'sem-camera')
      }
    })()
    return () => {
      encerrado.current = true
      if (temporizador) clearTimeout(temporizador)
      pararCamera(fluxo.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abre a câmera uma vez por abertura do leitor
  }, [])

  const alternarLuz = async () => {
    const quer = !luz
    if (await trocarLanterna(fluxo.current?.getVideoTracks()[0], quer)) setLuz(quer)
    else setAviso('Este aparelho não deixou ligar a luz.')
  }

  const tirarFoto = async () => {
    if (tirando) return
    setTirando(true)
    setAviso('')
    try {
      const trilha = fluxo.current?.getVideoTracks()[0]
      let digitos: string | null = null
      const foto = await fotoComFlashAutomatico(trilha)
      if (foto) digitos = await lerDigitosDaFoto(new File([foto], 'boleto.jpg', { type: foto.type || 'image/jpeg' }))
      if (!digitos && video.current && video.current.videoWidth > 0) {
        const q = cinzaDoDesenho(video.current, video.current.videoWidth, video.current.videoHeight)
        if (q) digitos = (leitor.current ?? (await criarLeitorDeBarras()))(q.cinza, q.largura, q.altura)
      }
      if (digitos && !encerrado.current) {
        encerrado.current = true
        pararCamera(fluxo.current)
        aoLer(digitos)
      } else setAviso('Não achei o código de barras nesta foto. Chegue mais perto, deixe o código reto e bem iluminado, ou digite o número.')
    } finally {
      setTirando(false)
    }
  }

  return (
    <div className="leitor-vivo" role="dialog" aria-modal="true" aria-label="Ler código de barras do boleto" data-testid="leitor-vivo">
      <video ref={video} className="leitor-vivo-video" playsInline muted autoPlay />
      {situacao === 'lendo' && <div className="leitor-vivo-linha" aria-hidden="true" />}
      <div className="leitor-vivo-topo">
        <p data-testid="leitor-vivo-dica">
          {situacao === 'abrindo' ? 'Abrindo a câmera…'
            : situacao === 'sem-permissao' ? 'Permita o uso da câmera para ler o boleto. Você pode tirar foto ou digitar o número.'
            : situacao === 'sem-camera' ? 'Não consegui abrir a câmera neste aparelho. Digite o número do boleto.'
            : 'Deixe o código de barras do boleto na linha vermelha.'}
        </p>
      </div>
      <div className="leitor-vivo-base">
        {aviso && <p role="status" className="leitor-vivo-aviso" data-testid="leitor-vivo-aviso">{aviso}</p>}
        {situacao === 'lendo' && !temLuz && <p className="leitor-vivo-nota" data-testid="leitor-vivo-sem-luz">Este aparelho não deixa o app ligar a luz.</p>}
        <div className="leitor-vivo-botoes">
          {temLuz && <button type="button" className="botao secundario" aria-pressed={luz} onClick={() => void alternarLuz()} data-testid="leitor-vivo-luz">{luz ? 'Apagar a luz' : 'Ligar a luz'}</button>}
          {situacao === 'lendo' && <button type="button" className="botao secundario" disabled={tirando} onClick={() => void tirarFoto()} data-testid="leitor-vivo-foto">{tirando ? 'Lendo a foto…' : 'Tirar foto'}</button>}
          <button type="button" className="botao secundario" onClick={aoDigitar} data-testid="leitor-vivo-digitar">Digitar o número</button>
          <button type="button" className="botao" onClick={aoFechar} data-testid="leitor-vivo-fechar">Fechar</button>
        </div>
      </div>
    </div>
  )
}
