// Aviso de PREÇO FORA DO NORMAL (pedido do Ivan, 29/10/2026). Caso que o motivou: a Coca Zero da Mateus (NF 90049) entrou como 20 × R$ 21,25 quando eram 120 × ~R$ 3,50, porque a "UN" da
// nota era um fardo de 6. Em vez de uma regra por produto (ketchup sachê, cheddar, pães…), um aviso que vale para qualquer item: o preço por UNIDADE DE ESTOQUE da linha (o que o SisChef vai
// gravar como custo) não se parece com o que o produto custou nas últimas compras. Só funções puras (sem rede nem React): quem mostra o aviso são as telas da nota fiscal e do cupom.
//
// A referência são as últimas compras da lista semanal (itens_semana: o preço da última compra e o dia dela, uma linha por semana). O histórico JÁ TEM erros de embalagem gravados (ketchup sachê a
// R$ 28,60 contra R$ 0,17; shoyu sachê a R$ 67,17 contra R$ 0,27; pães a 6× do normal), então um número só como referência acusaria o preço certo e calaria o errado. Por isso a regra olha DOIS
// pontos: a ÚLTIMA compra e, havendo 3 ou mais compras, o preço MAIS COMUM entre elas (a mediana, que uma compra suja não move). O aviso só sai quando o preço está a 3× ou mais, para cima ou para
// baixo, de OS DOIS (mesma unidade): o preço certo não é acusado só porque a última compra foi suja, e o errado não passa só porque uma compra antiga tinha o mesmo erro. Teste em 174 itens de
// cupons já lançados: com 2× saíam 8 avisos (5%), com 3× só 3 produtos. Só avisa, nunca trava: o Ivan decide.
import type { PrecoDeCompra } from '../lib/tipos'

/** Quantas vezes o preço pode estar acima (ou abaixo, 1/3) da última compra E do preço mais comum antes do aviso. Pega fardo de 6, caixa de 12, pacote de 15; preço que sobe e desce normal não chega a 3×. */
export const LIMITE_FORA_DO_NORMAL = 3
/** Quantas compras (de dias diferentes, as mais novas) formam a referência. */
export const COMPRAS_NA_REFERENCIA = 5

const unidadeNorm = (u: unknown): string => String(u ?? '').trim().toLowerCase()
const numeroBom = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

export interface PrecoForaDoNormal {
  /** O preço por unidade de estoque que a linha vai gravar. */
  preco: number
  /** 'alto' = bem mais caro que na última compra; 'baixo' = bem mais barato. */
  sentido: 'alto' | 'baixo'
  /** O preço da compra mais recente da referência (na mesma unidade). */
  usual: number
  /** O dia dessa compra (aaaa-mm-dd), quando a lista o sabe. */
  data: string | null
  /** Quantas vezes o preço está longe da última compra (sempre 3 ou mais). */
  vezes: number
  /** A unidade do estoque, em minúscula ("un", "kg"). */
  unidade: string
}

/** As compras da referência: só as de preço válido e MESMA unidade do estoque, a mais nova primeiro (sem data = por último), no máximo COMPRAS_NA_REFERENCIA. */
export function comprasDaReferencia(compras: readonly PrecoDeCompra[] | null | undefined, unidadeDoEstoque: string | null | undefined): PrecoDeCompra[] {
  const u = unidadeNorm(unidadeDoEstoque)
  if (u === '' || !Array.isArray(compras)) return []
  return compras
    .filter((c) => c != null && numeroBom(c.preco) && unidadeNorm(c.unidade) === u)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const da = a.c.data ?? '', db = b.c.data ?? ''
      if (da !== db) return da === '' ? 1 : db === '' ? -1 : da < db ? 1 : -1 // a mais nova primeiro; sem data no fim
      return a.i - b.i
    })
    .slice(0, COMPRAS_NA_REFERENCIA)
    .map((x) => x.c)
}

/** O preço do meio das compras (a mediana: com quantidade par, a média dos dois do meio). Lista vazia = NaN. */
function mediana(precos: readonly number[]): number {
  const o = [...precos].sort((a, b) => a - b)
  const meio = Math.floor(o.length / 2)
  return o.length % 2 === 1 ? o[meio] : (o[meio - 1] + o[meio]) / 2
}

/**
 * O preço `preco` (por unidade de ESTOQUE, em reais) está fora do normal para este produto? Devolve o aviso, ou null quando está normal OU quando não há como saber
 * (preço ou unidade ilegíveis, produto sem compras na mesma unidade): na dúvida a tela fica calada. "Fora do normal" = longe da ÚLTIMA compra e, havendo 3 ou mais compras, longe também do
 * preço mais comum entre elas (veja o cabeçalho do arquivo).
 */
export function precoForaDoNormal(
  preco: number | null | undefined,
  unidadeDoEstoque: string | null | undefined,
  compras: readonly PrecoDeCompra[] | null | undefined,
): PrecoForaDoNormal | null {
  if (!numeroBom(preco)) return null
  const referencia = comprasDaReferencia(compras, unidadeDoEstoque)
  if (referencia.length === 0) return null
  const ultima = referencia[0]
  const usual = ultima.preco
  // os pontos de comparação: a última compra e, com 3 ou mais compras, o preço mais comum entre elas
  const pontos = referencia.length >= 3 ? [usual, mediana(referencia.map((c) => c.preco))] : [usual]
  const longeDeTodos = pontos.every((ponto) => {
    const razao = preco / ponto
    return razao >= LIMITE_FORA_DO_NORMAL || razao <= 1 / LIMITE_FORA_DO_NORMAL
  })
  if (!longeDeTodos) return null
  return {
    preco,
    sentido: preco > usual ? 'alto' : 'baixo',
    usual,
    data: ultima.data ?? null,
    vezes: Math.max(preco / usual, usual / preco),
    unidade: unidadeNorm(unidadeDoEstoque),
  }
}

/** "3,5", "6", "252": uma casa abaixo de 10, inteiro daí em diante (o Ivan lê "6 vezes", não "6,0000001"). */
export function vezesPorExtenso(v: number): string {
  const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10
  return r.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

/** "21/10" a partir de "2026-10-21" (o que a lista guarda); data ilegível = null. */
export function diaCurto(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}` : null
}

/** O que fazer quando o aviso aparece (a causa mais comum é a embalagem: a "UN" da nota era um fardo, uma caixa ou um pacote). */
export const CONSELHO_DO_PRECO = 'Confira a embalagem (fardo, caixa, pacote) e a conversão.'

/** O fato, sem o título nem o conselho (serve de linha numa lista de itens): "R$ 21,25 por UN. Na última compra custou R$ 3,55 (21/10): 6 vezes mais caro." */
export function detalheDoPrecoForaDoNormal(a: PrecoForaDoNormal, reais: (v: number) => string): string {
  const quando = diaCurto(a.data)
  return `${reais(a.preco)} por ${a.unidade.toUpperCase()}. Na última compra custou ${reais(a.usual)}${quando ? ` (${quando})` : ''}: ` +
    `${vezesPorExtenso(a.vezes)} vezes ${a.sentido === 'alto' ? 'mais caro' : 'mais barato'}.`
}

/**
 * O texto do aviso, na linguagem do Ivan: "Preço fora do normal: R$ 21,25 por UN. Na última compra custou R$ 3,55 (21/10): 6 vezes mais caro. Confira a embalagem (fardo, caixa,
 * pacote) e a conversão." `reais` formata o dinheiro (a tela passa o formatarReais do app).
 */
export function textoDoPrecoForaDoNormal(a: PrecoForaDoNormal, reais: (v: number) => string): string {
  return `Preço fora do normal: ${detalheDoPrecoForaDoNormal(a, reais)} ${CONSELHO_DO_PRECO}`
}
