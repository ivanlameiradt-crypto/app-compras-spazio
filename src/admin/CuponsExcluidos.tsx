// Lista dos cupons (ou compras avulsas) que o Ivan excluiu, com o motivo e o "Voltar para a lista" (pedido do Ivan, 03/11/2026). Só aparece quando há algum.
// "Voltar" devolve o envio EXATAMENTE como estava (na fila, "precisa de você" ou teste): quem decide é o banco (cupom_restaurar). Nada foi mudado no SisChef.
import { useState } from 'react'
import * as api from '../lib/api'
import { formatarDataHora, formatarReais } from '../lib/regras'
import type { CupomRecente } from '../lib/tipos'

export interface PropsCuponsExcluidos {
  lista: CupomRecente[]
  /** "Cupons excluídos" ou "Compras excluídas". */
  titulo: string
  /** Nome para mostrar de cada envio (a tela sabe a fantasia do fornecedor). */
  nomeDe: (c: CupomRecente) => string
  /** Depois de voltar: a tela relê as listas. */
  aoMudar: () => void
}

export default function CuponsExcluidos({ lista, titulo, nomeDe, aoMudar }: PropsCuponsExcluidos) {
  const [voltando, setVoltando] = useState<string | null>(null) // id do envio que está voltando para a lista
  const [erro, setErro] = useState('')
  if (lista.length === 0) return null

  async function voltar(id: string) {
    if (voltando) return
    setVoltando(id); setErro('')
    try {
      await api.restaurarCupom(id)
      aoMudar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui voltar para a lista. Tente de novo.')
    } finally {
      setVoltando(null)
    }
  }

  return (
    <details className="conferir descartadas" data-testid="cupons-excluidos">
      <summary>{titulo} ({lista.length})</summary>
      <p className="sub">Estes envios saíram da lista e o robô não os lança. Nada foi mudado no SisChef.</p>
      <ul className="conferir-itens">
        {lista.map((c) => (
          <li key={c.id} data-testid="cupom-excluido">
            <span><b>{nomeDe(c)}</b>{c.valor_a_pagar != null && c.valor_a_pagar > 0 && ` · ${formatarReais(c.valor_a_pagar)}`} · enviado em {formatarDataHora(c.criado_em)}</span>
            {c.excluido_motivo && <span className="sub">Motivo: {c.excluido_motivo}</span>}
            <button type="button" className="link" disabled={voltando !== null} onClick={() => void voltar(c.id)}>
              {voltando === c.id ? 'Voltando…' : 'Voltar para a lista'}
            </button>
          </li>
        ))}
      </ul>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </details>
  )
}
