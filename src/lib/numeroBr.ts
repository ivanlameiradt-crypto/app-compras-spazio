// Leitura de número digitado em português (item 3 da análise de 07/11/2026: "1.250" era lido como 1,25).
//
// Regra única, a mesma que o app usa para MOSTRAR números ("1.250" = mil duzentos e cinquenta; "1,5" = um e meio):
//  - a vírgula separa os decimais; o ponto separa os milhares;
//  - sem vírgula, ponto com EXATAMENTE 3 dígitos depois (e o número não começa com zero) é milhar: "1.250" = 1250, "1.250.000" = 1250000;
//  - qualquer outro ponto é decimal ("1.5", "12.50", "0.125", "0.500"): o teclado do celular às vezes só tem o ponto;
//  - texto, sinal, mistura sem sentido ("1.2.3", "1,2,3", "1.25,5") não é número: devolve null (nunca adivinha).
// Espaços são ignorados ("1 250" = 1250).

const INTEIRO = /^\d+$/
const MILHAR_SEM_VIRGULA = /^[1-9]\d{0,2}(\.\d{3})+$/
const DECIMAL_COM_PONTO = /^\d+\.\d+$/
const COM_VIRGULA = /^(?:[1-9]\d{0,2}(?:\.\d{3})+|\d+),\d+$/

/** O número como foi digitado, ou null se não for um número. Não decide sinal nem limite: quem chama confere (maior que zero, máximo...). */
export function lerNumeroBr(texto: string): number | null {
  const t = String(texto ?? '').replace(/\s/g, '')
  let n: number
  if (INTEIRO.test(t)) n = Number(t)
  else if (COM_VIRGULA.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'))
  else if (MILHAR_SEM_VIRGULA.test(t)) n = Number(t.replace(/\./g, ''))
  else if (DECIMAL_COM_PONTO.test(t)) n = Number(t)
  else return null
  return Number.isFinite(n) ? n : null
}

/**
 * Para campo que a pessoa está digitando agora: vazio vale 0, e "2," ou "2." (a vírgula ainda sem o resto) valem 2 até chegar o resto.
 * Texto que não é número devolve null: a tela mantém o último valor bom e marca o campo.
 */
export function lerNumeroBrDigitando(texto: string): number | null {
  const t = String(texto ?? '').replace(/\s/g, '')
  if (t === '') return 0
  return lerNumeroBr(t.replace(/[,.]$/, ''))
}
