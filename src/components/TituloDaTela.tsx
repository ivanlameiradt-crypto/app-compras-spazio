import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** O lugar do título dentro da barra preta (criado pelo Layout). Sem Layout (telas soltas, testes), o título fica onde está. */
export const SlotDoTitulo = createContext<HTMLElement | null>(null)

const LARGA = '(min-width: 1280px)'

/** Computador largo? Lá a barra já está cheia (destinos dentro dela) e o título fica no conteúdo, como no desenho aprovado. */
function useTelaLarga(): boolean {
  const consulta = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LARGA) : null)
  const [larga, setLarga] = useState(() => consulta()?.matches === true)
  useEffect(() => {
    const m = consulta()
    if (!m) return
    const f = () => setLarga(m.matches)
    f()
    m.addEventListener?.('change', f)
    return () => m.removeEventListener?.('change', f)
  }, [])
  return larga
}

/** Título da tela. No celular e no tablet vai para dentro da barra preta, como no desenho aprovado em 10/11/2026; no computador largo e fora do Layout fica no conteúdo. */
export default function TituloDaTela({ children }: { children: ReactNode }) {
  const slot = useContext(SlotDoTitulo)
  const larga = useTelaLarga()
  if (slot && !larga) return createPortal(<h1 className="titulo-barra">{children}</h1>, slot)
  return <h2>{children}</h2>
}
