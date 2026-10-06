// Regras puras da aba "Lançamento de nota SEFAZ" (Fase 3): "Como pagar", memória por fornecedor, bloqueios e textos.
// Fica fora de src/lib/api.ts de propósito (sem rede nem React): os testes de tela trocam o api inteiro por um mock.
import { CONTAS_PIX } from '../cupom/formasPagamento'
import type { EstadoLancamentoNfe, ItemNotaSefaz, NotaSefazLista } from '../lib/tipos'

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

export function formaLembrada(emitente: string): string | null {
  try { return formaValida(localStorage.getItem(chaveMemoria(emitente))) } catch { return null }
}
export function lembrarForma(emitente: string, forma: string): void {
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

/** Forma que a tela começa mostrando: a gravada na nota, senão a lembrada do fornecedor, senão Boleto. '' = ainda sem escolha. */
export function formaInicial(n: NotaSefazLista): string {
  if (precisaEscolherForma(n)) return ''
  return formaValida(n.forma_pagamento) ?? formaLembrada(n.emitente) ?? FORMA_PADRAO
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
