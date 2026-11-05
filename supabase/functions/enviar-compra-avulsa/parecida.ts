// supabase/functions/enviar-cupom/parecida.ts
// E5 (compra repetida nos 3 tipos, pedido do Ivan de 04/11/2026): a "impressão digital" de uma compra (CNPJ de 14 dígitos + total em CENTAVOS), a procura das compras parecidas que já
// existem (cupom, compra avulsa e nota fiscal, nos últimos 45 dias) e a frase em português simples que o app mostra. CÓPIA IDÊNTICA em enviar-cupom, confirmar-cupom e
// enviar-compra-avulsa (cada função é publicada sozinha: nada de importar de outra pasta); tests/unit/parecidaCopias.test.ts confere que as três são iguais. Puro: sem globais do
// Deno nem rede; o banco entra por `io` (ioDoSupabase monta o `io` com o cliente do PostgREST). SÓ AVISA: quem decide é o Ivan.

/** O que o app e as funções reconhecem no começo do aviso (no motivo do cupom ou no texto do erro 409). */
export const REPETIDA_PREFIXO = 'POSSÍVEL REPETIDA: '
export const JANELA_DIAS = 45
const MAX_NA_FRASE = 3

export interface Impressao { cnpj: string; centavos: number }
export type TipoParecida = 'cupom' | 'avulsa' | 'nota'
/** Uma compra parecida, já no formato que a frase usa. `quando` é o instante do envio (cupom/avulsa) ou o dia da emissão (nota). */
export interface Parecida { tipo: TipoParecida; id: string; estado: string; quando: string; centavos: number; pedido: string | null; numero: string | null; motivo: string | null }

/** As colunas de `cupom` que a procura lê. */
export interface LinhaCupom {
  id: string; estado: string; origem: string | null; emitente_cnpj: string | null; valor_a_pagar: number | string | null; pedido_sischef: string | null
  motivo: string | null; criado_em: string; teste: boolean | null
}
/** As colunas de `cot_nfe` que a procura lê. */
export interface LinhaNota {
  chave: string; cnpj_emitente: string | null; numero: string | null; emissao: string; valor_nf: number | string | null; situacao: string
  lancamento_estado: string | null; nf_sischef: string | null; descartada_em: string | null
}
export interface IoParecidas {
  /** Os cupons (e compras avulsas) do CNPJ criados desde `desdeIso`, sem os de teste e só nos estados que contam. */
  cupons(cnpj: string, desdeIso: string): Promise<LinhaCupom[]>
  /** As notas fiscais do CNPJ emitidas desde `desdeDia` (AAAA-MM-DD), sem as descartadas. */
  notas(cnpj: string, desdeDia: string): Promise<LinhaNota[]>
}

const ESTADOS_QUE_CONTAM = ['LANCADO', 'PENDENTE', 'PROCESSANDO', 'REVISAR']   // REVISAR: só o que "parou no meio" (ver podeExistirNoSischef)
/** O robô parou no meio do SisChef: a compra PODE já existir lá (as mesmas palavras da tela, do robô e da função cupom_excluir). */
const NO_MEIO_DO_SISCHEF = /^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO|^falha ao preencher o pagamento no Sischef/i
/** O cupom/avulsa em REVISAR só conta como "a mesma compra" quando PODE já estar no SisChef (pedido preenchido ou parou no meio). O REVISAR comum ("esperando você") NÃO conta: duas cópias esperando o Ivan se acusariam uma à outra
 *  e, excluída uma, o aviso morto ficaria na outra (revisão independente do código, 05/11). A cópia solta DEPOIS da original continua barrada: a original já estará na fila ou lançada. */
const podeExistirNoSischef = (c: LinhaCupom): boolean => !!c.pedido_sischef || NO_MEIO_DO_SISCHEF.test((c.motivo ?? '').trim())
const BELEM_MS = 3 * 3600 * 1000   // UTC−3 fixo (o Brasil não tem horário de verão desde 2019)

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? NaN : Number(v))
const centavosDe = (v: unknown): number | null => {
  const n = num(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

/** CNPJ (14 dígitos, com ou sem pontuação) + total em reais. null quando falta um dos dois: o REVISAR sem total é gravado com 0, e 0 não pode casar com 0. */
export function impressaoDaCompra(cnpj: unknown, total: unknown): Impressao | null {
  const c = soDigitos(cnpj)
  const centavos = centavosDe(total)
  return c.length === 14 && centavos !== null ? { cnpj: c, centavos } : null
}

const diaBelem = (iso: string): string => new Date(Date.parse(iso) - BELEM_MS).toISOString().slice(0, 10)   // AAAA-MM-DD no horário de Belém
const ddmm = (diaIso: string): string => `${diaIso.slice(8, 10)}/${diaIso.slice(5, 7)}`
const brl = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`

/**
 * Procura, no que o `io` devolve, as compras do mesmo CNPJ e do mesmo total (em centavos inteiros) dos últimos 45 dias, e filtra de novo (não confia só no filtro do banco): nunca conta
 * teste, EXCLUIDO, a própria linha (`ignorarId`) nem nota descartada. Cupom/avulsa: LANCADO, PENDENTE, PROCESSANDO e REVISAR. Nota: lançada (`lancada`), entrada por fora (`saiu_da_fila`),
 * sendo lançada (`lancando`) ou com erro no meio (`erro`: o pedido pode existir no SisChef). Mais recente primeiro. Falha do `io` SOBE: nunca vira "não achei".
 */
export async function acharParecidas(
  io: IoParecidas, imp: Impressao, opcoes: { agora: Date; ignorarId?: string; comNotas?: boolean },
): Promise<Parecida[]> {
  const desde = new Date(opcoes.agora.getTime() - JANELA_DIAS * 86_400_000)
  const desdeIso = desde.toISOString()
  const desdeDia = diaBelem(desdeIso)
  const cupons = (await io.cupons(imp.cnpj, desdeIso)).filter((c) =>
    c.teste !== true && c.id !== opcoes.ignorarId && ESTADOS_QUE_CONTAM.includes(c.estado) && soDigitos(c.emitente_cnpj) === imp.cnpj
    && centavosDe(c.valor_a_pagar) === imp.centavos && Date.parse(c.criado_em) >= desde.getTime() && (c.estado !== 'REVISAR' || podeExistirNoSischef(c)))
  const notas = opcoes.comNotas === false ? [] : (await io.notas(imp.cnpj, desdeDia)).filter((n) =>
    n.descartada_em == null && soDigitos(n.cnpj_emitente) === imp.cnpj && centavosDe(n.valor_nf) === imp.centavos && n.emissao >= desdeDia
    && (n.situacao === 'lancada' || n.situacao === 'saiu_da_fila' || n.lancamento_estado === 'lancando' || n.lancamento_estado === 'erro'))
  const achadas: Parecida[] = [
    ...cupons.map((c): Parecida => ({
      tipo: c.origem === 'avulsa' ? 'avulsa' : 'cupom', id: c.id, estado: c.estado, quando: c.criado_em, centavos: imp.centavos,
      pedido: c.pedido_sischef ?? null, numero: null, motivo: c.motivo ?? null,
    })),
    ...notas.map((n): Parecida => ({
      tipo: 'nota', id: n.chave, estado: n.situacao === 'lancada' || n.situacao === 'saiu_da_fila' ? n.situacao : (n.lancamento_estado ?? n.situacao), quando: n.emissao,
      centavos: imp.centavos, pedido: n.nf_sischef ?? null, numero: n.numero ?? null, motivo: null,
    })),
  ]
  const dia = (p: Parecida) => (p.tipo === 'nota' ? p.quando : diaBelem(p.quando))
  return achadas.sort((a, b) => (dia(a) < dia(b) ? 1 : dia(a) > dia(b) ? -1 : 0))
}

/** Como a compra parecida está, em palavras do dia a dia. */
function situacao(p: Parecida): string {
  if (p.tipo === 'nota') {
    if (p.estado === 'saiu_da_fila') return 'entrou no SisChef por fora'
    if (p.estado === 'lancando') return 'sendo lançada agora'
    if (p.estado === 'erro') return 'ficou com erro no meio e pode já estar no SisChef'
    return 'lançada no SisChef'
  }
  if (p.estado === 'LANCADO') return `lançado no SisChef${p.pedido ? ` (pedido ${p.pedido})` : ''}`
  if (p.estado === 'PENDENTE' || p.estado === 'PROCESSANDO') return 'na fila para lançar'
  return 'parou no meio e pode já estar no SisChef'   // REVISAR só chega aqui quando pode já estar no SisChef (podeExistirNoSischef)
}
function umaCompra(p: Parecida): string {
  const o = p.tipo === 'nota' ? `nota fiscal${p.numero ? ` nº ${p.numero}` : ''} de ${ddmm(p.quando)}` : `${p.tipo === 'avulsa' ? 'compra avulsa' : 'cupom'} de ${ddmm(diaBelem(p.quando))}`
  return `${o}, ${situacao(p)}`
}

/** A frase do aviso: "POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 1)." (até 3 compras; o resto vira "e mais N"). */
export function fraseDaRepetida(parecidas: Parecida[], centavos: number): string {
  const lista = parecidas.slice(0, MAX_NA_FRASE).map(umaCompra).join('; ')
  const mais = parecidas.length > MAX_NA_FRASE ? ` e mais ${parecidas.length - MAX_NA_FRASE}` : ''
  return `${REPETIDA_PREFIXO}já existe compra deste fornecedor com o mesmo total (${brl(centavos)}): ${lista}${mais}.`
}

// ---------- o trecho dentro do motivo do cupom (sempre no FIM: "CONFIRMAR: …; POSSÍVEL REPETIDA: …")
/** Acrescenta a frase ao fim do motivo, depois de "; ". Já tendo o trecho, não duplica. */
export function acrescentarTrecho(motivo: string | null | undefined, frase: string): string {
  const m = (motivo ?? '').trim()
  if (m.includes(REPETIDA_PREFIXO)) return m
  return m === '' ? frase : `${m}; ${frase}`
}
/** O trecho (do prefixo até o fim do motivo), ou null. */
export function trechoDaRepetida(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(REPETIDA_PREFIXO)
  return i < 0 ? null : m.slice(i)
}
/** O motivo sem o trecho (e sem o "; " que o separava); vazio quando o trecho era o motivo inteiro. */
export function semTrechoDaRepetida(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim()
  const i = m.indexOf(REPETIDA_PREFIXO)
  return i < 0 ? m : m.slice(0, i).replace(/[;\s]+$/, '').trim()
}

// ---------- o banco: as duas consultas (PostgREST)
interface Consulta {
  select(colunas: string): Consulta
  eq(coluna: string, valor: unknown): Consulta
  in(coluna: string, valores: unknown[]): Consulta
  gte(coluna: string, valor: string): Consulta
  is(coluna: string, valor: null): Consulta
  limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}
/** O pedaço do cliente do Supabase que a procura usa (o `admin` do index.ts, com `as unknown as ClienteConsulta`). */
export interface ClienteConsulta { from(tabela: string): Consulta }
const LIMITE_DE_LINHAS = 200

export function ioDoSupabase(c: ClienteConsulta): IoParecidas {
  return {
    async cupons(cnpj, desdeIso) {
      const { data, error } = await c.from('cupom')
        .select('id, estado, origem, emitente_cnpj, valor_a_pagar, pedido_sischef, motivo, criado_em, teste')
        .eq('emitente_cnpj', cnpj).eq('teste', false).in('estado', ESTADOS_QUE_CONTAM).gte('criado_em', desdeIso).limit(LIMITE_DE_LINHAS)
      if (error) throw new Error(error.message)
      return (data ?? []) as LinhaCupom[]
    },
    async notas(cnpj, desdeDia) {
      const { data, error } = await c.from('cot_nfe')
        .select('chave, cnpj_emitente, numero, emissao, valor_nf, situacao, lancamento_estado, nf_sischef, descartada_em')
        .eq('cnpj_emitente', cnpj).is('descartada_em', null).gte('emissao', desdeDia).limit(LIMITE_DE_LINHAS)
      if (error) throw new Error(error.message)
      return (data ?? []) as LinhaNota[]
    },
  }
}
