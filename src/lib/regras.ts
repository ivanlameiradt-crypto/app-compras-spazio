import type { ItemSemana, LinhaCompra, StatusCompra, StatusSemana, Unidade } from './tipos'

export const LIMITE_ALERTA_PRECO = 0.1

export function totalEstimado(itens: ItemSemana[]): number {
  return itens.filter((i) => i.incluido).reduce((s, i) => s + i.qtd_aprovada * (i.preco_estimado ?? 0), 0)
}

export function quantidadeComprada(itemId: number, linhas: LinhaCompra[]): number {
  return linhas.filter((l) => l.item_semana_id === itemId).reduce((s, l) => s + Number(l.qtd), 0)
}

export type SituacaoCompra = 'pendente' | 'completo' | 'parcial' | 'nao_achei'
export function situacaoDoItem(item: ItemSemana, linhas: LinhaCompra[]): SituacaoCompra {
  const doItem = linhas.filter((l) => l.item_semana_id === item.id)
  if (doItem.length === 0) return 'pendente'
  const q = quantidadeComprada(item.id, doItem)
  if (q > 0 && q >= item.qtd_aprovada) return 'completo'
  if (q > 0) return 'parcial'
  return 'nao_achei'
}

export function variacaoPreco(pago: number | null, referencia: number | null): number | null {
  if (pago == null || !referencia) return null
  return (pago - referencia) / referencia
}

export interface AlertaPreco { item: ItemSemana; linha: LinhaCompra; variacao: number }
export interface Resumo {
  pedidos: number
  completos: number
  parciais: number
  naoAchados: number
  pendentes: number
  estimado: number
  pago: number
  alertas: AlertaPreco[]
}

export function resumirSemana(itens: ItemSemana[], linhas: LinhaCompra[]): Resumo {
  const incluidos = itens.filter((i) => i.incluido)
  const conta = { completo: 0, parcial: 0, nao_achei: 0, pendente: 0 }
  for (const i of incluidos) conta[situacaoDoItem(i, linhas)]++
  const alertas: AlertaPreco[] = []
  for (const l of linhas) {
    const it = itens.find((i) => i.id === l.item_semana_id)
    const v = variacaoPreco(l.preco_unit, it?.preco_estimado ?? null)
    if (it && v !== null && v > LIMITE_ALERTA_PRECO + 1e-9) alertas.push({ item: it, linha: l, variacao: v })
  }
  return {
    pedidos: incluidos.length,
    completos: conta.completo,
    parciais: conta.parcial,
    naoAchados: conta.nao_achei,
    pendentes: conta.pendente,
    estimado: totalEstimado(itens),
    pago: linhas.reduce((s, l) => s + Number(l.qtd) * (l.preco_unit ?? 0), 0),
    alertas,
  }
}

const porNome = (a: ItemSemana, b: ItemSemana) => a.produto.localeCompare(b.produto, 'pt-BR')
export function separarAbas(itens: ItemSemana[]) {
  return {
    bebidas: itens.filter((i) => i.bebida).sort(porNome),
    insumos: itens.filter((i) => !i.bebida && !i.negativo).sort(porNome),
    negativos: itens.filter((i) => i.negativo).sort(porNome),
  }
}

/**
 * "1,2" → 1.2 · "R$ 1.234,50" → 1234.5 · "2.79" → 2.79 · "1.250" → 1250 (milhar, sem vírgula) · "0.500" → 0.5 ·
 * vazio/negativo/inválido → null
 */
export function lerNumero(texto: string): number | null {
  let t = texto.replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.')
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) {
    // sem vírgula, no formato de milhar (1.250, 12.500…): os pontos são separadores, não decimal.
    // Começando com zero ("0.500") nunca é milhar: é decimal.
    t = t.replace(/\./g, '')
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

export function formatarReais(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatarQtd(v: number, unidade: Unidade): string {
  return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unidade}`
}

export function formatarData(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function passo(unidade: Unidade): number {
  return unidade === 'kg' ? 0.5 : 1
}

export function nomeCurto(email: string): string {
  return email.split('@')[0]
}

export function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const ROTULO_STATUS: Record<StatusSemana | StatusCompra, string> = {
  rascunho: 'Rascunho',
  em_compra: 'Em compra',
  encerrada: 'Encerrada',
  aberta: 'Aberta',
  fechada: 'Aguardando aprovação',
  aprovada: 'Pronta para lançar',
  lancada: 'Lançada no SisChef',
}
