import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** O lugar do título logo abaixo da barra preta (criado pelo Layout). Sem Layout (telas soltas, testes), o título fica onde está. */
export const SlotDoTitulo = createContext<HTMLElement | null>(null)

/** Título da tela (h1). Padrão visual único (23/11/2026): vai para o lugar logo abaixo da barra preta, em qualquer tamanho de tela; fora do Layout fica no conteúdo. */
export default function TituloDaTela({ children }: { children: ReactNode }) {
  const slot = useContext(SlotDoTitulo)
  if (slot) return createPortal(<h1 className="titulo-barra">{children}</h1>, slot)
  return <h2>{children}</h2>
}
