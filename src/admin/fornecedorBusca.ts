// Fornecedores que o app já conhece (pedido do Ivan, 10/10/2026, aba "Compras avulsas"): a mesma ideia do cupom e da nota fiscal — o fornecedor vem do CNPJ; se o app
// o conhece, o Ivan digita um pedaço do nome (ou do CNPJ) e toca na sugestão; se não, cadastra pela caixa "Cadastrar fornecedor". Puro: sem rede nem React.
import { nomeDoFornecedor, soDigitos } from './fornecedorRegras'

export interface FornecedorConhecido {
  /** 14 dígitos. */
  cnpj: string
  /** Razão social (a que vai ao SisChef). */
  razao: string
  /** Nome fantasia (só do app; vazio se não há). */
  fantasia: string
}

/** Uma linha de qualquer fonte (notas da SEFAZ, cupons, cadastro do app). */
export interface LinhaFornecedor { cnpj: string | null | undefined; razao: string | null | undefined; fantasia?: string | null }

/** Junta as fontes num fornecedor por CNPJ (14 dígitos): razão da 1ª fonte que a tem, fantasia da 1ª que a tem. CNPJ inválido é descartado. */
export function juntarFornecedores(...fontes: LinhaFornecedor[][]): FornecedorConhecido[] {
  const porCnpj = new Map<string, FornecedorConhecido>()
  for (const fonte of fontes) {
    for (const l of fonte) {
      const cnpj = soDigitos(l.cnpj ?? '')
      if (cnpj.length !== 14) continue
      const atual = porCnpj.get(cnpj) ?? { cnpj, razao: '', fantasia: '' }
      if (atual.razao === '') atual.razao = (l.razao ?? '').replace(/\s+/g, ' ').trim()
      if (atual.fantasia === '') atual.fantasia = (l.fantasia ?? '').replace(/\s+/g, ' ').trim()
      porCnpj.set(cnpj, atual)
    }
  }
  return [...porCnpj.values()].filter((f) => f.razao !== '' || f.fantasia !== '')
}

const normalizar = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** O nome que o app mostra do fornecedor: a fantasia, senão a razão social (mesma regra dos "Últimos envios"). */
export const nomeDoConhecido = (f: FornecedorConhecido): string => nomeDoFornecedor(f.razao, f.fantasia)

/**
 * Sugestões para o que o Ivan digitou: cada palavra tem de estar na fantasia, na razão social ou no CNPJ (só dígitos, a partir de 3). Primeiro os que COMEÇAM pela
 * 1ª palavra, depois o resto; empate: nome mais curto, depois ordem alfabética. Texto vazio = nada.
 */
export function buscarFornecedores(lista: FornecedorConhecido[], texto: string, limite = 6): FornecedorConhecido[] {
  const palavras = normalizar(texto).split(' ').filter(Boolean)
  if (palavras.length === 0) return []
  const achados: { f: FornecedorConhecido; nota: number }[] = []
  for (const f of lista) {
    const campos = [normalizar(f.fantasia), normalizar(f.razao)]
    const ok = palavras.every((w) => campos.some((c) => c.includes(w)) || (/^\d{3,}$/.test(w) && f.cnpj.includes(w)))
    if (!ok) continue
    achados.push({ f, nota: campos.some((c) => c.startsWith(palavras[0])) ? 0 : 1 })
  }
  achados.sort((a, b) => a.nota - b.nota || nomeDoConhecido(a.f).length - nomeDoConhecido(b.f).length || nomeDoConhecido(a.f).localeCompare(nomeDoConhecido(b.f), 'pt-BR'))
  return achados.slice(0, limite).map((x) => x.f)
}
