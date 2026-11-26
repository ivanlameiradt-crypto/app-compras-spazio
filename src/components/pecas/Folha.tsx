import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from '../Icones'

// Folha: painel por cima da tela com fundo escuro atrás (manual visual v2, peça 5B-2). Adaptada da Folha do Tiquei (src/componentes/ui/Folha.tsx).
// No celular sobe da borda de baixo; no computador (768 px ou mais) vira gaveta na lateral direita. O foco entra nela, o Tab não sai, Esc e o fundo fecham,
// e ao fechar o foco volta para o botão que abriu. A tela de trás não rola enquanto ela está aberta.
const FOCAVEIS = 'a[href], button, input, select, textarea, [tabindex]'

export default function Folha({ titulo, aoFechar, rodape, children }: { titulo: string; aoFechar: () => void; rodape?: ReactNode; children: ReactNode }) {
  const idTitulo = useId()
  const caixa = useRef<HTMLDivElement>(null)
  const fechar = useRef(aoFechar)
  useEffect(() => { fechar.current = aoFechar })

  useEffect(() => {
    const quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rolagemAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    caixa.current?.querySelector<HTMLElement>('[data-fechar]')?.focus({ preventScroll: true })
    const aoApertar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); fechar.current(); return }
      if (ev.key !== 'Tab' || !caixa.current) return
      const itens = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0)
      if (itens.length === 0) return
      const primeiro = itens[0], ultimo = itens[itens.length - 1]
      const atual = document.activeElement
      if (ev.shiftKey && (atual === primeiro || !caixa.current.contains(atual))) { ultimo.focus(); ev.preventDefault() }
      else if (!ev.shiftKey && (atual === ultimo || !caixa.current.contains(atual))) { primeiro.focus(); ev.preventDefault() }
    }
    document.addEventListener('keydown', aoApertar)
    return () => {
      document.removeEventListener('keydown', aoApertar)
      document.body.style.overflow = rolagemAntes
      if (quemAbriu?.isConnected) quemAbriu.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <>
      <div className="folha-fundo" aria-hidden="true" onClick={aoFechar} />
      <div ref={caixa} className="folha" role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <div className="folha-topo">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" data-fechar className="folha-fechar" aria-label="Fechar" onClick={aoFechar}><Icone nome="fechar" tamanho={24} /></button>
        </div>
        <div className="folha-corpo">{children}</div>
        {rodape && <div className="folha-rodape">{rodape}</div>}
      </div>
    </>,
    document.body,
  )
}
