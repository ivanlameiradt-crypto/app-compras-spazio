// Frete da nota fiscal (pedido do Ivan, 09/10/2026): nota de fora do Pará traz um frete que NÃO está na nota (é pago a outra empresa, em boleto lançado à mão no SisChef
// por um funcionário). O valor do frete serve SÓ para formar o preço do produto: nunca entra no financeiro da nota.
// O SisChef tem o mesmo recurso na entrada de compra (Complemento do pedido › "Valor do Frete" + "Distribuir entre os itens"): confirmado ao vivo em 09/10 que ele reparte
// o frete PROPORCIONAL AO VALOR de cada item (390,00 e 47,40 com frete de 100,00 → "(+) frete 89,16" e "(+) frete 10,84") e soma o frete ao total do pedido.
// Aqui, a mesma conta, para o Ivan conferir antes de mandar lançar. Puro: sem React nem rede.

/** Os tipos de frete do SisChef (campo "Tipo do frete" do Complemento do pedido), com o código dele. */
export const TIPOS_DE_FRETE: { valor: string; rotulo: string }[] = [
  { valor: '0', rotulo: '0 - Frete por conta do Remetente (CIF)' },
  { valor: '1', rotulo: '1 - Frete por conta do Destinatário (FOB)' },
  { valor: '2', rotulo: '2 - Frete por conta de Terceiros' },
  { valor: '3', rotulo: '3 - Transporte próprio do Remetente' },
  { valor: '4', rotulo: '4 - Transporte próprio do Destinatário' },
  { valor: '9', rotulo: '9 - Sem ocorrência de transporte' },
]
/** A contratação do frete pelo destinatário (nós) com uma transportadora: o caso da Tamarozzi. */
export const TIPO_DE_FRETE_PADRAO = '1'

/** Código IBGE do Pará na chave de acesso da NF-e (os 2 primeiros dígitos são o estado do emitente). */
const UF_PARA = '15'

/** O código do estado do emitente (2 primeiros dígitos da chave de 44 dígitos), ou '' se a chave não é válida. */
export function codigoUfDaChave(chave: string | null | undefined): string {
  const d = String(chave ?? '').replace(/\D/g, '')
  return d.length === 44 ? d.slice(0, 2) : ''
}

const SIGLAS: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
/** A sigla do estado do emitente ("SP"), ou '' se a chave não diz. */
export const siglaDaChave = (chave: string | null | undefined): string => SIGLAS[codigoUfDaChave(chave)] ?? ''
/** Nota de fora do Pará: é onde o frete costuma ser pago à parte. Chave inválida = não sabe (false). */
export const notaDeForaDoPara = (chave: string | null | undefined): boolean => {
  const c = codigoUfDaChave(chave)
  return c !== '' && c !== UF_PARA
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/** O que o Ivan digita ("300", "300,00", "1.250,5") como valor do frete; só vale maior que zero. */
export function lerFrete(texto: string): number | null {
  const t = texto.replace(/\s/g, '')
  if (t === '') return null
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  return Number.isFinite(n) && n > 0 ? round2(n) : null
}

/**
 * Quantas unidades vêm dentro do pacote/caixa, lido do NOME do produto ("... PCT 25 UND" → 25; "CX 12 UN", "FARDO C/ 10 UNID"). null quando o nome não diz
 * (não chuto): sem isso o app só mostra o preço por pacote. Só vale 2 ou mais (1 unidade no pacote não muda nada).
 */
export function unidadesDoPacote(descricao: string | null | undefined): number | null {
  const m = /\b(?:PCT|PC|PACOTE|CX|CAIXA|FD|FARDO|SC|SACO)\s*(?:C\/|COM)?\s*(\d{1,4})\s*(?:UND|UNDS|UN|UNID|UNIDS|UNIDADES)\b/i.exec(String(descricao ?? ''))
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n >= 2 ? n : null
}

/** Um item da nota para o rateio: quanto custa (valor total do item na nota), quantas unidades (na unidade do produto) e o nome. */
export interface ItemParaRateio { descricao: string; valor: number; quantidade: number; unidade: string }
export interface ItemRateado extends ItemParaRateio {
  /** A parte do frete deste item (R$), proporcional ao valor. */
  frete: number
  /** O preço unitário final: preço da nota + o frete deste item diluído por unidade (kg, pacote, unidade). */
  precoNota: number
  precoFinal: number
}

/**
 * Reparte o frete entre os itens, PROPORCIONAL AO VALOR de cada um (a mesma regra do "Distribuir entre os itens" do SisChef), em centavos: o que sobra do arredondamento
 * vai para o item de maior valor, para a soma fechar exatamente no frete. O preço final por unidade = preço da nota + a parte do frete ÷ quantidade.
 * `percentual` = frete ÷ valor dos itens (o "quanto o frete representa sobre a nota", em %). Itens sem valor ou sem quantidade: lista vazia (não dá para ratear).
 */
export function ratearFrete(itens: ItemParaRateio[], frete: number): { itens: ItemRateado[]; percentual: number; totalComFrete: number } | null {
  const base = itens.reduce((s, i) => s + i.valor, 0)
  if (!(frete > 0) || itens.length === 0 || !(base > 0) || itens.some((i) => !(i.valor > 0) || !(i.quantidade > 0))) return null
  const partes = itens.map((i) => round2((frete * i.valor) / base))
  const resto = round2(frete - partes.reduce((s, p) => s + p, 0))
  if (resto !== 0) {
    const maior = itens.reduce((m, i, k) => (i.valor > itens[m].valor ? k : m), 0)
    partes[maior] = round2(partes[maior] + resto)
  }
  return {
    percentual: (frete / base) * 100,
    totalComFrete: round2(base + frete),
    itens: itens.map((i, k) => {
      const precoNota = i.valor / i.quantidade
      return { ...i, frete: partes[k], precoNota, precoFinal: precoNota + partes[k] / i.quantidade }
    }),
  }
}
