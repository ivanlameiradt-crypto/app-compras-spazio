import { useState, type ReactNode } from 'react'

/** No celular (até 767 px) a tela não passa de 2,5 alturas (manual visual, §5 "Tela longa"): a lista mostra os primeiros e o resto fica atrás de "Ver mais". */
const casa = (consulta: string): boolean => {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches } catch { return false }
}
const noCelular = (): boolean => casa('(max-width: 767px)')
/** Tela baixa: o notebook de 1024 x 768 mostra pouco de cada vez; nele as telas mais compridas (Economia, Pedidos) também abrem recolhidas. */
const telaBaixa = (): boolean => casa('(max-height: 800px)')

/**
 * Lista com "Ver mais": no celular mostra os primeiros `primeiros` itens e um botão "Ver mais N …" que abre todos os outros.
 * `folga`: quantos itens a mais ainda aparecem sem botão (padrão 1: não vale um botão para esconder um item só; 0 nos cartões muito altos).
 * No tablet e no computador mostra tudo, como sempre. Só aparência: nenhum item sai da lista nem muda de ordem.
 */
export default function VerMais<T>({ itens, primeiros = 5, folga = 1, naTelaBaixa = false, unidade = ['item', 'itens'], children }: {
  itens: T[]; primeiros?: number; folga?: number; naTelaBaixa?: boolean; unidade?: [string, string]; children: (visiveis: T[]) => ReactNode
}) {
  const [tudo, setTudo] = useState(false)
  const corta = !tudo && (noCelular() || (naTelaBaixa && telaBaixa())) && itens.length > primeiros + folga
  const resto = itens.length - primeiros
  return (
    <>
      {children(corta ? itens.slice(0, primeiros) : itens)}
      {corta && (
        <button type="button" className="botao secundario ver-mais" onClick={() => setTudo(true)}>
          Ver mais {resto} {resto === 1 ? unidade[0] : unidade[1]}
        </button>
      )}
    </>
  )
}

/**
 * Bloco que abre e fecha pelo título. No celular começa fechado (tela de até 2,5 alturas); no tablet e no computador começa aberto, como era.
 * Só aparência: o conteúdo é o mesmo e continua na tela (fechado, basta tocar no título).
 */
export function Recolher({ titulo, classe, naTelaBaixa = false, children }: { titulo: string; classe?: string; naTelaBaixa?: boolean; children: ReactNode }) {
  const [aberto, setAberto] = useState(() => !(noCelular() || (naTelaBaixa && telaBaixa())))
  return (
    <details className={classe ? `recolher ${classe}` : 'recolher'} open={aberto} onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="grupo">{titulo}</summary>
      {children}
    </details>
  )
}
