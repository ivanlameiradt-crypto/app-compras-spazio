// Detalhe clicável de um lançamento (o que entrou no SisChef): nº do pedido + itens com quantidade, unidade e valor.
// Genérico de propósito — o cupom usa hoje; a aba Nota SEFAZ (Fase 3) vai reusar o mesmo componente.
import { formatarReais } from '../lib/regras'

export interface LinhaDetalhe {
  descricao: string
  quantidade: number | null
  unidade: string | null
  valor: number | null
}

const qtd = (q: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(q)
/** Unidade exata do cupom (UND, KG, PCT…), só em minúscula para ler melhor — nunca inventada: vazio quando não veio. */
const unid = (u: string | null): string => (u ? u.trim().toLowerCase() : '')

export default function DetalheLancamento({ pedido, itens, rotulo = 'Pedido no SisChef' }: { pedido: string | null; itens: LinhaDetalhe[]; rotulo?: string }) {
  return (
    <div className="detalhe">
      {pedido && <p className="detalhe-pedido">{rotulo}: <b>{pedido}</b></p>}
      {itens.length === 0 ? (
        <p className="sub">Sem itens para mostrar.</p>
      ) : (
        <ul className="detalhe-itens">
          {itens.map((it, i) => {
            const u = unid(it.unidade)
            return (
              <li key={i}>
                <span className="desc">{it.descricao}</span>
                <span className="nums">
                  {it.quantidade != null && `qtd ${qtd(it.quantidade)}${u ? ` ${u}` : ''}`}
                  {it.quantidade != null && it.valor != null && ' · '}
                  {it.valor != null && formatarReais(it.valor)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
