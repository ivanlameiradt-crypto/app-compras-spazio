// Memória de embalagem das notas fiscais, lado da TELA (fase 2, pedido do Ivan de 29/10/2026). O robô aprende sozinho, depois de uma nota lançada, quantas unidades do produto
// vêm em 1 unidade da nota ("6 UN" na nota = 6 fardos de 6 latas, produto em lata) e aplica sozinho na nota seguinte; a tabela dele é public.nfe_aprendizado. Aqui ficam as regras
// puras (sem rede nem React) que ligam um item da nota à linha que o robô lembra e dizem o que a tela mostra: o casamento pela chave, o texto "visto em 2 notas" e qual dos
// avisos vale. A tela só MOSTRA e deixa o Ivan corrigir ou esquecer; quem aprende e quem aplica é o robô.
import { quantidadeNoEstoque } from './associacaoRegras'
import { codForDoItem } from './notaSefazRegras'
import type { ItemNotaSefaz, NfeAprendizado, NotaSefazLista } from '../lib/tipos'

const soDigitos = (t: string | null | undefined): string => (t ?? '').replace(/\D/g, '')

/**
 * A linha que o robô lembra para este item, ou null. A chave é a mesma do robô: CNPJ do fornecedor (só os dígitos, da própria nota) + CÓD. FOR do item (texto exato, só sem os
 * espaços das pontas: "017253" NÃO é "17253") + unidade da nota (em maiúsculas, a mesma que a tela mostra no item). Falta qualquer uma das três = nada lembrado: sem CNPJ
 * na nota (a tela não o tira da chave de acesso), sem CÓD. FOR na descrição ou sem unidade, o robô também não teria como achar a linha. A descrição NUNCA entra na chave
 * (muda de nota para nota, e o SisChef troca o nome depois de associar).
 */
export function memoriaDoItem(
  memoria: readonly NfeAprendizado[] | null | undefined,
  nota: Pick<NotaSefazLista, 'cnpj_emitente'>,
  item: ItemNotaSefaz,
): NfeAprendizado | null {
  if (!memoria || memoria.length === 0) return null
  const cnpj = soDigitos(nota.cnpj_emitente)
  const cod = (codForDoItem(item) ?? '').trim()
  const unidade = (item.unidade_sischef ?? '').trim().toUpperCase()
  if (cnpj === '' || cod === '' || unidade === '') return null
  return memoria.find((l) => soDigitos(l.emitente_cnpj) === cnpj && (l.cod_forn ?? '').trim() === cod && (l.unidade_nota ?? '').trim().toUpperCase() === unidade) ?? null
}

/** "28/10", sempre no horário de Brasília (o mesmo da equipe e do resto do app), qualquer que seja o fuso do aparelho; data ilegível = null. */
function dataCurta(iso: string | null | undefined): string | null {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return null
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  )
  return `${p.day}/${p.month}`
}

/** "visto em 2 notas, a última em 28/10" (uma nota só: "visto em 1 nota, em 28/10"; sem data legível, só a contagem). */
export function textoVisto(linha: Pick<NfeAprendizado, 'vezes' | 'atualizado_em'>): string {
  const n = Math.floor(Number(linha.vezes))
  const quando = dataCurta(linha.atualizado_em)
  if (!(n >= 2)) return quando ? `visto em 1 nota, em ${quando}` : 'visto em 1 nota'
  return quando ? `visto em ${n} notas, a última em ${quando}` : `visto em ${n} notas`
}

/** O produto que o item tem ligado (no SisChef) é o mesmo da linha lembrada? Item sem produto = não. */
export function mesmoProdutoLembrado(item: ItemNotaSefaz, linha: Pick<NfeAprendizado, 'produto_id'>): boolean {
  const id = Number(String(item.produto_id ?? '').trim())
  return String(item.produto_id ?? '').trim() !== '' && Number.isFinite(id) && id === Number(linha.produto_id)
}

/** Dois números de conversão são o mesmo (tolera o ruído do ponto flutuante: 12 e 12,0000)? */
export const mesmoNumero = (a: number, b: number): boolean => Math.abs(Number(a) - Number(b)) < 1e-9

/**
 * O que a tela mostra, no item que JÁ vem associado do SisChef, para a linha lembrada (`linha` já casada por memoriaDoItem):
 *  - 'aplica'            : o Ivan não informou número nesta nota, o item não está pedindo conversão e o produto ligado é o lembrado → "O robô lembra…" (Corrigir / Esquecer);
 *  - 'outro-produto'     : o mesmo, mas o item está ligado a OUTRO produto → aviso amarelo (o robô para e manda conferir; sem botão de usar);
 *  - 'vale-o-informado'  : o Ivan informou, nesta nota, um número diferente do lembrado → só a linha pequena (o número dele vence a memória);
 *  - null                : nada a dizer (nada lembrado; o robô parou pedindo a conversão; ou o Ivan informou exatamente o número lembrado — a linha "Conversão informada" já diz tudo).
 */
export type SituacaoDaMemoria = 'aplica' | 'outro-produto' | 'vale-o-informado'
export function situacaoDaMemoria(item: ItemNotaSefaz, linha: NfeAprendizado | null | undefined, informada: number | null | undefined, pede: boolean): SituacaoDaMemoria | null {
  if (!linha) return null
  if (informada != null) return mesmoNumero(informada, linha.fator) ? null : 'vale-o-informado'
  if (pede) return null
  return mesmoProdutoLembrado(item, linha) ? 'aplica' : 'outro-produto'
}

/** Quanto entra no estoque se o robô aplicar a linha lembrada à quantidade que a tela mostra para o item (null = sem quantidade legível). */
export const entraComALembrada = (item: ItemNotaSefaz, linha: Pick<NfeAprendizado, 'fator'>): number | null => quantidadeNoEstoque(item.qtd, linha.fator)
