// Produto lembrado por fornecedor (pedido do Ivan, 14/11/2026): o app lembra o produto que o Ivan escolheu para cada item, por FORNECEDOR + CÓD. FOR + UNIDADE DA NOTA,
// e associa sozinho nas notas seguintes. Quem lembra é o banco (cot_nfe_produto_lembrado, a partir das notas já lançadas); aqui ficam só as regras puras (sem rede nem React).
import { dataCurta } from './embalagemLembrada'
import { codForDoItem } from './notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista } from '../lib/tipos'

/** Uma linha do que o banco lembra: o produto escolhido para um CÓD. FOR + unidade daquele fornecedor, com a conversão e a data da última nota lançada. */
export interface ProdutoLembrado {
  cod_forn: string
  unidade_nota: string
  produto_id: number
  produto_nome: string | null
  conversao: number | null
  vezes: number
  ultima_em: string | null
}

const soDigitos = (t: string | null | undefined): string => (t ?? '').replace(/\D/g, '')

/**
 * O produto lembrado para este item, ou null. A chave: CNPJ do fornecedor (só os dígitos) + CÓD. FOR do item (texto exato, só sem os espaços das pontas: "009085"
 * NÃO é "0009085") + unidade da nota (em maiúsculas). Falta qualquer uma = nada. A lista vem do banco já só daquele fornecedor; o CNPJ entra para não usar a lista de
 * um fornecedor na nota de outro.
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

/** "lembrado da nota de 08/11" (horário de Brasília); sem data legível, só "lembrado de nota anterior". */
export function textoLembrado(l: Pick<ProdutoLembrado, 'ultima_em'>): string {
  const d = dataCurta(l.ultima_em)
  return d ? `lembrado da nota de ${d}` : 'lembrado de nota anterior'
}

/** Linha do banco (o PostgREST pode mandar número como texto) para o tipo da tela; fora do formato = null. */
export function linhaLembrada(x: unknown): ProdutoLembrado | null {
  if (x == null || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const produto = Number(o.produto_id)
  const cod = typeof o.cod_forn === 'string' ? o.cod_forn.trim() : ''
  const unidade = typeof o.unidade_nota === 'string' ? o.unidade_nota.trim().toUpperCase() : ''
  if (!Number.isInteger(produto) || produto <= 0 || cod === '' || unidade === '') return null
  const conv = o.conversao == null ? null : Number(o.conversao)
  return {
    cod_forn: cod, unidade_nota: unidade, produto_id: produto,
    produto_nome: typeof o.produto_nome === 'string' ? o.produto_nome : null,
    conversao: conv != null && Number.isFinite(conv) && conv > 0 ? conv : null,
    vezes: Number(o.vezes) || 1,
    ultima_em: typeof o.ultima_em === 'string' ? o.ultima_em : null,
  }
}
