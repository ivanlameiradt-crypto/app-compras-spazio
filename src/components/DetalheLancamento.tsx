// Detalhe clicável de um lançamento (o que entrou no SisChef): nº do pedido + itens com quantidade, unidade e valor.
// Genérico de propósito — o cupom usa hoje; a aba Nota SEFAZ (Fase 3) vai reusar o mesmo componente.
import { formatarReais } from '../lib/regras'

export interface LinhaDetalhe {
  /** Número do produto no SisChef (Cód. Interno), em destaque na frente da descrição. Vazio = sem destaque (o cupom não usa). */
  codigo?: string | null
  descricao: string
  quantidade: number | null
  unidade: string | null
  valor: number | null
}

const qtd = (q: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(q)
/** Unidade exata do cupom (UND, KG, PCT…), só em minúscula para ler melhor — nunca inventada: vazio quando não veio. */
const unid = (u: string | null): string => (u ? u.trim().toLowerCase() : '')

export default function DetalheLancamento({ pedido, itens, rotulo = 'Pedido no SisChef', quando = null, rotuloQuando = 'Lançada em', rotuloQtd = true, fornecedor = null }: {
  pedido: string | null; itens: LinhaDetalhe[]; rotulo?: string
  /** Razão social (e CNPJ) do fornecedor, já formatados: o nome de cima é o fantasia do app, aqui fica o do cadastro. Vazio = não mostra a linha. */
  fornecedor?: string | null
  /** Escreve "qtd" na frente da quantidade (padrão: sim, como o cupom sempre fez). `false` = só o número e a unidade ("3,09 kg"). */
  rotuloQtd?: boolean
  /** Dia e hora em que o lançamento foi feito no sistema, já formatado (ex.: "06/10 às 19h05"). Vazio = não mostra a linha. */
  quando?: string | null; rotuloQuando?: string
}) {
  return (
    <div className="detalhe">
      {quando && <p className="detalhe-pedido" data-testid="detalhe-quando">{rotuloQuando}: <b>{quando}</b></p>}
      {pedido && <p className="detalhe-pedido">{rotulo}: <b>{pedido}</b></p>}
      {fornecedor && <p className="detalhe-pedido" data-testid="detalhe-fornecedor">Fornecedor: <b>{fornecedor}</b></p>}
      {itens.length === 0 ? (
        <p className="sub">Sem itens para mostrar.</p>
      ) : (
        <ul className="detalhe-itens">
          {itens.map((it, i) => {
            const u = unid(it.unidade)
            return (
              <li key={i}>
                <span className="desc">{it.codigo ? <><b className="cod">{it.codigo}</b> {it.descricao}</> : it.descricao}</span>
                <span className="nums">
                  {it.quantidade != null && `${rotuloQtd ? 'qtd ' : ''}${qtd(it.quantidade)}${u ? ` ${u}` : ''}`}
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
