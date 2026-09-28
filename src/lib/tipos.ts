export type Papel = 'admin' | 'comprador'
export interface Usuario { email: string; nome: string; papel: Papel; ativo: boolean }

export type StatusSemana = 'rascunho' | 'em_compra' | 'encerrada'
export interface Semana {
  id: number
  data_referencia: string // AAAA-MM-DD
  status: StatusSemana
  aprovada_por: string | null
  aprovada_em: string | null
}

export type Unidade = 'kg' | 'un'
/** Selo "conferir" calculado pelo robô: o item chega fora da lista (aba Conferir) com o motivo escrito. */
export type CodigoSelo = 'linha_alta' | 'bebida_negativa' | 'preco_fora' | 'fracao_un'
export interface Selo { codigo: CodigoSelo; texto: string }
export interface ItemSemana {
  id: number
  semana_id: number
  produto_id: number
  produto: string
  bebida: boolean
  unidade: Unidade
  estoque: number
  estoque_minimo: number
  qtd_sugerida: number
  qtd_aprovada: number
  preco_estimado: number | null
  custo_medio: number | null
  data_ultima_compra: string | null
  fornecedor_ultima: string | null
  situacao: string
  negativo: boolean
  incluido: boolean
  selos: Selo[]
}

export type Resultado = 'comprado' | 'parcial' | 'nao_achei'
export type StatusCompra = 'aberta' | 'fechada' | 'aprovada' | 'lancada'
export interface Compra {
  id: string
  semana_id: number
  loja: string
  comprador: string
  com_nota: boolean | null
  foto_cupom: string | null
  total_pago: number | null
  status: StatusCompra
  aberta_em: string
  fechada_em: string | null
}
export interface LinhaCompra {
  id: string
  compra_id: string
  item_semana_id: number
  qtd: number
  preco_unit: number | null
  resultado: Resultado
  marcado_por: string
  marcado_em: string
}
