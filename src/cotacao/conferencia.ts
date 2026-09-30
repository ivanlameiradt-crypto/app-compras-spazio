// Fase 2, Bloco D: lógica pura da entrega prevista (D.7.3) e do selo da Revisão (D.7.4).
// Tudo em America/Sao_Paulo, sem depender do fuso do aparelho (usa horaLocal de mensagens.ts).
import type { SituacaoNfe, Unidade } from '../lib/tipos'
import { diaCurto, ddmm, horaLocal } from './mensagens'
import { formatarQtd } from '../lib/regras'

// ---------- D.7.3: sugestão da entrega prevista a partir do texto de Entrega

/** Data local (AAAA-MM-DD) somando `dias` a uma data AAAA-MM-DD, sem drift de fuso. */
function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + dias)
  return dt.toISOString().slice(0, 10)
}
function domingo(data: string): boolean {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() === 0
}

/**
 * Sugere a data de entrega (AAAA-MM-DD) a partir do texto de Entrega e da data de hoje (AAAA-MM-DD):
 * - texto com dd/mm → essa data (no ano de hoje; se já passou, no ano seguinte);
 * - "hoje" → hoje;
 * - "amanhã" ou "1 dia" → o dia seguinte que não seja domingo;
 * - qualquer outro texto → '' (o Ivan escolhe ou deixa sem).
 */
export function entregaPrevista(texto: string, hoje: string): string {
  const t = (texto || '').toLowerCase().trim()
  if (!t) return ''
  const m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (m) {
    const dia = String(Number(m[1])).padStart(2, '0')
    const mes = String(Number(m[2])).padStart(2, '0')
    const ano = Number(hoje.slice(0, 4))
    let data = `${ano}-${mes}-${dia}`
    if (data < hoje) data = `${ano + 1}-${mes}-${dia}`
    return data
  }
  if (/\bhoje\b/.test(t)) return hoje
  if (/amanh[ãa]/.test(t) || /\b1\s*dia\b/.test(t)) {
    let d = somarDias(hoje, 1)
    if (domingo(d)) d = somarDias(d, 1)
    return d
  }
  return ''
}

// ---------- D.7.4: selo informativo da Revisão (entra com a D2)

export type CorSelo = 'cinza' | 'amarelo'
export interface NfeSelo {
  numero: string
  situacao: SituacaoNfe
  lancada_em: string | null
  visto_na_fila_em: string
  saiu_da_fila_em: string | null
}
export interface ContextoSelo {
  vendedor: string
  pedido_data: string          // data do pedido (AAAA-MM-DD ou ISO)
  gerada_em: string            // leitura do estoque (ISO)
  nf?: NfeSelo | null          // NF casada com o produto (ou null)
  entrada_manual_em?: string | null
  recebido?: boolean
  recebido_em?: string | null
  falta_definitiva?: number | null
  unidade?: Unidade
}
export interface Selo { texto: string; cor: CorSelo }

const dataLocal = (iso: string): string => horaLocal(iso).data
const ehData = (s: string): string => (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length === 10 ? s : dataLocal(s))

/** O selo informativo da Revisão para um produto pedido antes: as 6 regras de D.7.4 + o sufixo da falta. */
export function seloPedidoAnterior(ctx: ContextoSelo): Selo {
  const prefixo = `Pedido com ${ctx.vendedor} em ${diaCurto(ehData(ctx.pedido_data))} ${ddmm(ehData(ctx.pedido_data))}: `
  const gerada = new Date(ctx.gerada_em).getTime()
  let texto: string
  let cor: CorSelo = 'amarelo'

  if (ctx.entrada_manual_em) {
    const q = dataLocal(ctx.entrada_manual_em)
    if (new Date(ctx.entrada_manual_em).getTime() <= gerada) {
      texto = `entrada no estoque informada por você em ${ddmm(q)} — já está no estoque que o robô leu.`
      cor = 'cinza'
    } else {
      texto = `entrada no estoque informada por você em ${ddmm(q)}, depois da leitura do estoque — a sugestão não conta este pedido.`
    }
  } else if (ctx.nf) {
    const nf = ctx.nf
    if (nf.situacao === 'na_fila') {
      texto = `NF-e ${nf.numero} chegou em ${ddmm(dataLocal(nf.visto_na_fila_em))} e ainda não foi lançada — a sugestão não conta este pedido.`
    } else {
      const inicioIso = nf.situacao === 'lancada' ? (nf.lancada_em as string) : nf.visto_na_fila_em
      const fimIso = nf.situacao === 'lancada' ? (nf.lancada_em as string) : (nf.saiu_da_fila_em as string)
      const inicio = new Date(inicioIso).getTime()
      const fim = new Date(fimIso).getTime()
      if (fim <= gerada) {
        texto = `NF-e ${nf.numero} entrou no SisChef em ${ddmm(dataLocal(fimIso))} — já está no estoque que o robô leu.`
        cor = 'cinza'
      } else if (inicio > gerada) {
        texto = `NF-e ${nf.numero} entrou no SisChef depois da leitura do estoque — a sugestão não conta este pedido.`
      } else {
        texto = `NF-e ${nf.numero} entrou no SisChef perto da leitura do estoque (entre dom 17h e seg 7h) — confira a sugestão.`
      }
    }
  } else if (ctx.recebido) {
    const q = ctx.recebido_em ? ddmm(dataLocal(ctx.recebido_em)) : '—'
    texto = `recebido em ${q}, sem NF-e no SisChef — a sugestão não conta este pedido.`
  } else {
    texto = 'ainda não recebido e sem NF-e — confira antes de pedir de novo.'
  }

  let saida = prefixo + texto
  if (ctx.falta_definitiva && ctx.falta_definitiva > 0) {
    saida += ` · faltaram ${formatarQtd(ctx.falta_definitiva, ctx.unidade ?? 'un')} (não vêm mais)`
  }
  return { texto: saida, cor }
}
