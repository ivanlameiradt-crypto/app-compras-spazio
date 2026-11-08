// Leitura de DINHEIRO digitado (frete e preço unitário). Usa a regra de lib/regras.lerNumero, a mesma com que o app MOSTRA números
// (sem vírgula, ponto com 3 dígitos é milhar), e acrescenta três proteções (correção de 08/11/2026, pedida pela revisão independente):
//  - separador na ponta: ",50" = 0,50 e "5," = 5, como antes de 07/11;
//  - número gigante (que o JavaScript lê como infinito) não é número: devolve null;
//  - preço unitário com ponto de milhar sem vírgula ("1.516") é ambíguo (R$ 1.516,00 ou R$ 1,516?): devolve null, e a tela pede a vírgula.
import { lerNumero } from './regras'

const MILHAR_SEM_VIRGULA = /^[1-9]\d{0,2}(\.\d{3})+$/

/** Valor em dinheiro digitado, ou null se não for um número finito. Sinal e limite: quem chama confere. */
export function lerDinheiro(texto: string): number | null {
  let t = String(texto ?? '').replace(/\s/g, '')
  if (/^,\d/.test(t)) t = '0' + t
  if (/[.,]$/.test(t)) t = t.slice(0, -1)
  const n = lerNumero(t)
  return n != null && Number.isFinite(n) ? n : null
}

/** True quando o texto tem ponto de milhar e não tem vírgula ("1.516", "10.125"): o caso que o preço unitário recusa. */
export function ehMilharAmbiguo(texto: string): boolean {
  return MILHAR_SEM_VIRGULA.test(String(texto ?? '').replace(/\s/g, ''))
}

/** Preço unitário digitado. "1.516" é ambíguo: devolve null, e a tela pede a vírgula nos centavos (ex.: "1,516" ou "1.516,00"). */
export function lerPrecoUnitario(texto: string): number | null {
  if (ehMilharAmbiguo(texto)) return null
  return lerDinheiro(texto)
}
