import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { EVENTO_SAIU, esquecerUsuario } from '../auth/usuarioGuardado'
import { ErroRede, ehErroTemporario, enfileirar, processar, type Op } from './fila'
import { emailDoLogin, SENHA_PADRAO } from './login'
import type {
  Abertura, AssociacaoApp, Compra, ConfirmacaoItemCupom, Cotacao, CupomRecente, DadosEnvio, Desempenho, EconomiaSemana, EntradaGerais, EntradaItem,
  HistoricoItem, IaStatus, ImagemIA, ItemCotacao, ItemPedidoEntrada, ItemRecebido, ItemSemana, LeituraIA, LeituraNotas,
  LinhaCompra, LinhaConferencia, MarcaItem, NfeResumo, NotaSefazLista, ParcelaDigitada, PagamentoCupom, PainelEconomia, Papel, Pedido, PedidoAReceber, PedidoRecente,
  Preparo, ProdutoCatalogo, Recebimento, RespostaConfirmacaoCupom, ResultadoEnvio, ResumoCotacao, ResumoEnvioCupom, ResumoIA, Semana, Unidade, Usuario, Vendedor,
} from './tipos'

/** Erro vindo do Supabase, com o status HTTP e o código (PostgREST/Postgres) para a fila saber se tenta de novo. */
export class ErroApi extends Error {
  status?: number
  code?: string
  constructor(mensagem: string, status?: number, code?: string) {
    super(mensagem)
    this.name = 'ErroApi'
    this.status = status
    this.code = code || undefined
  }
}

type Resposta<T> = { data: T | null; error: { message: string; code?: string } | null; status?: number }
export function checar<T>(r: Resposta<T>): T {
  if (r.error) throw new ErroApi(r.error.message, r.status, r.error.code)
  return r.data as T
}
export async function chamar(nome: string, args: Record<string, unknown>): Promise<void> {
  const { error, status } = await supabase.rpc(nome, args)
  if (error) throw new ErroApi(error.message, status, error.code)
}
/** Como `chamar`, mas devolve o que a função retornou (jsonb, tabela): para as funções de cadastro com retorno. */
export async function chamarRet<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await supabase.rpc(nome, args)
  if (error) throw new ErroApi(error.message, status, error.code)
  return data as T
}

// ---------- login (usuário + senha — P1)
export async function entrarComSenha(login: string, senha: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: emailDoLogin(login), password: senha })
  if (error) throw new Error(error.message)
}

/** Extrai a mensagem que a Edge Function devolveu no corpo (JSON) do erro, quando dá pra ler. */
async function mensagemDaFuncao(erro: unknown): Promise<string> {
  const contexto = (erro as { context?: Response }).context
  if (contexto && typeof contexto.json === 'function') {
    try {
      const corpo = await contexto.json()
      if (corpo && typeof corpo.erro === 'string') return corpo.erro
    } catch { /* corpo não era JSON: segue com a mensagem padrão */ }
  }
  return erro instanceof Error ? erro.message : String(erro)
}

export async function criarAcesso(args: { login: string; nome: string; papel: Papel; senha: string }): Promise<{ email: string }> {
  const { data, error } = await supabase.functions.invoke('gerenciar-usuarios', { body: { acao: 'criar', ...args } })
  if (error) throw new Error(await mensagemDaFuncao(error))
  return data as { email: string }
}

export async function redefinirSenha(email: string, senha: string = SENHA_PADRAO): Promise<void> {
  const { error } = await supabase.functions.invoke('gerenciar-usuarios', { body: { acao: 'redefinir_senha', email, senha } })
  if (error) throw new Error(await mensagemDaFuncao(error))
}

/** P2: cada pessoa troca a própria senha, confirmando primeiro a senha atual. */
export async function trocarMinhaSenha(atual: string, nova: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const email = data.session?.user.email
  if (!email) throw new Error('Sessão inválida. Entre de novo.')
  const conferida = await supabase.auth.signInWithPassword({ email, password: atual })
  // sem internet (ou servidor fora) não é senha errada: repassa o erro de rede para a tela avisar
  if (conferida.error && isAuthRetryableFetchError(conferida.error)) throw conferida.error
  if (conferida.error) throw new Error('Senha atual incorreta.')
  const atualizada = await supabase.auth.updateUser({ password: nova })
  if (atualizada.error) throw new Error(atualizada.error.message)
}

/** P3: primeiro acesso (senha padrão) — não pede a senha atual, a sessão já prova quem é. */
export async function escolherSenhaInicial(nova: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: nova, data: { trocar_senha: false } })
  if (error) throw new Error(error.message)
  await supabase.auth.refreshSession()
}

export async function sair() {
  esquecerUsuario()
  try {
    await supabase.auth.signOut()
  } finally {
    // sem internet e com o token vencido o Supabase não avisa a saída: o app avisa por conta própria
    window.dispatchEvent(new Event(EVENTO_SAIU))
  }
}

// ---------- usuários
export async function buscarUsuario(email: string): Promise<Usuario | null> {
  return checar(await supabase.from('usuarios').select('email, nome, papel, ativo').eq('email', email.toLowerCase()).maybeSingle())
}
export async function listarUsuarios(): Promise<Usuario[]> {
  return checar(await supabase.from('usuarios').select('email, nome, papel, ativo').order('nome'))
}
export async function salvarUsuario(u: Usuario): Promise<void> {
  checar(await supabase.from('usuarios').upsert({ ...u, email: u.email.trim().toLowerCase() }))
}

// ---------- semana
export async function semanaParaRevisar(): Promise<Semana | null> {
  return checar(await supabase.from('semanas').select('*').neq('status', 'encerrada')
    .order('data_referencia', { ascending: false }).limit(1).maybeSingle())
}
export async function semanaEmCompra(): Promise<Semana | null> {
  return checar(await supabase.from('semanas').select('*').eq('status', 'em_compra').maybeSingle())
}
export async function listarSemanas(): Promise<Semana[]> {
  return checar(await supabase.from('semanas').select('*').order('data_referencia', { ascending: false }).limit(52))
}
export async function itensDaSemana(semanaId: number): Promise<ItemSemana[]> {
  const r = checar(await supabase.from('itens_semana').select('*').eq('semana_id', semanaId).order('produto')) as ItemSemana[]
  // selos e custo_medio chegam com a 20260928000001; regra/regra_motivo com a C2. Sem elas, o item vale como
  // "sem selo", "sem custo médio" e "sem regra" (o padrão da 1A), e a Revisão fica igual à de hoje.
  return r.map((i) => ({ ...i, selos: i.selos ?? [], custo_medio: i.custo_medio ?? null, regra: i.regra ?? null, regra_motivo: i.regra_motivo ?? null }))
}
export async function linhasDaSemana(semanaId: number): Promise<LinhaCompra[]> {
  const r = checar(await supabase.from('compras_itens').select('*, compras!inner(semana_id)').eq('compras.semana_id', semanaId)) as
    (LinhaCompra & { compras?: unknown })[]
  return r.map(({ compras: _c, ...l }) => l)
}
export const ajustarItem = (item: number, qtd: number, incluido: boolean) =>
  chamar('ajustar_item', { p_item: item, p_qtd: qtd, p_incluido: incluido })
export const aprovarSemana = (semana: number) => chamar('aprovar_semana', { p_semana: semana })
export const encerrarSemana = (semana: number) => chamar('encerrar_semana', { p_semana: semana })

// ---------- fila de lançamento
export type CompraNaFila = Compra & { comprador_nome: string; itens: number }
export async function filaLancamentos(): Promise<CompraNaFila[]> {
  const r = checar(await supabase.from('compras').select('*, usuarios!compras_comprador_fkey(nome), compras_itens(count)')
    .in('status', ['fechada', 'aprovada']).order('fechada_em')) as
    (Compra & { usuarios: { nome: string } | null; compras_itens: { count: number }[] })[]
  return r.map(({ usuarios, compras_itens, ...c }) => ({
    ...c, comprador_nome: usuarios?.nome ?? c.comprador, itens: compras_itens[0]?.count ?? 0,
  }))
}
export async function contarAguardando(): Promise<number> {
  const { count, error } = await supabase.from('compras').select('id', { count: 'exact', head: true }).eq('status', 'fechada')
  if (error) throw new Error(error.message)
  return count ?? 0
}
export type LinhaDetalhada = LinhaCompra & { produto: string; unidade: Unidade; preco_estimado: number | null }
export async function itensDaCompra(compraId: string): Promise<LinhaDetalhada[]> {
  const r = checar(await supabase.from('compras_itens').select('*, itens_semana(produto, unidade, preco_estimado)').eq('compra_id', compraId)) as
    (LinhaCompra & { itens_semana: { produto: string; unidade: Unidade; preco_estimado: number | null } })[]
  return r.map(({ itens_semana, ...l }) => ({ ...l, ...itens_semana })).sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR'))
}
export const aprovarCompra = (id: string) => chamar('aprovar_compra', { p_compra: id })
export const marcarLancada = (id: string) => chamar('marcar_lancada', { p_compra: id })
export const corrigirItemCompra = (linha: string, qtd: number, preco: number | null) =>
  chamar('corrigir_item_compra', { p_linha: linha, p_qtd: qtd, p_preco: preco })
export const corrigirCompra = (id: string, comNota: boolean, total: number) =>
  chamar('corrigir_compra', { p_compra: id, p_com_nota: comNota, p_total: total })
export async function urlCupom(caminho: string): Promise<string> {
  const r = await supabase.storage.from('cupons').createSignedUrl(caminho, 600)
  if (r.error) throw new Error(r.error.message)
  return r.data.signedUrl
}

// ---------- I2: compras abertas (retomar no celular do comprador; listar/cancelar no Resumo do admin)
export async function minhaCompraAberta(semanaId: number, email: string): Promise<Compra | null> {
  const r = checar(await supabase.from('compras').select('*')
    .eq('semana_id', semanaId).eq('comprador', email).eq('status', 'aberta')
    .order('aberta_em', { ascending: false }).limit(1)) as Compra[]
  return r[0] ?? null
}
export type CompraAbertaResumo = Pick<Compra, 'id' | 'loja' | 'comprador' | 'aberta_em'> & { comprador_nome: string }
export async function comprasAbertas(semanaId: number): Promise<CompraAbertaResumo[]> {
  const r = checar(await supabase.from('compras').select('*, usuarios!compras_comprador_fkey(nome)')
    .eq('semana_id', semanaId).eq('status', 'aberta').order('aberta_em')) as
    (Compra & { usuarios: { nome: string } | null })[]
  return r.map((c) => ({ id: c.id, loja: c.loja, comprador: c.comprador, aberta_em: c.aberta_em, comprador_nome: c.usuarios?.nome ?? c.comprador }))
}
export const cancelarCompra = (id: string) => chamar('cancelar_compra', { p_compra: id })

// ---------- Fase 1A: compra aberta de outra pessoa trava o encerrar da semana (Lançamentos: fechar ou cancelar)
export type CompraAbertaParaFechar = CompraAbertaResumo & { itens: number; total_marcado: number }
/** As compras abertas da semana, com quantos itens já foram marcados e o total sugerido (soma de qtd × preço, sem preço = 0). */
export async function comprasAbertasParaFechar(semanaId: number): Promise<CompraAbertaParaFechar[]> {
  const r = checar(await supabase.from('compras').select('*, usuarios!compras_comprador_fkey(nome), compras_itens(qtd, preco_unit)')
    .eq('semana_id', semanaId).eq('status', 'aberta').order('aberta_em')) as
    (Compra & { usuarios: { nome: string } | null; compras_itens: { qtd: number; preco_unit: number | null }[] | null })[]
  return r.map((c) => {
    const linhas = c.compras_itens ?? []
    return {
      id: c.id, loja: c.loja, comprador: c.comprador, aberta_em: c.aberta_em, comprador_nome: c.usuarios?.nome ?? c.comprador,
      itens: linhas.length,
      total_marcado: linhas.reduce((s, l) => s + Number(l.qtd) * Number(l.preco_unit ?? 0), 0),
    }
  })
}
/**
 * A semana em compra que está travando a aprovação da lista nova: só quando já existe uma semana em rascunho
 * esperando e a semana em compra é outra (só uma fica em compra por vez). Fora disso, compra aberta é compra
 * em curso (o comprador pode estar na loja) e não há o que destravar.
 */
export async function semanaTravandoAprovacao(): Promise<Semana | null> {
  const [emCompra, paraRevisar] = await Promise.all([semanaEmCompra(), semanaParaRevisar()])
  if (!emCompra || !paraRevisar || paraRevisar.status !== 'rascunho' || paraRevisar.id === emCompra.id) return null
  return emCompra
}
/**
 * O admin fecha a compra aberta de outra pessoa com os itens já marcados (segue para a fila de lançamento).
 * Devolve false quando ela já estava fechada (o comprador fechou antes): nada mudou, valem os valores dele.
 */
export async function adminFecharCompra(id: string, comNota: boolean, total: number): Promise<boolean> {
  const { data, error, status } = await supabase.rpc('admin_fechar_compra', { p_compra: id, p_com_nota: comNota, p_total: total })
  if (error) throw new ErroApi(error.message, status, error.code)
  return data !== false // só o false explícito do banco quer dizer "já estava fechada"
}

// ---------- Fase 1B: cotações (admin) — contrato-1b.md 8.2
/** Chama uma função do banco e devolve o que ela retorna (JSON ou escalar). */
async function rpcDados<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await supabase.rpc(nome, args)
  if (error) throw new ErroApi(error.message, status, error.code)
  return data as T
}
/** numeric do Postgres pode chegar como texto (valores grandes ou vindos de jsonb): a conta do App precisa de número. */
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

const COLUNAS_VENDEDOR = 'id, codigo, nome, empresa, whatsapp, ativo'
const COLUNAS_COTACAO = 'id, semana_id, vendedor_id, versao, complementar, status, resultado, substituida_por, ' +
  'congelada_em, enviada_em, fechada_em, prazo, fechamento, primeiro_acesso, ultimo_acesso, acessos, envios_aceitos, ' +
  'ultimo_envio_em, pagamento, validade, pedido_minimo, frete, entrega, observacao, gerais_rev, gerais_origem, ' +
  'respostas_rev, cobranca_em, consolidado_em'
const COLUNAS_ITEM_COTACAO = 'id, cotacao_id, item_semana_id, produto_id, numero, incluido, nome, unidade, rotulo, ' +
  'vende_por_litro, qtd, qtd_sugerida, embalagem, fator, fator_confirmado, kg_por_litro, descricao_fornecedor, ' +
  'codigo_fornecedor, nota_vendedor, ref_preco, ref_data, ref_situacao, estado, preco_digitado, base, emb_unidades, emb_gramas, ' +
  'emb_ml, fator_informado, preco_convertido, tenho_so, similar_desc, similar_preco, a_partir_de, marca_informada, ' +
  'avisos_vendedor, avisos_ivan, confirmado_pelo_vendedor, origem, copiada_da_versao, respondido_em, rev, delta'
const COLUNAS_RESUMO = 'cotacao_id, itens, respondidos, tem, nao_tem, parciais, com_referencia, total_cotado, total_ultimo, gerais_respondidas'
const COLUNAS_PEDIDO = 'cotacao_id, confirmado_por, confirmado_em, itens'
const COLUNAS_ECONOMIA = 'semana_id, data_referencia, pedidos, itens_pedido, itens_com_referencia, itens_sem_comparacao, ' +
  'total_pedido, total_ultimo, diferenca'
/** Tabela ou view que ainda não existe no banco (App publicado antes da migration da cotação). */
const tabelaInexistente = (code?: string) => code === 'PGRST205' || code === '42P01'

function cotacaoLida(c: Cotacao): Cotacao {
  return { ...c, pedido_minimo: num(c.pedido_minimo), frete: num(c.frete) }
}
function itemCotacaoLido(i: ItemCotacao): ItemCotacao {
  return {
    ...i,
    qtd: Number(i.qtd), qtd_sugerida: Number(i.qtd_sugerida ?? 0), fator: num(i.fator), kg_por_litro: num(i.kg_por_litro),
    ref_preco: num(i.ref_preco), preco_digitado: num(i.preco_digitado), emb_unidades: num(i.emb_unidades),
    emb_gramas: num(i.emb_gramas), emb_ml: num(i.emb_ml), fator_informado: num(i.fator_informado),
    preco_convertido: num(i.preco_convertido), tenho_so: num(i.tenho_so), similar_preco: num(i.similar_preco),
    a_partir_de: num(i.a_partir_de), delta: num(i.delta),
    nota_vendedor: i.nota_vendedor ?? null, marca_informada: i.marca_informada ?? null,
    avisos_vendedor: i.avisos_vendedor ?? [], avisos_ivan: i.avisos_ivan ?? [],
  }
}
/** Pedido gravado (jsonb): números do Postgres viram número, a marca ausente vira null. */
function pedidoLido<T extends Pedido>(p: T): T {
  return {
    ...p,
    itens: (p.itens ?? []).map((l) => ({
      ...l, qtd: Number(l.qtd), embalagens: num(l.embalagens), fator: num(l.fator),
      preco_combinado: Number(l.preco_combinado), preco_convertido: num(l.preco_convertido), marca: l.marca ?? null,
    })),
  }
}

export async function prepararCotacoes(semanaId: number): Promise<Preparo> {
  const p = await rpcDados<Preparo>('cot_preparar', { p_semana: semanaId })
  // "atravessados" é sempre presente (contrato 4.1); a lista vazia protege a tela contra um banco mais antigo
  return { ...p, atravessados: p.atravessados ?? [] }
}
export async function listarVendedores(): Promise<Vendedor[]> {
  return checar(await supabase.from('cot_vendedores').select(COLUNAS_VENDEDOR).order('empresa')) as Vendedor[]
}
export async function cotacoesDaSemana(semanaId: number): Promise<Cotacao[]> {
  const r = checar(await supabase.from('cot_cotacoes').select(COLUNAS_COTACAO).eq('semana_id', semanaId)
    .order('vendedor_id').order('versao', { ascending: false })) as unknown as Cotacao[]
  return r.map(cotacaoLida)
}
/** Cotações de outras semanas ainda vivas, ou fechadas sem resultado há menos de 7 dias (8.2 da spec). */
export async function cotacoesAnterioresVivas(semanaAtualId: number | null): Promise<Cotacao[]> {
  const seteDias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  let q = supabase.from('cot_cotacoes').select(COLUNAS_COTACAO)
    .or(`status.in.(pronta,enviada,respondida),and(status.eq.fechada,resultado.is.null,fechada_em.gt."${seteDias}")`)
  if (semanaAtualId != null) q = q.neq('semana_id', semanaAtualId)
  const r = checar(await q.order('semana_id', { ascending: false }).order('vendedor_id').order('versao', { ascending: false })) as unknown as Cotacao[]
  return r.map(cotacaoLida)
}
/**
 * As cotações que alguma de `ids` substituiu (`substituida_por in ids`). Não aparecem na tela, mas sem elas a v2 de uma
 * semana anterior que substituiu a v1 pareceria "sem sinal de envio" (contrato 3.1) e a mensagem dela perderia o
 * "substitui a v1": `cotacoesAnterioresVivas` não traz a substituída.
 */
export async function cotacoesSubstituidasPor(ids: number[]): Promise<Cotacao[]> {
  if (ids.length === 0) return []
  const r = checar(await supabase.from('cot_cotacoes').select(COLUNAS_COTACAO).in('substituida_por', ids)) as unknown as Cotacao[]
  return r.map(cotacaoLida)
}
export async function itensDasCotacoes(ids: number[]): Promise<ItemCotacao[]> {
  if (ids.length === 0) return []
  const r = checar(await supabase.from('cot_itens_admin').select(COLUNAS_ITEM_COTACAO).in('cotacao_id', ids)
    .order('cotacao_id').order('numero', { nullsFirst: false }).order('nome')) as unknown as ItemCotacao[]
  return r.map(itemCotacaoLido)
}
export async function resumosDasCotacoes(ids: number[]): Promise<ResumoCotacao[]> {
  if (ids.length === 0) return []
  const r = checar(await supabase.from('cot_resumo').select(COLUNAS_RESUMO).in('cotacao_id', ids)) as ResumoCotacao[]
  return r.map((x) => ({ ...x, total_cotado: Number(x.total_cotado ?? 0), total_ultimo: Number(x.total_ultimo ?? 0) }))
}
export async function codigosDasCotacoes(ids: number[]): Promise<Record<number, string>> {
  if (ids.length === 0) return {}
  const r = checar(await supabase.from('cot_codigos').select('cotacao_id, codigo').in('cotacao_id', ids)) as
    { cotacao_id: number; codigo: string }[]
  return Object.fromEntries(r.map((x) => [x.cotacao_id, x.codigo]))
}
export async function pedidoDaCotacao(id: number): Promise<Pedido | null> {
  const r = checar(await supabase.from('cot_pedidos').select(COLUNAS_PEDIDO).eq('cotacao_id', id).maybeSingle()) as Pedido | null
  return r ? pedidoLido(r) : null
}
export const definirVendedor = (produtoId: number, vendedorId: number) =>
  chamar('cot_definir_vendedor', { p_produto_id: produtoId, p_vendedor_id: vendedorId })
export const definirNota = (produtoId: number, nota: string | null) =>
  chamar('cot_definir_nota', { p_produto_id: produtoId, p_nota: nota })
/** Economia por semana (cot_economia, order data_referencia). */
export async function economiaSemanas(): Promise<EconomiaSemana[]> {
  const { data, error, status } = await supabase.from('cot_economia').select(COLUNAS_ECONOMIA).order('data_referencia')
  if (error) {
    // sem a migration da cotação, o Resumo (tela da Fase 1A) continua sem a linha de economia
    if (tabelaInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return ((data ?? []) as unknown as EconomiaSemana[]).map((e) => ({
    ...e, total_pedido: Number(e.total_pedido ?? 0), total_ultimo: Number(e.total_ultimo ?? 0), diferenca: Number(e.diferenca ?? 0),
  }))
}
/** Pedidos confirmados desde `desde` (ISO) em cotações de outras semanas que `semanaId` (cot_pedidos gte confirmado_em + cot_cotacoes in ids). */
export async function pedidosRecentes(semanaId: number, desde: string): Promise<PedidoRecente[]> {
  const ped = await supabase.from('cot_pedidos').select(COLUNAS_PEDIDO).gte('confirmado_em', desde).order('confirmado_em')
  if (ped.error) {
    // sem a migration da cotação, a Revisão (tela da Fase 1A) continua sem a etiqueta de pedido anterior
    if (tabelaInexistente(ped.error.code)) return []
    throw new ErroApi(ped.error.message, ped.status, ped.error.code)
  }
  const pedidos = (ped.data ?? []) as Pedido[]
  if (pedidos.length === 0) return []
  const cot = await supabase.from('cot_cotacoes').select('id, semana_id, vendedor_id').in('id', pedidos.map((p) => p.cotacao_id))
  if (cot.error) {
    if (tabelaInexistente(cot.error.code)) return []
    throw new ErroApi(cot.error.message, cot.status, cot.error.code)
  }
  const deCotacao = new Map(((cot.data ?? []) as { id: number; semana_id: number; vendedor_id: number }[]).map((c) => [c.id, c]))
  const r: PedidoRecente[] = []
  for (const p of pedidos) {
    const c = deCotacao.get(p.cotacao_id)
    if (!c || c.semana_id === semanaId) continue
    r.push(pedidoLido({ ...p, semana_id: c.semana_id, vendedor_id: c.vendedor_id }))
  }
  return r
}
export const marcarItemCotacao = (cotItem: number, incluido: boolean) =>
  chamar('cot_marcar_item', { p_cot_item: cotItem, p_incluido: incluido })
export async function congelarCotacao(id: number): Promise<DadosEnvio> {
  return rpcDados<DadosEnvio>('cot_congelar', { p_cotacao: id })
}
export async function dadosEnvio(id: number): Promise<DadosEnvio> {
  return rpcDados<DadosEnvio>('cot_dados_envio', { p_cotacao: id })
}
export const descongelarCotacao = (id: number) => chamar('cot_descongelar', { p_cotacao: id })
export const confirmarEnvio = (id: number) => chamar('cot_confirmar_envio', { p_cotacao: id })
export async function trocarCodigo(id: number): Promise<DadosEnvio> {
  return rpcDados<DadosEnvio>('cot_trocar_codigo', { p_cotacao: id })
}
export async function responderComoAdmin(id: number, envioId: string, itens: EntradaItem[], gerais: EntradaGerais | null,
  origem: 'ivan_digitou' | 'ivan_colou' | 'ivan_ia'): Promise<ResultadoEnvio> {
  return rpcDados<ResultadoEnvio>('cot_responder_admin', {
    p_cotacao: id, p_envio_id: envioId, p_itens: itens, p_gerais: gerais, p_origem: origem,
  })
}

// ---------- Fase 2, Bloco B: leitura com IA (DESIGN-fase-2.md B.8)
/** Erro da leitura com IA, com o código de B.13 (o texto já vem pronto para a tela). */
export class ErroIA extends Error {
  codigo: string
  constructor(codigo: string, mensagem: string) {
    super(mensagem)
    this.name = 'ErroIA'
    this.codigo = codigo
  }
}

/** Lê o corpo JSON {erro, mensagem} de um erro da Edge Function (status ≠ 2xx). */
async function corpoDaFuncaoIA(erro: unknown): Promise<{ erro?: string; mensagem?: string }> {
  const contexto = (erro as { context?: Response }).context
  if (contexto && typeof contexto.json === 'function') {
    try { return await contexto.json() } catch { /* corpo não era JSON */ }
  }
  return {}
}

/**
 * Chama a Edge Function cot-ler-resposta (B.7). Devolve a prévia (LeituraIA) ou lança ErroIA com o texto de B.13. O App
 * cancela aos 140 s pelo `sinal`. Os erros "brandos" (recusa, incompleta, tempo…) voltam com status 200 e ok: false;
 * os "duros" (admin, desligada, limite, cotação, sessão) voltam com status ≠ 2xx.
 */
export async function lerComIA(
  cotacaoId: number,
  entrada: { texto: string | null; imagens: ImagemIA[]; transcricao: boolean; pendentes?: number[] },
  sinal?: AbortSignal,
): Promise<LeituraIA> {
  const chamada = supabase.functions.invoke('cot-ler-resposta', {
    body: { cotacao_id: cotacaoId, ...entrada },
  })
  const resultado = sinal
    ? await Promise.race([
      chamada,
      new Promise<never>((_, rej) => sinal.addEventListener('abort', () => rej(new ErroIA('cancelado', 'Leitura cancelada.')), { once: true })),
    ])
    : await chamada
  const { data, error } = resultado as { data: unknown; error: unknown }
  if (error) {
    const corpo = await corpoDaFuncaoIA(error)
    throw new ErroIA(corpo.erro ?? 'api', corpo.mensagem ?? (error instanceof Error ? error.message : 'A IA não respondeu.'))
  }
  const corpo = data as LeituraIA & { ok: boolean; erro?: string; mensagem?: string }
  if (!corpo || corpo.ok !== true) throw new ErroIA(corpo?.erro ?? 'api', corpo?.mensagem ?? 'A IA não respondeu.')
  return corpo
}

/** Registra a gravação por IA (melhor esforço: a falha não aparece para o Ivan). */
export async function iaGravada(leitura: number, envioId: string, resumo: ResumoIA): Promise<void> {
  await chamar('cot_ia_gravada', { p_leitura: leitura, p_envio_id: envioId, p_resumo: resumo })
}

/** cot_ia_status; null quando a função ainda não existe no banco (App publicado antes da migration). */
export async function iaStatus(): Promise<IaStatus | null> {
  const { data, error, status } = await supabase.rpc('cot_ia_status')
  if (error) {
    if (funcaoInexistente(error.code)) return null
    throw new ErroApi(error.message, status, error.code)
  }
  return data as IaStatus
}

export async function iaLigar(ligada: boolean): Promise<IaStatus> {
  return rpcDados<IaStatus>('cot_ia_ligar', { p_ligada: ligada })
}
export async function novaVersao(id: number): Promise<number> {
  return Number(await rpcDados<number>('cot_nova_versao', { p_cotacao: id }))
}
export const cancelarCotacao = (id: number) => chamar('cot_cancelar', { p_cotacao: id })
export async function gravarPedido(id: number, itens: ItemPedidoEntrada[]): Promise<Pedido> {
  return pedidoLido(await rpcDados<Pedido>('cot_gravar_pedido', { p_cotacao: id, p_itens: itens }))
}
/** "O vendedor não confirmou — desfazer pedido" (D67): o pedido volta a ser só cotação (refazer o mapa ou Obrigado). */
export const desfazerPedido = (id: number) => chamar('cot_desfazer_pedido', { p_cotacao: id })
export const dispensarCotacao = (id: number) => chamar('cot_dispensar', { p_cotacao: id })
export const liberarLoja = (id: number) => chamar('cot_liberar_loja', { p_cotacao: id })
export const voltarACotar = (id: number) => chamar('cot_voltar_a_cotar', { p_cotacao: id })
/** "Ver como o vendedor vê" e checagem de saúde depois do Preparar: o mesmo caminho do vendedor, em prévia. */
export async function abrirComoVendedor(codigo: string): Promise<Abertura> {
  return rpcDados<Abertura>('cotacao_abrir', { p_codigo: codigo, p_previa: true })
}

// ---------- Fase 1B: etiquetas (comprador e admin)
/** Função que ainda não existe no banco (App publicado antes da migration da cotação). */
const funcaoInexistente = (code?: string) => code === 'PGRST202' || code === '42883'
export async function marcasDaSemana(semanaId: number): Promise<MarcaItem[]> {
  const { data, error, status } = await supabase.rpc('cot_marcas_semana', { p_semana: semanaId })
  if (error) {
    // sem a migration da cotação, Comprar e Resumo continuam sem etiqueta (como os selos no itensDaSemana)
    if (funcaoInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return (data ?? []) as MarcaItem[]
}

// ---------- Fase 2, Bloco E1: painel de economia (DESIGN-fase-2.md E.6)
/** cot_painel_economia; null quando a função ainda não existe no banco (App publicado antes da migration). */
export async function painelEconomia(de: string | null, ate: string | null): Promise<PainelEconomia | null> {
  const { data, error, status } = await supabase.rpc('cot_painel_economia', { p_de: de, p_ate: ate })
  if (error) {
    if (funcaoInexistente(error.code)) return null
    throw new ErroApi(error.message, status, error.code)
  }
  return data as PainelEconomia
}
/** cot_historico_item; null quando a função ainda não existe no banco. */
export async function historicoItem(produtoId: number, de: string | null, ate: string | null): Promise<HistoricoItem | null> {
  const { data, error, status } = await supabase.rpc('cot_historico_item', { p_produto_id: produtoId, p_de: de, p_ate: ate })
  if (error) {
    if (funcaoInexistente(error.code)) return null
    throw new ErroApi(error.message, status, error.code)
  }
  return data as HistoricoItem
}

// ---------- Fase 2, Bloco D: recebimento e conferência da NF-e (DESIGN-fase-2.md, D.7)
const COLUNAS_NFE = 'chave, numero, emissao, valor_nf, emitente, cnpj_emitente, situacao, saiu_da_fila_em, ' +
  'lancada_em, nf_sischef, vendedor_id, cotacao_id, vinculo'
const COLUNAS_CONFERENCIA = 'cotacao_id, confirmado_em, entrega_prevista, numero, produto_id, nome, unidade, qtd, base, embalagens, fator, ' +
  'preco_combinado, preco_convertido, marca, chegou, avaria, falta, resto, falta_definitiva, recebimento, ' +
  'nf_chaves, nf_qtd, qtd_nf, preco, valor_acima, combinado_unit, cobrado_unit, imposto, marca_nf, motivos'

const nfeLida = (n: NfeResumo): NfeResumo => ({ ...n, valor_nf: Number(n.valor_nf ?? 0) })
const conferenciaLida = (l: LinhaConferencia): LinhaConferencia => ({
  ...l, qtd: Number(l.qtd), embalagens: num(l.embalagens), fator: num(l.fator),
  preco_combinado: Number(l.preco_combinado), preco_convertido: num(l.preco_convertido),
  chegou: num(l.chegou), avaria: num(l.avaria), falta: num(l.falta), falta_definitiva: Number(l.falta_definitiva ?? 0),
  nf_qtd: num(l.nf_qtd), valor_acima: Number(l.valor_acima ?? 0),
  combinado_unit: num(l.combinado_unit), cobrado_unit: num(l.cobrado_unit), imposto: Number(l.imposto ?? 0),
  nf_chaves: l.nf_chaves ?? [], motivos: l.motivos ?? [],
})

export async function pedidosAReceber(): Promise<PedidoAReceber[]> {
  const { data, error, status } = await supabase.rpc('cot_pedidos_a_receber')
  if (error) {
    if (funcaoInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return (data ?? []) as PedidoAReceber[]
}
export async function registrarRecebimento(cotacao: number, envioId: string, recebidoEm: string | null,
  itens: ItemRecebido[], resto: 'vem_depois' | 'nao_vem' | null, observacao: string | null): Promise<Recebimento> {
  return rpcDados<Recebimento>('cot_registrar_recebimento', {
    p_cotacao: cotacao, p_envio_id: envioId, p_recebido_em: recebidoEm, p_itens: itens, p_resto: resto, p_observacao: observacao,
  })
}
export const desfazerRecebimento = (id: number) => chamar('cot_desfazer_recebimento', { p_recebimento: id })
export const definirEntrega = (id: number, data: string | null) => chamar('cot_definir_entrega', { p_cotacao: id, p_data: data })
export const marcarEntrada = (id: number, entrou: boolean) => chamar('cot_marcar_entrada', { p_cotacao: id, p_entrou: entrou })

export async function conferencia(cotacaoIds: number[]): Promise<LinhaConferencia[]> {
  if (cotacaoIds.length === 0) return []
  const { data, error, status } = await supabase.from('cot_conferencia').select(COLUNAS_CONFERENCIA)
    .in('cotacao_id', cotacaoIds).order('cotacao_id').order('numero')
  if (error) {
    if (tabelaInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return ((data ?? []) as unknown as LinhaConferencia[]).map(conferenciaLida)
}
export async function nfesDosPedidos(cotacaoIds: number[]): Promise<NfeResumo[]> {
  if (cotacaoIds.length === 0) return []
  const { data, error, status } = await supabase.from('cot_nfe').select(COLUNAS_NFE).in('cotacao_id', cotacaoIds)
  if (error) {
    if (tabelaInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return ((data ?? []) as unknown as NfeResumo[]).map(nfeLida)
}
/** NF-e sem pedido casado, do vendedor (ou de emitente sem vendedor, com vendedorId null), emitidas desde `desde` (AAAA-MM-DD). */
export async function nfesSemPedido(vendedorId: number | null, desde: string): Promise<NfeResumo[]> {
  let q = supabase.from('cot_nfe').select(COLUNAS_NFE).is('cotacao_id', null).eq('nao_e_pedido', false).gte('emissao', desde)
  q = vendedorId == null ? q.is('vendedor_id', null) : q.eq('vendedor_id', vendedorId)
  const { data, error, status } = await q.order('emissao', { ascending: false })
  if (error) {
    if (tabelaInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return ((data ?? []) as unknown as NfeResumo[]).map(nfeLida)
}
// ---------- Fase 3: aba "Lançamento de nota SEFAZ" (lê cot_nfe por RLS de admin). numeric pode chegar como texto.
const COLUNAS_NOTA_ANTIGAS = 'chave, cnpj_emitente, emitente, numero, emissao, valor_nf, situacao, lancada_em, nf_sischef, itens'
// As colunas novas (migrações 20261206000001 e 20261207000001 — esta traz `parcelas`) só existem depois de aplicada: sem elas a leitura cai para as antigas.
/** Até a migração do descarte (20261209000001): sem a coluna da decisão do app (20261210000001), que é a mais nova. */
const COLUNAS_NOTA_SEM_ASSOCIACAO = `${COLUNAS_NOTA_ANTIGAS}, forma_pagamento, lancamento_estado, lancamento_motivo, lancamento_estado_em, parcelas, parcelas_manuais, descartada_em, descartada_motivo`
const COLUNAS_NOTA = `${COLUNAS_NOTA_SEM_ASSOCIACAO}, associacoes_app`
const notaListaLida = (n: NotaSefazLista): NotaSefazLista => ({
  ...n,
  valor_nf: n.valor_nf == null ? null : Number(n.valor_nf),
  itens: Array.isArray(n.itens) ? n.itens : [],
  cnpj_emitente: n.cnpj_emitente ?? null,
  forma_pagamento: n.forma_pagamento ?? null,
  lancamento_estado: n.lancamento_estado ?? null,
  lancamento_motivo: n.lancamento_motivo ?? null,
  lancamento_estado_em: n.lancamento_estado_em ?? null,
  parcelas: Array.isArray(n.parcelas)
    ? n.parcelas.map((p) => ({ numero: p?.numero ?? null, vencimento: p?.vencimento ?? null, valor: Number(p?.valor ?? 0) }))
    : null,
  parcelas_manuais: Array.isArray(n.parcelas_manuais)
    ? n.parcelas_manuais.map((p) => ({ vencimento: String(p?.vencimento ?? ''), valor: Number(p?.valor ?? 0) }))
    : null,
  descartada_em: n.descartada_em ?? null,
  descartada_motivo: n.descartada_motivo ?? null,
  associacoes_app: associacoesLidas(n.associacoes_app),
})
/** Decisões do app como vêm do banco (jsonb) -> só as bem formadas, com o código como número. Vazio ou estragado = null. */
function associacoesLidas(x: unknown): Record<string, AssociacaoApp> | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null
  const saida: Record<string, AssociacaoApp> = {}
  for (const [n, v] of Object.entries(x as Record<string, unknown>)) {
    const d = (v ?? {}) as Record<string, unknown>
    const id = Number(d.produto_id)
    if (!Number.isFinite(id) || typeof d.produto_nome !== 'string' || d.produto_nome.trim() === '') continue
    // A conversão (quanto vale 1 unidade da nota em unidades do produto) TEM de passar: sem ela a tela nunca a vê, o aviso "falta a conversão" não
    // sai e o Lançar fica apagado mesmo com o valor gravado no banco (SEARA, 07/10). Só número > 0 (o banco já exige até 4 casas e ≤ 10000).
    const conversao = d.conversao == null || d.conversao === '' ? NaN : Number(d.conversao)
    saida[n] = {
      produto_id: id, produto_nome: d.produto_nome, unidade: typeof d.unidade === 'string' ? d.unidade : null,
      ...(Number.isFinite(conversao) && conversao > 0 ? { conversao } : {}),
      por: typeof d.por === 'string' ? d.por : null, em: typeof d.em === 'string' ? d.em : null,
    }
  }
  return Object.keys(saida).length > 0 ? saida : null
}
/** Coluna que não existe (Postgres 42703, ou a mensagem "column ... does not exist"): migração ainda não aplicada. */
const colunaInexistente = (e: { message?: string; code?: string }): boolean =>
  e.code === '42703' || /column .* does not exist/i.test(e.message ?? '')
type RespostaNotas = { data: unknown; error: { message: string; code?: string } | null; status: number }
/**
 * Lê as notas com as colunas novas; se o banco ainda não as tem, repete com as antigas (a aba não pode quebrar). `novas` diz a
 * `consulta` qual das duas tentativas é: com as colunas antigas ela também não pode filtrar pelas colunas do descarte.
 */
async function lerNotas(consulta: (colunas: string, novas: boolean) => PromiseLike<RespostaNotas>): Promise<NotaSefazLista[]> {
  // Degraus: tudo (com a decisão do app) -> sem a decisão do app (descarte já existe) -> só as colunas antigas. Cada degrau só é tentado se o anterior
  // falhou por coluna inexistente (migração ainda não aplicada); qualquer outro erro vale como está.
  let r = await consulta(COLUNAS_NOTA, true)
  if (r.error && colunaInexistente(r.error)) r = await consulta(COLUNAS_NOTA_SEM_ASSOCIACAO, true)
  if (r.error && colunaInexistente(r.error)) r = await consulta(COLUNAS_NOTA_ANTIGAS, false)
  if (r.error) {
    if (tabelaInexistente(r.error.code)) return []
    throw new ErroApi(r.error.message, r.status, r.error.code)
  }
  return ((r.data ?? []) as unknown as NotaSefazLista[]).map(notaListaLida)
}
/** Notas pendentes da fila da SEFAZ (situacao 'na_fila') que o Ivan NÃO descartou, para "Notas a lançar". */
export const notasALancar = (): Promise<NotaSefazLista[]> =>
  lerNotas((colunas, novas) => {
    const q = supabase.from('cot_nfe').select(colunas).eq('situacao', 'na_fila')
    return (novas ? q.is('descartada_em', null) : q).order('emissao', { ascending: false })
  })
/** Notas que o Ivan descartou e que ainda estão na fila do SisChef (as que já saíram de lá não aparecem), a mais nova primeiro. */
export async function notasDescartadas(): Promise<NotaSefazLista[]> {
  const r = await supabase.from('cot_nfe').select(COLUNAS_NOTA_SEM_ASSOCIACAO).eq('situacao', 'na_fila').not('descartada_em', 'is', null)
    .order('descartada_em', { ascending: false })
  if (r.error) {
    if (colunaInexistente(r.error) || tabelaInexistente(r.error.code)) return [] // migração do descarte ainda não aplicada
    throw new ErroApi(r.error.message, r.status, r.error.code)
  }
  return ((r.data ?? []) as unknown as NotaSefazLista[]).map(notaListaLida)
}
/** Notas já lançadas (situacao 'lancada'), mais recentes primeiro, para "Últimos lançamentos". */
export const notasLancadas = (limite = 10): Promise<NotaSefazLista[]> =>
  lerNotas((colunas) => supabase.from('cot_nfe').select(colunas)
    .eq('situacao', 'lancada').order('lancada_em', { ascending: false, nullsFirst: false }).limit(limite))

/**
 * Forma de pagamento padrão por fornecedor (chave = CNPJ do emitente): a da última nota LANÇADA dele, lida do banco (vale em qualquer
 * aparelho; a Edge Function lancar-nfe já grava a forma na nota). Devolve a forma crua; quem decide se pode vir PRÉ-MARCADA é
 * notaSefazRegras (PIX e cartão nunca). Falha de leitura ou coluna ainda inexistente = sem padrão (a tela segue com Boleto).
 */
export async function formasPadraoPorFornecedor(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('cot_nfe').select('cnpj_emitente, forma_pagamento, lancada_em')
    .eq('situacao', 'lancada').order('lancada_em', { ascending: false, nullsFirst: false }).limit(300)
  if (error) return {}
  const ultima: Record<string, string> = {}
  for (const r of (data ?? []) as { cnpj_emitente: string | null; forma_pagamento: string | null }[]) {
    if (!r.cnpj_emitente || !r.forma_pagamento || r.cnpj_emitente in ultima) continue // a 1ª de cada CNPJ é a mais recente
    ultima[r.cnpj_emitente] = r.forma_pagamento
  }
  return ultima
}

/**
 * Quantas notas SEGUIDAS (as mais recentes) de cada fornecedor (chave = CNPJ) foram lançadas em BOLETO. Para a regra do Ivan:
 * fornecedor com 3 ou mais já "aprendeu" e a nota dele vem só para confirmar. Para no 1º lançamento que não foi boleto
 * (ou que não tem forma gravada). Falha de leitura = ninguém aprendido (a tela segue pedindo conferência).
 */
export async function lancamentosSeguidosEmBoleto(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('cot_nfe').select('cnpj_emitente, forma_pagamento, lancada_em')
    .eq('situacao', 'lancada').order('lancada_em', { ascending: false, nullsFirst: false }).limit(300)
  if (error) return {}
  const contagem: Record<string, number> = {}
  const parou = new Set<string>()
  for (const r of (data ?? []) as { cnpj_emitente: string | null; forma_pagamento: string | null }[]) {
    const c = r.cnpj_emitente
    if (!c || parou.has(c)) continue
    if (r.forma_pagamento === 'boleto') contagem[c] = (contagem[c] ?? 0) + 1
    else parou.add(c)
  }
  return contagem
}

/** Texto claro (em português) para o erro do "Lançar": pelo status HTTP da Edge Function lancar-nfe, ou pelo texto que ela devolveu. */
function mensagemDoLancar(status: number | undefined, texto: string): string {
  const t = texto.toLowerCase()
  if (status === 403 || t.includes('administrador')) return 'Só o administrador pode lançar notas.'
  if (t.includes('outra nota')) return 'O robô está lançando outra nota. Aguarde ela terminar (uns 3 minutos) e toque em Lançar de novo.'
  if (status === 409 || t.includes('não está disponível')) return 'Esta nota já está lançando, já foi lançada, ficou pela metade ou foi descartada. Atualize a tela e confira.'
  if (t.includes('parcelas digitadas')) {
    if (t.includes('não fecham')) return 'As parcelas digitadas não fecham com o valor da nota. Confira os valores.'
    if (t.includes('já tem boletos')) return 'Esta nota já tem boletos no XML. Atualize a tela e confira.'
    if (t.includes('só valem para boleto')) return 'Parcelas digitadas só valem para a forma Boleto.'
    return 'Confira o vencimento e o valor de cada parcela.'
  }
  if (status === 400 || t.includes('inválid')) {
    return t.includes('chave') ? 'A chave da nota não é válida. Atualize a tela e tente de novo.' : 'Escolha como pagar: a forma de pagamento não é válida.'
  }
  if (status === 502 || t.includes('robô')) return 'Não consegui chamar o robô agora, tente de novo.'
  return 'Não consegui lançar agora. Confira a internet e tente de novo.'
}
/**
 * Manda lançar UMA nota (Edge Function lancar-nfe: admin, reserva a nota e dispara o robô). A função só responde 202 quando o robô
 * foi chamado; o resultado de verdade aparece depois, no estado da nota (lancamento_estado). Erros viram texto em português.
 */
export async function lancarNota(chave: string, forma: string, parcelas?: ParcelaDigitada[]): Promise<void> {
  // `parcelas` só vai quando o Ivan digitou (boleto cujo XML não traz as duplicatas); sem ela o corpo é o de sempre
  const body = parcelas && parcelas.length > 0 ? { chave, forma, parcelas } : { chave, forma }
  const { error } = await supabase.functions.invoke('lancar-nfe', { body })
  if (!error) return
  const contexto = (error as { context?: Response }).context
  const status = typeof contexto?.status === 'number' ? contexto.status : undefined
  let texto = ''
  if (contexto && typeof contexto.json === 'function') {
    try { const corpo = await contexto.json(); if (corpo && typeof corpo.erro === 'string') texto = corpo.erro } catch { /* corpo não era JSON */ }
  }
  throw new ErroApi(mensagemDoLancar(status, texto), status)
}

/** O que a Edge Function lancar-nfe (ação "verificar") diz sobre o robô de uma nota "lançando". */
export interface VerificacaoRobo {
  /** nada_a_verificar | aguardando | rodando | concluida | sem_execucao | liberada | pela_metade */
  situacao: string
  /** Texto em português, pronto para mostrar. */
  mensagem: string
  /** A nota mudou de estado (liberada ou pela metade): vale recarregar a lista. */
  mudou: boolean
}
/**
 * Pergunta ao servidor como terminou a execução do robô de UMA nota que ficou "lançando" (ele consulta o GitHub). Se a execução caiu ANTES de
 * tocar no SisChef, a nota volta a poder ser lançada, com a explicação; se caiu depois, ela vira "pela metade" e fica travada. Não lança nada.
 */
export async function verificarRobo(chave: string): Promise<VerificacaoRobo> {
  const { data, error } = await supabase.functions.invoke('lancar-nfe', { body: { chave, acao: 'verificar' } })
  if (!error && data && typeof (data as { mensagem?: unknown }).mensagem === 'string') {
    const d = data as { situacao?: unknown; mensagem: string; mudou?: unknown }
    return { situacao: typeof d.situacao === 'string' ? d.situacao : '', mensagem: d.mensagem, mudou: d.mudou === true }
  }
  let texto = ''
  const contexto = (error as { context?: Response } | null)?.context
  if (contexto && typeof contexto.json === 'function') {
    try { const corpo = await contexto.json(); if (corpo && typeof corpo.erro === 'string') texto = corpo.erro } catch { /* corpo não era JSON */ }
  }
  throw new ErroApi(texto ? texto.charAt(0).toUpperCase() + texto.slice(1) + '.' : 'Não consegui verificar o robô agora. Confira a internet e tente de novo.')
}

/**
 * Texto claro para o erro de descartar/restaurar. As mensagens do banco (cot_nfe_descartar) já são em português e dizem o motivo
 * (pela metade, robô lançando…): passam como vieram; falha de rede ou erro desconhecido vira um texto genérico.
 */
function mensagemDoDescarte(e: unknown, acao: string): string {
  const texto = e instanceof Error ? e.message : ''
  if (/administrador/i.test(texto)) return 'Só o administrador pode fazer isso.'
  if (/nota não encontrada|não está mais na fila|pela metade|lançando esta nota/i.test(texto)) return texto.charAt(0).toUpperCase() + texto.slice(1) + '.'
  return `Não consegui ${acao} agora. Confira a internet e tente de novo.`
}
/**
 * Descarta UMA nota da fila (cot_nfe_descartar, admin): ela sai de "Notas a lançar" e o robô não a lança. NADA muda no SisChef nem na
 * SEFAZ. Não vale para nota pela metade nem para a que o robô está lançando (o banco recusa). `motivo` fica guardado (até 300 letras).
 */
export async function descartarNota(chave: string, motivo: string): Promise<void> {
  try { await chamar('cot_nfe_descartar', { p_chave: chave, p_motivo: motivo }) }
  catch (e) { throw new ErroApi(mensagemDoDescarte(e, 'descartar a nota'), e instanceof ErroApi ? e.status : undefined) }
}
/** Desfaz o descarte: a nota volta para "Notas a lançar". */
export async function restaurarNota(chave: string): Promise<void> {
  try { await chamar('cot_nfe_restaurar', { p_chave: chave }) }
  catch (e) { throw new ErroApi(mensagemDoDescarte(e, 'voltar a nota para a fila'), e instanceof ErroApi ? e.status : undefined) }
}

/** As palavras-chave, os nomes corrigidos e os produtos escondidos. Banco ainda sem a coluna `ocultar` (migração 20261211000002 não aplicada): lê sem ela. */
async function lerBuscaDosProdutos() {
  const com = await supabase.from('cot_produto_busca').select('produto_id, palavras, nome_corrigido, ocultar').limit(1000)
  if (com.error?.code === '42703') return supabase.from('cot_produto_busca').select('produto_id, palavras, nome_corrigido').limit(1000)
  return com
}
/**
 * A unidade (e, para o produto que ele acrescentou, o nome do SisChef) de cada produto na planilha do Ivan (tabela produto_planilha, admin): produto_id → { unidade 'kg' | 'un', descricao }. Falha de leitura (tabela ainda não criada, rede)
 * devolve vazio: o catálogo segue com a unidade de itens_semana, como antes da planilha — melhor que derrubar a caixa de associação inteira.
 */
async function lerPlanilhaDeUnidades(): Promise<Map<number, { unidade: string; descricao: string }>> {
  const mapa = new Map<number, { unidade: string; descricao: string }>()
  try {
    const com = await supabase.from('produto_planilha').select('produto_id, unidade, descricao').limit(1000)
    // banco ainda sem a coluna `descricao` (42703): lê só a unidade
    const r: { data: unknown[] | null; error: { code?: string } | null } = com.error?.code === '42703'
      ? await supabase.from('produto_planilha').select('produto_id, unidade').limit(1000)
      : com
    if (r.error) { console.warn('catalogoProdutos: não li a planilha de unidades', r.error.code); return mapa }
    for (const x of (r.data ?? []) as { produto_id: number | string; unidade: string | null; descricao?: string | null }[]) {
      const id = Number(x.produto_id)
      const u = String(x.unidade ?? '').trim().toLowerCase()
      if (Number.isFinite(id) && (u === 'kg' || u === 'un')) mapa.set(id, { unidade: u, descricao: String(x.descricao ?? '').replace(/\s+/g, ' ').trim() })
    }
  } catch (e) {
    console.warn('catalogoProdutos: não li a planilha de unidades', e instanceof Error ? e.name : '')
  }
  return mapa
}
/**
 * Os produtos que o Ivan pode escolher ao associar um item da nota: os insumos e bebidas que já estão no app (itens_semana; o código é o do
 * SisChef), UMA linha por produto, com o nome e a unidade da semana mais nova. Em ordem alfabética. Só o admin lê tudo (RLS).
 *
 * Junta o que o Ivan escreveu na planilha de 06/10 (cot_produto_busca): as palavras-chave de cada produto e, quando o nome do SisChef tem erro,
 * o nome corrigido — que passa a ser o `nome` mostrado (o do SisChef fica em `nome_sischef`, e a busca acha por ele também). App publicado antes
 * da migração: a tabela não existe e o catálogo vem como sempre, sem palavras. Qualquer outro erro nessa leitura é erro (a caixa avisa).
 * O produto marcado `ocultar` (receita da casa, não é de compra) vem com `oculto: true`: a busca e as sugestões o ignoram.
 */
export async function catalogoProdutos(): Promise<ProdutoCatalogo[]> {
  const [lista, busca] = await Promise.all([
    supabase.from('itens_semana').select('produto_id, produto, unidade, semana_id').order('semana_id', { ascending: false }).limit(1000),
    lerBuscaDosProdutos(),
  ])
  const planilha = await lerPlanilhaDeUnidades()
  if (lista.error) throw new ErroApi(lista.error.message, lista.status, lista.error.code)
  const porId = new Map<number, ProdutoCatalogo>()
  for (const r of (lista.data ?? []) as { produto_id: number | string; produto: string | null; unidade: string | null }[]) {
    const id = Number(r.produto_id)
    const nome = (r.produto ?? '').replace(/\s+/g, ' ').trim()
    if (!Number.isFinite(id) || nome === '' || porId.has(id)) continue // a 1ª de cada produto é a da semana mais nova
    porId.set(id, { produto_id: id, nome, unidade: r.unidade ?? null })
  }
  // A planilha "Produtos - como eu lanço no SisChef" do Ivan (08/10): a unidade dela MANDA sobre a de itens_semana (que o app só adivinhava pelo nome) e o produto
  // que ele acrescentou com o nome do SisChef (ex.: CHOCOLATE BARRA LACTA LAKA OREO) entra na lista mesmo fora da lista semanal de compra. Entra ANTES das palavras-chave,
  // para elas (e o nome corrigido) valerem também para ele.
  for (const [id, x] of planilha) {
    const p = porId.get(id)
    if (p) { p.unidade = x.unidade; if (x.descricao !== '') p.descricao_sischef = x.descricao }
    else if (x.descricao !== '') porId.set(id, { produto_id: id, nome: x.descricao, unidade: x.unidade })
  }
  if (busca.error) {
    if (!tabelaInexistente(busca.error.code)) throw new ErroApi(busca.error.message, busca.status, busca.error.code)
  } else {
    for (const r of (busca.data ?? []) as { produto_id: number | string; palavras: string | null; nome_corrigido: string | null; ocultar?: boolean | null }[]) {
      const p = porId.get(Number(r.produto_id))
      if (!p) continue // anotação de produto que não está na lista desta semana: não aparece
      const palavras = (r.palavras ?? '').replace(/\s+/g, ' ').trim()
      const corrigido = (r.nome_corrigido ?? '').replace(/\s+/g, ' ').trim()
      if (palavras !== '') p.palavras = palavras
      if (r.ocultar === true) p.oculto = true
      if (corrigido !== '' && corrigido !== p.nome) { p.nome_sischef = p.nome; p.nome = corrigido }
    }
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
/** Texto claro para o erro de associar: as mensagens do banco (cot_nfe_associar) já são em português e dizem o motivo; o resto vira um texto genérico. */
function mensagemDaAssociacao(e: unknown): string {
  const texto = e instanceof Error ? e.message : ''
  if (/administrador/i.test(texto)) return 'Só o administrador pode fazer isso.'
  if (/nota não encontrada|não está mais na fila|descartada|pela metade|lançando esta nota|item não encontrado|já está associado|ainda não está associado|código do produto|fora da lista|a conversão/i.test(texto)) {
    return texto.charAt(0).toUpperCase() + texto.slice(1) + '.'
  }
  return 'Não consegui guardar a escolha agora. Confira a internet e tente de novo.'
}
/**
 * Guarda a escolha do Ivan para UM item sem produto (cot_nfe_associar, admin): o produto vem da lista de insumos do app e o servidor grava
 * o nome e a unidade. Com `produtoId` nulo desfaz a escolha. `conversao` = quanto vale 1 unidade da nota em unidades do produto (só quando as
 * unidades diferem; o banco confere o número); sempre vai como p_conversao, nulo quando não há — a função do banco só existe com os 4 parâmetros
 * (etapa 2). Nada muda no SisChef aqui: é o robô, ao lançar, que aplica a decisão lá.
 */
export async function associarItem(chave: string, n: number, produtoId: number | null, conversao: number | null = null): Promise<void> {
  try { await chamar('cot_nfe_associar', { p_chave: chave, p_n: n, p_produto_id: produtoId, p_conversao: conversao }) }
  catch (e) { throw new ErroApi(mensagemDaAssociacao(e), e instanceof ErroApi ? e.status : undefined) }
}
/**
 * Guarda a conversão de unidade de um item que JÁ vem associado no SisChef mas com UN DIFERE (cot_nfe_converter_item, admin): o robô a registra no modal
 * do SisChef ao lançar. `conversao` nula desfaz. Quem escolhe o produto continua sendo a caixa de associação (item sem produto).
 */
export async function converterItem(chave: string, n: number, conversao: number | null): Promise<void> {
  try { await chamar('cot_nfe_converter_item', { p_chave: chave, p_n: n, p_conversao: conversao }) }
  catch (e) { throw new ErroApi(mensagemDaAssociacao(e), e instanceof ErroApi ? e.status : undefined) }
}
/**
 * "Lembrar esta descrição": guarda a descrição que veio na nota como mais uma palavra-chave do produto que o Ivan confirmou (cot_produto_lembrar,
 * admin), para a caixa de associação já sugeri-lo da próxima vez. true = acrescentou; false = já estava lá (ou não coube nos 500 caracteres).
 * Só reforça a busca: quem chama não deve deixar uma falha daqui desfazer a confirmação.
 */
export async function lembrarDescricao(produtoId: number, texto: string): Promise<boolean> {
  return (await chamarRet<boolean | null>('cot_produto_lembrar', { p_produto_id: produtoId, p_texto: texto })) === true
}
export const vincularNfe = (chave: string, cotacao: number | null) => chamar('cot_nfe_vincular', { p_chave: chave, p_cotacao: cotacao })
export const desvincularNfe = (chave: string) => chamar('cot_nfe_desvincular', { p_chave: chave })
export const moverCnpj = (cnpj: string, vendedorId: number) => chamar('cot_cnpj_mover', { p_cnpj: cnpj, p_vendedor: vendedorId })
export const removerCnpj = (cnpj: string) => chamar('cot_cnpj_remover', { p_cnpj: cnpj })
export async function desempenho(): Promise<Desempenho[]> {
  const { data, error, status } = await supabase.rpc('cot_desempenho_vendedores')
  if (error) {
    if (funcaoInexistente(error.code)) return []
    throw new ErroApi(error.message, status, error.code)
  }
  return ((data ?? []) as Desempenho[]).map((d) => ({ ...d, valor_acima: Number(d.valor_acima ?? 0) }))
}
export async function ultimaLeituraNotas(): Promise<LeituraNotas | null> {
  const { data, error, status } = await supabase.from('cot_nfe_leituras').select('lida_em, notas, completa, origem')
    .order('lida_em', { ascending: false }).limit(1).maybeSingle()
  if (error) {
    if (tabelaInexistente(error.code)) return null
    throw new ErroApi(error.message, status, error.code)
  }
  return (data ?? null) as LeituraNotas | null
}

// ---------- M12: nome de quem comprou, em vez do e-mail
export async function nomesEquipe(): Promise<Record<string, string>> {
  const r = checar(await supabase.rpc('nomes_equipe')) as { email: string; nome: string }[]
  return Object.fromEntries(r.map((x) => [x.email, x.nome]))
}

// ---------- comprador
export async function lojasUsadas(): Promise<string[]> {
  const r = checar(await supabase.from('compras').select('loja')) as { loja: string }[]
  return [...new Set(r.map((x) => x.loja))].sort()
}

export async function executarOp(op: Op): Promise<void> {
  // sem sessão a chamada iria como anônimo e seria recusada: a operação espera o login voltar
  const sessao = await supabase.auth.getSession().then((r) => r.data.session, () => null)
  if (!sessao) throw new ErroRede('sem sessão')
  try {
    let args: Record<string, unknown> = op.args
    if (op.tipo === 'fechar_compra' && op.foto) {
      const caminho = `${op.args.p_compra}/${op.id}.jpg`
      const arquivo = new Blob([op.foto.dados], { type: op.foto.tipo })
      const up = await supabase.storage.from('cupons').upload(caminho, arquivo, { contentType: op.foto.tipo })
      if (up.error && !/exists|duplicate/i.test(up.error.message)) {
        throw new ErroApi(up.error.message, (up.error as { status?: number }).status)
      }
      args = { ...op.args, p_foto: caminho }
    }
    await chamar(op.tipo, args)
  } catch (e) {
    if (ehErroTemporario(e)) throw new ErroRede(e instanceof Error ? e.message : String(e))
    throw e
  }
}

/** Guarda a operação no celular e tenta mandar já; sem internet ela fica na fila. Não espera a rede: quem chamar não trava no envio. */
export async function enviarOp(op: Op): Promise<void> {
  await enfileirar(op)
  void processar(executarOp).catch(() => undefined)
}

// ---------- Sub-fase 3: cupom fiscal (o app só captura e envia; a escrita é service_role na Edge Function)
/**
 * Sobe a foto reduzida ao bucket privado `cupons`. "já existe" (retry/reenvio) não é erro — o servidor dedup por foto_path.
 * Sem `upsert` de propósito: o bucket só tem policy de INSERT (e SELECT de admin), sem UPDATE; um upsert no reenvio seria negado pela RLS.
 */
export async function subirFotoCupom(caminho: string, foto: Blob): Promise<void> {
  const up = await supabase.storage.from('cupons').upload(caminho, foto, { contentType: foto.type || 'image/jpeg' })
  if (up.error && !/exists|duplicate/i.test(up.error.message)) {
    throw new ErroApi(up.error.message, (up.error as { status?: number }).status)
  }
}

/** Chama a Edge Function enviar-cupom (service_role lê a foto, lê com IA, casa o confirmado, grava e dispara). */
export async function enviarCupom(fotoPath: string, pagamento: PagamentoCupom, teste = false): Promise<ResumoEnvioCupom> {
  const { data, error } = await supabase.functions.invoke('enviar-cupom', { body: { foto_path: fotoPath, pagamento, teste } })
  if (error) throw new Error(await mensagemDaFuncao(error))
  return data as ResumoEnvioCupom
}

/**
 * Chama a Edge Function confirmar-cupom: num cupom parado em REVISAR por item sem produto confirmado, o Ivan confirma (produto + quantidade
 * do cupom) item a item e o servidor refaz os itens, confere a soma, volta o cupom a PENDENTE, guarda o aprendizado e dispara o robô.
 * O erro da função (soma que não bate, cupom que já saiu de REVISAR…) vem no corpo JSON e vira a mensagem que a tela mostra.
 */
export async function confirmarCupom(cupomId: string, itens: ConfirmacaoItemCupom[], soConfirmar = false): Promise<RespostaConfirmacaoCupom> {
  // soConfirmar: cupom em que TODOS os itens já vieram conhecidos (motivo CONFIRMAR:) — o Ivan só confere e confirma o cupom inteiro, sem itens um a um
  const { data, error } = await supabase.functions.invoke('confirmar-cupom', { body: soConfirmar ? { cupom_id: cupomId, so_confirmar: true } : { cupom_id: cupomId, itens } })
  if (error) throw new Error(await mensagemDaFuncao(error))
  return data as RespostaConfirmacaoCupom
}

/** "Últimos envios": só leitura, por RLS de admin (e_admin() do Plano 1). numeric pode chegar como texto. */
export async function cuponsRecentes(limite = 10): Promise<CupomRecente[]> {
  const r = checar(await supabase.from('cupom')
    .select('id, estado, emitente_nome, emitente_cnpj, valor_a_pagar, pedido_sischef, criado_em, atualizado_em, motivo, teste, itens, foto_path')
    .order('criado_em', { ascending: false }).limit(limite)) as CupomRecente[]
  return r.map((c) => ({
    ...c,
    valor_a_pagar: c.valor_a_pagar == null ? null : Number(c.valor_a_pagar),
    itens: Array.isArray(c.itens) ? c.itens : [], // JSONB pode vir null; a UI espera lista
  }))
}
