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
  regra: 'barrar' | 'incluir' | null // C2: retrato da regra da lista na importação (null sem a migration)
  regra_motivo: string | null
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
export type OrigemResposta = 'vendedor' | 'ivan_digitou' | 'ivan_colou' | 'ivan_ia'
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

// ---------- Cadastros (Fase 2, Bloco C)
export interface ProdutoCadastro {
  produto_id: number; produto: string; nome_limpo: string; unidade: Unidade; bebida: boolean
  fornecedor_ultima: string | null; data_ultima_compra: string | null
  vendedor_id: number | null; via: 'catalogo' | 'ultima_compra' | null; motivo: string | null; vendedor_motivo_id: number | null
  catalogo_origem: string | null; escolhido_em: string | null; nome_para_vendedor: string | null; nota_vendedor: string | null
  embalagem: string | null; fator: number | null; fator_confirmado_em: string | null
  vende_por_litro: boolean; kg_por_litro: number | null; kg_por_litro_confirmado_em: string | null
  descricao_fornecedor: string | null; codigo_fornecedor: string | null; categoria: string
  regra: 'barrar' | 'incluir' | null; regra_motivo: string | null; a_confirmar: number; disputa: unknown | null
}
export interface FornecedorSemVendedor { nome_original: string; nome_normalizado: string; produtos: number; ultima_compra: string | null }
export interface AvisoConfirmar { codigo: string; [k: string]: unknown }
export interface RespostaConfirmar { ok: boolean; confirmar?: AvisoConfirmar[]; id?: number; codigo?: string; avisos?: AvisoConfirmar[] }
export interface CnpjAprendido { cnpj: string; vendedor_id: number; origem: 'nome' | 'ivan'; nome_na_nf: string }
export interface Grafia { nome_normalizado: string; nome_original: string; vendedor_id: number }
export interface Feriado { data: string; nome: string }
export interface FatorAConfirmar {
  produto_id: number; produto: string; unidade: Unidade; bebida: boolean; vendedor_id: number
  fator: number; embalagem_sugerida: string; origem: 'resposta' | 'nfe'; ref: string; vezes: number; ultima: string | null
  exemplos: { data_referencia: string; versao: number }[]
  padrao_embalagem: string | null; padrao_fator: number | null; padrao_confirmado_em: string | null; conflito: boolean
}
export interface HistoricoSemana {
  semana_id: number; data_referencia: string; vendedor_id: number; versoes: number; desfecho: string
  itens: number; respondidos: number; tem: number; pedido_itens: number; comparados: number
  total_pedido: number; total_ultimo: number; diferenca: number; pct: number | null
  enviada_em: string | null; primeira_resposta_em: string | null; canais: string[] | null
}
export interface HistoricoItemLinha {
  semana_id: number; data_referencia: string; vendedor_id: number; cotacao_id: number; versao: number; complementar: boolean
  status: string; resultado: string | null; produto_id: number; nome: string; unidade: Unidade; qtd: number
  estado: string; base: string | null; preco_digitado: number | null; preco_convertido: number | null
  marca_informada: string | null; ref_preco: number | null; no_pedido: boolean; qtd_pedido: number | null; preco_pedido: number | null
}

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

// ---------- Fase 2, Bloco E1: painel de economia (cot_painel_economia, cot_historico_item — DESIGN-fase-2.md E.4.3)
/** Métricas M de um grupo de linhas de pedido (E.4.2). */
export interface Metricas {
  pedidos: number; itens: number; comparados: number; sem_comparacao: number; acima: number
  total_pedido: number; total_ultimo: number; diferenca: number; pct: number | null
}
export interface SemanaPainel extends Metricas {
  semana_id: number; data_referencia: string; status: string; acumulado: number; acumulado_desde_inicio: number
}
export interface MesPainel extends Metricas { mes: string }
export interface VendedorPainel extends Metricas { vendedor_id: number; rotulo: string; semanas: number }
export interface CategoriaPainel extends Metricas { categoria: string }
export interface PontoItem { data: string; vendedor: string; preco: number | null; ultimo: number | null }
export interface ItemEconomia extends Metricas {
  produto_id: number; produto: string; unidade: Unidade; categoria: string; qtd: number
  preco_primeiro: number | null; preco_ultimo: number | null; variacao: number | null; pontos: PontoItem[]
}
export type MotivoSemComparacao = 'sem_conversao' | 'ultimo_preco_antigo' | 'sem_referencia'
export interface SemComparacao { produto_id: number; produto: string; linhas: number; motivo: MotivoSemComparacao }
export interface CompraSischef {
  produto_id: number; produto: string; unidade: Unidade; compras: number
  primeiro: { data: string; preco: number; fornecedor: string | null }
  ultimo: { data: string; preco: number; fornecedor: string | null }
  variacao: number
}
export interface PainelEconomia {
  de: string; ate: string; inicio: string | null
  total: Metricas; desde_inicio: { diferenca: number; semanas: number }
  semanas: SemanaPainel[]; meses: MesPainel[]; vendedores: VendedorPainel[]; categorias: CategoriaPainel[]
  itens: ItemEconomia[]; sem_comparacao: SemComparacao[]
  sischef: { altas: CompraSischef[]; quedas: CompraSischef[] }
}
export interface HistoricoCompra { data: string; preco: number; fornecedor: string | null; conferir: boolean }
export interface HistoricoCotacao {
  data_referencia: string; vendedor: string; versao: number; preco: number | null; delta: number | null
  marca: string | null; avisos: AvisoIvan[]; no_pedido: boolean
}
export interface HistoricoPedido {
  data_referencia: string; vendedor: string; qtd: number; preco: number | null; preco_combinado: number
  base: BaseCotacao; embalagens: number | null; fator: number | null; ultimo: number | null
  comparavel: boolean; marca: string | null
}
export interface HistoricoItem {
  produto_id: number; produto: string | null; unidade: Unidade | null; categoria: string; de: string; ate: string
  compras_sischef: HistoricoCompra[]; cotacoes: HistoricoCotacao[]; pedidos: HistoricoPedido[]
}

// ---------- Fase 2, Bloco B: leitura com IA (cot-ler-resposta / DESIGN-fase-2.md B.7.2, B.8)
export type CertezaIA = 'alta' | 'media' | 'baixa'
export type SinalIA = 'nome' | 'print' | 'audio' | 'extenso'
export interface ImagemIA { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
/** A "entrada" lida pela IA de um item (a resposta que o App vai gravar, sem numero/rev). */
export interface EntradaPropostaIA {
  estado: 'tem' | 'nao_tem'; preco: number | null; base: BaseCotacao | null
  emb_unidades: number | null; emb_gramas: number | null; emb_ml: number | null
  tenho_so: number | null; a_partir_de: number | null
  similar_desc: string | null; similar_preco: number | null; marca: string | null
}
export interface ItemPropostoIA {
  numero: number; fonte: 'texto' | 'imagem'; casou_por: 'numero' | 'nome'
  entrada: EntradaPropostaIA; trecho: string; certeza: CertezaIA; duvida: string | null; sinais: SinalIA[]
}
export interface CondicaoIA { valor: string | number; trecho: string; certeza: CertezaIA }
export interface GeraisIA {
  pagamento: CondicaoIA | null; validade: CondicaoIA | null; pedido_minimo: CondicaoIA | null
  frete: CondicaoIA | null; entrega: CondicaoIA | null; observacao: CondicaoIA | null
}
export interface UsoIA { hoje: number; limite_dia: number; mes: number; limite_mes: number; custo_mes_usd: number }
/** Retorno de cot-ler-resposta em caso de sucesso (B.7.2). */
export interface LeituraIA {
  ok: true; leitura_id: number; modelo: string; duracao_ms: number; custo_usd: number | null
  itens: ItemPropostoIA[]; gerais: GeraisIA
  fora_da_lista: { numero: number; trecho: string }[]
  nao_entendidos: { trecho: string; motivo: string }[]
  uso: UsoIA
}
/** cot_ia_status: o cartão "Ligar e desligar" (B.8, Chaves.tsx). */
export interface IaStatus { ligada: boolean; liberada: boolean; liberada_em: string | null; modelo: string; uso: UsoIA }
export interface ResumoIA { gravados: number; corrigidos: number; descartados: number; discordancias: number }

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

// ---------- Fase 2, Bloco D: recebimento e conferência da NF-e (DESIGN-fase-2.md, D.5 a D.10)
export type Resto = 'vem_depois' | 'nao_vem'
export type EstadoRecebimento = 'aguardando' | 'completo' | 'parcial' | 'com_falta'

/** Item de um pedido a receber (cot_pedidos_a_receber) — sem preço, para a tela Receber (D.7.1). */
export interface ItemAReceber {
  numero: number; nome: string; unidade: Unidade; qtd: number
  embalagens: number | null; fator: number | null; embalagem: string; marca: string | null
  chegou: number; avaria: number; resto: Resto | null
}
export interface EntregaFeita { recebido_local: string; quem: string }
export interface PedidoAReceber {
  cotacao_id: number; vendedor: string; confirmado_em: string; confirmado_local: string
  entrega_prevista: string | null; recebimento: EstadoRecebimento
  itens: ItemAReceber[]; entregas: EntregaFeita[]
}
/** Item enviado no registro do recebimento (cot_registrar_recebimento). */
export interface ItemRecebido { numero: number; chegou: number; avaria?: number; obs?: string | null; resto?: Resto | null }
export interface FaltaRegistrada { numero: number; nome: string; falta: number; resto: Resto | null }
export interface AvariaRegistrada { numero: number; nome: string; avaria: number; obs: string | null }
export interface Recebimento {
  recebimento_id: number; recebimento: EstadoRecebimento
  faltas: FaltaRegistrada[]; avarias: AvariaRegistrada[]; reenvio?: boolean
}

export type SituacaoNfe = 'na_fila' | 'saiu_da_fila' | 'lancada'
/** NF-e do espelho (cot_nfe), para o cartão do pedido e a lista de NF sem pedido (D.7.2). */
export interface NfeResumo {
  chave: string; numero: string; emissao: string; valor_nf: number; emitente: string
  cnpj_emitente: string; situacao: SituacaoNfe; saiu_da_fila_em: string | null
  lancada_em: string | null; nf_sischef: string | null
  vendedor_id: number | null; cotacao_id: number | null; vinculo: 'auto' | 'ivan' | null
}
/** Item da NF-e (cot_nfe.itens) para a aba Lançamento de nota SEFAZ (Fase 3). */
export interface ItemNotaSefaz {
  descricao: string
  qtd: number | null
  unidade_sischef: string | null
  produto_id: number | null
  /** Como o item foi associado no SisChef ('painel' = só pelo painel, sem produto de verdade). Vem do robô; pode faltar. */
  associacao?: string | null
  /** Nome do produto associado, quando o robô de leitura o trouxe (vem do cadastro do SisChef). */
  produto_nome?: string | null
  /** Número do item na NF (1, 2, 3…): é por ele que a decisão do app (cot_nfe.associacoes_app) liga ao item. Vem do robô de leitura. */
  n?: number | null
  /** Palpite do robô de leitura para um item sem produto (o produto do SisChef mais parecido); só sugestão, nunca vale sozinho. */
  sugestao?: { id: number | string; nome: string } | null
}
/** Produto que o Ivan escolheu e CONFIRMOU no app para um item sem produto no SisChef (cot_nfe.associacoes_app; migração 20261210000001).
 *  O nome e a unidade vêm do servidor (lista de insumos do app). Etapa 2 (migração 20261212000001): o robô aplica a decisão na tela do SisChef
 *  ao lançar, e para isso ela pode trazer a conversão de unidade. */
export interface AssociacaoApp {
  produto_id: number
  produto_nome: string
  /** Unidade do produto na lista de insumos do app; null = desconhecida (produto novo, fora da lista): aí quem decide a conversão é o robô,
   *  pelo cadastro vivo do SisChef. */
  unidade: string | null
  /** Quanto vale 1 unidade da NOTA em unidades do PRODUTO (lata de 395 g: NF em UN, produto em KG → 0.395). Só faz sentido quando as unidades
   *  diferem; null/ausente = sem conversão (decisão antiga ou unidades iguais). O banco exige > 0, ≤ 10000 e até 4 casas. */
  conversao?: number | null
  /** De onde veio a decisão: app/lista/sugestao = produto escolhido no app; "sischef" = SÓ a conversão de um item que já vem associado do SisChef. */
  origem?: string | null
  por?: string | null
  em?: string | null
}
/** Produto da lista de insumos do app (itens_semana; o código é o do SisChef): o que o Ivan pode escolher ao associar um item da nota. */
export interface ProdutoCatalogo {
  produto_id: number
  /** O nome que o app mostra: o CORRIGIDO pelo Ivan (cot_produto_busca), se houver; senão o da lista semanal (que é o do SisChef). */
  nome: string
  unidade: string | null
  /** Produto NOVO: o robô já o vê no SisChef (palpite do item), mas ele ainda não entrou na lista semanal de insumos do app; sem unidade conhecida. */
  novo?: boolean
  /** O nome como está no SisChef, quando o Ivan o corrigiu (só vem se for diferente de `nome`): a busca também o acha por ele. */
  nome_sischef?: string
  /** Palavras-chave que o Ivan escreveu para achar o produto (cot_produto_busca; migração 20261211000001): texto livre, do jeito que ele escreveu. */
  palavras?: string
  /** Produto que o Ivan mandou esconder (a casa o PRODUZ, com receita: não é de compra; migração 20261211000002). Fica na lista só para dar nome a decisões
   *  antigas; a busca, as sugestões e o palpite do robô o ignoram. */
  oculto?: boolean
  /** A descrição do produto na planilha do Ivan (produto_planilha.descricao = a do SisChef): cada palavra dela serve de palavra-chave para a sugestão do cupom. */
  descricao_sischef?: string
}
/** Uma duplicata (boleto) do XML da nota: cot_nfe.parcelas (migração 20261207000001). */
export interface ParcelaNota { numero: string | null; vencimento: string | null; valor: number }
/** Parcela que o Ivan digita quando o XML não traz as duplicatas: vencimento aaaa-mm-dd e valor em reais. */
export interface ParcelaDigitada { vencimento: string; valor: number }
/** Situação do último "Lançar" de uma nota (cot_nfe.lancamento_estado, migração 20261206000001). null = nunca disparada. */
export type EstadoLancamentoNfe = 'lancando' | 'revisar' | 'erro' | 'ensaio_ok'
/** Linha da aba Lançamento de nota SEFAZ (lê cot_nfe por RLS de admin). */
export interface NotaSefazLista {
  chave: string
  cnpj_emitente?: string | null
  emitente: string
  numero: string
  emissao: string
  valor_nf: number | null
  situacao: SituacaoNfe
  lancada_em: string | null
  nf_sischef: string | null
  itens: ItemNotaSefaz[]
  /** Colunas da migração 20261206000001 (podem faltar enquanto ela não estiver aplicada). */
  forma_pagamento?: string | null
  lancamento_estado?: EstadoLancamentoNfe | null
  lancamento_motivo?: string | null
  lancamento_estado_em?: string | null
  /** Boletos do XML. null/ausente = XML ainda não lido; [] = lido e sem duplicatas (à vista). Migração 20261207000001. */
  parcelas?: ParcelaNota[] | null
  /** Parcelas que o Ivan digitou (XML sem duplicatas): o que foi mandado ao robô. null = nada digitado. Migração 20261208000001. */
  parcelas_manuais?: ParcelaDigitada[] | null
  /** Descartada pelo Ivan (some de "Notas a lançar"; dá para desfazer). null/ausente = na lista normal. Migração 20261209000001. */
  descartada_em?: string | null
  descartada_motivo?: string | null
  /** Decisões do Ivan no app para itens sem produto, por número do item na NF ("1", "2"…). null/ausente = nenhuma. Migração 20261210000001. */
  associacoes_app?: Record<string, AssociacaoApp> | null
}
export type EstadoQtdNf = 'sem_nf' | 'igual' | 'a_mais' | 'a_menos'
export type EstadoPrecoNf = 'sem_nf' | 'igual' | 'acima' | 'abaixo' | 'confira' | 'nao_conferivel'
export type MarcaNf = 'ok' | 'confira' | 'sem_marca' | null
/** Uma linha da view cot_conferencia (D.5.2). */
export interface LinhaConferencia {
  cotacao_id: number; confirmado_em: string; entrega_prevista: string | null
  numero: number; produto_id: number; nome: string; unidade: Unidade
  qtd: number; base: BaseCotacao; embalagens: number | null; fator: number | null
  preco_combinado: number; preco_convertido: number | null; marca: string | null
  chegou: number | null; avaria: number | null; falta: number | null; resto: Resto | null; falta_definitiva: number
  recebimento: EstadoRecebimento
  nf_chaves: string[]; nf_qtd: number | null; qtd_nf: EstadoQtdNf; preco: EstadoPrecoNf
  valor_acima: number; combinado_unit: number | null; cobrado_unit: number | null
  imposto: number; marca_nf: MarcaNf; motivos: string[]
}
/** Linha de desempenho do vendedor (cot_desempenho_vendedores — D.10). */
export interface Desempenho {
  vendedor_id: number; rotulo: string; pedidos: number; com_prazo: number; sem_prazo: number
  no_prazo: number; atrasados: number; atraso_medio_dias: number; sem_registro: number
  nao_chegou: number; entregue_nf: number
  itens: number; itens_completos: number; itens_com_falta: number; itens_com_avaria: number
  itens_conferidos: number; itens_preco_igual: number; itens_acima: number; valor_acima: number; itens_abaixo: number
}
/** Última leitura das notas (cot_nfe_leituras — para "última leitura: hoje 12h"). */
export interface LeituraNotas { lida_em: string; notas: number; completa: boolean; origem: 'agendada' | 'app' }

// ---------- Sub-fase 3: cupom fiscal (captura + envio)
export type FormaCupom = 'dinheiro' | 'tesouraria' | 'pix' | 'sem_cartao'
/** O que o app manda ao servidor: a forma e, nas à vista/pix, a conta exata do Sischef (= MAPA_PIX do robô). */
export type PagamentoCupom =
  | { forma: 'dinheiro' | 'tesouraria' | 'pix'; conta: string }
  | { forma: 'sem_cartao' }
export type EstadoCupom = 'PENDENTE' | 'PROCESSANDO' | 'LANCADO' | 'REVISAR' | 'TESTE'
/** Resposta da Edge Function enviar-cupom. */
export interface ResumoEnvioCupom {
  cupom_id: string
  resumo: string
  estado?: EstadoCupom
  disparo_ok?: boolean
  duplicado?: boolean
}
/** Um item do cupom como está no `itens` (JSONB) — para o detalhe clicável de "Últimos envios". */
export interface ItemCupomRecente {
  descricao_cupom: string | null
  entrada_estoque: number | null
  unidade_cupom: string | null
  valor_unitario: number | null
  desconto_item: number | null
  sugestao_produto: { id: string } | null
  casado_por: string | null
  /** O melhor candidato do sistema quando o item não tem produto confirmado (só pré-preenche a confirmação do Ivan). */
  proposta?: { insumo_id: string; insumo_nome: string | null } | null
  /** Código de barras lido no cupom (quando o cupom o imprime): é por ele que o aprendizado vale para qualquer fornecedor. */
  codigo_barras?: string | null
  /** A quantidade como está impressa no cupom (na unidade do cupom), também nos itens ainda sem produto — cupons enviados a partir da v2 da
   *  Edge Function enviar-cupom; os anteriores não a têm (o peso só existe na foto). */
  quantidade_cupom?: number | null
  /** Só no item sem produto: o que ESTE fornecedor já mandou e o Ivan confirmou, parecido com a descrição nova (a descrição mudou): o app avisa "antes vinha como X". */
  conhecidos_do_fornecedor?: { insumo_id: string; insumo_nome: string | null; descricao_norm: string }[] | null
}
/** Linha de "Últimos envios" (SELECT por RLS de admin — e_admin() do Plano 1). */
export interface CupomRecente {
  id: string
  estado: EstadoCupom
  emitente_nome: string | null
  /** CNPJ do emitente, só dígitos (ou null quando a leitura não o achou): é a chave do aprendizado por descrição. */
  emitente_cnpj?: string | null
  valor_a_pagar: number | null
  pedido_sischef: string | null
  criado_em: string
  /** Última atualização da linha: o robô a grava ao terminar, então num cupom LANCADO é o momento em que ele foi lançado (mostrado em "Lançado em"). */
  atualizado_em?: string | null
  motivo: string | null
  teste: boolean
  itens: ItemCupomRecente[]
  /** Caminho da foto no bucket privado `cupons` (null nos cupons semeados à mão): é o que o botão "Ver a foto do cupom" abre. */
  foto_path?: string | null
}
/** Uma confirmação do Ivan para um item do cupom parado (corpo da Edge Function confirmar-cupom). */
export interface ConfirmacaoItemCupom {
  /** Posição do item em `itens` (0-based). */
  indice: number
  /** Cód. Interno do produto no SisChef. */
  insumo_id: string
  /** A quantidade que está impressa no cupom, na unidade DO CUPOM (kg, un…). */
  quantidade: number
  /** Quanto entra no estoque, na unidade DO PRODUTO, quando ela é outra (cupom em UN, produto em KG). Ausente = a mesma quantidade (fator 1). */
  entrada?: number
  /** Guardar o aprendizado: nos próximos cupons este item (mesmo código de barras, ou mesma descrição deste fornecedor) passa direto. */
  lembrar: boolean
}
/** Resposta da Edge Function confirmar-cupom: o resumo do reenvio mais quantas confirmações com "lembrar" ficaram (ou não) guardadas. */
export interface RespostaConfirmacaoCupom extends ResumoEnvioCupom {
  lembrados?: number
  /** Confirmações com "lembrar" que NÃO ficaram guardadas em cupom_aprendizado: no próximo cupom desse fornecedor o item para de novo. */
  nao_lembrados?: number
}
