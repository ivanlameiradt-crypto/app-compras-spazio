// Camada de dados dos cadastros (Fase 2, Bloco C). Chama as funções do banco pelo nome (C.4) e lê as tabelas de
// cadastro pela RLS de admin. As funções de admin já existem; nada aqui grava direto nas tabelas.
import { supabase } from '../lib/supabase'
import { chamar, chamarRet, checar } from '../lib/api'
import type {
  CnpjAprendido, FatorAConfirmar, Feriado, FornecedorSemVendedor, Grafia, HistoricoItemLinha, HistoricoSemana,
  ProdutoCadastro, RespostaConfirmar, Vendedor,
} from '../lib/tipos'
import type { Mudanca } from './regras'

// ---------- Vendedores e grafias
export const listarVendedores = async (): Promise<Vendedor[]> =>
  checar(await supabase.from('cot_vendedores').select('*').order('empresa')) as Vendedor[]
export const fornecedoresSemVendedor = (semanas = 8): Promise<FornecedorSemVendedor[]> =>
  chamarRet('cot_fornecedores_sem_vendedor', { p_semanas: semanas })
export const salvarVendedor = (p: Record<string, unknown>): Promise<RespostaConfirmar> =>
  chamarRet('cot_vendedor_salvar', { p })
export const excluirVendedor = (id: number) => chamar('cot_vendedor_excluir', { p_id: id })
export const salvarGrafia = (nome: string, vendedorId: number): Promise<Record<string, unknown>> =>
  chamarRet('cot_grafia_salvar', { p_nome: nome, p_vendedor_id: vendedorId })
export const removerGrafia = (nomeNorm: string): Promise<Record<string, unknown>> =>
  chamarRet('cot_grafia_remover', { p_nome_normalizado: nomeNorm })
export const listarGrafias = async (): Promise<Grafia[]> =>
  checar(await supabase.from('cot_fornecedores').select('*').order('nome_original')) as Grafia[]
export const listarCnpjs = async (): Promise<CnpjAprendido[]> =>
  checar(await supabase.from('cot_fornecedores_cnpj').select('*').order('cnpj')) as CnpjAprendido[]
export const moverCnpj = (cnpj: string, vendedor: number): Promise<Record<string, unknown>> =>
  chamarRet('cot_cnpj_mover', { p_cnpj: cnpj, p_vendedor: vendedor })
export const removerCnpj = (cnpj: string): Promise<Record<string, unknown>> =>
  chamarRet('cot_cnpj_remover', { p_cnpj: cnpj })

// ---------- Feriados
export const listarFeriados = async (): Promise<Feriado[]> =>
  checar(await supabase.from('cot_feriados').select('*').order('data')) as Feriado[]
export const salvarFeriado = (data: string, nome: string): Promise<{ muda_aguardando: boolean }> =>
  chamarRet('cot_feriado_salvar', { p_data: data, p_nome: nome })
export const removerFeriado = (data: string) => chamar('cot_feriado_remover', { p_data: data })

// ---------- Produtos e catálogo
export const produtosCadastro = (): Promise<ProdutoCadastro[]> => chamarRet('cot_produtos_cadastro', {})
export const definirNome = (produto: number, nome: string | null) => chamar('cot_definir_nome', { p_produto_id: produto, p_nome: nome })
export const definirLitro = (produto: number, litro: boolean) => chamar('cot_definir_litro', { p_produto_id: produto, p_vende_por_litro: litro })
export const confirmarKgPorLitro = (produto: number, kg: number | null) =>
  chamar('cot_confirmar_kg_por_litro', { p_produto_id: produto, p_kg: kg })
export const confirmarFator = (produto: number, vendedor: number, embalagem: string, fator: number,
  origem: 'ivan' | 'resposta' | 'nfe' = 'ivan', ref: string | null = null): Promise<Record<string, unknown>> =>
  chamarRet('cot_confirmar_fator', { p_produto_id: produto, p_vendedor_id: vendedor, p_embalagem: embalagem, p_fator: fator, p_origem: origem, p_ref: ref })
export const tirarFator = (produto: number) => chamar('cot_tirar_fator', { p_produto_id: produto })
export const soltarVendedor = (produto: number) => chamar('cot_catalogo_soltar_vendedor', { p_produto_id: produto })

// ---------- Fatores a confirmar
export const fatoresAConfirmar = (): Promise<FatorAConfirmar[]> => chamarRet('cot_fatores_a_confirmar', {})
export const descartarFator = (produto: number, vendedor: number, fator: number) =>
  chamar('cot_descartar_fator', { p_produto_id: produto, p_vendedor_id: vendedor, p_fator: fator })

// ---------- Regras da lista
export const listaRegraSalvar = (produto: number, acao: 'barrar' | 'incluir', motivo: string | null): Promise<{ semana_rascunho: number | null; efeito: string }> =>
  chamarRet('lista_regra_salvar', { p_produto_id: produto, p_acao: acao, p_motivo: motivo })
export const listaRegraRemover = (produto: number) => chamar('lista_regra_remover', { p_produto_id: produto })

// ---------- Mudanças (auditoria das tabelas de cadastro)
const TABELAS_CADASTRO = ['cot_vendedores', 'cot_fornecedores', 'cot_catalogo', 'cot_feriados', 'lista_regras', 'cot_fator_descartes']
export const mudancas = async (): Promise<Mudanca[]> =>
  checar(await supabase.from('historico_alteracoes').select('*').in('tabela', TABELAS_CADASTRO)
    .order('id', { ascending: false }).limit(30)) as Mudanca[]

// ---------- Histórico de cotações
export const historicoSemanas = async (): Promise<HistoricoSemana[]> =>
  checar(await supabase.from('cot_historico_semanas').select('*').order('data_referencia', { ascending: false })) as HistoricoSemana[]
export const historicoItens = async (semanaId: number, vendedorId: number): Promise<HistoricoItemLinha[]> =>
  checar(await supabase.from('cot_historico_itens').select('*').eq('semana_id', semanaId).eq('vendedor_id', vendedorId).order('produto_id')) as HistoricoItemLinha[]
