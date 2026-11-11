// Lista da semana (tela nova): contas puras, sem banco e sem React. Une o item da semana, a sugestão do histórico
// (lib/sugestaoCompra), a contagem feita na loja e o ajuste manual do admin.
import type { ItemSemana } from '../lib/tipos'
import type { SugestaoProduto } from '../lib/sugestaoCompra'
import { quantoComprar } from '../lib/sugestaoCompra'
import { paraConferir } from '../lib/regras'

export const AVISO_UNIDADE = 'Confira a unidade: os preços dos fornecedores estão muito diferentes'
export const TAMANHO_PRINCIPAIS = 20

export interface OutroFornecedor { fornecedor: string; custo: number; data: string; diferencaPct: number | null }

export interface LinhaLista {
  item: ItemSemana
  sug: SugestaoProduto | null
  alvo: number | null
  contagem: number | null
  /** O que a conta manda comprar; null = "contar" (sem base para calcular). */
  calculado: number | null
  /** O que vale: o ajuste manual, senão o calculado. null = "contar". */
  comprar: number | null
  ajustado: boolean
  deVezEmQuando: boolean
  melhorPreco: boolean
  melhor: { fornecedor: string; custo: number; data: string } | null
  outros: OutroFornecedor[]
  /** Texto do fornecedor quando não há histórico (o de última compra). */
  fornecedorTexto: string | null
  precoUnit: number | null
  avisoUnidade: string | null
  avisoEstoque: string | null
  conferir: boolean
}


/** Número na tela: unidade (un) sempre inteira; kg e L com no máximo 1 casa; milhar com ponto ("12.943"). */
export function numeroNaTela(v: number, unidade?: string | null): string {
  const un = /^un$/i.test(String(unidade ?? '').trim())
  const n = un ? Math.round(v) : Math.round(v * 10) / 10
  return (Object.is(n, -0) ? 0 : n).toLocaleString('pt-BR', { maximumFractionDigits: un ? 0 : 1, useGrouping: true })
}
export const qtdNaTela = (v: number, unidade: string): string => `${numeroNaTela(v, unidade)} ${unidade}`

/** Nome sem o rabicho do cadastro: " - INSUMOS", " - INSUMO" e "(KG)"/"(UN)" no fim. Só para exibir. */
export function nomeNaTela(nome: string): string {
  let n = nome.trim()
  for (let k = 0; k < 3; k++) {
    n = n.replace(/\s*\((?:kg|un|l)\)\s*$/i, '').replace(/\s*-\s*insumos?\s*$/i, '').trim()
  }
  return n
}

export function avisoEstoqueNegativo(estoque: number, unidade?: string | null): string {
  return `O SisChef mostra ${numeroNaTela(estoque, unidade)}. Esse número está errado, por isso vale a contagem.`
}

export function montarLinha(item: ItemSemana, sug: SugestaoProduto | null, contagem: number | null, manual: number | undefined | null): LinhaLista {
  const alvo = sug?.alvo ?? null
  const deVezEmQuando = alvo === null
  const negativo = item.estoque < 0
  let calculado: number | null
  if (alvo !== null) {
    calculado = quantoComprar(alvo, contagem, item.estoque)
    // em unidade (copo, lata) não existe meio: o calculado sobe para o inteiro
    if (calculado !== null && /^un$/i.test(item.unidade)) calculado = Math.ceil(Math.round(calculado * 1e6) / 1e6)
  }
  else calculado = negativo && contagem === null ? 0 : item.qtd_sugerida
  const ajustado = manual != null
  const comprar = ajustado ? manual : calculado
  const forn = sug?.fornecedores ?? null
  const conferirUnidade = !!forn?.conferirUnidade
  const melhor = forn?.melhor ?? null
  const melhorPreco = !!melhor && forn!.outros.length > 0 && !conferirUnidade
  const outros: OutroFornecedor[] = (forn?.outros ?? []).map((o) => ({
    fornecedor: o.fornecedor, custo: o.custo, data: o.data,
    diferencaPct: melhor && melhor.custo > 0 ? Math.round(((o.custo - melhor.custo) / melhor.custo) * 100) : null,
  }))
  const semNumero = negativo && contagem === null
  return {
    item, sug, alvo, contagem, calculado, comprar, ajustado, deVezEmQuando, melhorPreco, melhor, outros,
    fornecedorTexto: forn && (forn.melhor || forn.outros.length > 0) ? null : item.fornecedor_ultima,
    precoUnit: melhor?.custo ?? item.preco_estimado,
    avisoUnidade: conferirUnidade ? AVISO_UNIDADE : null,
    avisoEstoque: negativo ? avisoEstoqueNegativo(item.estoque, item.unidade) : null,
    conferir: conferirUnidade || semNumero || paraConferir([item]).length > 0,
  }
}

/** Uma linha por item da semana (menos os barrados por regra e fora da lista), na ordem do nome. */
export function montarLinhas(itens: ItemSemana[], sugestoes: SugestaoProduto[], contagens: Map<number, number>, manuais: Record<number, number | null | undefined>): LinhaLista[] {
  const porProduto = new Map(sugestoes.map((s) => [s.produtoId, s]))
  return itens
    .filter((i) => !(i.regra === 'barrar' && !i.incluido))
    .map((i) => montarLinha(i, porProduto.get(i.produto_id) ?? null, contagens.get(i.produto_id) ?? null, manuais[i.id]))
}

/** Os 20 de maior gasto (ordem de `sugerirCompras`) que estão na semana. */
export function abaPrincipais(linhas: LinhaLista[], sugestoes: SugestaoProduto[]): LinhaLista[] {
  const porProduto = new Map(linhas.map((l) => [l.item.produto_id, l]))
  const r: LinhaLista[] = []
  for (const s of sugestoes) {
    const l = porProduto.get(s.produtoId)
    if (l) r.push(l)
    if (r.length === TAMANHO_PRINCIPAIS) break
  }
  return r
}

export function resumoContagem(linhas: LinhaLista[], sugestoes: SugestaoProduto[]): { contados: number; total: number; faltam: number } {
  const p = abaPrincipais(linhas, sugestoes)
  const contados = p.filter((l) => l.contagem !== null).length
  return { contados, total: p.length, faltam: p.length - contados }
}

/** Soma de comprar × preço (do melhor fornecedor, ou o último preço). "Contar" e item com unidade a conferir (preço não confiável) não entram. */
export function totalEstimadoLista(linhas: LinhaLista[]): number {
  return linhas.reduce((s, l) => (l.comprar !== null && l.comprar > 0 && !l.avisoUnidade ? s + l.comprar * (l.precoUnit ?? 0) : s), 0)
}

/** Quantos itens a comprar ficaram fora do total por causa da unidade. */
export function itensForaDoTotal(linhas: LinhaLista[]): number {
  return linhas.filter((l) => l.comprar !== null && l.comprar > 0 && l.avisoUnidade).length
}

/** O que gravar ao aprovar: quantidade de cada item (incluído se > 0). Item em "contar" sem número não é tocado. */
export function itensParaGravar(linhas: LinhaLista[]): { id: number; qtd: number; incluido: boolean }[] {
  return linhas.filter((l) => l.comprar !== null).map((l) => ({ id: l.item.id, qtd: l.comprar as number, incluido: (l.comprar as number) > 0 }))
}
