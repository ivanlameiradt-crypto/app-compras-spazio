// Aviso de PREÇO FORA DO NORMAL na nota fiscal (pedido do Ivan, 29/10/2026): junta o que a nota sabe de cada item (o total da linha que o robô de leitura manda em `valor`, a quantidade que o SisChef
// mostra, a conversão que o Ivan decidiu ou que o robô lembra) e pergunta à regra pura (precoForaDoNormal) se o preço por unidade de ESTOQUE se parece com o das últimas compras do produto.
// Só funções puras. Regra de ouro: na dúvida, SEM aviso — falta o total da linha, a quantidade, o produto, a conversão que o robô pediu e ninguém informou, ou a quantidade está numa unidade e
// o estoque em outra sem conversão (aí "R$ por CX" contra "R$ por UN" daria um aviso falso).
import { conversaoDaDecisao, quantidadeNoEstoque } from './associacaoRegras'
import { memoriaDoItem, situacaoDaMemoria } from './embalagemLembrada'
import { CFOPS_BONIFICACAO, conversaoDeItemAssociado, decisaoCompleta, decisaoDoItem, itemAssociado, itemPedeConversao } from './notaSefazRegras'
import { precoForaDoNormal, type PrecoForaDoNormal } from './precoForaDoNormal'
import { unidadeDoProduto } from './unidadeEstoque'
import type { ItemNotaSefaz, NfeAprendizado, NotaSefazLista, ProdutoCatalogo } from '../lib/tipos'

export interface PrecoDoItem {
  /** O preço por unidade de estoque que o SisChef vai gravar (total da linha ÷ o que entra no estoque). */
  preco: number
  /** A unidade do estoque, em minúscula. */
  unidade: string
  produto_id: number
}

const minusc = (u: string | null | undefined): string => String(u ?? '').trim().toLowerCase()

/** O preço por unidade de ESTOQUE do item da nota, ou null quando não dá para saber (veja o cabeçalho do arquivo). */
export function precoPorUnidadeDoItem(
  nota: NotaSefazLista,
  it: ItemNotaSefaz,
  catalogo: readonly ProdutoCatalogo[] | null | undefined,
  memoria: readonly NfeAprendizado[] | null | undefined,
): PrecoDoItem | null {
  const valor = it.valor
  if (typeof valor !== 'number' || !Number.isFinite(valor) || !(valor > 0)) return null
  // Brinde (CFOP de bonificação): o valor da linha é nominal, não é preço de compra.
  if (typeof it.cfop === 'string' && CFOPS_BONIFICACAO.includes(it.cfop.trim())) return null

  let produtoId: number
  let conversao: number | null
  let unidadeDaDecisao: string | null = null
  if (itemAssociado(it)) {
    // Já vem associado do SisChef. Se o robô parou pedindo a conversão e ninguém a informou, ainda não se sabe quanto entra no estoque.
    const informada = conversaoDeItemAssociado(nota, it)
    if (itemPedeConversao(nota, it) && informada == null) return null
    const id = Number(String(it.produto_id ?? '').trim())
    if (!Number.isFinite(id) || id <= 0) return null
    produtoId = id
    conversao = informada
    if (conversao == null) {
      // O robô aplica sozinho a embalagem que lembra (o Ivan não informou número e é o mesmo produto): o preço certo é o de depois dela.
      const lembrada = memoriaDoItem(memoria, nota, it)
      if (lembrada && situacaoDaMemoria(it, lembrada, null, false) === 'aplica') conversao = lembrada.fator
    }
  } else {
    // Sem produto no SisChef: vale a decisão COMPLETA do app (produto + a conversão, quando ela é obrigatória).
    const d = decisaoDoItem(nota, it)
    if (d == null || !decisaoCompleta(it, d)) return null
    const id = Number(d.produto_id)
    if (!Number.isFinite(id) || id <= 0) return null
    produtoId = id
    conversao = conversaoDaDecisao(d)
    unidadeDaDecisao = minusc(d.unidade) || null
  }

  const doEstoque = unidadeDoProduto(catalogo, produtoId) // a unidade da planilha do Ivan (a mesma do SisChef), minúscula; null = a lista não o conhece
  const daQuantidade = minusc(it.unidade_sischef)
  let unidade: string | null
  if (conversao == null) {
    // Sem conversão a quantidade já é a do estoque. Se a lista diz que o estoque é outra unidade, a conta não faz sentido (R$ por CX contra R$ por UN).
    if (doEstoque && daQuantidade && doEstoque !== daQuantidade) return null
    unidade = doEstoque ?? (daQuantidade || null)
  } else {
    unidade = doEstoque ?? unidadeDaDecisao
  }
  if (!unidade) return null
  const entra = quantidadeNoEstoque(it.qtd, conversao ?? 1)
  if (entra == null || !(entra > 0)) return null
  return { preco: valor / entra, unidade, produto_id: produtoId }
}

/**
 * O aviso deste item da nota, ou null (preço normal, ou sem como saber). O aviso é um EXTRA: um dado estranho (um item mal formado, uma linha da memória mal lida…) NUNCA pode derrubar a tela
 * da nota fiscal, que roda esta conta a cada desenho; qualquer erro aqui vira "sem aviso".
 */
export function avisoDePrecoDoItem(
  nota: NotaSefazLista,
  it: ItemNotaSefaz,
  catalogo: readonly ProdutoCatalogo[] | null | undefined,
  memoria: readonly NfeAprendizado[] | null | undefined,
): PrecoForaDoNormal | null {
  try {
    const p = precoPorUnidadeDoItem(nota, it, catalogo, memoria)
    if (!p) return null
    const produto = (catalogo ?? []).find((x) => x.produto_id === p.produto_id)
    return precoForaDoNormal(p.preco, p.unidade, produto?.compras)
  } catch {
    return null
  }
}

export interface ItemComPrecoForaDoNormal { item: ItemNotaSefaz; indice: number; aviso: PrecoForaDoNormal }

/** Os itens da nota com preço fora do normal, na ordem da nota. */
export function itensComPrecoForaDoNormal(
  nota: NotaSefazLista,
  catalogo: readonly ProdutoCatalogo[] | null | undefined,
  memoria: readonly NfeAprendizado[] | null | undefined,
): ItemComPrecoForaDoNormal[] {
  const saida: ItemComPrecoForaDoNormal[] = []
  ;(Array.isArray(nota.itens) ? nota.itens : []).forEach((item, indice) => {
    const aviso = avisoDePrecoDoItem(nota, item, catalogo, memoria)
    if (aviso) saida.push({ item, indice, aviso })
  })
  return saida
}
