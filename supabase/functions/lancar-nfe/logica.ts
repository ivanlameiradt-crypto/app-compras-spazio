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
//
// Etapa 2 ("confirmou no app → pode lançar"): a nota vai ao robô com `associacoes_app` (a decisão do Ivan para item sem produto
// no SisChef, por nº do item) e cada item com o seu `n`. É o ROBÔ quem aplica a associação na tela do SisChef (e ignora a decisão
// de item que já tem produto); aqui só se repassa o que está no banco, sem filtrar.
//
// Parcelas digitadas (regra do Ivan de 07/10): "quando não vier informando nada na nota, o que prevalece é o que eu determinar
// dentro do app". Com boleto, o Ivan digita quantidade de parcelas, vencimento e valor, e a função aceita essas parcelas tanto
// quando o XML já foi lido e NÃO traz boletos (cot_nfe.parcelas = []) quanto quando o XML ainda NÃO foi lido (parcelas = null).
// Só recusa quando o XML JÁ traz boletos (lista não vazia): aí os boletos do XML prevalecem. A soma das digitadas tem de fechar
// com o valor da nota ao centavo, sempre.

export interface Corpo { chave?: unknown; forma?: unknown; parcelas?: unknown; acao?: unknown }
/** Parcela digitada pelo Ivan quando o XML não traz as duplicatas (falha do fornecedor, ex.: MATEUS) ou ainda não foi lido. */
export interface ParcelaManual { vencimento: string; valor: number }
export interface UsuarioLinha { papel: string; ativo: boolean }
export interface ItemNota {
  /** Número do item na NF (1, 2, 3…), gravado pela sincronização: é por ele que a decisão do app (associacoes_app) liga ao item. */
  n?: number | null
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
  /** Decisões do Ivan no app para itens sem produto no SisChef, por nº do item ("1", "2"…): { produto_id, produto_nome, unidade,
   *  conversao, origem, por, em } (migração 20261210000001; a conversão é da etapa 2). Vai inteira ao robô, como veio do banco;
   *  null/ausente = nenhuma decisão. */
  associacoes_app?: Record<string, unknown> | null
}
/** O que a função precisa saber da nota ANTES de reservar, para conferir as parcelas digitadas. */
export interface NotaParaParcelas { valor_nf: number | string | null; parcelas: unknown; cnpj_emitente?: string | null }

/**
 * Fornecedores que pagam a compra da SEMANA numa única quarta-feira (= CNPJS_PAGAMENTO_SEMANAL_QUARTA do robô). Para eles o app mostra a
 * quarta e o Ivan pode editar a DATA, mesmo com boletos no XML (pedido de 07/10): quantidade e valores seguem o XML. CNPJ só com dígitos.
 */
export const CNPJS_PAGAMENTO_SEMANAL_QUARTA = ['37638932000174'] // MAUES FOOD BRASIL

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

/**
 * A nota pronta para o robô (o `nota_json` do workflow): só o que o lancar_nfe_nuvem.py usa.
 * Etapa 2: vão também `associacoes_app` (o objeto inteiro, ou null) e o `n` de cada item (ou null quando a cot_nfe não o traz): é por
 * `associacoes_app[str(n)]` que o robô acha a decisão do app e associa o produto na tela do SisChef antes de importar. Nada é filtrado
 * aqui de propósito: o robô é fail-closed e ignora a decisão de item que já tem produto no SisChef (nunca sobrepõe), então repassar
 * tudo é seguro e deixa as travas num lugar só. Sem decisão, `associacoes_app: null` = o comportamento de hoje.
 */
export function montarNotaJson(n: NotaReservada): string {
  return JSON.stringify({
    chave: n.chave, emitente: n.emitente, numero: n.numero, emissao: n.emissao, valor_nf: n.valor_nf,
    forma_pagamento: n.forma_pagamento,
    ...(n.parcelas_manuais && n.parcelas_manuais.length > 0 ? { parcelas_manuais: n.parcelas_manuais } : {}),
    associacoes_app: n.associacoes_app ?? null,
    itens: (n.itens ?? []).map((it) => ({
      n: it.n ?? null, descricao: it.descricao ?? null, produto_id: it.produto_id ?? null, associacao: it.associacao ?? null,
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
  // Parcelas digitadas (regra do Ivan de 07/10: "quando não vier informando nada na nota, prevalece o que eu determinar no app"):
  // só para boleto, no formato certo, e só se a soma fecha com o valor da nota. São aceitas quando o XML NÃO traz boletos
  // (cot_nfe.parcelas = []) E também quando o XML ainda não foi lido (parcelas = null): nos dois casos a nota "não veio informando
  // nada", então vale o que o Ivan digitou. A recusa fica só para o XML que JÁ traz boletos (lista não vazia): esses prevalecem.
  // O robô repete a conta contra o vNF do XML antes de lançar.
  let manuais: ParcelaManual[] | null = null
  if (c.parcelas !== undefined && c.parcelas !== null) {
    if (forma !== 'boleto') return { status: 400, corpo: { erro: 'parcelas digitadas só valem para boleto' } }
    manuais = normalizarParcelas(c.parcelas)
    if (!manuais) return { status: 400, corpo: { erro: 'parcelas digitadas inválidas: confira o vencimento e o valor de cada uma' } }
    const n = await deps.notaParaParcelas(chave)
    if (n) {
      if (Array.isArray(n.parcelas) && n.parcelas.length > 0) {
        const semanal = CNPJS_PAGAMENTO_SEMANAL_QUARTA.includes(String(n.cnpj_emitente ?? '').replace(/\D/g, ''))
        if (!semanal) {
          return { status: 400, corpo: { erro: 'esta nota já tem boletos no XML: as parcelas digitadas não se aplicam (os boletos do XML prevalecem)' } }
        }
        // MAUES: só a DATA muda; quantidade e valores têm de ser os do XML (centavos, sem ordem). O robô repete a conferência.
        const centavos = (valores: unknown[]): number[] => valores.map((v) => Math.round(Number(v) * 100)).sort((a, b) => a - b)
        const doXml = centavos((n.parcelas as Array<{ valor?: unknown }>).map((p) => p?.valor))
        const doApp = centavos(manuais.map((p) => p.valor))
        if (doXml.length !== doApp.length || doXml.some((c, i) => c !== doApp[i])) {
          return { status: 400, corpo: { erro: 'esta nota tem boletos no XML: no app só a data pode mudar (a quantidade e os valores são os do XML)' } }
        }
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

// ---------------------------------------------------------------------------------------------------------------------
// Ação "verificar": o que houve com o robô de UMA nota que ficou "lançando"?
// Em 07/10/2026 a execução da MERCURIO travou instalando o navegador e foi cancelada pelo GitHub 25 min depois, SEM ter tentado
// nada no SisChef. A nota ficou "lançando" por 30 min, o botão apagado e ninguém soube dizer por quê. Esta ação pergunta ao GitHub
// como terminou a execução daquela nota e, quando é seguro, devolve a nota ao Ivan com a explicação. Regra de ouro: só libera
// ('revisar') quando o passo que LANÇA no SisChef nunca começou (conclusion 'skipped'); se ele começou e a execução morreu sem avisar,
// a nota pode estar pela metade e vira 'erro' (o app nunca deixa lançar de novo uma nota 'erro').
// ---------------------------------------------------------------------------------------------------------------------

/** Uma execução do lancar-nfe.yml no GitHub (só o que a verificação usa). `titulo` é o display_title: "Lançar NF <numero> (<modo>)". */
export interface Execucao { id: number; titulo: string; status: string; conclusao: string | null; criada_em: string }
/** Um passo da execução (jobs[].steps[] da API do GitHub). */
export interface PassoExecucao { name: string; status: string; conclusion: string | null }
/** O que a verificação precisa saber da nota. */
export interface NotaEstado {
  chave: string; numero: string; situacao: string
  lancamento_estado: string | null; lancamento_em: string | null; lancada_em: string | null; descartada_em: string | null
}
export interface DepsVerificar {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  estadoDaNota(chave: string): Promise<NotaEstado | null>
  /** As execuções mais recentes do lancar-nfe.yml (disparos manuais), da mais nova para a mais velha. Levanta se o GitHub não responde. */
  execucoesDoRobo(): Promise<Execucao[]>
  passosDaExecucao(id: number): Promise<PassoExecucao[]>
  /** Compara-e-troca: só muda se a nota AINDA está 'lancando' (e sem lançada_em). true = mudou. */
  marcarEstado(chave: string, estado: 'revisar' | 'erro', motivo: string, agoraIso: string): Promise<boolean>
  agora(): Date
}

export type SituacaoVerificacao =
  | 'nada_a_verificar' | 'aguardando' | 'rodando' | 'concluida' | 'sem_execucao' | 'liberada' | 'pela_metade'

/** Nome do passo que lança no SisChef (workflow lancar-nfe.yml). */
export const PASSO_QUE_LANCA = 'Lançar / ensaiar a nota'
/** Antes disto a execução ainda pode nem ter aparecido no GitHub: não se conclui nada. */
export const MINUTOS_PARA_CONCLUIR = 3
/** O GitHub cria a execução logo depois do disparo; esta folga cobre diferença de relógio. */
const FOLGA_MS = 2 * 60_000

const COMO_TERMINOU: Record<string, string> = { cancelled: 'foi cancelada', failure: 'falhou', timed_out: 'estourou o tempo' }
const respostaVerificacao = (situacao: SituacaoVerificacao, mensagem: string, extra: Record<string, unknown> = {}): Resultado =>
  ({ status: 200, corpo: { ok: true, situacao, mensagem, ...extra } })

export async function verificar(corpo: Corpo, chamador: string, deps: DepsVerificar): Promise<Resultado> {
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }
  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const chave = typeof c.chave === 'string' ? c.chave.trim() : ''
  if (!RE_CHAVE.test(chave)) return { status: 400, corpo: { erro: 'chave da nota inválida' } }

  const nota = await deps.estadoDaNota(chave)
  if (!nota) return { status: 404, corpo: { erro: 'nota não encontrada' } }
  if (nota.lancada_em || nota.situacao !== 'na_fila' || nota.descartada_em || nota.lancamento_estado !== 'lancando') {
    return respostaVerificacao('nada_a_verificar', 'Esta nota não está esperando o robô.', { estado: nota.lancamento_estado })
  }

  const agora = deps.agora()
  const reservadaEm = Date.parse(nota.lancamento_em ?? '')
  if (!Number.isFinite(reservadaEm)) return respostaVerificacao('aguardando', 'Sem a hora do disparo não dá para conferir o robô.')
  const minutos = Math.floor((agora.getTime() - reservadaEm) / 60_000)

  let execucoes: Execucao[]
  try { execucoes = await deps.execucoesDoRobo() } catch {
    return { status: 502, corpo: { erro: 'não consegui consultar o GitHub agora — tente de novo em instantes' } }
  }
  const prefixo = `Lançar NF ${nota.numero} (`
  const dela = execucoes
    .filter((e) => e.titulo.startsWith(prefixo) && Date.parse(e.criada_em) >= reservadaEm - FOLGA_MS)
    .sort((a, b) => Date.parse(b.criada_em) - Date.parse(a.criada_em))[0]

  if (!dela) {
    return minutos < MINUTOS_PARA_CONCLUIR
      ? respostaVerificacao('aguardando', 'O robô acabou de ser chamado: aguarde um instante.')
      : respostaVerificacao('sem_execucao',
          `Não achei a execução desta nota no GitHub (disparada há ${minutos} min). Confira no SisChef se a nota entrou; se não entrou, a tela libera o Lançar sozinha aos 30 min.`)
  }
  if (dela.status !== 'completed') {
    return respostaVerificacao('rodando', 'O robô ainda está trabalhando nesta nota. Aguarde.', { execucao: dela.id })
  }
  if (dela.conclusao === 'success') {
    return respostaVerificacao('concluida',
      'A execução do robô terminou bem, mas o app ainda não recebeu o resultado. Confira no SisChef se a nota entrou antes de lançar de novo.', { execucao: dela.id })
  }

  const como = COMO_TERMINOU[dela.conclusao ?? ''] ?? `terminou como "${dela.conclusao ?? 'desconhecido'}"`
  let passos: PassoExecucao[]
  try { passos = await deps.passosDaExecucao(dela.id) } catch {
    return { status: 502, corpo: { erro: 'não consegui consultar o GitHub agora — tente de novo em instantes' } }
  }
  const lanca = passos.find((p) => p.name === PASSO_QUE_LANCA)
  // 'skipped' = o passo que lança nunca começou (um passo anterior caiu ou o tempo acabou). Qualquer outra coisa — ou passo que não achamos —
  // é tratada como "pode ter começado": nunca se libera a nota nesse caso.
  const naoComecou = lanca != null && lanca.conclusion === 'skipped'

  if (naoComecou) {
    const motivo = `O robô não chegou a começar: a execução no GitHub ${como} antes de tocar no SisChef (por exemplo, travou ao preparar o navegador). Nada foi criado no SisChef; pode lançar de novo.`
    const mudou = await deps.marcarEstado(chave, 'revisar', motivo, agora.toISOString())
    return respostaVerificacao('liberada', mudou ? motivo : 'A nota já mudou de estado: recarregue a tela.', { execucao: dela.id, mudou })
  }
  const motivo = `A execução do robô ${como} depois de começar a lançar, sem avisar o resultado: a nota pode ter ficado pela metade. Confira no SisChef antes de qualquer coisa. Não lance de novo.`
  const mudou = await deps.marcarEstado(chave, 'erro', motivo, agora.toISOString())
  return respostaVerificacao('pela_metade', mudou ? motivo : 'A nota já mudou de estado: recarregue a tela.', { execucao: dela.id, mudou })
}
