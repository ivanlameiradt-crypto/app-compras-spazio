// supabase/functions/enviar-cupom/regraQuilos.ts — CÓPIA IDÊNTICA de src/admin/regraQuilos.ts (regra do Ivan, 08/10/2026): o estoque dos produtos
// "(KG)" é sempre em quilos. Regra 1: peso da embalagem na descrição × unidades (850g × 10 = 8,5 kg). Regra 2: a quantidade do cupom já é o peso
// (kg; gramas ÷ 1.000). Sem nenhuma das duas: null. Trava: mais de 50 kg por unidade é absurdo. O teste tests/unit/regraQuilos.test.ts confere as duas.

/** Mais que isto, por unidade do cupom, não é um produto "(KG)" desta casa: é quase certo que o número veio em gramas ou digitado errado. */
export const MAX_KG_POR_UNIDADE = 50

const UNIDADE_KG = /^(kg|kgs|kilo|kilos|quilo|quilos)$/i
const UNIDADE_G = /^(g|gr|grs|grama|gramas)$/i
const UNIDADE_OUTRA_MEDIDA = /^(l|lt|lts|litro|litros|ml)$/i

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** O peso de UMA embalagem escrito na descrição, em kg, quando há UM peso claro ("850g" → 0,85). Dois pesos, "12x395g" (embalagem múltipla) ou um
 *  peso fora de 1 g a 50 kg → null (não adivinha). */
export function pesoNaDescricao(descricao: string | null | undefined): number | null {
  const t = String(descricao ?? '')
  // "1X1,5Kg" é UMA embalagem de 1,5 kg (jeito do Atacadão): vale. "12X395G" (várias embalagens) não: o app pergunta.
  const semUm = t.replace(/(^|[^\d.,])1\s*[xX]\s*(?=\d)/g, '$1')
  if (/\d\s*[xX]\s*\d/.test(semUm)) return null
  const achados = [...semUm.matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(KG|GRS?|G|K)(?![A-Za-z])/gi)]
  if (achados.length !== 1) return null
  const numero = Number(achados[0][1].replace(',', '.'))
  const kg = /^(KG|K)$/i.test(achados[0][2]) ? numero : numero / 1000
  return Number.isFinite(kg) && kg >= 0.001 && kg <= MAX_KG_POR_UNIDADE ? round3(kg) : null
}

export interface EntradaEmKg {
  /** Quanto entra no estoque, em kg (3 casas). */
  kg: number
  /** 1 = peso da embalagem na descrição × unidades; 2 = a quantidade do cupom já é o peso. */
  regra: 1 | 2
  /** De onde saiu o número, para mostrar ao Ivan. */
  origem: string
}

const br = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/** Aplica as Regras 1 e 2 a UM item do cupom. null = nenhuma vale (o Ivan decide / vale o fator que ele já confirmou). */
export function entradaEmKg(descricao: string | null | undefined, unidadeCupom: string | null | undefined, quantidade: number): EntradaEmKg | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null
  const u = String(unidadeCupom ?? '').trim()
  if (UNIDADE_KG.test(u)) return { kg: round3(quantidade), regra: 2, origem: `quantidade do cupom (${br(quantidade)} kg)` }
  if (UNIDADE_G.test(u)) return { kg: round3(quantidade / 1000), regra: 2, origem: `quantidade do cupom (${br(quantidade)} g ÷ 1.000)` }
  if (UNIDADE_OUTRA_MEDIDA.test(u)) return null // litro e mililitro: não há kg para tirar do nome
  const peso = pesoNaDescricao(descricao)
  if (peso == null) return null
  return { kg: round3(quantidade * peso), regra: 1, origem: `${br(quantidade)} un × ${br(peso * 1000)} g (peso da embalagem no nome do cupom)` }
}

/** Quilos por unidade do cupom acima do limite: número absurdo, a tela e o servidor não lançam sem perguntar. */
export const kgPorUnidadeAbsurdo = (entradaKg: number, quantidade: number): boolean =>
  Number.isFinite(entradaKg) && Number.isFinite(quantidade) && quantidade > 0 && entradaKg / quantidade > MAX_KG_POR_UNIDADE
