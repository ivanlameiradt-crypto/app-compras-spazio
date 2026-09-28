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

// ---------- Fase 1B: cotação com vendedores (contrato-1b.md)
export type StatusCotacao = 'rascunho' | 'pronta' | 'enviada' | 'respondida' | 'fechada' | 'substituida' | 'cancelada' | 'liberada'
export type ResultadoCotacao = 'pedido' | 'dispensado'
export type EstadoItemCotacao = 'sem_resposta' | 'tem' | 'nao_tem'
export type BaseCotacao = 'un' | 'kg' | 'litro' | 'embalagem'
export type OrigemResposta = 'vendedor' | 'ivan_digitou' | 'ivan_colou'
export type RotuloItem = 'un' | 'kg' | 'saco'
export type TipoEmbalagem = 'fardo' | 'caixa' | 'pacote' | 'saco'
export type SituacaoReferencia = 'ok' | 'antiga' | 'sem_referencia'
export type AvisoVendedor = 'centavos' | 'valor_alto' | 'fator_diferente'
export type AvisoIvan = 'unidade_suspeita' | 'acima_500_sem_ref' | 'fator_nao_confirmado' | 'litro_sem_fator' | 'parcial' | 'similar' | 'a_partir_de'
export type MotivoSemVendedor = 'nunca_comprado' | 'fornecedor_sem_vendedor' | 'vendedor_inativo'
export type EstadoMarca = 'pedido' | 'em_cotacao' | 'aguardando_cotacao'
/** 3.13: 'codigo_invalido' também é estado — substituída cuja versão viva ficou sem código (D56). */
export type EstadoEfetivo = 'aberta' | 'encerrada' | 'pedido_confirmado' | 'encerrada_pelo_ivan' | 'substituida' | 'cancelada' | 'codigo_invalido'
export type ErroEnvio = 'codigo_invalido' | 'devagar' | 'limite' | 'formato' | 'envio_de_outra_cotacao' | 'estado'
export type ErroItem = 'numero_inexistente' | 'sem_preco' | 'sem_embalagem' | 'valor_invalido' | 'base_incompativel' | 'texto_invalido'

export interface Vendedor { id: number; codigo: string; nome: string; empresa: string; whatsapp: string; ativo: boolean }

export interface Gerais {
  pagamento: string | null; validade: string | null; pedido_minimo: number | null
  frete: number | null; entrega: string | null; observacao: string | null
}

export interface Cotacao extends Gerais {
  id: number; semana_id: number; vendedor_id: number; versao: number; complementar: boolean
  status: StatusCotacao; resultado: ResultadoCotacao | null; substituida_por: number | null
  congelada_em: string | null; enviada_em: string | null; fechada_em: string | null
  prazo: string | null; fechamento: string | null
  primeiro_acesso: string | null; ultimo_acesso: string | null; acessos: number
  envios_aceitos: number; ultimo_envio_em: string | null
  gerais_rev: number; gerais_origem: OrigemResposta | null; respostas_rev: number
  cobranca_em: string | null; consolidado_em: string | null
}

/** A resposta de um item como está gravada (mesmo formato na página, no App e no retorno dos envios). */
export interface RespostaItem {
  estado: EstadoItemCotacao
  preco_digitado: number | null; base: BaseCotacao | null
  emb_unidades: number | null; emb_gramas: number | null; emb_ml: number | null
  preco_convertido: number | null
  tenho_so: number | null; similar_desc: string | null; similar_preco: number | null; a_partir_de: number | null
  marca_informada: string | null
  confirmado_pelo_vendedor: boolean; avisos_vendedor: AvisoVendedor[]
}

/** Linha de cot_itens_admin. */
export interface ItemCotacao extends RespostaItem {
  id: number; cotacao_id: number; item_semana_id: number; produto_id: number
  numero: number | null; incluido: boolean; nome: string; unidade: Unidade; rotulo: RotuloItem; vende_por_litro: boolean
  qtd: number; qtd_sugerida: number
  embalagem: TipoEmbalagem | null; fator: number | null; fator_confirmado: boolean; kg_por_litro: number | null
  descricao_fornecedor: string | null; codigo_fornecedor: string | null; nota_vendedor: string | null
  ref_preco: number | null; ref_data: string | null; ref_situacao: SituacaoReferencia | null
  fator_informado: number | null; avisos_ivan: AvisoIvan[]
  origem: OrigemResposta | null; copiada_da_versao: number | null; respondido_em: string | null; rev: number
  delta: number | null
}

export interface ResumoCotacao {
  cotacao_id: number; itens: number; respondidos: number; tem: number; nao_tem: number; parciais: number
  com_referencia: number; total_cotado: number; total_ultimo: number; gerais_respondidas: boolean
}

export interface CartaoPreparo { vendedor_id: number; itens: number; estimado: number; cotacoes: number[] }
export interface ItemPreparo {
  item_semana_id: number; produto_id: number; vendedor_id: number | null; via: 'catalogo' | 'ultima_compra' | null
  preso_com: number | null; ultima_com_outro: { fornecedor: string; vendedor_id: number; data: string } | null
}
export interface ItemSemVendedor {
  item_semana_id: number; produto_id: number; produto: string; nome: string; unidade: Unidade; qtd: number
  motivo: MotivoSemVendedor; fornecedor: string | null; vendedor_id: number | null
}
export interface ItemForaDaCotacao {
  vendedor_id: number; cotacao_id: number; item_semana_id: number; produto_id: number; nome: string; unidade: Unidade; qtd: number
}
export interface ItemPreso {
  item_semana_id: number; produto_id: number; nome: string; vendedor_id: number; cotacao_id: number; vendedor_novo_id: number | null
}
/** Item seguro por cotação de semana anterior (3.1 "atravessando"). */
export interface ItemAtravessado {
  item_semana_id: number; produto_id: number; nome: string; vendedor_id: number; cotacao_id: number; semana_id: number
  estado: 'em_cotacao' | 'pedido'
}
export interface Preparo {
  semana_id: number; data_referencia: string; aprovada_em: string | null; aguardando_ate: string | null; agora: string
  cartoes: CartaoPreparo[]; itens: ItemPreparo[]; sem_vendedor: ItemSemVendedor[]
  fora_da_enviada: ItemForaDaCotacao[]; depois_do_resultado: ItemForaDaCotacao[]; presos: ItemPreso[]
  atravessados: ItemAtravessado[]
}

export interface DadosEnvio {
  cotacao_id: number; semana_id: number; data_referencia: string
  versao: number; complementar: boolean; substitui_versao: number | null; status: StatusCotacao
  codigo: string | null; prazo: string; fechamento: string; prazo_local: string; fechamento_local: string
  vendedor: { id: number; codigo: string; nome: string; empresa: string; rotulo: string; whatsapp: string }
  itens: {
    numero: number; produto_id: number; nome: string; qtd: number; unidade: Unidade; rotulo: RotuloItem
    vende_por_litro: boolean; embalagem: TipoEmbalagem | null; fator: number | null; nota: string | null
  }[]
}

/** p_itens de cot_responder_admin / cotacao_responder. Chave ausente = null. */
export interface EntradaItem {
  numero: number; rev_lida: number; estado: EstadoItemCotacao
  preco?: number | null; base?: BaseCotacao | null
  emb_unidades?: number | null; emb_gramas?: number | null; emb_ml?: number | null
  tenho_so?: number | null; similar_desc?: string | null; similar_preco?: number | null; a_partir_de?: number | null
  marca?: string | null
  confirmado?: boolean
}
export interface EntradaGerais extends Gerais { rev_lida: number }

export interface ResultadoItemEnvio {
  numero: number; resultado: 'gravado' | 'conflito' | 'erro'; rev: number | null
  valor_atual: RespostaItem | null; avisos_vendedor: AvisoVendedor[]; erro: ErroItem | null
}
export interface ResultadoEnvio {
  ok: true; reenvio: boolean; recebido_em: string; itens: ResultadoItemEnvio[]
  gerais: { resultado: 'gravado' | 'conflito' | 'erro'; rev: number; valor_atual: Gerais; erro: 'valor_invalido' | 'texto_invalido' | null } | null
}

export interface ItemPedidoEntrada {
  numero: number; qtd: number; base: BaseCotacao; embalagens: number | null; fator: number | null; preco_combinado: number
}
export interface Pedido {
  cotacao_id: number; confirmado_por: string; confirmado_em: string
  itens: (ItemPedidoEntrada & { produto_id: number; preco_convertido: number | null; marca: string | null })[]
}
/** Pedido de outra semana, para a marca informativa da Revisão (8.3). */
export interface PedidoRecente extends Pedido { semana_id: number; vendedor_id: number }

/** Linha de cot_economia (2.2). */
export interface EconomiaSemana {
  semana_id: number; data_referencia: string; pedidos: number; itens_pedido: number
  itens_com_referencia: number; itens_sem_comparacao: number
  total_pedido: number; total_ultimo: number; diferenca: number
}

/**
 * Etiqueta do item (cot_marcas_semana, contrato 4.15). `qtd` (D63) = quanto ela cobre, na unidade do SisChef: a do
 * pedido ou o "só tenho" do vendedor; null no "aguardando" (o item inteiro espera). Menor que a aprovada → o resto
 * é comprado na loja.
 */
export interface MarcaItem {
  item_semana_id: number; estado: EstadoMarca; vendedor_id: number; vendedor: string; ate: string | null; qtd: number | null
}

/** Retorno de cotacao_abrir (prévia do Ivan, checagem de saúde). */
export interface ItemAbertura {
  numero: number; nome: string; nota: string | null; qtd: number; unidade: Unidade; rotulo: RotuloItem; vende_por_litro: boolean
  embalagem: TipoEmbalagem | null; fator: number | null; kg_por_litro: number | null
  descricao_fornecedor: string | null; codigo_fornecedor: string | null; resposta: RespostaItem; rev: number
}
export interface AberturaOk {
  ok: true; estado: EstadoEfetivo; texto: string | null; loja: string; vendedor_nome: string
  versao: number; complementar: boolean; substitui_versao: number | null
  prazo: string; fechamento: string; agora: string; prazo_local: string; fechamento_local: string; agora_local: string
  segundos_para_fechar: number; validade_opcoes: { data: string; rotulo: string }[]
  itens: ItemAbertura[]; gerais: Gerais | null; gerais_rev: number; nova: { versao: number; codigo: string } | null
}
export interface FalhaVendedor {
  ok: false; erro: ErroEnvio; texto: string; espera_s?: number
  estado?: EstadoEfetivo; nova?: { versao: number; codigo: string } | null
}
export type Abertura = AberturaOk | FalhaVendedor
