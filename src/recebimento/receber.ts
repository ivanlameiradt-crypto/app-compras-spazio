// Fase 2, Bloco D: lógica pura da tela Receber (DESIGN-fase-2.md, D.7.1). Sem preço em nenhum lugar.
import type { ItemAReceber, ItemRecebido, PedidoAReceber, Recebimento, Resto } from '../lib/tipos'
import { numeroBr, mensagemFaltaAvaria } from '../cotacao/mensagens'

/** Quanto ainda falta chegar do item (na unidade do SisChef): qtd − chegou, nunca negativo. */
export function faltaChegar(item: Pick<ItemAReceber, 'qtd' | 'chegou'>): number {
  return Math.max(+(Number(item.qtd) - Number(item.chegou)).toFixed(3), 0)
}

/** O pedido é por embalagem (o campo Chegou aparece em embalagens): tem fator > 0. */
export function porEmbalagem(item: Pick<ItemAReceber, 'fator'>): boolean {
  return item.fator != null && Number(item.fator) > 0
}

export const embParaUn = (emb: number, fator: number): number => +(Number(emb) * Number(fator)).toFixed(3)
export const unParaEmb = (un: number, fator: number): number => +(Number(un) / Number(fator)).toFixed(4)

/** Descrição do pedido do item: "9 fardos c/12 (108 un)" ou "20 kg". */
export function descricaoPedido(item: ItemAReceber): string {
  if (porEmbalagem(item) && item.embalagens) {
    const emb = Number(item.embalagens) === 1 ? item.embalagem : `${item.embalagem}s`
    return `${numeroBr(item.embalagens)} ${emb} c/${numeroBr(Number(item.fator))} (${numeroBr(item.qtd)} ${item.unidade})`
  }
  return `${numeroBr(item.qtd)} ${item.unidade}`
}

/** Uma entrada do formulário por item (a tela guarda isto). chegou_un é sempre na unidade do SisChef. */
export interface EntradaItem { numero: number; chegou_un: number; avaria_un?: number; obs?: string | null; resto?: Resto | null }

/** "Chegou tudo certo": tudo o que falta, sem avaria, sem resto (D.7.1). */
export function tudoQueFalta(pedido: PedidoAReceber): ItemRecebido[] {
  return pedido.itens.map((it) => ({ numero: it.numero, chegou: faltaChegar(it) }))
}

/** Itens do formulário → payload de cot_registrar_recebimento. Item sem entrada conta como chegou 0. */
export function montarItens(pedido: PedidoAReceber, entradas: Record<number, EntradaItem>): ItemRecebido[] {
  return pedido.itens.map((it) => {
    const e = entradas[it.numero]
    const item: ItemRecebido = { numero: it.numero, chegou: e ? +Number(e.chegou_un).toFixed(3) : 0 }
    if (e?.avaria_un) item.avaria = +Number(e.avaria_un).toFixed(3)
    if (e?.obs) item.obs = e.obs
    if (e?.resto) item.resto = e.resto
    return item
  })
}

/** Itens que ficaram com falta nesta entrega (somando o que já chegou antes) e precisam de resto (por item). */
export function itensComFalta(pedido: PedidoAReceber, entradas: Record<number, EntradaItem>): ItemAReceber[] {
  return pedido.itens.filter((it) => {
    const chegouAgora = entradas[it.numero] ? Number(entradas[it.numero].chegou_un) : 0
    const total = Number(it.chegou) + chegouAgora
    const falta = +(Number(it.qtd) - total).toFixed(3)
    const tol = it.unidade === 'kg' ? 0.02 * Number(it.qtd) : 0
    return falta > tol
  })
}

/** O botão só grava quando toda falta tem resto respondido (o dela ou o atalho "Todos"). */
export function prontoParaGravar(pedido: PedidoAReceber, entradas: Record<number, EntradaItem>, restoTodos: Resto | null): boolean {
  return itensComFalta(pedido, entradas).every((it) => (entradas[it.numero]?.resto ?? restoTodos) != null)
}

/** Mensagem "Recebido! Faltaram 24 un de X (ainda vêm)." a partir do resultado da gravação. */
export function resumoRecebido(r: Recebimento): string {
  if (!r.faltas.length && !r.avarias.length) return 'Recebido! Chegou tudo certo.'
  const partes: string[] = []
  for (const f of r.faltas) {
    const vem = f.resto === 'nao_vem' ? 'não vêm mais' : 'ainda vêm'
    partes.push(`Faltaram ${numeroBr(f.falta)} de ${f.nome} (${vem})`)
  }
  for (const a of r.avarias) partes.push(`${numeroBr(a.avaria)} com avaria de ${a.nome}`)
  return 'Recebido! ' + partes.join('. ') + '.'
}

/**
 * Linhas para a mensagem 10.7 (falta e avaria) ao vendedor, com a unidade e o fator REAIS de cada item do pedido
 * (D.8). O retorno de cot_registrar_recebimento não traz unidade nem fator; sem buscá-los aqui, a mensagem sairia com
 * tudo em "un" (5 un em vez de 5 kg, 24 un em vez de 2 embalagens). NENHUM preço entra: os campos de preço vão zerados.
 */
export function linhasFaltaAvaria(pedido: PedidoAReceber, r: Recebimento): Parameters<typeof mensagemFaltaAvaria>[2] {
  const porNumero = new Map(pedido.itens.map((i) => [i.numero, i]))
  const faltas = r.faltas.map((f) => {
    const it = porNumero.get(f.numero)
    return {
      numero: f.numero, nome: f.nome, unidade: it?.unidade ?? 'un', fator: it?.fator ?? null,
      falta: f.falta, resto: f.resto, avaria: null,
      base: 'un' as const, qtd: f.falta, embalagens: null, preco_combinado: 0, valor_acima: 0, preco: 'sem_nf' as const,
    }
  })
  const avarias = r.avarias.map((a) => {
    const it = porNumero.get(a.numero)
    return {
      numero: a.numero, nome: a.nome, unidade: it?.unidade ?? 'un', fator: it?.fator ?? null,
      falta: null, resto: null, avaria: a.avaria,
      base: 'un' as const, qtd: 0, embalagens: null, preco_combinado: 0, valor_acima: 0, preco: 'sem_nf' as const,
    }
  })
  return [...faltas, ...avarias]
}
