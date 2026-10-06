// supabase/functions/lancar-nfe/logica.ts
// Lógica pura da Edge Function lancar-nfe (Fase 3, aba "Lançamento de nota SEFAZ"). Sem globais do Deno nem rede: o
// banco e o GitHub entram por `deps` (molde enviar-cupom). index.ts monta `deps` e chama `tratar`.
//
// O "Lançar" de UMA nota: autoriza o admin, confere a forma de pagamento escolhida ("como pagar"), RESERVA a nota num
// compara-e-troca (só uma nota 'na_fila' livre, ou cuja tentativa anterior acabou SEM pedido — 'revisar'/'ensaio_ok' —,
// ou que ficou presa em 'lancando' há mais de 30 min; 'erro' = pedido pela metade NUNCA é reservado), grava a forma
// junto e dispara o lancar-nfe.yml do robô com a nota pronta (nota_json) em modo 'real'. Quem decide se é real de
// verdade é a trava MOTOR_NFE_LIGADO do robô: desligada, ele roda em ensaio e não cria nada. Se o disparo falhar, a
// reserva é solta (a nota volta a ficar disponível).

export interface Corpo { chave?: unknown; forma?: unknown; parcelas?: unknown }
/** Parcela digitada pelo Ivan quando o XML não traz as duplicatas (falha do fornecedor, ex.: MATEUS). */
export interface ParcelaManual { vencimento: string; valor: number }
export interface UsuarioLinha { papel: string; ativo: boolean }
export interface ItemNota {
  descricao?: string | null
  produto_id?: string | number | null
  associacao?: string | null
  qtd?: number | null
  unidade_sischef?: string | null
}
export interface NotaReservada {
  chave: string
  emitente: string
  numero: string
  emissao: string
  valor_nf: number | string | null
  forma_pagamento: string
  itens: ItemNota[] | null
  /** O que o Ivan digitou (gravado na reserva); null = nada digitado. */
  parcelas_manuais?: ParcelaManual[] | null
}
/** O que a função precisa saber da nota ANTES de reservar, para conferir as parcelas digitadas. */
export interface NotaParaParcelas { valor_nf: number | string | null; parcelas: unknown }

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  /** Reserva atômica (um UPDATE só, com as condições de `filtroReservavel`): a nota reservada, ou null se indisponível. */
  reservar(chave: string, forma: string, agoraIso: string, limiteIso: string, parcelasManuais: ParcelaManual[] | null): Promise<NotaReservada | null>
  /** Valor da nota e boletos do XML (cot_nfe.parcelas), ou null se a nota não existe. */
  notaParaParcelas(chave: string): Promise<NotaParaParcelas | null>
  /** Há OUTRA nota (chave diferente) 'lancando' desde `limiteIso` ou depois? O GitHub guarda só UM run pendente por grupo
   *  (sischef-session): um 2º disparo cancelaria o pendente e a nota reservada ficaria presa em 'lancando'. Um robô por vez. */
  outraLancando(chave: string, limiteIso: string): Promise<boolean>
  /** Desfaz a reserva (o disparo falhou): a nota volta a ficar disponível. */
  soltar(chave: string): Promise<void>
  /** workflow_dispatch do lancar-nfe.yml com {nota_json, modo: 'real'}. */
  disparar(notaJson: string): Promise<void>
  agora(): Date
}

export interface Resultado { status: number; corpo: Record<string, unknown> }

/** As contas PIX válidas (= cupom_formas_pagamento.MAPA_PIX do robô; o app as mostra em src/cupom/formasPagamento.ts). */
export const CONTAS_PIX = ['pangbank|ij', 'pangbank|sp', 'bradesco|ij', 'bradesco|sp', 'itau|ij', 'caixa|ij', 'caixa|sp']
/** Uma tentativa 'lancando' mais velha que isto é dada como presa (o run caiu/foi cancelado) e pode ser reservada. */
export const MINUTOS_TRAVA = 30
const RE_CHAVE = /^\d{44}$/

export const MAX_PARCELAS_MANUAIS = 60
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/

/** Parcelas digitadas no app -> lista normalizada (valor em centavos exatos), ou null se algo estiver fora do formato. */
export function normalizarParcelas(x: unknown): ParcelaManual[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_PARCELAS_MANUAIS) return null
  const saida: ParcelaManual[] = []
  for (const p of x) {
    if (p === null || typeof p !== 'object') return null
    const { vencimento, valor } = p as Record<string, unknown>
    if (typeof vencimento !== 'string' || !RE_DATA.test(vencimento)) return null
    const d = new Date(`${vencimento}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== vencimento) return null // 2026-02-30 não existe
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > 10_000_000) return null
    const centavos = Math.round(valor * 100)
    if (Math.abs(valor * 100 - centavos) > 1e-6) return null // no máximo 2 casas
    saida.push({ vencimento, valor: centavos / 100 })
  }
  return saida
}

/** Soma em centavos (sem erro de ponto flutuante), em reais. */
export const somaParcelas = (ps: ParcelaManual[]): number => ps.reduce((t, p) => t + Math.round(p.valor * 100), 0) / 100

/** "Como pagar" do app -> a forma no formato do robô (formas_pagamento.py), ou null se inválida. */
export function normalizarForma(forma: unknown): string | null {
  if (typeof forma !== 'string') return null
  const f = forma.trim().toLowerCase()
  if (['boleto', 'dinheiro', 'tesouraria', 'cartao'].includes(f)) return f
  const m = /^pix:\s*([a-z]+)\|([a-z]+)$/.exec(f)
  if (m && CONTAS_PIX.includes(`${m[1]}|${m[2]}`)) return `pix:${m[1]}|${m[2]}`
  return null
}

/**
 * Filtro `or` do PostgREST das notas que podem ser reservadas (junto com chave = X e situacao = 'na_fila'): estado vazio,
 * 'revisar' ou 'ensaio_ok' (a tentativa anterior não gerou pedido), ou 'lancando' preso desde antes de `limiteIso`.
 * 'erro' (pedido pela metade) fica de fora de propósito. O carimbo vai entre aspas: ':' e '.' são reservados no filtro.
 */
export function filtroReservavel(limiteIso: string): string {
  return `lancamento_estado.is.null,lancamento_estado.in.(revisar,ensaio_ok),` +
    `and(lancamento_estado.eq.lancando,lancamento_em.lt."${limiteIso}")`
}

/** A nota pronta para o robô (o `nota_json` do workflow): só o que o lancar_nfe_nuvem.py usa. */
export function montarNotaJson(n: NotaReservada): string {
  return JSON.stringify({
    chave: n.chave, emitente: n.emitente, numero: n.numero, emissao: n.emissao, valor_nf: n.valor_nf,
    forma_pagamento: n.forma_pagamento,
    ...(n.parcelas_manuais && n.parcelas_manuais.length > 0 ? { parcelas_manuais: n.parcelas_manuais } : {}),
    itens: (n.itens ?? []).map((it) => ({
      descricao: it.descricao ?? null, produto_id: it.produto_id ?? null, associacao: it.associacao ?? null,
      qtd: it.qtd ?? null, unidade_sischef: it.unidade_sischef ?? null,
    })),
  })
}

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  // 1. autoriza (admin ativo) — a RLS é a trava real da leitura; isto é defesa em profundidade, como enviar-cupom.
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  // 2. valida a entrada.
  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const chave = typeof c.chave === 'string' ? c.chave.trim() : ''
  if (!RE_CHAVE.test(chave)) return { status: 400, corpo: { erro: 'chave da nota inválida' } }
  const forma = normalizarForma(c.forma)
  if (!forma) return { status: 400, corpo: { erro: 'escolha como pagar (forma de pagamento inválida)' } }
  // Parcelas digitadas (boleto sem duplicatas no XML — falha do fornecedor): só para boleto, no formato certo, só se o XML
  // da nota NÃO traz boletos e se a soma fecha com o valor da nota. O robô repete a conta contra o vNF do XML antes de lançar.
  let manuais: ParcelaManual[] | null = null
  if (c.parcelas !== undefined && c.parcelas !== null) {
    if (forma !== 'boleto') return { status: 400, corpo: { erro: 'parcelas digitadas só valem para boleto' } }
    manuais = normalizarParcelas(c.parcelas)
    if (!manuais) return { status: 400, corpo: { erro: 'parcelas digitadas inválidas: confira o vencimento e o valor de cada uma' } }
    const n = await deps.notaParaParcelas(chave)
    if (n) {
      if (!Array.isArray(n.parcelas) || n.parcelas.length > 0) {
        return { status: 400, corpo: { erro: 'esta nota já tem boletos no XML (ou o XML ainda não foi lido): as parcelas digitadas não se aplicam' } }
      }
      const total = Number(n.valor_nf)
      // Regra 4 do Ivan: a soma das parcelas tem de ser IGUAL ao valor da nota, ao centavo (parcelas iguais ou diferentes: tanto faz). Em centavos
      // inteiros (sem erro de ponto flutuante). É a mesma exigência do robô (TOL_TOTAL = 0,005): com tolerância aqui, a nota pararia no robô.
      if (!Number.isFinite(total) || Math.round(somaParcelas(manuais) * 100) !== Math.round(total * 100)) {
        return { status: 400, corpo: { erro: 'as parcelas digitadas não fecham com o valor da nota' } }
      }
    }
  }

  // 3. reserva (compara-e-troca): duplo toque / dois aparelhos / nota pela metade não disparam de novo.
  const agora = deps.agora()
  const limite = new Date(agora.getTime() - MINUTOS_TRAVA * 60_000)
  // Um robô por vez: com outra nota ainda lançando (há menos de 30 min) este disparo cancelaria o run pendente e deixaria uma
  // nota reservada à toa. Recusa ANTES de reservar; a tela mostra o aviso e o Ivan lança esta quando a outra terminar.
  if (await deps.outraLancando(chave, limite.toISOString())) {
    return { status: 409, corpo: { erro: 'o robô está lançando outra nota: aguarde ela terminar e lance esta em seguida' } }
  }
  const nota = await deps.reservar(chave, forma, agora.toISOString(), limite.toISOString(), manuais)
  if (!nota) {
    return { status: 409, corpo: { erro: 'esta nota não está disponível para lançar agora (já lançada, lançando, pela metade ou descartada)' } }
  }

  // 4. dispara o robô; se não der, solta a reserva (senão a nota ficaria 'lançando' à toa por 30 min).
  try {
    await deps.disparar(montarNotaJson(nota))
  } catch {
    await deps.soltar(chave).catch(() => undefined)
    return { status: 502, corpo: { erro: 'não consegui chamar o robô agora — tente de novo em instantes' } }
  }
  return { status: 202, corpo: { ok: true, chave, forma } }
}
