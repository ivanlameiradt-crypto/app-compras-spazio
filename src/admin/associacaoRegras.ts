// Regras puras da caixa de associação de produto (aba "Lançamento fiscal"): busca na lista de insumos do app, sugestão pelas palavras-chave do Ivan
// e comparação de unidades. Sem rede nem React (os testes de tela trocam o api inteiro por um mock).
import { normalizar } from '../lib/regras'
import type { ItemNotaSefaz, ProdutoCatalogo } from '../lib/tipos'

/** Quantos produtos a busca mostra de uma vez (o resto some atrás de "digite mais letras"). */
export const MAX_RESULTADOS = 8

/** `parcial`: nenhum produto tem TODAS as palavras digitadas; os mostrados têm ALGUMA (os mais parecidos primeiro). */
export interface ResultadoBusca { itens: ProdutoCatalogo[]; total: number; parcial?: boolean }

interface Campos { p: ProdutoCatalogo; nome: string; sischef: string; chaves: string; codigo: string }
const camposDe = (p: ProdutoCatalogo): Campos => ({
  p, nome: normalizar(p.nome), sischef: normalizar(p.nome_sischef ?? ''), chaves: normalizar(p.palavras ?? ''), codigo: String(p.produto_id),
})

/**
 * Procura na lista de insumos: TODAS as palavras digitadas têm de aparecer no nome (o corrigido ou o do SisChef), no código ou nas
 * palavras-chave do Ivan (sem acento e sem diferença de maiúsculas). Vêm primeiro os que casam só pelo nome/código — os que COMEÇAM com a 1ª
 * palavra, depois os que a têm no começo de alguma palavra, depois o resto —, e por último os que só casam graças às palavras-chave; empate:
 * nome mais curto, depois ordem alfabética. Texto vazio = nada (a caixa não despeja a lista inteira).
 *
 * Se NENHUM produto tem todas as palavras, a busca não termina em "nada": devolve os que têm ALGUMA (só palavras de 3 letras ou mais, para
 * "de" e "kg" não casarem com tudo), os que têm mais palavras primeiro, com `parcial: true` — o Ivan reconhece o produto e escolhe.
 */
export function buscarProdutos(catalogo: ProdutoCatalogo[], texto: string, limite = MAX_RESULTADOS): ResultadoBusca {
  const palavras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return { itens: [], total: 0 }
  const campos = catalogo.filter((p) => !p.oculto).map(camposDe)                              // produto de receita da casa não é opção
  const noNomeOuCodigo = (c: Campos, w: string) => c.nome.includes(w) || c.sischef.includes(w) || c.codigo.includes(w)
  const noComeco = (c: Campos) => {
    const w = palavras[0]
    if (c.nome.startsWith(w) || c.sischef.startsWith(w)) return 0
    const inicioDePalavra = (s: string) => { const i = s.indexOf(w); return i > 0 && s[i - 1] === ' ' }
    return inicioDePalavra(c.nome) || inicioDePalavra(c.sischef) ? 1 : 2
  }
  const ordenar = (a: { p: ProdutoCatalogo; nota: number }, b: { p: ProdutoCatalogo; nota: number }) =>
    a.nota - b.nota || a.p.nome.length - b.p.nome.length || a.p.nome.localeCompare(b.p.nome, 'pt-BR')

  const achados: { p: ProdutoCatalogo; nota: number }[] = []
  for (const c of campos) {
    if (!palavras.every((w) => noNomeOuCodigo(c, w) || c.chaves.includes(w))) continue
    achados.push({ p: c.p, nota: palavras.every((w) => noNomeOuCodigo(c, w)) ? noComeco(c) : 3 })
  }
  if (achados.length > 0) {
    achados.sort(ordenar)
    return { itens: achados.slice(0, limite).map((x) => x.p), total: achados.length }
  }

  const longas = [...new Set(palavras.filter((w) => w.length >= 3))]
  const parecidos: { p: ProdutoCatalogo; nota: number; casadas: number }[] = []
  for (const c of campos) {
    const casadas = longas.filter((w) => noNomeOuCodigo(c, w) || c.chaves.includes(w)).length
    if (casadas > 0) parecidos.push({ p: c.p, nota: noComeco(c), casadas })
  }
  parecidos.sort((a, b) => b.casadas - a.casadas || ordenar(a, b))
  if (parecidos.length === 0) return { itens: [], total: 0 }
  return { itens: parecidos.slice(0, limite).map((x) => x.p), total: parecidos.length, parcial: true }
}

// ---------- sugestão pelas palavras-chave

/** Palavras que não ajudam a reconhecer um produto: ligações, unidades e embalagens (e "insumo", que está no nome de quase todos). */
const SEM_VALOR = new Set([
  'com', 'sem', 'para', 'por', 'dos', 'das', 'uma', 'uns', 'ate', 'und', 'unid', 'unidade', 'pct', 'pacote', 'caixa', 'pet', 'pack',
  'insumo', 'insumos', 'ltda', 'tipo',
])
/** As palavras de um texto (descrição da nota, nome ou palavras-chave) que servem para reconhecer o produto: só letras, 3 ou mais, sem acento. */
function palavrasUteis(texto: string): string[] {
  const todas = normalizar(texto).match(/[a-z]{3,}/g) ?? []
  return [...new Set(todas.filter((w) => !SEM_VALOR.has(w)))]
}
/**
 * A palavra da NOTA (`a`) reconhece a palavra do PRODUTO (`b`) se são iguais, se a da nota é o COMEÇO da do produto (abreviação: "muss" =
 * "mussarela", "cond" = "condensado", "resf" = "resfriada" — só com 4 letras ou mais, para "bis" não virar "biscoito") ou se a do produto é o
 * começo da da nota (plural: "queijos" para "queijo").
 */
const reconhece = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))

export interface SugestaoPorPalavras { produto: ProdutoCatalogo; palavras: string[] }

/**
 * Sugere o produto pela descrição do item na nota, usando o nome e as palavras-chave que o Ivan escreveu ("queijo muss" é mussarela). Conta,
 * para cada produto, quantas palavras da nota ele reconhece; só sugere se o melhor reconhece 2 ou mais. Empate de contagem: fica o produto com
 * MENOS palavras do próprio nome que a nota não menciona — "Q. MUÇARELA" ganha de "QUEIJO MUÇARELA DE BÚFALA" para "QUEIJO MUSS ARGE LA PAULINA",
 * porque a variante (búfala) só vale quando a nota fala dela. Empate de verdade (nem isso desempata) = nada: o Ivan escolhe. Devolve também as
 * palavras da nota que casaram, para a tela mostrar o porquê. Só SUGERE: quem decide é o Ivan, e nada vai ao SisChef.
 */
export function sugestaoPorPalavras(it: ItemNotaSefaz, catalogo: ProdutoCatalogo[]): SugestaoPorPalavras | null {
  const daNota = palavrasUteis((it.descricao ?? '').replace(/^CÓD\. FOR:\s*\S+\s*/i, ''))
  if (daNota.length < 2) return null
  let melhor: SugestaoPorPalavras & { sobras: number } | null = null
  let empate = false
  for (const p of catalogo) {
    if (p.oculto) continue
    const doProduto = palavrasUteis(`${p.nome} ${p.nome_sischef ?? ''} ${p.palavras ?? ''}`)
    const casadas = daNota.filter((a) => doProduto.some((b) => reconhece(a, b)))
    if (casadas.length < 2) continue
    // palavras do nome mostrado que a nota não menciona (o nome do SisChef, que pode ter erro de digitação, não entra nessa conta)
    const sobras = palavrasUteis(p.nome).filter((w) => !daNota.some((a) => reconhece(a, w))).length
    if (melhor === null || casadas.length > melhor.palavras.length || (casadas.length === melhor.palavras.length && sobras < melhor.sobras)) {
      melhor = { produto: p, palavras: casadas, sobras }; empate = false
    } else if (casadas.length === melhor.palavras.length && sobras === melhor.sobras) {
      empate = true
    }
  }
  return melhor !== null && !empate ? { produto: melhor.produto, palavras: melhor.palavras } : null
}

/**
 * O nome para MOSTRAR de um produto já escolhido: o do catálogo (que traz o nome corrigido pelo Ivan; `noSischef` é o nome original, quando ele
 * foi corrigido) ou, sem o catálogo, o que ficou guardado na decisão. O guardado é sempre o nome do SisChef: o servidor não conhece o corrigido.
 */
export function nomeParaMostrar(catalogo: ProdutoCatalogo[] | null, id: number, guardado: string): { nome: string; noSischef?: string } {
  const p = catalogo?.find((x) => x.produto_id === id)
  return p ? { nome: p.nome, noSischef: p.nome_sischef } : { nome: guardado }
}

const unidadeNorm = (u: string | null | undefined): string => (u ?? '').trim().toLowerCase()
/** A unidade do item na NF e a do produto escolhido são diferentes (UN × KG)? Sem uma das duas, não dá para dizer: false. */
export function unidadesDiferem(unidadeNota: string | null | undefined, unidadeProduto: string | null | undefined): boolean {
  const a = unidadeNorm(unidadeNota)
  const b = unidadeNorm(unidadeProduto)
  return a !== '' && b !== '' && a !== b
}

/**
 * O palpite do robô de leitura para o item (item.sugestao). Se o produto está na lista de insumos do app, devolve o da lista (nome e unidade
 * dela). Se NÃO está — produto novo, criado no SisChef depois da lista semanal (ex.: CHOCOLATE BIS) —, devolve o palpite mesmo assim, marcado
 * `novo`, com o nome do palpite e sem unidade: o banco aceita esse produto só para ESTE item (cot_nfe_associar confere o código). Sem palpite
 * utilizável (sem código inteiro positivo ou sem nome): null.
 */
export function sugestaoNoCatalogo(it: ItemNotaSefaz, catalogo: ProdutoCatalogo[]): ProdutoCatalogo | null {
  const id = Number(it.sugestao?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  const daLista = catalogo.find((p) => p.produto_id === id)
  if (daLista) return daLista.oculto ? null : daLista                                        // escondido: nem como palpite (não é produto de compra)
  const nome = (it.sugestao?.nome ?? '').replace(/\s+/g, ' ').trim()
  return nome === '' ? null : { produto_id: id, nome, unidade: null, novo: true }
}
