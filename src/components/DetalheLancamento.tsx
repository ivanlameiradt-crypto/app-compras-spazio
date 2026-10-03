// Detalhe clicável de um lançamento (o que entrou no SisChef): nº do pedido + itens com quantidade e valor.
// Genérico de propósito — o cupom usa hoje; a aba Nota SEFAZ (Fase 3) vai reusar o mesmo componente.
import { formatarReais } from '../lib/regras'

export interface LinhaDetalhe {
  descricao: string
  quantidade: number | null
  valor: number | null
}

const qtd = (q: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(q)

export default function DetalheLancamento({ pedido, itens }: { pedido: string | null; itens: LinhaDetalhe[] }) {
  return (
    <div className="detalhe">
      {pedido && <p className="detalhe-pedido">Pedido no SisChef: <b>{pedido}</b></p>}
      {itens.length === 0 ? (
        <p className="sub">Sem itens para mostrar.</p>
      ) : (
        <ul className="detalhe-itens">
          {itens.map((it, i) => (
            <li key={i}>
              <span className="desc">{it.descricao}</span>
              <span className="nums">
                {it.quantidade != null && `qtd ${qtd(it.quantidade)}`}
                {it.quantidade != null && it.valor != null && ' · '}
                {it.valor != null && formatarReais(it.valor)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
