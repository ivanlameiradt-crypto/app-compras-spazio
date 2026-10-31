// A CONTA de cada item que já vem ligado ao produto do SisChef (pedido do Ivan, 31/10/2026, olhando a NF 000113752 da De Marchi: o Brioche vem como 48 PC e entra 720 UN; ele digitou
// ×1, ×15 e ×1 sem precisar, porque nada na tela dizia que a conta já era automática). O robô de leitura manda, em cada item, a quantidade e a unidade ORIGINAIS da nota
// (`qtd_nota`/`unidade_nota`, a "Qtde. XML") ao lado das CONVERTIDAS (`qtd`/`unidade_sischef`, a "Qtde Conver."), e a regra FIXA de embalagem do robô que vale para o item
// (`regra_embalagem`). Aqui isso vira o texto "48 PC × 15 = 720 UN" e a resposta de QUEM faz a conta. Regras puras, sem rede nem React; a tela só MOSTRA, nunca grava nada.
import type { ItemNotaSefaz } from '../lib/tipos'
import { CONVERSAO_CASAS, formatarConversao, formatarQuantidade, quantidadeNoEstoque, rotuloUnidade } from './associacaoRegras'
import { itemAssociado } from './notaSefazRegras'

/** Quem faz a conta: o SisChef (a ficha do produto lá já converte: a tela da importação mostra a quantidade convertida) ou o robô (a tabela fixa do Ivan: ele multiplica a linha do pedido ao lançar). */
export type QuemFazAConta = 'sischef' | 'robo'
export interface ContaDoItem {
  /** "48 PC × 15 = 720 UN"; quando o fator não reproduz a quantidade certinha (arredondamento), sem a multiplicação: "48 PC → 719,99 UN". */
  conta: string
  /** O total que entra no estoque, com a unidade: "720 UN". */
  entra: string
  quem: QuemFazAConta
}

const positivo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
/** Duas quantidades iguais, tolerando o arredondamento de 4 casas do SisChef. */
const iguais = (a: number, b: number): boolean => Math.abs(a - b) <= 0.0005 * Math.max(1, Math.abs(b))

/** O fator da regra FIXA do robô que vale para este item, ou null: só com fator maior que 1, para o MESMO produto que o item tem ligado e para a nota na unidade da regra. */
function fatorDaRegra(it: ItemNotaSefaz, unidadeNota: string): number | null {
  const r = it.regra_embalagem
  const fator = positivo(r?.fator)
  if (r == null || fator == null || !(fator > 1)) return null
  if (String(r.produto_id ?? '').trim() !== String(it.produto_id ?? '').trim()) return null
  return rotuloUnidade(r.unidade) === unidadeNota ? fator : null
}

function montar(nota: number, unidadeNota: string, fator: number, unidadeEntra: string, quem: QuemFazAConta, lido?: number): ContaDoItem | null {
  const total = quantidadeNoEstoque(nota, fator)
  const valor = lido ?? total
  if (valor == null) return null
  const entra = `${formatarQuantidade(valor)} ${unidadeEntra}`
  const reproduz = total != null && (lido == null || iguais(total, lido))
  const origem = `${formatarQuantidade(nota)} ${unidadeNota}`
  return { conta: reproduz ? `${origem} × ${formatarConversao(fator)} = ${entra}` : `${origem} → ${entra}`, entra, quem }
}

/**
 * A conta do item, ou null quando não há o que mostrar. Só item JÁ ligado a produto do SisChef; só quando a leitura trouxe as duas quantidades e as duas unidades; e só quando
 * há MULTIPLICAÇÃO de verdade (a mesma quantidade com outro nome de unidade, "10 PC" → "10 UN", não é conta). Dois jeitos de ser automático:
 *  - 'sischef': a quantidade convertida (`qtd`) já difere da da nota: o SisChef converteu pela ficha do produto (48 PC → 720 UN; 8 UN → 18,16 KG);
 *  - 'robo': a regra FIXA do robô vale para o item (`regra_embalagem`) e a tela do SisChef ainda mostra a quantidade da nota (4 UN): o robô multiplica ao lançar (4 UN × 15 = 60 UN).
 * Qualquer outra coisa (regra de outro produto, quantidade que não é nem a da nota nem a da regra) não se diz "automática": o robô para nesses casos e a tela mostra o motivo dele.
 */
export function contaDoItem(it: ItemNotaSefaz): ContaDoItem | null {
  if (!itemAssociado(it)) return null
  const nota = positivo(it.qtd_nota)
  const entra = positivo(it.qtd)
  const unidadeNota = rotuloUnidade(it.unidade_nota)
  const unidadeEntra = rotuloUnidade(it.unidade_sischef)
  if (nota == null || entra == null || unidadeNota === '' || unidadeEntra === '') return null
  const regra = fatorDaRegra(it, unidadeNota)
  if (iguais(entra, nota)) {
    return regra != null && unidadeNota === unidadeEntra ? montar(nota, unidadeNota, regra, unidadeEntra, 'robo') : null
  }
  if (regra != null && !iguais(entra, nota * regra)) return null          // nem a quantidade da nota nem a da regra: o robô para neste caso (ajustes_da_tela), então não é "automático"
  const fator = regra ?? Math.round((entra / nota) * 10 ** CONVERSAO_CASAS) / 10 ** CONVERSAO_CASAS
  return montar(nota, unidadeNota, fator, unidadeEntra, 'sischef', entra)
}
