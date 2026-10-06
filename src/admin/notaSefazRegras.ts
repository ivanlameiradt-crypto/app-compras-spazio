// Regras puras da aba "Lançamento de nota SEFAZ" (Fase 3): "Como pagar", memória por fornecedor, bloqueios e textos.
// Fica fora de src/lib/api.ts de propósito (sem rede nem React): os testes de tela trocam o api inteiro por um mock.
import { CONTAS_PIX } from '../cupom/formasPagamento'
import type { EstadoLancamentoNfe, ItemNotaSefaz, NotaSefazLista, ParcelaNota } from '../lib/tipos'

/** Forma de pagamento já marcada quando não há nada gravado nem lembrado. */
export const FORMA_PADRAO = 'boleto'

/** Formas já PROVADAS ao vivo no SisChef (OLINDA, boleto). As outras têm texto de conta/opção ainda não confirmado na tela e, se
 *  errarem, só quebram DEPOIS do pedido criado (nota pela metade). Quando uma for provada num lançamento real, entra aqui. */
export const FORMAS_PROVADAS: string[] = ['boleto']
export const AVISO_FORMA_NAO_PROVADA = 'Esta forma ainda não foi testada ao vivo no robô. No 1º lançamento real, use Boleto.'
export const formaNaoProvada = (forma: string): boolean => forma !== '' && !FORMAS_PROVADAS.includes(forma)

export interface OpcaoPagar { valor: string; rotulo: string }
/** Valores no formato que a Edge Function lancar-nfe aceita: boleto | dinheiro | tesouraria | cartao | pix:<banco>|<empresa>. */
export const OPCOES_ANTES_DO_PIX: OpcaoPagar[] = [
  { valor: 'boleto', rotulo: 'Boleto' },
  { valor: 'dinheiro', rotulo: 'Dinheiro à vista' },
  { valor: 'tesouraria', rotulo: 'Tesouraria à vista' },
]
export const OPCOES_PIX: OpcaoPagar[] = CONTAS_PIX.map((c) => ({ valor: `pix:${c.banco}|${c.empresa}`, rotulo: c.rotulo }))
export const OPCOES_DEPOIS_DO_PIX: OpcaoPagar[] = [{ valor: 'cartao', rotulo: 'Cartão (só estoque)' }]
const TODAS: OpcaoPagar[] = [...OPCOES_ANTES_DO_PIX, ...OPCOES_PIX, ...OPCOES_DEPOIS_DO_PIX]

/** A forma (já em minúscula, sem espaços nas pontas) se for uma das opções da tela; senão null. */
export function formaValida(forma: unknown): string | null {
  if (typeof forma !== 'string') return null
  const f = forma.trim().toLowerCase()
  return TODAS.some((o) => o.valor === f) ? f : null
}

/** Texto da forma para o aviso de confirmação ("PIX — Pang Bank — Spazio…", "Boleto"). */
export function rotuloForma(forma: string): string {
  const o = TODAS.find((x) => x.valor === forma)
  if (!o) return forma
  return OPCOES_PIX.includes(o) ? `PIX — ${o.rotulo}` : o.rotulo
}

// ---------- memória da última escolha, por fornecedor (emitente). Sempre em try/catch: a tela funciona sem localStorage.
const PREFIXO_MEMORIA = 'spazio.notaSefaz.forma.'
const chaveMemoria = (emitente: string): string => PREFIXO_MEMORIA + emitente.replace(/\s+/g, ' ').trim().toUpperCase()

/** Só Boleto, Dinheiro e Tesouraria podem vir pré-marcados: PIX (a conta pode ser a da empresa errada) e cartão (não cria pagamento
 *  no Sischef) exigem escolha deliberada em cada nota. */
const FORMAS_AUTOMATICAS = ['boleto', 'dinheiro', 'tesouraria']
export const podeVirMarcada = (forma: string | null | undefined): boolean => forma != null && FORMAS_AUTOMATICAS.includes(forma)

export function formaLembrada(emitente: string): string | null {
  try {
    const f = formaValida(localStorage.getItem(chaveMemoria(emitente)))
    return podeVirMarcada(f) ? f : null
  } catch { return null }
}
export function lembrarForma(emitente: string, forma: string): void {
  if (!podeVirMarcada(forma)) return // PIX e cartão nunca são memorizados
  try { localStorage.setItem(chaveMemoria(emitente), forma) } catch { /* sem armazenamento: segue sem lembrar */ }
}

// ---------- textos do estado
const SEM_BOLETO = 'A nota não tem boleto: escolha como pagar'

/** O motivo que o robô gravou, em português simples ("sem boletos na nota — pagamento manual" vira o aviso de escolher como pagar). */
export function traduzirMotivo(motivo: string | null | undefined): string {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  const trocado = t.replace(/sem boletos?\s+na nota\s*[—–-]\s*pagamento manual/i, SEM_BOLETO)
  if (trocado !== t) return trocado
  return /sem boletos?/i.test(t) ? SEM_BOLETO : t
}

/** A nota voltou do robô porque não tem boleto: a forma "boleto" já tentada não serve, o Ivan tem que escolher. */
export const precisaEscolherForma = (n: NotaSefazLista): boolean =>
  n.lancamento_estado === 'revisar' && /sem boletos?/i.test(n.lancamento_motivo ?? '')

/** Padrão do fornecedor no banco (a forma da última nota lançada dele; chave = CNPJ), ou null. */
export function formaPadraoDoFornecedor(n: NotaSefazLista, padroes: Record<string, string> | undefined): string | null {
  const f = n.cnpj_emitente && padroes ? formaValida(padroes[n.cnpj_emitente]) : null
  return podeVirMarcada(f) ? f : null
}

/** Forma que a tela começa mostrando: a gravada na nota, senão o padrão do fornecedor no banco, senão a lembrada neste celular,
 *  senão Boleto. '' = ainda sem escolha (a nota voltou do robô sem boleto: o robô para e o Ivan escolhe). */
export function formaInicial(n: NotaSefazLista, padroes?: Record<string, string>): string {
  if (precisaEscolherForma(n)) return ''
  return formaValida(n.forma_pagamento) ?? formaPadraoDoFornecedor(n, padroes) ?? formaLembrada(n.emitente) ?? FORMA_PADRAO
}

// ---------- bloqueios
export const AVISO_ITEM_SEM_PRODUTO = 'Item sem produto no SisChef: associe lá antes de lançar'
export const AVISO_CONTA_ESPECIAL = 'Conta especial: essa nota não é lançada pelo app'

const itemSemProduto = (it: ItemNotaSefaz): boolean =>
  it.produto_id == null || String(it.produto_id).trim() === '' || (it.associacao ?? '').trim().toLowerCase() === 'painel'
const contaEspecial = (emitente: string): boolean => /KONDO|MERCADO\s+LIVRE/.test(emitente.toUpperCase())

/** Motivos (em português) pelos quais esta nota NÃO pode ser lançada pelo app; lista vazia = pode. */
export function bloqueiosDaNota(n: NotaSefazLista): string[] {
  const b: string[] = []
  if (contaEspecial(n.emitente)) b.push(AVISO_CONTA_ESPECIAL)
  if (n.itens.some(itemSemProduto)) b.push(AVISO_ITEM_SEM_PRODUTO)
  return b
}

// ---------- 'lancando' preso
/** Mesmo limite da Edge Function lancar-nfe (MINUTOS_TRAVA): uma reserva 'lancando' mais velha que isto é dada como presa (o run
 *  caiu ou o GitHub o cancelou na fila) e o servidor aceita reservar de novo. A tela espelha a regra para não travar o botão. */
export const MINUTOS_PRESA = 30
export const AVISO_PRESA = 'O robô não respondeu em 30 min. Confira no SisChef se a nota entrou; se não entrou, pode lançar de novo.'

/** A nota está 'lancando' há mais de MINUTOS_PRESA (carimbo da reserva). Sem carimbo legível, NÃO é presa (fica travada). */
export function lancandoPresa(n: NotaSefazLista, agoraMs: number = Date.now()): boolean {
  if (n.lancamento_estado !== 'lancando' || !n.lancamento_estado_em) return false
  const desde = Date.parse(n.lancamento_estado_em)
  return Number.isFinite(desde) && agoraMs - desde > MINUTOS_PRESA * 60_000
}

/** Texto do estado da nota (null = nunca disparada). */
export function textoDoEstado(estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined): string | null {
  const m = traduzirMotivo(motivo)
  switch (estado) {
    case 'lancando': return 'Lançando… (o robô está trabalhando)'
    case 'revisar': return m ? `Precisa de você: ${m}` : 'Precisa de você: confira a nota'
    case 'erro': return 'Ficou pela metade — NÃO lance de novo (chame o Ivan/confira no SisChef)'
    case 'ensaio_ok': return m ? `Ensaio ok (nada foi criado): ${m}` : 'Ensaio ok (nada foi criado)'
    default: return null
  }
}

// ---------- nota "pronta" (regra 2 do Ivan) e conferência do financeiro
/** Diferença aceita entre a soma dos boletos e o valor da nota (R$): só ruído de centavo. */
export const TOLERANCIA_FINANCEIRO = 0.01
/** Quantas notas seguidas em boleto, sem problema, para o fornecedor contar como "aprendido". */
export const NOTAS_PARA_APRENDER = 3

const arredondar = (v: number): number => Math.round(v * 100) / 100

export interface ResumoFinanceiro {
  /** XML lido (parcelas conhecidas)? */
  lido: boolean
  parcelas: ParcelaNota[]
  soma: number
  total: number | null
  /** soma - total, em reais (já arredondada); null se não dá para comparar. */
  diferenca: number | null
  /** Tem boleto e a soma fecha com o valor da nota. */
  bate: boolean
}

/** Financeiro da nota (boletos do XML contra o valor da nota), para o painel de conferir e para marcar a nota como pronta. */
export function resumoFinanceiro(n: NotaSefazLista): ResumoFinanceiro {
  const parcelas = Array.isArray(n.parcelas) ? n.parcelas : []
  const lido = Array.isArray(n.parcelas)
  const soma = arredondar(parcelas.reduce((t, p) => t + (Number.isFinite(p.valor) ? p.valor : 0), 0))
  const total = n.valor_nf == null ? null : arredondar(n.valor_nf)
  const diferenca = lido && total != null ? arredondar(soma - total) : null
  const bate = lido && parcelas.length > 0 && diferenca != null && Math.abs(diferenca) <= TOLERANCIA_FINANCEIRO
  return { lido, parcelas, soma, total, diferenca, bate }
}

/** Itens sem produto de verdade no SisChef (os mesmos que bloqueiam o Lançar). */
export const itensSemProduto = (n: NotaSefazLista): ItemNotaSefaz[] => n.itens.filter(itemSemProduto)

export interface ProntidaoNota {
  pronta: boolean
  motivos: string[]
  /** O motivo ligado ao financeiro (boletos), ou null: a tela mostra só este, os de item/conta já têm aviso próprio. */
  financeiro: string | null
}

/**
 * Regra 2 do Ivan: a nota está "pronta" (só falta lançar) quando TODOS os itens estão associados no SisChef, o pagamento é em
 * boleto (a nota tem duplicatas) e os boletos fecham com o valor da nota. Qualquer coisa fora disso vira motivo, em português,
 * e a nota segue o fluxo normal (conferir e escolher como pagar). Nota bloqueada, lançando ou pela metade nunca é "pronta".
 */
export function prontidaoDaNota(n: NotaSefazLista): ProntidaoNota {
  const motivos: string[] = []
  if (n.itens.length === 0) motivos.push('A nota chegou sem itens')
  const sem = itensSemProduto(n).length
  if (sem > 0) motivos.push(sem === 1 ? '1 item sem produto no SisChef' : `${sem} itens sem produto no SisChef`)
  const f = resumoFinanceiro(n)
  let financeiro: string | null = null
  if (!f.lido) financeiro = 'Boletos ainda não lidos do XML (próxima leitura)'
  else if (f.parcelas.length === 0) financeiro = 'A nota não tem boletos: escolha como pagar'
  else if (!f.bate) financeiro = 'Os boletos não fecham com o valor da nota'
  if (financeiro) motivos.push(financeiro)
  if (contaEspecial(n.emitente)) motivos.push(AVISO_CONTA_ESPECIAL)
  if (n.lancamento_estado === 'erro') motivos.push('Ficou pela metade: não lance de novo')
  if (n.lancamento_estado === 'revisar' && n.lancamento_motivo) motivos.push(`Precisa de você: ${traduzirMotivo(n.lancamento_motivo)}`)
  return { pronta: motivos.length === 0, motivos, financeiro }
}

/** O fornecedor já "aprendeu"? (NOTAS_PARA_APRENDER ou mais notas seguidas lançadas em boleto.) */
export function fornecedorAprendido(n: NotaSefazLista, seguidas: Record<string, number> | undefined): number {
  const c = n.cnpj_emitente ? seguidas?.[n.cnpj_emitente] ?? 0 : 0
  return c >= NOTAS_PARA_APRENDER ? c : 0
}
