import type {
  Cotacao, DadosEnvio, ItemCotacao, ItemSemana, LinhaCompra, Preparo, ResumoCotacao, Vendedor,
} from '../src/lib/tipos'

export function item(p: Partial<ItemSemana>): ItemSemana {
  return {
    id: 1, semana_id: 1, produto_id: 1, produto: 'X', bebida: true, unidade: 'un', estoque: 0, estoque_minimo: 0,
    qtd_sugerida: 0, qtd_aprovada: 0, preco_estimado: null, custo_medio: null, data_ultima_compra: null, fornecedor_ultima: null,
    situacao: 'Repor', negativo: false, incluido: true, selos: [], regra: null, regra_motivo: null, ...p,
  }
}
export function linha(p: Partial<LinhaCompra>): LinhaCompra {
  return {
    id: 'l', compra_id: 'c', item_semana_id: 1, qtd: 0, preco_unit: null, resultado: 'comprado',
    marcado_por: 'joao@spazio.com', marcado_em: '2026-09-23T10:00:00Z', ...p,
  }
}

// ---------- Fase 1B: cotação. Dados INVENTADOS (repositório público): vendedores Fulano/Beltrano, "FORNECEDOR A",
// telefones no formato de teste 55 + DDD + 90000 + 4 dígitos (D21), preços redondos.
export function vendedor(p: Partial<Vendedor> = {}): Vendedor {
  return { id: 1, codigo: 'fulano', nome: 'Fulano', empresa: 'FORNECEDOR A (Centro)', whatsapp: '5511900000001', ativo: true, ...p }
}
export function cotacao(p: Partial<Cotacao> = {}): Cotacao {
  return {
    id: 7, semana_id: 3, vendedor_id: 1, versao: 1, complementar: false, status: 'rascunho', resultado: null, substituida_por: null,
    congelada_em: null, enviada_em: null, fechada_em: null, prazo: null, fechamento: null,
    primeiro_acesso: null, ultimo_acesso: null, acessos: 0, envios_aceitos: 0, ultimo_envio_em: null,
    pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null,
    gerais_rev: 0, gerais_origem: null, respostas_rev: 0, cobranca_em: null, consolidado_em: null, ...p,
  }
}
/** Cotação preparada seg 19/10 15h02 (BRT): prazo ter 20/10 12h, fechamento 17h. */
export const PREPARADA = {
  congelada_em: '2026-10-19T18:02:00Z', prazo: '2026-10-20T15:00:00Z', fechamento: '2026-10-20T20:00:00Z',
}
export function itemCotacao(p: Partial<ItemCotacao> = {}): ItemCotacao {
  return {
    id: 100, cotacao_id: 7, item_semana_id: 1000, produto_id: 10, numero: 1, incluido: true, nome: 'ÁGUA MINERAL 500ML',
    unidade: 'un', rotulo: 'un', vende_por_litro: false, qtd: 60, qtd_sugerida: 60,
    embalagem: null, fator: null, fator_confirmado: false, kg_por_litro: null,
    descricao_fornecedor: null, codigo_fornecedor: null, nota_vendedor: null, ref_preco: 2, ref_data: '2026-10-02', ref_situacao: 'ok',
    estado: 'sem_resposta', preco_digitado: null, base: null, emb_unidades: null, emb_gramas: null, emb_ml: null,
    fator_informado: null, preco_convertido: null, tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null,
    marca_informada: null, confirmado_pelo_vendedor: false, avisos_vendedor: [], avisos_ivan: [], origem: null, copiada_da_versao: null,
    respondido_em: null, rev: 0, delta: null, ...p,
  }
}
export function resumo(p: Partial<ResumoCotacao> = {}): ResumoCotacao {
  return {
    cotacao_id: 7, itens: 1, respondidos: 0, tem: 0, nao_tem: 0, parciais: 0, com_referencia: 0, total_cotado: 0, total_ultimo: 0,
    gerais_respondidas: false, ...p,
  }
}
export function preparo(p: Partial<Preparo> = {}): Preparo {
  return {
    semana_id: 3, data_referencia: '2026-10-19', aprovada_em: '2026-10-19T11:02:00Z', aguardando_ate: '2026-10-20T15:00:00Z',
    agora: '2026-10-19T18:10:00Z', cartoes: [], itens: [], sem_vendedor: [], fora_da_enviada: [], depois_do_resultado: [], presos: [],
    atravessados: [], ...p,
  }
}
export function dadosEnvio(p: Partial<DadosEnvio> = {}): DadosEnvio {
  return {
    cotacao_id: 7, semana_id: 3, data_referencia: '2026-10-19', versao: 1, complementar: false, substitui_versao: null, status: 'pronta',
    codigo: 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG', prazo: PREPARADA.prazo, fechamento: PREPARADA.fechamento,
    prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00',
    vendedor: { id: 1, codigo: 'fulano', nome: 'Fulano', empresa: 'FORNECEDOR A (Centro)', rotulo: 'FORNECEDOR A', whatsapp: '5511900000001' },
    itens: [{ numero: 1, produto_id: 10, nome: 'ÁGUA MINERAL 500ML', qtd: 60, unidade: 'un', rotulo: 'un', vende_por_litro: false, embalagem: null, fator: null, nota: null }],
    ...p,
  }
}
