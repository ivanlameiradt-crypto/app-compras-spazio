// Boleto de cobrança bancário (padrão FEBRABAN): o código de barras (44 dígitos) e a linha digitável (47 dígitos) já trazem o VALOR e o VENCIMENTO.
// Pedido do Ivan em 25/11/2026: nota do MATEUS vem sem boleto no XML; em vez de digitar, a Marilane tira a foto do boleto e o app preenche a parcela.
// Aqui fica só a conta (sem câmera, sem tela): ler os dígitos e devolver valor e data.

export interface BoletoLido {
  /** Os 44 dígitos do código de barras (a linha digitável de 47 é convertida). */
  codigo: string
  /** Valor em reais; null quando o boleto é "sem valor" (o pagador escolhe): esse a tela recusa. */
  valor: number | null
  /** AAAA-MM-DD; null quando o fator de vencimento é 0000 (sem data). */
  vencimento: string | null
}
export type ResultadoBoleto = { ok: true; boleto: BoletoLido } | { ok: false; motivo: string }

const DIA_MS = 86_400_000
/** O fator de vencimento conta dias desde 07/10/1997. Ao chegar em 9999 (21/02/2025) ele recomeçou em 1000: a mesma conta vale 9000 dias depois. */
const BASE_FATOR = Date.UTC(1997, 9, 7)
const CICLO_DIAS = 9000

const soDigitos = (t: string): string => t.replace(/\D/g, '')

/** Dígito verificador geral do código de barras (módulo 11, pesos 2 a 9 da direita para a esquerda, sem a posição do próprio dígito). */
function dvGeral(barras: string): number {
  let soma = 0
  let peso = 2
  for (let i = 43; i >= 0; i--) {
    if (i === 4) continue
    soma += Number(barras[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const dv = 11 - (soma % 11)
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv
}

/** Dígito verificador de cada um dos 3 primeiros campos da linha digitável (módulo 10, pesos 2 e 1 alternados da direita para a esquerda). */
function dvCampo(campo: string): number {
  let soma = 0
  let peso = 2
  for (let i = campo.length - 1; i >= 0; i--) {
    const p = Number(campo[i]) * peso
    soma += p > 9 ? p - 9 : p
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

/** Linha digitável (47) -> código de barras (44), conferindo o dígito de cada campo; null se algum campo não confere. */
function barrasDaLinha(linha: string): string | null {
  const c1 = linha.slice(0, 10)
  const c2 = linha.slice(10, 21)
  const c3 = linha.slice(21, 32)
  const ok = [c1, c2, c3].every((c) => dvCampo(c.slice(0, -1)) === Number(c[c.length - 1]))
  if (!ok) return null
  return c1.slice(0, 4) + linha[32] + linha.slice(33, 47) + c1.slice(4, 9) + c2.slice(0, 10) + c3.slice(0, 10)
}

/** Data do fator: das duas datas possíveis (antes e depois da virada de 2025), a mais perto da data de referência (hoje). */
function vencimentoDoFator(fator: number, referencia: Date): string | null {
  if (fator === 0) return null
  const a = BASE_FATOR + fator * DIA_MS
  const b = a + CICLO_DIAS * DIA_MS
  const ref = Date.UTC(referencia.getFullYear(), referencia.getMonth(), referencia.getDate())
  const escolhida = Math.abs(a - ref) <= Math.abs(b - ref) ? a : b
  return new Date(escolhida).toISOString().slice(0, 10)
}

const MOTIVO_NAO_CONFERE = 'O número do boleto não confere (algum dígito está errado). Confira e tente de novo.'

/** Lê o texto (44 ou 47 dígitos, com ou sem pontos e espaços) e devolve valor e vencimento, ou o motivo de não servir. */
export function lerBoleto(texto: string, referencia: Date = new Date()): ResultadoBoleto {
  const d = soDigitos(texto)
  if (d.length !== 44 && d.length !== 47) {
    return { ok: false, motivo: `O número do boleto tem 47 dígitos (ou 44, o do código de barras) e este tem ${d.length}. Confira e tente de novo.` }
  }
  if (d[0] === '8') {
    return { ok: false, motivo: 'Este é um documento de arrecadação (conta de consumo ou imposto), não um boleto de cobrança. Digite a parcela à mão.' }
  }
  const barras = d.length === 47 ? barrasDaLinha(d) : d
  if (barras == null || dvGeral(barras) !== Number(barras[4])) return { ok: false, motivo: MOTIVO_NAO_CONFERE }
  const centavos = Number(barras.slice(9, 19))
  return {
    ok: true,
    boleto: {
      codigo: barras,
      valor: centavos > 0 ? centavos / 100 : null,
      vencimento: vencimentoDoFator(Number(barras.slice(5, 9)), referencia),
    },
  }
}
