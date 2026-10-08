// Regras puras da correção de um cupom parado em "precisa de você" (REVISAR) por item SEM produto confirmado, feita dentro do app
// (pedido do Ivan, 07/10: "deixe eu corrigir as pendências no app" + "botão para reenviar"). Sem React nem rede.
//
// Este arquivo é o ESPELHO da Edge Function confirmar-cupom (supabase/functions/confirmar-cupom/logica.ts): a tela usa estas contas para
// acender o botão "Reenviar para lançar" só quando a soma fecha, e o servidor refaz a MESMA conta antes de aceitar. Se as duas divergirem,
// o pior caso é a tela acender o botão e o servidor recusar (ele é quem manda) — por isso cada regra daqui cita a função que copia, e o
// teste tests/unit/cupomCorrigirRegras.test.ts confere a conta da tela contra a de logica.ts.
import { lerNumero } from '../lib/regras'
import type { CupomRecente, ItemCupomRecente } from '../lib/tipos'

/** A mesma tolerância do robô (cupom_valores.conferir_total) e da Edge Function: até 2 centavos entre a soma das linhas e o total do cupom. */
export const TOLERANCIA = 0.02

const round2 = (v: number) => Math.round(v * 100) / 100
const round3 = (v: number) => Math.round(v * 1000) / 1000
/** Número como o servidor o lê (`Number(x ?? 0)`): nulo vira zero; o que não é número também (para a conta nunca virar NaN na tela). */
const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** O que o Ivan digita ("0,5", "1.234,5", " 2 ") como quantidade; só vale maior que zero (o servidor recusa zero e negativo). */
export function lerQuantidade(texto: string): number | null {
  const t = texto.replace(/\s/g, '')
  if (t === '') return null
  // Com vírgula, ela é o decimal e os pontos são de milhar ("1.234,5"). SEM vírgula, um ponto é DECIMAL ("1.234" = 1,234 kg): o teclado numérico do
  // Android só oferece o ponto, e um peso nunca tem milhar — o lerNumero genérico (preços) leria 1.234 como 1234 e mandaria 1.234 kg ao estoque.
  const n = t.includes(',')
    ? lerNumero(t)
    : (t.split('.').length <= 2 && /^\d*\.?\d*$/.test(t) ? Number(t) : null)
  return n !== null && Number.isFinite(n) && n > 0 ? n : null
}

/** Unidade comparável, igual à `unidadeNorm` de logica.ts: "UN", "UND", "UNID" e "PC" são a mesma coisa; o resto fica como veio (kg, cx, l). */
export function unidadeNorm(u: unknown): string {
  const t = String(u ?? '').trim().toLowerCase()
  return /^(un|und|unid|unidade|pc|pç)$/.test(t) ? 'un' : t
}

/** Unidade de peso/volume: a tela pede "o peso" (com 3 casas) em vez de "a quantidade". A mesma lista de cupomRegras.ts. */
export function ehPeso(unidade: unknown): boolean {
  return /^(kg|g|gr|l|lt|ml)$/i.test(String(unidade ?? '').trim())
}

/**
 * O cupom está numa unidade e o produto do SisChef em outra (cupom em UN, produto em KG): o servidor exige `entrada` (quanto entra no estoque
 * na unidade do produto) e recusa sem ela. Unidade vazia de um dos lados não conta como diferença — o servidor também não a cobra.
 */
export function precisaConversao(unidadeCupom: unknown, unidadeProduto: unknown): boolean {
  const a = unidadeNorm(unidadeCupom)
  const b = unidadeNorm(unidadeProduto)
  return a !== '' && b !== '' && a !== b
}

const semProduto = (it: ItemCupomRecente): boolean => String(it.sugestao_produto?.id ?? '').trim() === ''

/** Posições (0-based em `itens`) dos itens sem produto confirmado: são os que o servidor exige confirmar (e só eles). `itens` que não é lista = nenhum. */
export function itensPendentes(c: CupomRecente): number[] {
  const itens = Array.isArray(c.itens) ? c.itens : []
  return itens.map((it, i) => (semProduto(it) ? i : -1)).filter((i) => i >= 0)
}

/** O que a tela já tem de um item pendente: a quantidade do cupom e, quando a unidade do produto é outra, quanto entra no estoque. */
export interface Confirmada { quantidade: number; entrada: number | null }

/**
 * A linha como o servidor a refaz (`refazerItem` + uma linha de `conferirSoma` em logica.ts): a entrada arredonda a 3 casas; com conversão
 * (entrada diferente da quantidade) o preço por unidade do estoque é quantidade × preço do cupom ÷ entrada, o que PRESERVA o valor da linha;
 * sem conversão, o preço do cupom. O valor da linha é round2(entrada × preço − desconto). Entrada que arredonda a zero: o servidor recusa;
 * aqui ela entra sem conversão (valor = −desconto) só para a conta não virar NaN — a soma não fecha e o botão fica apagado.
 */
export function linhaConfirmada(it: ItemCupomRecente, conf: Confirmada): { entrada: number; valorUnitario: number; valor: number } {
  const precoCupom = num(it.valor_unitario)
  const entrada = round3(conf.entrada ?? conf.quantidade)
  const converte = conf.entrada !== null && Math.abs(conf.entrada - conf.quantidade) > 1e-9 && entrada > 0
  const valorUnitario = converte ? (conf.quantidade * precoCupom) / entrada : precoCupom
  return { entrada, valorUnitario, valor: round2(entrada * valorUnitario - num(it.desconto_item)) }
}

/** O valor de um item que JÁ tem produto (entrada × preço − desconto, a 2 casas, como o robô); null quando falta a quantidade ou o preço. */
export function linhaJaConfirmada(it: ItemCupomRecente): number | null {
  if (it.entrada_estoque == null || it.valor_unitario == null) return null
  const entrada = Number(it.entrada_estoque)
  const preco = Number(it.valor_unitario)
  if (!Number.isFinite(entrada) || !Number.isFinite(preco)) return null
  return round2(entrada * preco - num(it.desconto_item))
}

/**
 * A soma do cupom como o robô e o servidor a conferem (`conferirSoma`): cada linha arredondada a 2 casas, somadas e arredondadas de novo;
 * a diferença é soma − total. Itens já confirmados entram com o que está gravado; pendentes, com a confirmação da tela — e os pendentes AINDA
 * sem confirmação ficam em `faltam` (o servidor recusa enquanto faltar algum). `bate` só quando nada falta, o total foi lido (> 0) e a
 * diferença cabe na tolerância. `total` é null quando o cupom não tem total lido (0 ou nulo): sem ele não há conta a conferir.
 */
export function somaDoCupom(
  c: CupomRecente,
  confirmadas: ReadonlyMap<number, Confirmada>,
): { soma: number; total: number | null; diferenca: number | null; bate: boolean; faltam: number[]; linhas: { indice: number; valor: number | null }[] } {
  const itens = Array.isArray(c.itens) ? c.itens : []
  const faltam: number[] = []
  const linhas: { indice: number; valor: number | null }[] = []
  let soma = 0
  itens.forEach((it, indice) => {
    let valor: number | null
    if (semProduto(it)) {
      const conf = confirmadas.get(indice)
      if (conf) {
        valor = linhaConfirmada(it, conf).valor
      } else {
        valor = null
        faltam.push(indice)
      }
    } else {
      valor = linhaJaConfirmada(it)
      // item com produto mas sem quantidade ou preço (não devia existir): o servidor conta `0 × 0 − desconto`; a tela conta igual
      if (valor === null) soma += round2(0 - num(it.desconto_item))
    }
    if (valor !== null) soma += valor
    linhas.push({ indice, valor })
  })
  soma = round2(soma)
  const lido = c.valor_a_pagar == null ? NaN : Number(c.valor_a_pagar)
  const total = Number.isFinite(lido) && lido > 0 ? lido : null
  const diferenca = total === null ? null : round2(soma - round2(total))
  const bate = faltam.length === 0 && total !== null && total > 0 && diferenca !== null && Math.abs(diferenca) <= TOLERANCIA + 1e-9
  return { soma, total, diferenca, bate, faltam, linhas }
}

/**
 * Código de barras que o servidor aceita como chave GLOBAL de aprendizado — igual à `ehGtin` de logica.ts: EAN-8, UPC-12, EAN-13 ou GTIN-14
 * com o dígito verificador certo (módulo 10 do GS1) e não só zeros. Código interno do mercado, EAN cortado na foto ou "0000000000000" não
 * valem: dois fornecedores podem usar o mesmo número para produtos diferentes, e o robô lançaria o produto errado em silêncio.
 */
export function ehGtin(v: unknown): v is string {
  if (typeof v !== 'string' || !/^(\d{8}|\d{12,14})$/.test(v) || /^0+$/.test(v)) return false
  let soma = 0
  for (let i = v.length - 1, peso = 1; i >= 0; i--, peso = 4 - peso) soma += Number(v[i]) * peso
  return soma % 10 === 0
}

/** Texto comparável: sem acento, minúsculo, só letras e dígitos separados por espaço. */
const comparavel = (t: unknown): string => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Itens que o Ivan quer informar SEMPRE à mão, a cada compra (08/10/2026): o mesmo nome muda de produto ou de embalagem conforme o fornecedor, então o
 * app não guarda a escolha ("Lembrar" desligado) e nunca casa sozinho. 1) Molho de queijo cheddar ("MOLHO QJO CHEDDAR"). 2) Coca-Cola em pacote/pack
 * (unidade PCT/PACK/FD/CX, ou "6X350ML", "PACK" no nome; "1X2L" é uma unidade só). Coca-Cola avulsa (UN, 1 L, 2 L) segue o fluxo normal.
 */
export function itemSempreManual(it: Pick<ItemCupomRecente, 'descricao_cupom' | 'unidade_cupom'>): boolean {
  const d = comparavel(it.descricao_cupom)
  const u = comparavel(it.unidade_cupom)
  if (/\bmolho\b/.test(d) && /\bcheddar\b/.test(d)) return true
  if (/\bcoca\b/.test(d) && (/^(pct|pack|fd|cx)$/.test(u) || /\b([2-9]|\d{2,}) ?x ?\d+/.test(d) || /\b(pack|pct|fardo)\b/.test(d))) return true
  return false
}

/**
 * Se o servidor tem como guardar o aprendizado deste item (`linhaDeAprendizado` em logica.ts): por um código de barras VÁLIDO do cupom (GTIN,
 * vale para qualquer fornecedor) ou pela descrição + CNPJ do emitente (só dígitos, 14). Sem nenhuma das duas chaves, a tela nem oferece o "lembrar".
 * "Descrição não vazia" é a do servidor: depois de normalizada (só letras e dígitos) ainda sobra alguma coisa.
 */
export function podeLembrar(c: CupomRecente, it: ItemCupomRecente): boolean {
  if (itemSempreManual(it)) return false // regra do Ivan (08/10): estes itens ele informa à mão a cada compra
  if (ehGtin(it.codigo_barras)) return true
  const cnpjOk = typeof c.emitente_cnpj === 'string' && /^\d{14}$/.test(c.emitente_cnpj)
  const descricao = String(it.descricao_cupom ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return cnpjOk && descricao !== ''
}
