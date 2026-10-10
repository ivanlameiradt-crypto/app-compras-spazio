// Regras puras da aba "Lançamento fiscal" (Fase 3; até 06/10/2026 "Lançamento de nota SEFAZ"): "Como pagar", memória por fornecedor, bloqueios e textos.
// Fica fora de src/lib/api.ts de propósito (sem rede nem React): os testes de tela trocam o api inteiro por um mock.
import { CONTAS_PIX } from '../cupom/formasPagamento'
import { conversaoDaDecisao, rotuloUnidade, situacaoConversao } from './associacaoRegras'
import type { AssociacaoApp, EstadoLancamentoNfe, ItemNotaSefaz, NotaSefazLista, ParcelaDigitada, ParcelaNota } from '../lib/tipos'

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
// ETAPA 2 da associação pelo app (migração 20261212000001): o robô, ao lançar, aplica na tela do SisChef o produto que o Ivan confirmou no app. Por isso o
// item sem produto no SisChef só trava o Lançar enquanto a decisão do app para ele está INCOMPLETA: sem produto escolhido, ou com produto que o app TEM
// CERTEZA de estar em outra unidade (nota em UN, produto "(KG)") e sem a conversão (quanto vale 1 unidade da nota em unidades do produto — é o que o
// robô digita no modal do SisChef). Quando o app só DESCONFIA (a unidade "un" da lista é um chute pelo nome; produto novo não tem unidade), a decisão
// vale sem conversão: o robô lê o cadastro vivo do SisChef e, se precisar do fator, para a nota em "revisar" antes de gravar qualquer coisa
// (associacaoRegras.situacaoConversao explica o porquê).
export const AVISO_ITEM_SEM_PRODUTO = 'Item sem produto no SisChef: escolha o produto na caixa de associação (ou associe no SisChef) antes de lançar'
/** Todo item sem produto no SisChef já tem o produto confirmado no app, mas em algum deles as unidades diferem e falta a conversão. */
export const AVISO_FALTA_CONVERSAO = 'Produto confirmado no app, mas falta a conversão de unidade: informe na caixa de associação antes de lançar'
export const AVISO_CONTA_ESPECIAL = 'Conta especial: essa nota não é lançada pelo app'
/**
 * Nota que a leitura do SisChef trouxe sem itens: não há o que conferir, e o robô também recusa. No SisChef ela costuma aparecer como
 * "XML resumido": a SEFAZ só entrega o resumo da nota até o destinatário registrar a ciência da operação; só depois vem o XML completo.
 */
export const AVISO_SEM_ITENS = 'Esta nota chegou sem itens: no SisChef ela costuma aparecer como “XML resumido” (a SEFAZ só entregou o resumo da nota, e o XML completo só vem depois da ciência da operação). Sem os itens não dá para conferir nem lançar. Se ela não vai ser lançada, descarte-a.'

const itemSemProduto = (it: ItemNotaSefaz): boolean =>
  it.produto_id == null || String(it.produto_id).trim() === '' || (it.associacao ?? '').trim().toLowerCase() === 'painel'
/** Item com produto de verdade no SisChef: o "✓ verde" do painel de conferir. Um item com ✓ nunca trava o Lançar; um sem ✓ trava, SALVO se a decisão
 *  do app para ele está completa (etapa 2: o robô aplica a decisão ao lançar — ver pendenciasParaLancar). */
export const itemAssociado = (it: ItemNotaSefaz): boolean => !itemSemProduto(it)
/** A escolha que o Ivan CONFIRMOU no app para este item (pelo número do item na NF), ou null. Só existe para item que ainda não tem produto de
 *  verdade no SisChef: se ele já vem associado de lá, vale o SisChef. */
export function decisaoDoItem(n: NotaSefazLista, it: ItemNotaSefaz): AssociacaoApp | null {
  if (it.n == null || !n.associacoes_app || !itemSemProduto(it)) return null
  return n.associacoes_app[String(it.n)] ?? null
}
/** TODO item que ainda NÃO tem produto de verdade no SisChef, com o produto que o Ivan confirmou no app para ele (se confirmou). `codigo`/`nome`
 *  nulos = ainda sem escolha no app. Era a lista do "associe no SisChef" da etapa 1; a tela da etapa 2 usa pendenciasParaLancar (o que ainda trava) e
 *  associacoesPeloRobo (o que o robô vai aplicar) e não a chama mais. Fica como regra pura (com teste): é a lista de quem prefere o caminho de
 *  associar direto no SisChef, se a tela voltar a querer mostrá-la. */
export interface PendenciaSischef { descricao: string; codigo: number | null; nome: string | null }
export function pendenciasNoSischef(n: NotaSefazLista): PendenciaSischef[] {
  return n.itens.filter(itemSemProduto).map((it) => {
    const d = decisaoDoItem(n, it)
    return { descricao: it.descricao ?? 'item', codigo: d?.produto_id ?? null, nome: d?.produto_nome ?? null }
  })
}

// ---------- item que JÁ vem associado no SisChef, mas com "UN DIFERE" (nota em UN, cadastro em KG, sem conversão registrada)
/** CÓD. FOR do item como o SisChef o mostra na descrição ("CÓD. FOR: 376611 CREME DE LEITE…" → "376611"); null quando não dá para ler. */
export const codForDoItem = (it: ItemNotaSefaz): string | null => /^\s*C[OÓ]D\.?\s*FOR\.?:?\s*(\S+)/i.exec(it.descricao ?? '')?.[1] ?? null
/** Os CÓD. FOR que o robô disse estarem com UN DIFERE sem conversão: o motivo é "UN DIFERE sem conversão na tela: CÓD. FOR 376611; 132534 (no app, …)". */
export function codsComUnDifere(motivo: string | null | undefined): string[] {
  const m = /UN DIFERE sem convers[ãa]o na tela:\s*([^(]*)/i.exec(motivo ?? '')
  return m ? [...new Set(m[1].match(/\d{2,}/g) ?? [])] : []
}
/** O robô parou (nota em "revisar") porque ESTE item, que já vem associado do SisChef, está com UN DIFERE e ninguém informou a conversão: é o que o Ivan tem
 *  de informar no app (a caixa de conversão do item). Não trava o Lançar — ele pode também registrar a conversão direto no SisChef. */
export function itemPedeConversao(n: NotaSefazLista, it: ItemNotaSefaz): boolean {
  if (n.lancamento_estado !== 'revisar' || !itemAssociado(it)) return false
  const cod = codForDoItem(it)
  return cod != null && codsComUnDifere(n.lancamento_motivo).includes(cod)
}
/** A conversão que o Ivan JÁ informou no app para um item que vem associado do SisChef (decisão com origem "sischef"), ou null. */
export function conversaoDeItemAssociado(n: NotaSefazLista, it: ItemNotaSefaz): number | null {
  if (it.n == null || !itemAssociado(it)) return null
  const d = n.associacoes_app?.[String(it.n)]
  return d != null && (d.origem ?? '').trim().toLowerCase() === 'sischef' ? conversaoDaDecisao(d) : null
}

/** A conversão da decisão foi informada (número > 0)? A régua é a mesma da caixa de associação (associacaoRegras.conversaoDaDecisao). */
const conversaoInformada = (d: AssociacaoApp): boolean => conversaoDaDecisao(d) != null
/**
 * O que ainda FALTA na decisão do app para um item sem produto no SisChef (texto para o Ivan), ou null = decisão completa. Só trava quando a conversão
 * é OBRIGATÓRIA (situacaoConversao: nota em UN/CX/… e produto "(KG)" na lista — aí é certo que o SisChef vai pedir o fator) e ela não foi informada.
 * Nos outros casos ("opcional": produto "un", que é um chute pelo nome, ou produto novo sem unidade; "oculta": unidades iguais ou nota sem unidade) a
 * decisão está completa: o robô confere no cadastro vivo do SisChef e, se precisar da conversão, para a nota em "revisar" antes de gravar.
 */
function faltaNaDecisao(it: ItemNotaSefaz, d: AssociacaoApp | null): string | null {
  if (d == null) return it.n == null ? 'este item veio sem número na nota: associe no SisChef' : 'escolha o produto na caixa de associação'
  if (situacaoConversao(it.unidade_sischef, d.unidade) === 'obrigatoria' && !conversaoInformada(d)) {
    return `informe quanto vale 1 ${rotuloUnidade(it.unidade_sischef)} em ${rotuloUnidade(d.unidade)} na caixa de associação`
  }
  return null
}

/** A decisão do app para o item está COMPLETA (produto e, quando é certo que precisa, a conversão)? Só então o painel mostra o ✓ de "confirmado". */
export const decisaoCompleta = (it: ItemNotaSefaz, d: AssociacaoApp | null): boolean => d != null && faltaNaDecisao(it, d) == null

/** Item sem produto no SisChef cuja decisão do app está INCOMPLETA: é o que ainda TRAVA o Lançar (etapa 2). `falta` diz o que fazer no app; as unidades
 *  vêm para a tela montar o pedido de conversão. `codigo`/`nome` nulos = ainda sem produto escolhido; com produto = falta só a conversão. */
export interface PendenciaParaLancar extends PendenciaSischef { n: number | null; falta: string; unidadeNota: string | null; unidadeProduto: string | null }
export function pendenciasParaLancar(n: NotaSefazLista): PendenciaParaLancar[] {
  const pendencias: PendenciaParaLancar[] = []
  for (const it of n.itens) {
    if (!itemSemProduto(it)) continue
    const d = decisaoDoItem(n, it)
    const falta = faltaNaDecisao(it, d)
    if (falta == null) continue
    pendencias.push({
      descricao: it.descricao ?? 'item', codigo: d?.produto_id ?? null, nome: d?.produto_nome ?? null, n: it.n ?? null, falta,
      unidadeNota: it.unidade_sischef ?? null, unidadeProduto: d?.unidade ?? null,
    })
  }
  return pendencias
}

/** O que o robô vai associar na tela do SisChef ao lançar (etapa 2): item sem produto no SisChef com decisão COMPLETA do app. `conversao` = o que o
 *  robô digita no modal de conversão (null = não digita). Essa associação fica gravada no SisChef para as próximas notas do fornecedor: a tela avisa.
 *  `unidadeIncerta` = o app não tem certeza de que o robô vai conseguir associar sem parar: ou a conversão era "opcional" e ficou vazia (a unidade do
 *  produto na lista é um palpite; o robô pode parar pedindo o fator depois de olhar o cadastro vivo), ou a NOTA veio sem unidade (`unidadeNota` vazia:
 *  o robô não associa às cegas e para pedindo uma nova leitura). A decisão vale nos dois casos, mas a tela avisa ao lado do item, para o Ivan não
 *  se surpreender com um "revisar" logo depois de lançar. */
export interface AssociacaoPeloRobo {
  n: number; descricao: string; produto_id: number; produto_nome: string; conversao: number | null; unidadeNota: string | null; unidadeProduto: string | null
  unidadeIncerta: boolean
}
export function associacoesPeloRobo(n: NotaSefazLista): AssociacaoPeloRobo[] {
  const lista: AssociacaoPeloRobo[] = []
  for (const it of n.itens) {
    if (!itemSemProduto(it) || it.n == null) continue
    const d = decisaoDoItem(n, it)
    if (d == null || faltaNaDecisao(it, d) != null) continue
    const conversao = conversaoDaDecisao(d)
    lista.push({
      n: it.n, descricao: it.descricao ?? 'item', produto_id: d.produto_id, produto_nome: d.produto_nome,
      conversao, unidadeNota: it.unidade_sischef ?? null, unidadeProduto: d.unidade ?? null,
      // sem conversão informada, a dúvida existe quando o app só desconfia das unidades (não "oculta") OU quando a nota nem trouxe a unidade
      unidadeIncerta: conversao == null && (rotuloUnidade(it.unidade_sischef) === '' || situacaoConversao(it.unidade_sischef, d.unidade) !== 'oculta'),
    })
  }
  return lista
}

/** Bloqueio que só diz "falta produto (ou conversão) no app/SisChef": a nota ainda NÃO pode ser lançada, mas dá para preparar o resto (forma de
 *  pagamento e parcelas). */
export const bloqueioDeProduto = (b: string): boolean => b === AVISO_ITEM_SEM_PRODUTO || b === AVISO_FALTA_CONVERSAO
const contaEspecial = (emitente: string): boolean => /KONDO|MERCADO\s+LIVRE/.test(emitente.toUpperCase())

/** Motivos (em português) pelos quais esta nota NÃO pode ser lançada pelo app; lista vazia = pode. Item sem produto no SisChef só conta enquanto a
 *  decisão do app para ele está incompleta (pendenciasParaLancar): com todas completas, o robô associa ao lançar. */
export function bloqueiosDaNota(n: NotaSefazLista): string[] {
  const b: string[] = []
  if (contaEspecial(n.emitente)) b.push(AVISO_CONTA_ESPECIAL)
  if (n.itens.length === 0) b.push(AVISO_SEM_ITENS)
  const pendencias = pendenciasParaLancar(n)
  if (pendencias.length > 0) b.push(pendencias.every((p) => p.codigo != null) ? AVISO_FALTA_CONVERSAO : AVISO_ITEM_SEM_PRODUTO)
  return b
}

// ---------- descartar nota que não dá para lançar (regra 3 do Ivan)
/** Início do motivo guardado quando a nota foi descartada por não ter itens (a lista de descartadas o reconhece por ele). */
export const MOTIVO_SEM_ITENS = 'Sem itens (XML resumido)'

/**
 * Regra 3 do Ivan (06/10): nota que NÃO dá para lançar do jeito que está — o app a trava (sem itens/"XML resumido", item sem produto,
 * conta especial) ou o robô parou nela ('revisar') — pode ser DESCARTADA: sai da lista e o robô nunca a lança; nada muda no SisChef nem
 * na SEFAZ e dá para desfazer. Nunca a pela metade ('erro': o pedido já existe no SisChef, a nota fica à vista até alguém conferir) nem a
 * que o robô está lançando agora. O banco confere tudo de novo (cot_nfe_descartar).
 */
export function podeDescartar(n: NotaSefazLista): boolean {
  const estado = n.lancamento_estado ?? null
  if (estado === 'erro') return false
  if (estado === 'lancando' && !lancandoPresa(n)) return false
  return bloqueiosDaNota(n).length > 0 || estado === 'revisar'
}

/** Por que a nota está sendo descartada (guardado na nota, até 300 letras): o(s) motivo(s) pelos quais ela não dá para lançar. */
export function motivoDoDescarte(n: NotaSefazLista): string {
  const partes: string[] = []
  if (n.itens.length === 0) partes.push(MOTIVO_SEM_ITENS)
  // o motivo gravado diz o que de fato travou: item ainda sem produto escolhido, ou produto já confirmado no app ao qual só faltava a conversão
  const pendencias = pendenciasParaLancar(n)
  if (pendencias.some((p) => p.codigo == null)) partes.push('Item sem produto no SisChef')
  if (pendencias.some((p) => p.codigo != null)) partes.push('Item confirmado no app sem a conversão de unidade')
  if (contaEspecial(n.emitente)) partes.push('Conta especial')
  if (n.lancamento_estado === 'revisar') partes.push(`O robô parou: ${traduzirMotivo(n.lancamento_motivo) || 'confira a nota'}`)
  return partes.join('; ').slice(0, 300)
}

/** Nota descartada por não ter itens que AGORA veio com itens (o XML completo chegou): vale avisar o Ivan para ele reconsiderar. */
export const descartadaVoltouComItens = (n: NotaSefazLista): boolean =>
  (n.descartada_motivo ?? '').startsWith(MOTIVO_SEM_ITENS) && n.itens.length > 0

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

/**
 * Nota COM FRETE que o robô deixou de propósito com o pedido aberto no SisChef (desfecho FRETE_ABERTO, 10/10/2026): o estado vem como 'erro' (a aba não deixa lançar de
 * novo), mas NÃO é falha — falta o funcionário lançar o boleto do frete e finalizar a compra no SisChef. O motivo do robô traz "aberto na tela de pagamento com o frete".
 */
export const freteAberto = (estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined): boolean =>
  estado === 'erro' && /aberto na tela de pagamento com o frete|parou de propósito \(frete\)/i.test(motivo ?? '')
export const TEXTO_FRETE_ABERTO = 'Nota com frete parada de propósito no SisChef (compra finalizada, nota fiscal ainda não finalizada): falta conferir os boletos e finalizar a nota lá (não lance de novo aqui)'

/** Texto do estado da nota (null = nunca disparada). */
export function textoDoEstado(estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined): string | null {
  const m = traduzirMotivo(motivo)
  if (freteAberto(estado, motivo)) return TEXTO_FRETE_ABERTO
  switch (estado) {
    case 'lancando': return 'Lançando… (o robô está trabalhando)'
    case 'revisar': return m ? `Precisa de você: ${m}` : 'Precisa de você: confira a nota'
    case 'erro': return 'Ficou pela metade — NÃO lance de novo (chame o Ivan/confira no SisChef)'
    case 'ensaio_ok': return m ? `Ensaio ok (nada foi criado): ${m}` : 'Ensaio ok (nada foi criado)'
    default: return null
  }
}

// ---------- nota "pronta" (regra 2 do Ivan) e conferência do financeiro
/**
 * Diferença aceita entre a soma dos boletos e o valor da nota (R$): NENHUMA. Regra 4 do Ivan (06/10): o que importa é o total lançado ser igual ao
 * total da nota; as parcelas podem ser iguais ou diferentes, mas a soma tem de bater ao centavo. É a mesma exigência do robô (TOL_TOTAL = 0,005
 * sobre valores de 2 casas): se o app aceitasse 1 centavo de diferença, o robô pararia a nota depois do disparo.
 */
export const TOLERANCIA_FINANCEIRO = 0
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

export interface ProntidaoNota {
  pronta: boolean
  motivos: string[]
  /** O motivo ligado ao financeiro (boletos), ou null: a tela mostra só este, os de item/conta já têm aviso próprio. */
  financeiro: string | null
}

/**
 * Regra 2 do Ivan: a nota está "pronta" (só falta lançar) quando TODOS os itens estão associados no SisChef — ou, desde a etapa 2, têm decisão
 * completa do app, que o robô aplica ao lançar —, o pagamento é em boleto (a nota tem duplicatas) e os boletos fecham com o valor da nota.
 * Qualquer coisa fora disso vira motivo, em português, e a nota segue o fluxo normal (conferir e escolher como pagar). Nota bloqueada, lançando
 * ou pela metade nunca é "pronta".
 */
export function prontidaoDaNota(n: NotaSefazLista): ProntidaoNota {
  const motivos: string[] = []
  if (n.itens.length === 0) motivos.push('A nota chegou sem itens')
  const pendencias = pendenciasParaLancar(n)
  const semProduto = pendencias.filter((p) => p.codigo == null).length
  const semConversao = pendencias.length - semProduto
  if (semProduto > 0) motivos.push(semProduto === 1 ? '1 item sem produto no SisChef' : `${semProduto} itens sem produto no SisChef`)
  if (semConversao > 0) {
    motivos.push(semConversao === 1
      ? '1 item confirmado no app sem a conversão de unidade'
      : `${semConversao} itens confirmados no app sem a conversão de unidade`)
  }
  const f = resumoFinanceiro(n)
  let financeiro: string | null = null
  // Regra do Ivan (07/10): com o XML por ler, o que ele digitar no app vale — a nota segue NÃO pronta (não há boleto conferido), mas a tela abre o editor.
  if (!f.lido) financeiro = 'Boletos ainda não lidos do XML: se for boleto, digite as parcelas (o que você digitar vale; se o XML trouxer boletos, eles prevalecem e o robô avisa)'
  else if (f.parcelas.length === 0) financeiro = 'O XML da nota não traz boletos: digite as parcelas ou escolha outra forma de pagamento'
  else if (!f.bate) financeiro = 'Os boletos não fecham com o valor da nota'
  if (financeiro) motivos.push(financeiro)
  if (contaEspecial(n.emitente)) motivos.push(AVISO_CONTA_ESPECIAL)
  if (freteAberto(n.lancamento_estado, n.lancamento_motivo)) motivos.push('Pedido aberto no SisChef com o frete: falta o boleto do frete e finalizar a compra lá')
  else if (n.lancamento_estado === 'erro') motivos.push('Ficou pela metade: não lance de novo')
  if (n.lancamento_estado === 'revisar' && n.lancamento_motivo) motivos.push(`Precisa de você: ${traduzirMotivo(n.lancamento_motivo)}`)
  return { pronta: motivos.length === 0, motivos, financeiro }
}

/** O fornecedor já "aprendeu"? (NOTAS_PARA_APRENDER ou mais notas seguidas lançadas em boleto.) */
export function fornecedorAprendido(n: NotaSefazLista, seguidas: Record<string, number> | undefined): number {
  const c = n.cnpj_emitente ? seguidas?.[n.cnpj_emitente] ?? 0 : 0
  return c >= NOTAS_PARA_APRENDER ? c : 0
}

// ---------- parcelas DIGITADAS pelo Ivan (boleto cujo XML não traz as duplicatas)
/**
 * REGRA PROVISÓRIA (Ivan, 06/10/2026): fornecedores cujo XML vem SEM a forma de pagamento e sem duplicatas (falha DELES). A forma
 * real é decidida pelo Ivan em cada nota (boleto, cartão de crédito, outras): nunca assumir. Quando o fornecedor corrigir o XML o
 * Ivan avisa e o fornecedor sai desta lista. Chave = CNPJ (14 dígitos, sem pontuação).
 */
export const FORNECEDORES_XML_SEM_PAGAMENTO: Record<string, string> = { '03995515011363': 'MATEUS SUPERMERCADOS' }

/** Linha do editor: vencimento (aaaa-mm-dd, do campo de data) e valor como foi digitado (pt-BR). */
export interface LinhaParcela { vencimento: string; valor: string }

/** "1.234,56" / "1234,5" / "R$ 100" -> 1234.56 / 1234.5 / 100; texto fora do formato, zero ou negativo -> null. */
export function parseValorBr(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, '')
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null
}
export const formatarValorBr = (v: number): string => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Divide o valor da nota em `n` parcelas IGUAIS ao centavo, com o centavo que sobra na ÚLTIMA — para a soma fechar com a nota (regra 4 do Ivan). R$ 1.794,49 em 3
 * não dá 3 valores iguais (598,16 × 3 = 1.794,48): fica 598,16 + 598,16 + 598,17. Devolve os valores no formato da tela ("598,16"), ou null se não dá para dividir.
 */
export function dividirEmParcelas(valorNota: number | null, n: number): string[] | null {
  if (valorNota == null || !Number.isInteger(n) || n < 1 || n > 60) return null
  const total = Math.round(valorNota * 100)
  const base = Math.floor(total / n)
  if (!(total > 0) || base <= 0) return null
  const resto = total - base * n
  return Array.from({ length: n }, (_, i) => formatarValorBr((i === n - 1 ? base + resto : base) / 100))
}

/**
 * O editor de parcelas aparece quando a forma é Boleto e o XML NÃO traz boletos que valham: ou o XML ainda não foi lido (parcelas null)
 * ou foi lido e veio sem duplicatas (parcelas []). Regra do Ivan (07/10/2026): "Quando não vier informando nada na nota, o que vai prevalecer
 * é o que eu determinar dentro do app. Se eu determinar que essa compra foi feita via boleto, eu vou clicar no botão boleto e você vai me
 * abrir as opções de eu botar a quantidade de parcelas, data do vencimento e o valor, e eu vou confirmar para lançar." Antes o editor só
 * abria com o XML lido e vazio; com o XML por ler o Ivan ficava esperando a próxima leitura sem poder fazer nada. Se a leitura trouxer
 * boletos de verdade (array com itens), eles prevalecem: o editor não abre, e o robô para em "revisar" se receber parcelas digitadas.
 */
export const precisaDigitarParcelas = (n: NotaSefazLista, forma: string): boolean =>
  forma === 'boleto' && (n.parcelas == null || (Array.isArray(n.parcelas) && n.parcelas.length === 0))

/** Linhas que o editor mostra ao abrir: o que já foi digitado (nota que voltou do robô) ou uma linha em branco. */
export function linhasIniciais(n: NotaSefazLista): LinhaParcela[] {
  const antigas = n.parcelas_manuais ?? []
  return antigas.length > 0
    ? antigas.map((p) => ({ vencimento: p.vencimento, valor: formatarValorBr(p.valor) }))
    : [{ vencimento: '', valor: '' }]
}

// ---------- rascunho das parcelas (no aparelho)
// O Ivan pode digitar as parcelas ANTES de o Lançar liberar (a nota ainda espera produto no SisChef) e a página pode ser recarregada no meio
// (a leitura do SisChef é atualizada, ele fecha o app...): sem rascunho, o que ele digitou se perdia. Fica só neste aparelho, por nota.
const chaveRascunho = (chave: string): string => `spazio.notaSefaz.parcelas.${chave}`
const rascunhoVazio = (ls: LinhaParcela[]): boolean => ls.every((l) => l.vencimento.trim() === '' && l.valor.trim() === '')

/** O que o Ivan já digitou nesta nota, ou null (nada guardado, ou o que estava guardado não presta). */
export function rascunhoDasParcelas(chave: string): LinhaParcela[] | null {
  try {
    const bruto = localStorage.getItem(chaveRascunho(chave))
    if (!bruto) return null
    const x: unknown = JSON.parse(bruto)
    if (!Array.isArray(x) || x.length < 1 || x.length > 60) return null
    const linhas: LinhaParcela[] = []
    for (const l of x) {
      const { vencimento, valor } = (l ?? {}) as Record<string, unknown>
      if (typeof vencimento !== 'string' || typeof valor !== 'string' || vencimento.length > 10 || valor.length > 20) return null
      linhas.push({ vencimento, valor })
    }
    return rascunhoVazio(linhas) ? null : linhas
  } catch { return null }
}
/** Guarda o que está no editor (editor em branco = apaga o rascunho). */
export function guardarRascunhoDasParcelas(chave: string, linhas: LinhaParcela[]): void {
  try {
    if (rascunhoVazio(linhas)) localStorage.removeItem(chaveRascunho(chave))
    else localStorage.setItem(chaveRascunho(chave), JSON.stringify(linhas.map((l) => ({ vencimento: l.vencimento, valor: l.valor }))))
  } catch { /* sem armazenamento: segue sem rascunho */ }
}
export function limparRascunhoDasParcelas(chave: string): void {
  try { localStorage.removeItem(chaveRascunho(chave)) } catch { /* idem */ }
}

export interface ResultadoParcelas {
  ok: boolean
  /** Por que ainda não dá para lançar (vazio quando ok). */
  motivo: string
  /** As parcelas válidas, no formato que a Edge Function recebe (só confiáveis quando ok). */
  parcelas: ParcelaDigitada[]
  /** Soma das linhas já válidas, em reais. */
  soma: number
  /** valor da nota - soma (positivo = falta, negativo = passou), em reais; null sem valor da nota. */
  falta: number | null
}

const dataValida = (iso: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Confere o que o Ivan digitou: cada linha com vencimento e valor, vencimento não anterior à emissão e soma IGUAL ao valor da nota, ao centavo
 * (regra 4 do Ivan). Os valores das parcelas podem ser iguais ou diferentes: só a soma importa.
 */
export function validarParcelasDigitadas(todasAsLinhas: LinhaParcela[], valorNota: number | null, emissao: string): ResultadoParcelas {
  // Linha COMPLETAMENTE em branco (sem data e sem valor) é só uma linha aberta e não conta — não trava o Lançar (07/10, pedido do Ivan: o que ele digita é o que vale).
  // Linha pela metade (só a data, ou só o valor) continua travando, com o número da linha. Se TODAS estão em branco, vale a regra de sempre (pede a parcela 1).
  const emBranco = (l: LinhaParcela): boolean => l.vencimento.trim() === '' && l.valor.trim() === ''
  const algumaPreenchida = todasAsLinhas.some((l) => !emBranco(l))
  const comNumero = todasAsLinhas.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !algumaPreenchida || !emBranco(l))
  const linhas = comNumero.map(({ l }) => l)
  const parcelas: ParcelaDigitada[] = []
  let motivo = ''
  comNumero.forEach(({ l, n }) => {
    const valor = parseValorBr(l.valor)
    if (valor != null) parcelas.push({ vencimento: l.vencimento, valor })
    if (motivo) return
    if (!dataValida(l.vencimento)) motivo = `Parcela ${n}: informe o vencimento`
    else if (emissao && l.vencimento < emissao) motivo = `Parcela ${n}: o vencimento é anterior à emissão da nota`
    else if (valor == null) motivo = `Parcela ${n}: informe o valor (ex.: 1.234,56)`
  })
  const cents = parcelas.reduce((t, p) => t + Math.round(p.valor * 100), 0)
  const soma = cents / 100
  const falta = valorNota == null ? null : Math.round(Math.round(valorNota * 100) - cents) / 100
  if (linhas.length === 0) motivo = 'Digite ao menos uma parcela'
  if (!motivo && falta == null) motivo = 'A nota está sem valor para conferir as parcelas'
  if (!motivo && falta != null && falta !== 0) {
    motivo = falta > 0 ? `Faltam ${formatarValorBr(falta)} para fechar com o valor da nota` : `Passou ${formatarValorBr(-falta)} do valor da nota`
  }
  const todasValidas = parcelas.length === linhas.length && linhas.every((l) => dataValida(l.vencimento))
  return { ok: motivo === '' && todasValidas, motivo, parcelas, soma, falta }
}

// ---------- pagamento SEMANAL na quarta (MAUES): o app mostra a quarta e a data pode ser editada
/**
 * Fornecedores que pagam a compra da SEMANA (domingo a sábado) numa única QUARTA-FEIRA, a seguinte ao sábado (regra do Ivan, 30/09/2026).
 * É o mesmo conjunto do robô (motor_logica.CNPJS_PAGAMENTO_SEMANAL_QUARTA) e da Edge Function lancar-nfe. Chave = CNPJ (14 dígitos).
 */
export const CNPJS_PAGAMENTO_SEMANAL_QUARTA: Record<string, string> = { '37638932000174': 'MAUES FOOD BRASIL' }

const DIA_MS = 86_400_000
const somarDias = (d: Date, dias: number): string => new Date(d.getTime() + dias * DIA_MS).toISOString().slice(0, 10)

/** O domingo e o sábado (aaaa-mm-dd) da semana da emissão, ou null se a data não existe. */
export function semanaDaCompra(emissao: string): { inicio: string; fim: string } | null {
  if (!dataValida(emissao)) return null
  const d = new Date(`${emissao}T00:00:00Z`)
  const dia = d.getUTCDay() // 0 = domingo … 6 = sábado
  return { inicio: somarDias(d, -dia), fim: somarDias(d, 6 - dia) }
}

/** A quarta-feira seguinte ao sábado da semana da emissão (aaaa-mm-dd) — a mesma conta do robô (quarta_do_pagamento); null se a data não existe. */
export function quartaDoPagamento(emissao: string): string | null {
  const s = semanaDaCompra(emissao)
  return s ? somarDias(new Date(`${s.fim}T00:00:00Z`), 4) : null
}

/** MAUES com os boletos já lidos do XML (e a emissão válida): a data de vencimento vale a quarta, e o Ivan pode editá-la. */
export const ehPagamentoSemanal = (n: NotaSefazLista): boolean =>
  !!n.cnpj_emitente && n.cnpj_emitente in CNPJS_PAGAMENTO_SEMANAL_QUARTA && Array.isArray(n.parcelas) && n.parcelas.length > 0 &&
  quartaDoPagamento(n.emissao) != null

export interface ParcelaSemanal {
  /** O vencimento que vale (a quarta, ou a data que o Ivan editou), aaaa-mm-dd. */
  vencimento: string
  valor: number
  /** O que o XML trouxe (a data do boleto), só para mostrar. */
  vencimentoXml: string | null
  /** O Ivan mudou a data (ela não é a quarta da regra). */
  editada: boolean
}
export interface PlanoSemanal {
  quarta: string
  semana: { inicio: string; fim: string }
  parcelas: ParcelaSemanal[]
  /** Pode lançar: datas válidas, não anteriores à emissão, e os boletos do XML fecham com o valor da nota. */
  ok: boolean
  motivo: string
}

/**
 * Plano de pagamento da MAUES: um boleto do XML por parcela (valor e quantidade são os do XML), cada um vencendo na quarta da regra ou na data
 * que o Ivan editou (`editadas[i]`; vazio = a quarta). Null quando a nota não é pagamento semanal.
 */
export function planoSemanal(n: NotaSefazLista, editadas: string[]): PlanoSemanal | null {
  if (!ehPagamentoSemanal(n)) return null
  const quarta = quartaDoPagamento(n.emissao) as string
  const semana = semanaDaCompra(n.emissao) as { inicio: string; fim: string }
  const parcelas: ParcelaSemanal[] = (n.parcelas as ParcelaNota[]).map((p, i) => {
    const vencimento = (editadas[i] ?? '').trim() || quarta
    return { vencimento, valor: p.valor, vencimentoXml: p.vencimento ?? null, editada: vencimento !== quarta }
  })
  let motivo = ''
  parcelas.forEach((p, i) => {
    if (motivo) return
    if (!dataValida(p.vencimento)) motivo = `Parcela ${i + 1}: informe uma data de vencimento válida`
    else if (n.emissao && p.vencimento < n.emissao) motivo = `Parcela ${i + 1}: o vencimento é anterior à emissão da nota`
  })
  if (!motivo && !resumoFinanceiro(n).bate) motivo = 'Os boletos do XML não fecham com o valor da nota'
  return { quarta, semana, parcelas, ok: motivo === '', motivo }
}
