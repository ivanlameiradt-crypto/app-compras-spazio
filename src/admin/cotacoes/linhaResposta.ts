// Uma linha de resposta do "Digitar preços" (os campos da página do vendedor): a base da tela, o que a tela mostra e a
// EntradaItem que ela representa. Saiu de DigitarPrecos.tsx (que reimporta sem mudar comportamento) para o "Corrigir" do
// Colar resposta com IA (B.8) usar os mesmos campos.
import { lerNumero } from '../../lib/regras'
import type { BaseCotacao, EntradaItem, EstadoItemCotacao, ItemCotacao } from '../../lib/tipos'

export type BaseTela = 'un' | 'emb_un' | 'kg' | 'emb_g' | 'litro' | 'emb_ml'
export interface LinhaTela {
  estado: EstadoItemCotacao; preco: string; base: BaseTela; emb: string
  tenhoSo: string; similarDesc: string; similarPreco: string; aPartirDe: string; marca: string
}

export const virgula = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

export function baseTelaDe(i: ItemCotacao): BaseTela {
  if (i.base === 'embalagem') return i.unidade === 'un' ? 'emb_un' : i.emb_ml != null ? 'emb_ml' : 'emb_g'
  if (i.base) return i.base
  // sem resposta: como na página, a embalagem confirmada vem marcada; líquido começa pelo litro
  if (i.fator_confirmado && i.fator) return i.unidade === 'un' ? 'emb_un' : 'emb_g'
  return i.unidade === 'un' ? 'un' : i.vende_por_litro ? 'litro' : 'kg'
}

export function linhaDe(i: ItemCotacao): LinhaTela {
  const base = baseTelaDe(i)
  const fatorConfirmado = i.fator_confirmado && i.fator ? Number(i.fator) : null
  const emb = base === 'emb_un' ? (i.emb_unidades ?? fatorConfirmado)
    : base === 'emb_g' ? (i.emb_gramas ?? (fatorConfirmado != null ? Math.round(fatorConfirmado * 1000 * 1000) / 1000 : null))
      : base === 'emb_ml' ? i.emb_ml : null
  return {
    estado: i.estado, preco: virgula(i.preco_digitado), base, emb: virgula(emb), tenhoSo: virgula(i.tenho_so),
    similarDesc: i.similar_desc ?? '', similarPreco: virgula(i.similar_preco), aPartirDe: virgula(i.a_partir_de),
    marca: i.marca_informada ?? '',
  }
}

/** Número digitado ("31,50", "R$ 1.234,50"); vazio → null; texto que não é número → NaN (erro na tela). */
export const numeroDe = (t: string): number | null => (t.trim() ? (lerNumero(t) ?? Number.NaN) : null)
export const textoDe = (t: string) => (t.trim() ? t.trim() : null)

/** A entrada de cot_responder_admin que a linha da tela representa (sem numero/rev). */
export function entradaDe(l: LinhaTela, unidade: 'un' | 'kg'): Omit<EntradaItem, 'numero' | 'rev_lida'> {
  if (l.estado === 'sem_resposta') return { estado: 'sem_resposta' }
  const similar = { similar_desc: textoDe(l.similarDesc), similar_preco: numeroDe(l.similarPreco) }
  if (l.estado === 'nao_tem') return { estado: 'nao_tem', ...similar }
  const base: BaseCotacao = l.base.startsWith('emb_') ? 'embalagem' : (l.base as BaseCotacao)
  const emb = numeroDe(l.emb)
  return {
    estado: 'tem', preco: numeroDe(l.preco), base,
    emb_unidades: l.base === 'emb_un' && unidade === 'un' ? emb : null,
    emb_gramas: l.base === 'emb_g' ? emb : null,
    emb_ml: l.base === 'emb_ml' ? emb : null,
    tenho_so: numeroDe(l.tenhoSo), a_partir_de: numeroDe(l.aPartirDe), ...similar, marca: textoDe(l.marca),
  }
}
