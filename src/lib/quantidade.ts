// Leitura de QUANTIDADE digitada em português (kg, L, un, fardos): compra avulsa e tela Receber (itens 3 e 4 da análise de 07/11/2026).
//
// Dinheiro e quantidade são digitados de jeitos diferentes, por isso há dois leitores:
//  - DINHEIRO (frete, preço): `lerNumero` em lib/regras, a mesma regra com que o app MOSTRA números: sem vírgula, ponto com 3 dígitos é
//    milhar ("1.250" = mil duzentos e cinquenta; "2.79" = 2,79).
//  - QUANTIDADE (este arquivo): a balança mostra "2.500" para 2,5 kg, o teclado numérico do celular às vezes só tem o ponto, e ninguém
//    recebe 2.500 kg de queijo. Então, SEM vírgula, o ponto é SEMPRE decimal ("2.500" = 2,5; "1.000" = 1; "0.750" = 0,75), como o campo
//    antigo já lia. COM vírgula, os pontos são milhar ("1.234,5" = 1234,5). Separador na ponta vale como as pessoas digitam (",5" e ".5"
//    = 0,5; "5," e "5." = 5). A mesma distinção já existia em admin/cupomCorrigirRegras.ts (quantidade do cupom).
// Texto, sinal e mistura sem sentido ("1.2.3", "1,2,3", "1.25,5", "1,250.5") não é número: devolve null (nunca adivinha). Espaços são ignorados.

const INTEIRO = /^\d+$/
const COM_MILHAR = /^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/
const DECIMAL_SIMPLES = /^\d*[.,]\d*$/

const limpar = (texto: string): string => String(texto ?? '').replace(/\s/g, '')
const finito = (n: number): number | null => (Number.isFinite(n) ? n : null)

/** Quantidade como foi digitada ("2.500" = 2,5; "1.234,5" = 1234,5), ou null se não for um número. Sinal e limite: quem chama confere. */
export function lerQuantidadeBr(texto: string): number | null {
  const t = limpar(texto)
  if (INTEIRO.test(t)) return finito(Number(t))
  if (COM_MILHAR.test(t)) return finito(Number(t.replace(/\./g, '').replace(',', '.')))
  if (DECIMAL_SIMPLES.test(t)) return finito(Number(t.replace(',', '.')))
  return null
}

/**
 * Para o campo que a pessoa está digitando agora: vazio vale 0 (e "2," ou "2." valem 2 até chegar o resto, pela regra acima).
 * Texto que não é número devolve null: a tela mantém o último valor bom e marca o campo.
 */
export const lerQuantidadeBrDigitando = (texto: string): number | null => (limpar(texto) === '' ? 0 : lerQuantidadeBr(texto))
