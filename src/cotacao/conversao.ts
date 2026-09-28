// Regra 3.10 do contrato (spec 7.3.8) em TS: validação, conversão e avisos de uma resposta de item, para a conta ao
// vivo do "Digitar preços" e a conferência do "Colar resposta" antes de gravar. O banco (cot_aplicar_resposta) continua
// sendo quem decide; esta cópia só existe para o Ivan ver o resultado antes de tocar em Gravar — mesmos números.
import type { AvisoIvan, AvisoVendedor, EntradaItem, ErroItem, ItemCotacao } from '../lib/tipos'

/** O que a conta precisa saber do item (o retrato gravado no congelamento). */
export type ItemParaConta = Pick<ItemCotacao, 'unidade' | 'qtd' | 'fator' | 'fator_confirmado' | 'kg_por_litro' | 'ref_preco' | 'ref_situacao'>

export interface Conta {
  /** primeiro erro encontrado (nada seria gravado); null = o banco grava */
  erro: ErroItem | null
  preco_convertido: number | null
  fator_informado: number | null
  avisos_vendedor: AvisoVendedor[]
  avisos_ivan: AvisoIvan[]
}

const LIMITE_DINHEIRO = 1_000_000
const CONTROLE = /[\x01-\x1F\x7F\u0080-\u009F]/

/**
 * round(x, casas) do Postgres (meio para longe do zero) sem o ruído do ponto flutuante: 5,25 × 10⁴ vira 52500 e não
 * 52499,99…; 12,40 ÷ 0,4 = 31,000000000000004 vira 31.
 */
export function arred(x: number, casas: number): number {
  const f = 10 ** casas
  const v = Number((Math.abs(x) * f).toPrecision(15))
  return (Math.sign(x) * Math.round(v)) / f
}
/** Quantas embalagens inteiras cobrem a quantidade (104 un em fardos de 12 → 9); o ruído do ponto flutuante não soma uma. */
export const embalagensPara = (qtd: number, fator: number) => Math.ceil(Number(qtd) / Number(fator) - 1e-9)
const duasCasas = (v: number) => arred(v, 2) === v
const ehNum = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v))
const ehTexto = (v: unknown) => v == null || typeof v === 'string'
const vazio = (v: unknown) => v == null
const dinheiroOk = (v: number | null | undefined) => v == null || (v > 0 && v <= LIMITE_DINHEIRO && duasCasas(v))
const quantidadeOk = (v: number | null | undefined) => v == null || (v > 0 && v <= LIMITE_DINHEIRO)
const faixa = (v: number | null | undefined, min: number, max: number, inteiro = false) =>
  v == null || (v >= min && v <= max && (!inteiro || Number.isInteger(v)))

const semConta = (erro: ErroItem | null): Conta => ({ erro, preco_convertido: null, fator_informado: null, avisos_vendedor: [], avisos_ivan: [] })

/** Texto vindo de fora (contrato 1.2): trim; vazio depois do trim = null. */
export const textoLimpo = (t: string | null | undefined): string | null => (t == null || t.trim() === '' ? null : t.trim())

/** Valida a resposta de um item na ordem do contrato (3.10, passo 3). null = válida. */
export function validar(item: ItemParaConta, e: EntradaItem): ErroItem | null {
  const numericos = [e.preco, e.emb_unidades, e.emb_gramas, e.emb_ml, e.tenho_so, e.similar_preco, e.a_partir_de]
  if (!numericos.every(ehNum)) return 'valor_invalido'
  if (!ehTexto(e.similar_desc) || !ehTexto(e.marca)) return 'texto_invalido'
  // textos vindos de fora (contrato 1.2): trim; vazio depois do trim = ausente, como no banco
  const marca = textoLimpo(e.marca)
  const similar = textoLimpo(e.similar_desc)

  if (e.estado === 'sem_resposta') {
    const outros = [...numericos, e.base, similar, marca]
    return outros.every(vazio) ? null : 'valor_invalido'
  }
  if (e.estado === 'nao_tem') {
    if (![e.preco, e.base, e.emb_unidades, e.emb_gramas, e.emb_ml, e.tenho_so, e.a_partir_de, marca].every(vazio)) return 'valor_invalido'
  } else if (e.estado === 'tem') {
    if (e.preco == null) return 'sem_preco'
    if (e.base == null) return 'base_incompativel'
    const un = item.unidade === 'un'
    if (un && (e.base === 'kg' || e.base === 'litro')) return 'base_incompativel'
    if (!un && e.base === 'un') return 'base_incompativel'
    const temEmb = e.emb_unidades != null || e.emb_gramas != null || e.emb_ml != null
    if (temEmb && e.base !== 'embalagem') return 'base_incompativel'
    if (un && (e.emb_gramas != null || e.emb_ml != null)) return 'base_incompativel'
    if (!un && e.emb_unidades != null) return 'base_incompativel'
    if (e.emb_gramas != null && e.emb_ml != null) return 'base_incompativel'
    if (e.base === 'embalagem' && (un ? e.emb_unidades == null : e.emb_gramas == null && e.emb_ml == null)) return 'sem_embalagem'
  } else {
    return 'valor_invalido'
  }

  if (!dinheiroOk(e.preco) || !dinheiroOk(e.similar_preco)) return 'valor_invalido'
  if (!faixa(e.emb_unidades, 1, 10_000, true) || !faixa(e.emb_gramas, 1, 100_000) || !faixa(e.emb_ml, 1, 100_000)) return 'valor_invalido'
  if (!quantidadeOk(e.tenho_so) || !quantidadeOk(e.a_partir_de)) return 'valor_invalido'
  if (similar != null && ([...similar].length > 200 || CONTROLE.test(similar))) return 'texto_invalido'
  // marca informada (ajuste Foozi 3, D50): só com "tem", até 60 caracteres, sem caractere de controle
  if (marca != null && ([...marca].length > 60 || CONTROLE.test(marca))) return 'texto_invalido'
  return null
}

/** Validação + conversão para a unidade do SisChef + avisos ao vendedor e ao Ivan (3.10, passos 3 a 6). */
export function converter(item: ItemParaConta, e: EntradaItem): Conta {
  const erro = validar(item, e)
  if (erro) return semConta(erro)
  const qtd = Number(item.qtd)
  const avisosIvan: AvisoIvan[] = []
  const similar = textoLimpo(e.similar_desc)
  if (e.estado !== 'tem') {
    if (similar != null) avisosIvan.push('similar')
    return { ...semConta(null), avisos_ivan: avisosIvan }
  }

  const preco = e.preco as number
  const kgPorLitro = item.kg_por_litro
  let convertido: number | null = null
  let fatorInformado: number | null = null
  let porLitro: number | null = null // preço por litro quando não há conversão (para o aviso de valor alto)
  if (e.base === 'un' || e.base === 'kg') {
    convertido = arred(preco, 4)
  } else if (e.base === 'litro') {
    porLitro = preco
    convertido = kgPorLitro ? arred(preco / kgPorLitro, 4) : null
  } else if (item.unidade === 'un') {
    fatorInformado = e.emb_unidades as number
    convertido = arred(preco / fatorInformado, 4)
  } else if (e.emb_gramas != null) {
    fatorInformado = e.emb_gramas / 1000
    convertido = arred(preco / (e.emb_gramas / 1000), 4)
  } else {
    const ml = e.emb_ml as number
    porLitro = arred(preco / (ml / 1000), 4)
    convertido = kgPorLitro ? arred(preco / (ml / 1000) / kgPorLitro, 4) : null
  }

  const avisosVendedor: AvisoVendedor[] = []
  if (preco < 1 && (e.base === 'embalagem' || item.unidade === 'kg')) avisosVendedor.push('centavos')
  const valor = convertido ?? porLitro
  if (valor != null && valor > 300) avisosVendedor.push('valor_alto')
  if (e.base === 'embalagem' && item.fator_confirmado && fatorInformado != null && fatorInformado !== Number(item.fator)) {
    avisosVendedor.push('fator_diferente')
  }

  const ref = item.ref_preco == null ? null : Number(item.ref_preco)
  if ((item.ref_situacao === 'ok' || item.ref_situacao === 'antiga') && convertido != null && ref != null && ref > 0 &&
    (convertido / ref < 0.6 || convertido / ref > 1.6)) avisosIvan.push('unidade_suspeita')
  if (item.ref_situacao === 'sem_referencia' && convertido != null && convertido > 500) avisosIvan.push('acima_500_sem_ref')
  if (e.base === 'embalagem' && fatorInformado != null && !(item.fator_confirmado && fatorInformado === Number(item.fator))) {
    avisosIvan.push('fator_nao_confirmado')
  }
  if ((e.base === 'litro' || e.emb_ml != null) && kgPorLitro == null) avisosIvan.push('litro_sem_fator')
  if (e.tenho_so != null && e.tenho_so < qtd) avisosIvan.push('parcial')
  if (similar != null) avisosIvan.push('similar')
  if (e.a_partir_de != null && e.a_partir_de > qtd) avisosIvan.push('a_partir_de')

  return {
    erro: null,
    preco_convertido: convertido,
    fator_informado: fatorInformado,
    avisos_vendedor: e.confirmado ? [] : avisosVendedor,
    avisos_ivan: avisosIvan,
  }
}
