// Regra da palavra-chave (pedido do Ivan, 08/10/2026): a descrição do produto na planilha dele É a descrição do SisChef, e cada palavra dela serve de
// palavra-chave para achar o produto de um item que chega no cupom (ou na nota). Aqui só a SUGESTÃO, pura (sem rede nem React):
//  - "forte": o item traz TODAS as palavras de um produto e só um produto se encaixa melhor (mais palavras) → o app já deixa o produto escolhido e o Ivan só confirma;
//  - "fraca": nenhum produto tem todas as palavras, ou há empate → o app mostra os candidatos mais parecidos e o Ivan escolhe.
// "Qualquer palavra sozinha" NÃO basta (LEITE está em 5 produtos, ALHO em 4, COCA COLA em 8): por isso o critério é ter todas as palavras do produto.
// Item sempre manual (molho de queijo cheddar, Coca em pacote) nunca recebe sugestão.
import type { ProdutoCatalogo } from '../lib/tipos'
import { itemSempreManual } from './cupomCorrigirRegras'
import { palavrasDe } from './palavrasDoItem'

export { palavrasDe }

/** Conjuntos de palavras que identificam o produto: o nome, o do SisChef, a descrição da planilha e as palavras-chave que o Ivan escreveu. */
function conjuntosDe(p: ProdutoCatalogo): string[][] {
  const textos = [p.nome, p.nome_sischef, p.descricao_sischef, p.palavras]
  const conjuntos: string[][] = []
  for (const t of textos) {
    const c = palavrasDe(t)
    if (c.length > 0 && !conjuntos.some((x) => x.length === c.length && x.every((w) => c.includes(w)))) conjuntos.push(c)
  }
  return conjuntos
}

export interface Sugestao {
  /** 'forte' = todas as palavras de um produto estão no item e nenhum outro encaixa tão bem; 'fraca' = só candidatos. */
  forca: 'forte' | 'fraca'
  /** O produto sugerido (o único de 'forte'; o melhor candidato de 'fraca'). */
  produto: ProdutoCatalogo
  /** Outros candidatos, do mais parecido ao menos (no máximo 3). */
  alternativas: ProdutoCatalogo[]
}

export function sugerirPorPalavras(catalogo: ProdutoCatalogo[], descricaoCupom: string, unidadeCupom?: string | null): Sugestao | null {
  if (itemSempreManual({ descricao_cupom: descricaoCupom, unidade_cupom: unidadeCupom ?? null })) return null
  const doItem = palavrasDe(descricaoCupom)
  if (doItem.length === 0) return null
  const completos: { p: ProdutoCatalogo; n: number }[] = []
  const parciais: { p: ProdutoCatalogo; n: number }[] = []
  for (const p of catalogo) {
    if (p.oculto) continue
    let cheio = 0
    let parcial = 0
    for (const c of conjuntosDe(p)) {
      const achadas = c.filter((w) => doItem.includes(w)).length
      if (achadas === c.length) cheio = Math.max(cheio, c.length)
      else if (achadas > 0) parcial = Math.max(parcial, achadas)
    }
    if (cheio > 0) completos.push({ p, n: cheio })
    else if (parcial > 0) parciais.push({ p, n: parcial })
  }
  const ordem = (a: { p: ProdutoCatalogo; n: number }, b: { p: ProdutoCatalogo; n: number }) => b.n - a.n || a.p.nome.length - b.p.nome.length || a.p.nome.localeCompare(b.p.nome, 'pt-BR')
  completos.sort(ordem)
  parciais.sort(ordem)
  if (completos.length > 0 && (completos.length === 1 || completos[0].n > completos[1].n)) {
    return { forca: 'forte', produto: completos[0].p, alternativas: completos.slice(1, 4).map((x) => x.p) }
  }
  const todos = [...completos, ...parciais].map((x) => x.p)
  if (todos.length === 0) return null
  return { forca: 'fraca', produto: todos[0], alternativas: todos.slice(1, 4) }
}
