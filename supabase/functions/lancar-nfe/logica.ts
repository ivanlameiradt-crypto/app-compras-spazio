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

export interface Corpo { chave?: unknown; forma?: unknown }
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
}

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  /** Reserva atômica (um UPDATE só, com as condições de `filtroReservavel`): a nota reservada, ou null se indisponível. */
  reservar(chave: string, forma: string, agoraIso: string, limiteIso: string): Promise<NotaReservada | null>
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

  // 3. reserva (compara-e-troca): duplo toque / dois aparelhos / nota pela metade não disparam de novo.
  const agora = deps.agora()
  const limite = new Date(agora.getTime() - MINUTOS_TRAVA * 60_000)
  const nota = await deps.reservar(chave, forma, agora.toISOString(), limite.toISOString())
  if (!nota) {
    return { status: 409, corpo: { erro: 'esta nota não está disponível para lançar agora (já lançada, lançando ou pela metade)' } }
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
