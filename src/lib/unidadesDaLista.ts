// As unidades em que um produto da lista do app pode estar controlado no SisChef (regra pura, sem rede nem React).
// KG e UN vêm da lista semanal de compra (itens_semana) e da planilha do Ivan; CT (cento, "C/ 100 UND") e PCT (pacote) entram só pela planilha do app
// (produto_planilha), desde 22/10/2026: os sacos e o garfo do cupom da A. N. da Silva já existiam no SisChef nessas unidades e o app só aceitava KG e UN.
// Mesma lista do check de produto_planilha.unidade (migração 20261222000001) e de supabase/functions/confirmar-cupom/index.ts (buscarProduto).

/** As unidades aceitas, em minúscula (como a lista do app as guarda). */
export const UNIDADES_DA_LISTA: readonly string[] = ['kg', 'un', 'ct', 'pct']

/** A unidade (qualquer caixa, espaços nas pontas) é uma das que a lista do app aceita? */
export const ehUnidadeDaLista = (u: unknown): boolean => UNIDADES_DA_LISTA.includes(String(u ?? '').trim().toLowerCase())

/** CT ou PCT: embalagem com várias unidades dentro. Essas unidades NUNCA são palpite do app (só chegam pela planilha, que é a do SisChef): o SisChef pede a conversão
 *  para qualquer nota ou cupom que venha em outra unidade. */
export const ehEmbalagemContada = (u: unknown): boolean => ['ct', 'pct'].includes(String(u ?? '').trim().toLowerCase())
