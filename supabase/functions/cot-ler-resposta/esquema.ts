// JSON Schema da saída do modelo (B.7.4) e o validador escrito à mão (sem zod, para o vitest rodar sem `npm:`).
// A API garante o formato pela saída estruturada; o validador confere de novo, porque interpretar trata "JSON fora do
// formato" (campo a mais, enum errado, tipo errado) como erro 'invalida'. `additionalProperties: false` e TODAS as
// chaves obrigatórias em todo objeto, com null onde couber.

const item = {
  type: 'object',
  additionalProperties: false,
  required: ['numero', 'fonte', 'casou_por', 'estado', 'preco', 'base', 'emb', 'tenho_so', 'a_partir_de',
    'similar_desc', 'similar_preco', 'marca', 'trecho', 'certeza', 'duvida'],
  properties: {
    numero: { type: 'integer' },
    fonte: { enum: ['imagem', null] },
    casou_por: { enum: ['nome', null] },
    estado: { enum: ['tem', 'nao_tem'] },
    preco: { type: ['number', 'null'] },
    base: { enum: ['un', 'kg', 'litro', 'embalagem', null] },
    emb: { type: ['number', 'null'] },
    tenho_so: { type: ['number', 'null'] },
    a_partir_de: { type: ['number', 'null'] },
    similar_desc: { type: ['string', 'null'] },
    similar_preco: { type: ['number', 'null'] },
    marca: { type: ['string', 'null'] },
    trecho: { type: 'string' },
    certeza: { enum: ['alta', 'media', 'baixa'] },
    duvida: { type: ['string', 'null'] },
  },
}

const condicaoTexto = { type: ['object', 'null'], additionalProperties: false, required: ['valor', 'trecho', 'certeza'],
  properties: { valor: { type: 'string' }, trecho: { type: 'string' }, certeza: { enum: ['alta', 'media', 'baixa'] } } }
const condicaoNumero = { type: ['object', 'null'], additionalProperties: false, required: ['valor', 'trecho', 'certeza'],
  properties: { valor: { type: 'number' }, trecho: { type: 'string' }, certeza: { enum: ['alta', 'media', 'baixa'] } } }

export const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['itens', 'gerais', 'fora_da_lista', 'nao_entendidos'],
  properties: {
    itens: { type: 'array', items: item },
    gerais: {
      type: 'object',
      additionalProperties: false,
      required: ['pagamento', 'validade', 'pedido_minimo', 'frete', 'entrega', 'observacao'],
      properties: {
        pagamento: condicaoTexto,
        validade: { ...condicaoTexto, properties: { ...condicaoTexto.properties, valor: { type: 'string', format: 'date' } } },
        pedido_minimo: condicaoNumero,
        frete: condicaoNumero,
        entrega: condicaoTexto,
        observacao: condicaoTexto,
      },
    },
    fora_da_lista: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['numero', 'trecho'],
        properties: { numero: { type: 'integer' }, trecho: { type: 'string' } } },
    },
    nao_entendidos: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['trecho', 'motivo'],
        properties: { trecho: { type: 'string' }, motivo: { type: 'string' } } },
    },
  },
} as const

// ---------- Tipos da saída do modelo (o que o validador garante)
export type Certeza = 'alta' | 'media' | 'baixa'
export type BaseModelo = 'un' | 'kg' | 'litro' | 'embalagem' | null
export interface ItemModelo {
  numero: number; fonte: 'imagem' | null; casou_por: 'nome' | null; estado: 'tem' | 'nao_tem'
  preco: number | null; base: BaseModelo; emb: number | null; tenho_so: number | null; a_partir_de: number | null
  similar_desc: string | null; similar_preco: number | null; marca: string | null
  trecho: string; certeza: Certeza; duvida: string | null
}
export interface CondicaoModelo { valor: string | number; trecho: string; certeza: Certeza }
export interface GeraisModelo {
  pagamento: CondicaoModelo | null; validade: CondicaoModelo | null; pedido_minimo: CondicaoModelo | null
  frete: CondicaoModelo | null; entrega: CondicaoModelo | null; observacao: CondicaoModelo | null
}
export interface RespostaModelo {
  itens: ItemModelo[]; gerais: GeraisModelo
  fora_da_lista: { numero: number; trecho: string }[]
  nao_entendidos: { trecho: string; motivo: string }[]
}

const ehInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v)
const ehNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const chavesExatas = (o: Record<string, unknown>, chaves: string[]) => {
  const tem = Object.keys(o)
  return tem.length === chaves.length && chaves.every((k) => k in o)
}

function validarCondicao(v: unknown, numerica: boolean): boolean {
  if (v === null) return true
  if (typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  if (!chavesExatas(c, ['valor', 'trecho', 'certeza'])) return false
  if (typeof c.trecho !== 'string') return false
  if (!['alta', 'media', 'baixa'].includes(c.certeza as string)) return false
  return numerica ? ehNum(c.valor) : typeof c.valor === 'string'
}

/**
 * Confere a saída do modelo contra o esquema (chaves exatas, enums, tipos). Não aplica limites numéricos nem de
 * tamanho (esses saem de B.5.2 e do validar()/cot_validar_item). Retorna null quando válida, ou a razão do erro.
 */
export function validarSaida(v: unknown): string | null {
  if (v === null || typeof v !== 'object') return 'raiz não é objeto'
  const r = v as Record<string, unknown>
  if (!chavesExatas(r, ['itens', 'gerais', 'fora_da_lista', 'nao_entendidos'])) return 'chaves da raiz'
  if (!Array.isArray(r.itens)) return 'itens não é lista'
  for (const it of r.itens as unknown[]) {
    if (it === null || typeof it !== 'object') return 'item não é objeto'
    const i = it as Record<string, unknown>
    if (!chavesExatas(i, ['numero', 'fonte', 'casou_por', 'estado', 'preco', 'base', 'emb', 'tenho_so', 'a_partir_de',
      'similar_desc', 'similar_preco', 'marca', 'trecho', 'certeza', 'duvida'])) return 'chaves do item'
    if (!ehInt(i.numero)) return 'numero'
    if (!(i.fonte === 'imagem' || i.fonte === null)) return 'fonte'
    if (!(i.casou_por === 'nome' || i.casou_por === null)) return 'casou_por'
    if (!(i.estado === 'tem' || i.estado === 'nao_tem')) return 'estado'
    if (!(i.preco === null || ehNum(i.preco))) return 'preco'
    if (!(i.base === null || ['un', 'kg', 'litro', 'embalagem'].includes(i.base as string))) return 'base'
    if (!(i.emb === null || ehNum(i.emb))) return 'emb'
    if (!(i.tenho_so === null || ehNum(i.tenho_so))) return 'tenho_so'
    if (!(i.a_partir_de === null || ehNum(i.a_partir_de))) return 'a_partir_de'
    if (!(i.similar_desc === null || typeof i.similar_desc === 'string')) return 'similar_desc'
    if (!(i.similar_preco === null || ehNum(i.similar_preco))) return 'similar_preco'
    if (!(i.marca === null || typeof i.marca === 'string')) return 'marca'
    if (typeof i.trecho !== 'string') return 'trecho'
    if (!['alta', 'media', 'baixa'].includes(i.certeza as string)) return 'certeza'
    if (!(i.duvida === null || typeof i.duvida === 'string')) return 'duvida'
  }
  if (r.gerais === null || typeof r.gerais !== 'object') return 'gerais'
  const g = r.gerais as Record<string, unknown>
  if (!chavesExatas(g, ['pagamento', 'validade', 'pedido_minimo', 'frete', 'entrega', 'observacao'])) return 'chaves de gerais'
  if (!validarCondicao(g.pagamento, false)) return 'pagamento'
  if (!validarCondicao(g.validade, false)) return 'validade'
  if (!validarCondicao(g.pedido_minimo, true)) return 'pedido_minimo'
  if (!validarCondicao(g.frete, true)) return 'frete'
  if (!validarCondicao(g.entrega, false)) return 'entrega'
  if (!validarCondicao(g.observacao, false)) return 'observacao'
  if (!Array.isArray(r.fora_da_lista)) return 'fora_da_lista'
  for (const f of r.fora_da_lista as unknown[]) {
    if (f === null || typeof f !== 'object') return 'fora_da_lista item'
    const o = f as Record<string, unknown>
    if (!chavesExatas(o, ['numero', 'trecho']) || !ehInt(o.numero) || typeof o.trecho !== 'string') return 'fora_da_lista item'
  }
  if (!Array.isArray(r.nao_entendidos)) return 'nao_entendidos'
  for (const n of r.nao_entendidos as unknown[]) {
    if (n === null || typeof n !== 'object') return 'nao_entendidos item'
    const o = n as Record<string, unknown>
    if (!chavesExatas(o, ['trecho', 'motivo']) || typeof o.trecho !== 'string' || typeof o.motivo !== 'string') return 'nao_entendidos item'
  }
  return null
}
