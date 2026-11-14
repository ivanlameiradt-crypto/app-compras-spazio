// Produto lembrado por fornecedor (pedido do Ivan, 14/11/2026): o app lembra o produto que o Ivan escolheu para cada item, por FORNECEDOR + CÓD. FOR + UNIDADE DA NOTA,
// e associa sozinho nas notas seguintes, com travas. Quem lembra é o banco (cot_nfe_produto_lembrado, a partir das notas já lançadas); aqui ficam só as regras puras.
import { dataCurta } from './embalagemLembrada'
import { codForDoItem } from './notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista, ProdutoCatalogo } from '../lib/tipos'

/** Uma linha do que o banco lembra: o produto escolhido para um CÓD. FOR + unidade daquele fornecedor. */
export interface ProdutoLembrado {
  cod_forn: string
  unidade_nota: string
  produto_id: number
  produto_nome: string | null
  /** Unidade do produto na decisão (ex.: "un"); null = não se sabe. */
  unidade: string | null
  conversao: number | null
  /** Preço por unidade da nota na última decisão (total da linha ÷ quantidade); null = sem referência. */
  preco_ref: number | null
  vezes: number
  /** lancada_em da última nota; null = sem data. */
  ultima_em: string | null
}

/** Quantas notas lançadas concordando são precisas para associar sozinho (o Ivan ainda decide entre 1 e 2). Abaixo disso, só sugestão. */
export const MIN_VEZES_PARA_ASSOCIAR_SOZINHO = 1
/** A mesma faixa do robô (regras_embalagem.RAZAO_PRECO_MIN/MAX): fora dela pode ser outra embalagem sob o mesmo código (fardo vizinho). */
export const RAZAO_PRECO_MIN = 0.8
export const RAZAO_PRECO_MAX = 1.2

const soDigitos = (t: string | null | undefined): string => (t ?? '').replace(/\D/g, '')

/**
 * O produto lembrado para este item, ou null. A chave: CNPJ do fornecedor (só os dígitos) + CÓD. FOR do item (texto exato, só sem os espaços das pontas: "009085"
 * NÃO é "0009085") + unidade da nota (em maiúsculas). Falta qualquer uma = nada. O CNPJ da lista evita usar a lista de um fornecedor na nota de outro.
 */
export function produtoLembradoDoItem(
  lembrados: readonly ProdutoLembrado[] | null | undefined,
  cnpjDosLembrados: string | null | undefined,
  nota: Pick<NotaSefazLista, 'cnpj_emitente'>,
  item: ItemNotaSefaz,
): ProdutoLembrado | null {
  if (!lembrados || lembrados.length === 0) return null
  const cnpj = soDigitos(nota.cnpj_emitente)
  const cod = (codForDoItem(item) ?? '').trim()
  const unidade = (item.unidade_sischef ?? '').trim().toUpperCase()
  if (cnpj === '' || cod === '' || unidade === '' || soDigitos(cnpjDosLembrados) !== cnpj) return null
  return lembrados.find((l) => (l.cod_forn ?? '').trim() === cod && (l.unidade_nota ?? '').trim().toUpperCase() === unidade && l.produto_id > 0) ?? null
}

/** O preço por unidade da nota deste item está entre 0,8× e 1,2× o lembrado? Sem referência, sem total ou sem quantidade = false (fail-closed). */
export function precoNaFaixa(item: Pick<ItemNotaSefaz, 'valor' | 'qtd'>, l: Pick<ProdutoLembrado, 'preco_ref'>): boolean {
  const ref = l.preco_ref, total = item.valor, qtd = item.qtd
  if (ref == null || !(ref > 0) || total == null || !(total > 0) || qtd == null || !(qtd > 0)) return false
  const razao = total / qtd / ref
  return razao >= RAZAO_PRECO_MIN - 1e-9 && razao <= RAZAO_PRECO_MAX + 1e-9
}

/**
 * O que fazer com o lembrado deste item: 'sozinho' (grava sem perguntar), 'sugerir' (mostra o botão de um toque) ou null (nada). Só existe para item sem decisão
 * cujo produto lembrado está na lista de insumos carregada. Sozinho exige ainda: vezes ≥ o limiar, item não recusado pelo Ivan, preço por unidade na faixa e a mesma
 * unidade do produto no catálogo.
 */
export function oQueFazerComOLembrado(
  l: ProdutoLembrado | null,
  item: ItemNotaSefaz,
  catalogo: readonly ProdutoCatalogo[] | null | undefined,
  recusado: boolean,
): 'sozinho' | 'sugerir' | null {
  if (!l || !catalogo) return null
  const produto = catalogo.find((p) => p.produto_id === l.produto_id)
  if (!produto) return null
  const unidadeIgual = l.unidade != null && produto.unidade != null && l.unidade.trim().toLowerCase() === produto.unidade.trim().toLowerCase()
  if (!recusado && l.vezes >= MIN_VEZES_PARA_ASSOCIAR_SOZINHO && unidadeIgual && precoNaFaixa(item, l)) return 'sozinho'
  return 'sugerir'
}

/** "associado sozinho, igual à nota de 07/11 (1 CX = 12)"; sem data: "associado sozinho, igual a nota anterior"; sem conversão, sem o parêntese. */
export function textoAssociadoSozinho(ultimaEm: string | null | undefined, unidadeNota: string | null | undefined, conversao: number | null | undefined): string {
  const d = dataCurta(ultimaEm)
  const base = d ? `associado sozinho, igual à nota de ${d}` : 'associado sozinho, igual a nota anterior'
  return conversao != null && conversao > 0 ? `${base} (1 ${(unidadeNota ?? '').trim().toUpperCase() || 'unidade'} = ${String(conversao).replace('.', ',')})` : base
}

/** Texto do botão de um toque: "Usar o lembrado: GUARANÁ DIET LATA × 12". */
export function textoUsarLembrado(nome: string, conversao: number | null): string {
  return conversao != null && conversao > 0 ? `Usar o lembrado: ${nome} × ${String(conversao).replace('.', ',')}` : `Usar o lembrado: ${nome}`
}

const numeroOuNulo = (x: unknown): number | null => {
  if (x == null || x === '') return null
  const v = Number(x)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Linha do banco (o PostgREST pode mandar número como texto) para o tipo da tela; fora do formato = null. */
export function linhaLembrada(x: unknown): ProdutoLembrado | null {
  if (x == null || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const produto = Number(o.produto_id)
  const cod = typeof o.cod_forn === 'string' ? o.cod_forn.trim() : ''
  const unidade = typeof o.unidade_nota === 'string' ? o.unidade_nota.trim().toUpperCase() : ''
  if (!Number.isInteger(produto) || produto <= 0 || cod === '' || unidade === '') return null
  return {
    cod_forn: cod, unidade_nota: unidade, produto_id: produto,
    produto_nome: typeof o.produto_nome === 'string' ? o.produto_nome : null,
    unidade: typeof o.unidade === 'string' && o.unidade.trim() !== '' ? o.unidade.trim().toLowerCase() : null,
    conversao: numeroOuNulo(o.conversao),
    preco_ref: numeroOuNulo(o.preco_ref),
    vezes: Number(o.vezes) || 1,
    ultima_em: typeof o.ultima_em === 'string' ? o.ultima_em : null,
  }
}
