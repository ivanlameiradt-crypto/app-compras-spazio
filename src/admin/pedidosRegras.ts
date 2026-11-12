// Pedidos (etapa 4 da Compra): contas puras, sem banco e sem React. Os itens da semana que ficaram sem vendedor viram
// "compra na loja", agrupados por fornecedor; o resumo do rodapé soma cotações (vendedores) e loja.
import type { ItemSemana, ItemSemVendedor } from '../lib/tipos'
import type { SugestaoProduto } from '../lib/sugestaoCompra'
import { nomeNaTela } from './listaSemanaRegras'

export const SEM_FORNECEDOR = 'Sem fornecedor definido'

export interface LinhaLoja {
  /** O item como veio do preparo (motivo, produto_id e "Pedir a:" continuam saindo dele). */
  origem: ItemSemVendedor
  nome: string
  qtd: number
  unidade: string
  /** qtd × preço do melhor fornecedor, ou × preco_estimado do item; null sem preço confiável. */
  valor: number | null
}

export interface GrupoLoja {
  nome: string
  itens: LinhaLoja[]
  /** Soma dos valores que existem. */
  subtotal: number
  /** Quantos itens ficaram sem preço (não entram no subtotal). */
  semPreco: number
}

/** Chave para juntar nomes de fornecedor iguais: sem caixa, sem acento e com espaços colapsados. */
const chave = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const limpo = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Agrupa os itens sem vendedor por fornecedor. Fornecedor do item, nesta ordem: o melhor preço do histórico (só quando
 * a unidade não está a conferir); o `fornecedor` do próprio item; o da última compra; senão "Sem fornecedor definido".
 * Grupos do maior subtotal para o menor; o sem fornecedor fica sempre por último.
 */
export function gruposDeLoja(semVendedor: ItemSemVendedor[], itensSemana: ItemSemana[], sugestoes: SugestaoProduto[]): GrupoLoja[] {
  const sugPorProduto = new Map(sugestoes.map((s) => [s.produtoId, s]))
  const itemPorId = new Map(itensSemana.map((i) => [i.id, i]))
  const grupos = new Map<string, GrupoLoja>()
  for (const s of semVendedor) {
    const sug = sugPorProduto.get(s.produto_id)
    const doSemana = itemPorId.get(s.item_semana_id)
    const conferir = !!sug?.fornecedores.conferirUnidade
    const melhor = conferir ? null : sug?.fornecedores.melhor ?? null
    const nomeForn = limpo(melhor?.fornecedor) || limpo(s.fornecedor) || limpo(doSemana?.fornecedor_ultima) || SEM_FORNECEDOR
    // preço não confiável (unidade a conferir) fica fora, como na Lista da semana
    const preco = conferir ? null : melhor?.custo ?? doSemana?.preco_estimado ?? null
    const linha: LinhaLoja = {
      origem: s, nome: nomeNaTela(s.nome), qtd: s.qtd, unidade: s.unidade, valor: preco === null ? null : s.qtd * preco,
    }
    const k = nomeForn === SEM_FORNECEDOR ? SEM_FORNECEDOR : chave(nomeForn)
    const g = grupos.get(k) ?? { nome: nomeForn, itens: [], subtotal: 0, semPreco: 0 }
    g.itens.push(linha)
    if (linha.valor === null) g.semPreco += 1
    else g.subtotal += linha.valor
    grupos.set(k, g)
  }
  const lista = [...grupos.values()].map((g) => ({ ...g, subtotal: Math.round(g.subtotal * 100) / 100 }))
  return lista.sort((a, b) => {
    if ((a.nome === SEM_FORNECEDOR) !== (b.nome === SEM_FORNECEDOR)) return a.nome === SEM_FORNECEDOR ? 1 : -1
    return b.subtotal - a.subtotal || a.nome.localeCompare(b.nome)
  })
}

export interface ResumoPedidos { fornecedores: number; produtos: number; total: number }

/** Rodapé: vendedores com cotação (cartões do preparo: `itens` e `estimado`) + grupos de loja. */
export function resumoPedidos(cartoes: { itens: number; estimado: number }[], grupos: GrupoLoja[]): ResumoPedidos {
  const produtos = cartoes.reduce((s, c) => s + c.itens, 0) + grupos.reduce((s, g) => s + g.itens.length, 0)
  const total = cartoes.reduce((s, c) => s + c.estimado, 0) + grupos.reduce((s, g) => s + g.subtotal, 0)
  return { fornecedores: cartoes.length + grupos.length, produtos, total: Math.round(total * 100) / 100 }
}
