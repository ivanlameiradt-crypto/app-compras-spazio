// Regra do Ivan (09/10/2026): a unidade que o app mostra num lançamento é a do produto no BANCO (a planilha dele, que é a mesma do SisChef): batata, sal e
// Ovomaltine são KG, então o detalhe nunca pode dizer "un" só porque o cupom imprimiu "UN". A lista de insumos já traz a unidade da planilha (ela manda sobre
// a de itens_semana: api.catalogoProdutos). Sem o produto na lista (ainda carregando, ou produto fora dela), vale a unidade que veio na linha, como antes.
import type { ProdutoCatalogo } from '../lib/tipos'

/** A unidade do estoque do produto `produtoId` (minúscula, como na lista: "kg", "un"…), ou null quando a lista não o tem. */
export function unidadeDoProduto(catalogo: ProdutoCatalogo[] | null | undefined, produtoId: unknown): string | null {
  const id = String(produtoId ?? '').trim()
  if (id === '' || !catalogo) return null
  const u = catalogo.find((p) => String(p.produto_id) === id)?.unidade
  return u && u.trim() !== '' ? u.trim().toLowerCase() : null
}
