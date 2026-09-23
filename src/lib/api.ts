import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { EVENTO_SAIU, esquecerUsuario } from '../auth/usuarioGuardado'
import { ErroRede, ehErroTemporario, enfileirar, processar, type Op } from './fila'
import { emailDoLogin, SENHA_PADRAO } from './login'
import type { Compra, ItemSemana, LinhaCompra, Papel, Semana, Unidade, Usuario } from './tipos'

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
function checar<T>(r: Resposta<T>): T {
  if (r.error) throw new ErroApi(r.error.message, r.status, r.error.code)
  return r.data as T
}
async function chamar(nome: string, args: Record<string, unknown>): Promise<void> {
  const { error, status } = await supabase.rpc(nome, args)
  if (error) throw new ErroApi(error.message, status, error.code)
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
  return checar(await supabase.from('itens_semana').select('*').eq('semana_id', semanaId).order('produto'))
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
