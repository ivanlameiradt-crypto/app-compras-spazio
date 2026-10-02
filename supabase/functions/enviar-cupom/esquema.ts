// supabase/functions/enviar-cupom/esquema.ts
// JSON Schema da leitura do cupom (NFC-e) pela IA + validador à mão (sem zod, p/ o vitest rodar sem npm:). A API garante
// o formato pela saída estruturada; validarSaidaCupom confere de novo (interpretarIA trata "fora do formato" como
// ilegível). additionalProperties:false e TODAS as chaves obrigatórias, com null onde couber. Molde: cot-ler-resposta.
const itemCupom = {
  type: 'object', additionalProperties: false,
  required: ['descricao', 'quantidade', 'unidade', 'valor_unitario', 'desconto', 'codigo_barras'],
  properties: {
    descricao: { type: 'string' },
    quantidade: { type: 'number' },
    unidade: { type: 'string' },
    valor_unitario: { type: 'number' },
    desconto: { type: ['number', 'null'] },
    codigo_barras: { type: ['string', 'null'] },
  },
}

export const ESQUEMA_CUPOM = {
  type: 'object', additionalProperties: false,
  required: ['legivel', 'chave', 'emitente_cnpj', 'emitente_nome', 'valor_total', 'itens'],
  properties: {
    legivel: { type: 'boolean' },
    chave: { type: ['string', 'null'] },
    emitente_cnpj: { type: ['string', 'null'] },
    emitente_nome: { type: ['string', 'null'] },
    valor_total: { type: ['number', 'null'] },
    itens: { type: 'array', items: itemCupom },
  },
} as const

export interface ItemLidoIA {
  descricao: string; quantidade: number; unidade: string
  valor_unitario: number; desconto: number | null; codigo_barras: string | null
}
export interface LeituraCupomIA {
  legivel: boolean; chave: string | null; emitente_cnpj: string | null
  emitente_nome: string | null; valor_total: number | null; itens: ItemLidoIA[]
}

const ehNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const chavesExatas = (o: Record<string, unknown>, chaves: string[]) =>
  Object.keys(o).length === chaves.length && chaves.every((k) => k in o)

/** Confere a saída do modelo contra o esquema (chaves exatas, tipos). null quando válida, ou a razão do erro. */
export function validarSaidaCupom(v: unknown): string | null {
  if (v === null || typeof v !== 'object') return 'raiz não é objeto'
  const r = v as Record<string, unknown>
  if (!chavesExatas(r, ['legivel', 'chave', 'emitente_cnpj', 'emitente_nome', 'valor_total', 'itens'])) return 'chaves da raiz'
  if (typeof r.legivel !== 'boolean') return 'legivel'
  if (!(r.chave === null || typeof r.chave === 'string')) return 'chave'
  if (!(r.emitente_cnpj === null || typeof r.emitente_cnpj === 'string')) return 'emitente_cnpj'
  if (!(r.emitente_nome === null || typeof r.emitente_nome === 'string')) return 'emitente_nome'
  if (!(r.valor_total === null || ehNum(r.valor_total))) return 'valor_total'
  if (!Array.isArray(r.itens)) return 'itens'
  for (const it of r.itens as unknown[]) {
    if (it === null || typeof it !== 'object') return 'item não é objeto'
    const i = it as Record<string, unknown>
    if (!chavesExatas(i, ['descricao', 'quantidade', 'unidade', 'valor_unitario', 'desconto', 'codigo_barras'])) return 'chaves do item'
    if (typeof i.descricao !== 'string') return 'descricao'
    if (!ehNum(i.quantidade)) return 'quantidade'
    if (typeof i.unidade !== 'string') return 'unidade'
    if (!ehNum(i.valor_unitario)) return 'valor_unitario'
    if (!(i.desconto === null || ehNum(i.desconto))) return 'desconto'
    if (!(i.codigo_barras === null || typeof i.codigo_barras === 'string')) return 'codigo_barras'
  }
  return null
}
