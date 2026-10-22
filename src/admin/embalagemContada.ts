// Regras puras do cupom de EMBALAGEM contada (sacos, copos, garfos…): produto no SisChef em CT (cento, "C/ 100 UND") ou PCT (pacote), cupom em ML (milheiro), UN…
// Pedido do Ivan, 22/10/2026 (cupom da A. N. da Silva Descartáveis): "ML" no cupom de saco é MILHEIRO (1.000 unidades), não mililitro, e o estoque é em CT.
// Sem rede nem React. A caixa do cupom (CorrigirCupom) usa estas contas só para SUGERIR e explicar; quem decide o número é o Ivan, que o confere na tela.
import type { ProdutoCatalogo } from '../lib/tipos'
import { ehEmbalagemContada } from '../lib/unidadesDaLista'

/** "ML" no cupom de um produto em CT ou PCT é milheiro (1.000 unidades), não mililitro. */
export const ehMilheiro = (unidadeCupom: unknown, unidadeProduto: unknown): boolean =>
  String(unidadeCupom ?? '').trim().toUpperCase() === 'ML' && ehEmbalagemContada(unidadeProduto)

/**
 * Quantas unidades vêm em 1 CT ou PCT, tiradas do NOME do produto: "SACO 1/2 KG - C/ 100 UND" → 100; "GARFO PARA BATATA - PCT 50 UND" → 50. Só quando o nome diz UM
 * número claro ("C/ N" ou "N UND"; o mesmo número escrito duas vezes vale); dois números diferentes ou nenhum → null (não adivinha).
 */
export function unidadesNaEmbalagem(nome: string | null | undefined): number | null {
  const t = String(nome ?? '')
  const achados = new Set<number>()
  for (const m of t.matchAll(/(?:^|[^A-Za-z0-9])C\s*\/\s*(\d{1,5})(?![\d,.])/gi)) achados.add(Number(m[1]))
  for (const m of t.matchAll(/(?:^|[^A-Za-z0-9.,/])(\d{1,5})\s*UNDS?(?![A-Za-z])/gi)) achados.add(Number(m[1]))
  if (achados.size !== 1) return null
  const n = [...achados][0]
  return Number.isInteger(n) && n >= 2 ? n : null
}

/** O produto (o nome corrigido, o do SisChef ou a descrição da planilha: o primeiro que diz o número) → unidades em 1 CT/PCT, ou null. */
export const unidadesNaEmbalagemDoProduto = (p: ProdutoCatalogo): number | null =>
  [p.nome, p.nome_sischef, p.descricao_sischef].map((n) => unidadesNaEmbalagem(n)).find((n) => n != null) ?? null

/**
 * Sugestão de "quantos CT/PCT vêm em 1 ML (milheiro)": 1.000 ÷ unidades da embalagem ("C/ 100" → 10; "C/ 50" → 20). Só quando o produto é CT/PCT, o cupom está em ML,
 * o nome diz o número e a conta dá número inteiro. Qualquer outra coisa → null (a caixa pergunta sem sugerir).
 */
export function sugestaoPorMilheiro(unidadeCupom: unknown, p: ProdutoCatalogo): number | null {
  if (!ehMilheiro(unidadeCupom, p.unidade)) return null
  const n = unidadesNaEmbalagemDoProduto(p)
  return n != null && 1000 % n === 0 ? 1000 / n : null
}
