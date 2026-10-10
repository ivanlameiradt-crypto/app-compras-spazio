// Regras puras da aba "Compras avulsas" (pedido do Ivan, 10/10/2026): compra feita SEM cupom fiscal e SEM nota fiscal. Ele digita o produto, a quantidade e o preço;
// o lançamento no SisChef é o mesmo Pedido de compra manual do cupom (estoque + o pagamento escolhido), sem foto e sem nota. A unidade é sempre a do produto no
// BANCO (a planilha do Ivan = o SisChef), como nas outras abas: ele digita a quantidade já nessa unidade.

const arredondar = (v: number, casas: number): number => { const f = 10 ** casas; return Math.round(v * f) / f }

/** O número como o Ivan digita ("1,5", "1.250,75", "3"), ou null se não for um número maior que zero. `casas` = máximo de casas decimais guardadas. */
export function lerNumero(texto: string, casas: number): number | null {
  const t = texto.replace(/\s/g, '')
  if (t === '') return null
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  return Number.isFinite(n) && n > 0 ? arredondar(n, casas) : null
}
export const lerQuantidade = (texto: string): number | null => lerNumero(texto, 3)
export const lerPreco = (texto: string): number | null => lerNumero(texto, 4)

/** Quantidade e preço unitário máximos aceitos (trava de digitação errada: um zero a mais). */
export const QUANTIDADE_MAXIMA = 100_000
export const PRECO_MAXIMO = 100_000

export interface LinhaAvulsa { produtoId: number | null; quantidade: string; preco: string }

/** Total do item = quantidade × preço unitário, em centavos arredondados; null se faltar quantidade ou preço. */
export function totalDaLinha(l: Pick<LinhaAvulsa, 'quantidade' | 'preco'>): number | null {
  const q = lerQuantidade(l.quantidade), p = lerPreco(l.preco)
  return q === null || p === null ? null : arredondar(q * p, 2)
}

/** O que falta na linha, em português ('' = a linha está completa). */
export function faltaNaLinha(l: LinhaAvulsa): string {
  if (l.produtoId === null) return 'escolha o produto'
  const q = lerQuantidade(l.quantidade)
  if (q === null) return 'digite a quantidade'
  if (q > QUANTIDADE_MAXIMA) return 'quantidade grande demais: confira'
  const p = lerPreco(l.preco)
  if (p === null) return 'digite o preço'
  if (p > PRECO_MAXIMO) return 'preço grande demais: confira'
  return ''
}

/** O total da compra = soma de quantidade × preço das linhas completas (quantidade a 3 casas e preço a 4, como o servidor e o SisChef), arredondada ao centavo UMA vez. */
export function totalGeral(linhas: LinhaAvulsa[]): number {
  const soma = linhas.reduce((s, l) => (faltaNaLinha(l) === '' ? s + (lerQuantidade(l.quantidade) as number) * (lerPreco(l.preco) as number) : s), 0)
  return arredondar(soma, 2)
}

/** A compra pode ser lançada? Todas as linhas completas, sem produto repetido (o SisChef soma e o Ivan se confunde) e pelo menos 1 item. */
export function problemaDaCompra(linhas: LinhaAvulsa[]): string {
  if (linhas.length === 0) return 'Adicione pelo menos 1 item.'
  const ruim = linhas.findIndex((l) => faltaNaLinha(l) !== '')
  if (ruim >= 0) return `Item ${ruim + 1}: ${faltaNaLinha(linhas[ruim])}.`
  const vistos = new Set<number>()
  for (let i = 0; i < linhas.length; i++) {
    const id = linhas[i].produtoId as number
    if (vistos.has(id)) return `O item ${i + 1} repete um produto: junte as quantidades numa linha só.`
    vistos.add(id)
  }
  return ''
}
