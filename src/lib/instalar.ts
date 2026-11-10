// Instalação do app no aparelho (celular, tablet, notebook, computador).
// O navegador avisa UMA vez que o app pode ser instalado (evento "beforeinstallprompt"), às vezes antes de a tela de
// instalar existir. Este módulo é carregado logo no começo (main.tsx) e guarda o convite para o botão "Instalar agora".
import { useEffect, useState } from 'react'

interface Convite extends Event { prompt(): Promise<void> }

let convite: Convite | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); convite = e as Convite; avisar() })
  window.addEventListener('appinstalled', () => { convite = null; avisar() })
}

export type Aparelho = 'instalado' | 'dentro_de_outro_app' | 'iphone' | 'android' | 'computador'

/** iPhone e iPad. O iPad novo se apresenta como Mac: o que o entrega é a tela de toque. Função pura, para testar. */
export function ehIos(agente: string, plataforma = '', toques = 0): boolean {
  return /iPad|iPhone|iPod/.test(agente) || (plataforma === 'MacIntel' && toques > 1)
}

/** O app já está aberto como aplicativo instalado (sem a barra do navegador)? */
export function appInstalado(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/** Em que aparelho (e situação) a pessoa está, pelo que o navegador informa. Função pura, para testar. */
export function tipoDeAparelho(agente: string, o: { ios: boolean; instalado: boolean }): Aparelho {
  if (o.instalado) return 'instalado'
  // Link aberto por dentro do WhatsApp, Instagram, Facebook etc.: esses navegadores embutidos não instalam app.
  if (/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)/i.test(agente)) return 'dentro_de_outro_app'
  if (o.ios) return 'iphone'
  if (/Android/i.test(agente)) return 'android'
  return 'computador'
}

export function aparelhoAtual(): Aparelho {
  if (typeof navigator === 'undefined') return 'computador'
  const agente = navigator.userAgent ?? ''
  return tipoDeAparelho(agente, { ios: ehIos(agente, navigator.platform, navigator.maxTouchPoints), instalado: appInstalado() })
}

/** `podeInstalar`: o navegador ofereceu a instalação com um toque. `instalar()` abre a pergunta do navegador. */
export function useInstalacao(): { podeInstalar: boolean; instalar: () => Promise<void> } {
  const [, repintar] = useState(0)
  useEffect(() => {
    const f = () => repintar((n) => n + 1)
    ouvintes.add(f)
    return () => { ouvintes.delete(f) }
  }, [])
  return {
    podeInstalar: convite !== null,
    instalar: async () => {
      const c = convite
      if (!c) return
      convite = null // o convite do navegador só vale uma vez
      avisar()
      await c.prompt()
    },
  }
}
