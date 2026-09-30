// Funções puras dos cadastros (DESIGN-fase-2.md, C.5). Sem acesso ao banco: fáceis de testar e reaproveitáveis.
import type { Unidade } from '../lib/tipos'

/** Número em pt-BR sem zeros à toa: 12 → "12", 1.5 → "1,5", 0.25 → "0,25". */
function numeroBr(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

/**
 * WhatsApp normalizado, igual ao cot_whatsapp_normalizar do banco (C.4.3): só dígitos, sem zeros à esquerda;
 * 10/11 dígitos → '55' + dígitos; 12/13 já em 55 ficam; o resto volta como está (a validação decide se serve).
 */
export function normalizarWhatsapp(t: string): string {
  const d = (t ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) return '55' + d
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return d
}

/** WhatsApp válido (a mesma regex do banco, 7.2): 55 + DDD + celular (9+8) ou fixo (2–8 + 7). */
export function whatsappValido(w: string): boolean {
  return /^55[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$/.test(w)
}

/** Máscara para as listas (o telefone nunca aparece inteiro): "+55 91 9····-1234". */
export function mascararWhatsapp(w: string): string {
  const d = (w ?? '').replace(/\D/g, '')
  if (d.length < 12) return w ?? ''
  const ddd = d.slice(2, 4)
  const num = d.slice(4)
  return `+55 ${ddd} ${num[0]}····-${num.slice(-4)}`
}

/** WhatsApp legível, sem mascarar (só no formulário, antes de gravar): "+55 91 90000-1234". */
export function formatarWhatsapp(w: string): string {
  const d = (w ?? '').replace(/\D/g, '')
  if (d.length < 12) return w ?? ''
  const ddd = d.slice(2, 4)
  const num = d.slice(4)
  return `+55 ${ddd} ${num.slice(0, num.length - 4)}-${num.slice(-4)}`
}

/** Embalagem-padrão sugerida quando não há uma no catálogo (C.4.9): fardo (bebida/un), caixa (outro/un), pacote (kg). */
export function embalagemSugerida(unidade: Unidade, bebida: boolean): 'fardo' | 'caixa' | 'pacote' {
  if (unidade === 'kg') return 'pacote'
  return bebida ? 'fardo' : 'caixa'
}

/** Texto do fator (C.4.5): un → "fardo c/12"; kg < 1 kg → "pacote de 500 g"; kg ≥ 1 → "saco de 1,5 kg". */
export function textoFator(embalagem: string, fator: number, unidade: Unidade): string {
  if (unidade === 'kg') {
    const medida = fator < 1 ? `${numeroBr(Math.round(fator * 1000))} g` : `${numeroBr(fator)} kg`
    return `${embalagem} de ${medida}`
  }
  return `${embalagem} c/${numeroBr(fator)}`
}

/** Uma linha de histórico_alteracoes das tabelas de cadastro. */
export interface Mudanca {
  id: number
  quem: string
  quando: string
  tabela: string
  registro: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
}

const NOME_TABELA: Record<string, string> = {
  cot_vendedores: 'Vendedor',
  cot_fornecedores: 'Grafia',
  cot_catalogo: 'Produto',
  cot_feriados: 'Feriado',
  lista_regras: 'Regra da lista',
  cot_fator_descartes: 'Fator descartado',
}

/** Resumo curto de uma mudança para a aba Mudanças (C.5). O telefone sempre mascarado; "(pelo Claude)" com via=claude. */
export function resumoMudanca(m: Mudanca): string {
  const antes = m.antes ?? {}
  const depois = m.depois ?? {}
  const via = String((depois as { via?: string }).via ?? 'app')
  const rotulo = String(depois.empresa ?? antes.empresa ?? depois.nome ?? antes.nome ?? NOME_TABELA[m.tabela] ?? m.tabela)
  const nomeCurto = rotulo.split('(')[0].trim()

  let acao: string
  if (m.antes === null) acao = 'cadastrado'
  else if (m.depois === null) acao = 'removido'
  else if (m.tabela === 'cot_vendedores' && antes.whatsapp !== depois.whatsapp)
    acao = `WhatsApp trocado (${mascararWhatsapp(String(depois.whatsapp ?? ''))})`
  else if (m.tabela === 'cot_vendedores' && antes.ativo !== depois.ativo)
    acao = depois.ativo ? 'ligado' : 'desligado'
  else if (m.tabela === 'cot_catalogo' && antes.fator !== depois.fator)
    acao = depois.fator == null ? 'embalagem retirada' : `embalagem para c/${numeroBr(Number(depois.fator))}`
  else acao = 'alterado'

  return `${nomeCurto}: ${acao}${via === 'claude' ? ' (pelo Claude)' : ''}`
}
