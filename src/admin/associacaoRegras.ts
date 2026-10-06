// Regras puras da caixa de associação de produto (aba "Lançamento fiscal"): busca na lista de insumos do app e comparação de unidades.
// Sem rede nem React (os testes de tela trocam o api inteiro por um mock).
import { normalizar } from '../lib/regras'
import type { ItemNotaSefaz, ProdutoCatalogo } from '../lib/tipos'

/** Quantos produtos a busca mostra de uma vez (o resto some atrás de "digite mais letras"). */
export const MAX_RESULTADOS = 8

export interface ResultadoBusca { itens: ProdutoCatalogo[]; total: number }

/**
 * Procura na lista de insumos: TODAS as palavras digitadas têm de aparecer no nome (sem acento e sem diferença de maiúsculas) ou no código
 * do produto. Vêm primeiro os que COMEÇAM com a 1ª palavra, depois os que a têm no começo de alguma palavra, depois o resto; empate: nome
 * mais curto, depois ordem alfabética. Texto vazio = nada (a caixa não despeja a lista inteira).
 */
export function buscarProdutos(catalogo: ProdutoCatalogo[], texto: string, limite = MAX_RESULTADOS): ResultadoBusca {
  const palavras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return { itens: [], total: 0 }
  const achados: { p: ProdutoCatalogo; nota: number }[] = []
  for (const p of catalogo) {
    const nome = normalizar(p.nome)
    const codigo = String(p.produto_id)
    if (!palavras.every((w) => nome.includes(w) || codigo.includes(w))) continue
    const i = nome.indexOf(palavras[0])
    achados.push({ p, nota: nome.startsWith(palavras[0]) ? 0 : i > 0 && nome[i - 1] === ' ' ? 1 : 2 })
  }
  achados.sort((a, b) => a.nota - b.nota || a.p.nome.length - b.p.nome.length || a.p.nome.localeCompare(b.p.nome, 'pt-BR'))
  return { itens: achados.slice(0, limite).map((x) => x.p), total: achados.length }
}

const unidadeNorm = (u: string | null | undefined): string => (u ?? '').trim().toLowerCase()
/** A unidade do item na NF e a do produto escolhido são diferentes (UN × KG)? Sem uma das duas, não dá para dizer: false. */
export function unidadesDiferem(unidadeNota: string | null | undefined, unidadeProduto: string | null | undefined): boolean {
  const a = unidadeNorm(unidadeNota)
  const b = unidadeNorm(unidadeProduto)
  return a !== '' && b !== '' && a !== b
}

/** O palpite do robô de leitura para o item (item.sugestao), se esse produto está na lista de insumos do app; senão null. */
export function sugestaoNoCatalogo(it: ItemNotaSefaz, catalogo: ProdutoCatalogo[]): ProdutoCatalogo | null {
  const id = Number(it.sugestao?.id)
  if (!Number.isFinite(id)) return null
  return catalogo.find((p) => p.produto_id === id) ?? null
}
