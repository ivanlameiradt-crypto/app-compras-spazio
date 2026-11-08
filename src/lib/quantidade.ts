// Leitura de QUANTIDADE digitada em português (kg, L, un, fardos): compra avulsa, tela Receber, Revisão, Confirmar pedido, Lançamentos e comprador.
//
// Dinheiro e quantidade são digitados de jeitos diferentes, por isso há dois leitores:
//  - DINHEIRO (frete, preço): lerDinheiro em lib/dinheiro (a regra de lib/regras.lerNumero: "1.250" = mil duzentos e cinquenta).
//  - QUANTIDADE (este arquivo): a balança mostra "2.500" para 2,5 kg, o teclado numérico do celular às vezes só tem o ponto, e ninguém
//    recebe 2.500 kg de queijo. Então, SEM vírgula, o ponto é SEMPRE decimal ("2.500" = 2,5; "1.000" = 1; "0.750" = 0,75).
//    COM vírgula, os pontos são milhar ("1.234,5" = 1234,5). Separador na ponta vale (",5" = 0,5; "5," = 5).
//    EXCEÇÃO (decisão do Ivan, revisão de 08/11/2026): em unidade CONTADA ("un": copos, guardanapos), que é sempre inteira, o ponto com
//    3 dígitos é milhar: "2.000" = 2000 e "1.250.000" = 1250000. A unidade vem do item (ou do produto), nunca da digitação.
// Texto, sinal e mistura sem sentido ("1.2.3", "1,2,3", "1.25,5", "1,250.5") não é número: devolve null (nunca adivinha). Espaços são ignorados.

const INTEIRO = /^\d+$/
const COM_MILHAR = /^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/
const MILHAR_SEM_VIRGULA = /^[1-9]\d{0,2}(?:\.\d{3})+$/
const DECIMAL_SIMPLES = /^\d*[.,]\d*$/

const limpar = (texto: string): string => String(texto ?? '').replace(/\s/g, '')
const finito = (n: number): number | null => (Number.isFinite(n) ? n : null)
const ehUnidadeContada = (unidade?: string | null): boolean => /^un$/i.test(String(unidade ?? '').trim())

/** Quantidade como foi digitada ("2.500" = 2,5; "1.234,5" = 1234,5; em "un", "2.000" = 2000), ou null se não for um número. Sinal e limite: quem chama confere. */
export function lerQuantidadeBr(texto: string, unidade?: string | null): number | null {
  const t = limpar(texto)
  if (ehUnidadeContada(unidade) && MILHAR_SEM_VIRGULA.test(t)) return finito(Number(t.replace(/\./g, '')))
  if (INTEIRO.test(t)) return finito(Number(t))
  if (COM_MILHAR.test(t)) return finito(Number(t.replace(/\./g, '').replace(',', '.')))
  if (DECIMAL_SIMPLES.test(t)) return finito(Number(t.replace(',', '.')))
  return null
}

/** Para o campo que a pessoa está digitando agora: vazio vale 0 (e "2," ou "2." valem 2 até chegar o resto). */
export const lerQuantidadeBrDigitando = (texto: string, unidade?: string | null): number | null => (limpar(texto) === '' ? 0 : lerQuantidadeBr(texto, unidade))
