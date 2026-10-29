// supabase/functions/enviar-cupom/cnpj.ts
// Conferência do CNPJ que a IA leu na foto do cupom (pedido do Ivan, 29/10/2026). Lógica pura: sem rede, sem banco, sem globais do Deno
// (logica.ts a chama; index.ts só entrega a lista dos CNPJs conhecidos).
//
// O CNPJ tem 2 dígitos verificadores, então um número lido que NÃO fecha as contas está errado: a leitura trocou um dígito (22/10: o "8" virou "0" no CNPJ da
// A. N. da Silva e o cupom parou em "fornecedor não encontrado"). Se existe UM só CNPJ já conhecido, que fecha as contas, a UM dígito de distância e com nome
// compatível, é o mesmo fornecedor. CNPJ que já fecha as contas NUNCA é tocado — nem quando outro CNPJ válido está a um dígito (isso existe, raro).
// Limite: ~3,5 em cada 10 mil trocas de um dígito deixam o número ainda "fechando as contas"; essas não se detectam e ficam como vieram.
import { normalizar } from './normalizar.ts'

/** Um CNPJ que o app já conhece (cupom antigo, cadastro de fornecedor, nota fiscal) e o nome com que ele aparece lá (null = sem nome). */
export interface CnpjConhecido { cnpj: string; nome: string | null }

/** `ok` = nada a fazer (fecha as contas, ou o cupom não trouxe CNPJ); `corrigido` = trocado pelo único conhecido a um dígito; `invalido` = não fecha e não há como corrigir. */
export type ConferenciaCnpj =
  | { tipo: 'ok' }
  | { tipo: 'corrigido'; cnpj: string; original: string; nome: string | null }
  | { tipo: 'invalido' }

const soDigitos = (v: string | null | undefined): string => String(v ?? '').replace(/\D/g, '')
const limpar = (t: string | null | undefined): string => String(t ?? '').replace(/\s+/g, ' ').trim()

/** CNPJ válido: 14 dígitos, não todos iguais, com os dois dígitos verificadores certos (a mesma conta de src/admin/fornecedorRegras.ts; o teste confere que dão o mesmo). */
export function cnpjValido(v: string): boolean {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(d.slice(0, 12))
  return d1 === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** "63540861000182" → "63.540.861/0001-82" (o que não tem 14 dígitos fica como veio). */
export function formatarCnpj(v: string): string {
  const d = soDigitos(v)
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

/** Palavras que aparecem em muitos nomes de empresa e não identificam nenhuma (já normalizadas: minúsculas, sem acento). Palavras de menos de 4 letras (sa, epp, da, de) nem entram na conta. */
const PALAVRAS_GENERICAS = new Set([
  'ltda', 'eireli', 'comercio', 'comercial', 'industria', 'industrial', 'distribuidora', 'distribuicao', 'supermercado', 'supermercados', 'mercado',
  'atacado', 'atacadista', 'alimentos', 'alimenticios', 'produtos', 'servicos', 'importacao', 'exportacao', 'deposito', 'matriz', 'filial', 'brasil',
])
/** As palavras do nome que identificam a empresa: 4 letras ou mais e que não são genéricas. */
const palavrasQueIdentificam = (nome: string): Set<string> =>
  new Set(nome.split(' ').filter((p) => p.length >= 4 && !PALAVRAS_GENERICAS.has(p)))

/**
 * O nome lido na foto e o nome do CNPJ conhecido podem ser da mesma empresa? Faltou um dos nomes (ou os dois) ⇒ vale. Existindo os dois, precisam repartir ao
 * menos uma palavra que identifique a empresa ("A. N. DA SILVA DESCARTAVEIS" e "A. N. DA SILVA DESCARTAVEIS LTDA" repartem "silva" e "descartaveis").
 */
export function nomesCompativeis(lido: string | null | undefined, conhecido: string | null | undefined): boolean {
  const a = normalizar(lido)
  const b = normalizar(conhecido)
  if (!a || !b) return true
  const dosDois = palavrasQueIdentificam(a)
  return [...palavrasQueIdentificam(b)].some((p) => dosDois.has(p))
}

/** Quantos dígitos diferem entre dois números de mesmo tamanho (distância de Hamming); tamanhos diferentes = infinito. */
function digitosDiferentes(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

/**
 * Confere o CNPJ lido na foto. `lido` e os `conhecidos` podem vir com pontuação (só os dígitos contam). Devolve:
 *  - `ok`: sem CNPJ, ou ele fecha as contas (nunca é tocado);
 *  - `corrigido`: não fecha as contas e existe EXATAMENTE UM CNPJ conhecido que fecha, tem 14 dígitos, difere do lido em UM dígito (troca, não falta nem
 *    sobra) e tem nome compatível; `nome` é o do conhecido (o primeiro da lista que combina e tem nome), para o Ivan ver de quem é;
 *  - `invalido`: não fecha as contas e não há candidato único (nenhum, ou dois ou mais — então não se chuta).
 * O mesmo CNPJ vindo de várias fontes conta UMA vez.
 */
export function conferirCnpjLido(
  lido: string | null | undefined, nomeLido: string | null | undefined, conhecidos: CnpjConhecido[],
): ConferenciaCnpj {
  const original = soDigitos(lido)
  if (!original || cnpjValido(original)) return { tipo: 'ok' }

  const candidatos = new Map<string, string | null>() // cnpj → nome (o primeiro que combina e não é vazio)
  for (const k of conhecidos) {
    const cnpj = soDigitos(k?.cnpj)
    if (cnpj.length !== 14 || !cnpjValido(cnpj)) continue // só vale como "conhecido" quem fecha as contas
    if (digitosDiferentes(original, cnpj) !== 1) continue
    if (!nomesCompativeis(nomeLido, k.nome)) continue
    const nome = limpar(k.nome) || null
    if (!candidatos.has(cnpj) || (candidatos.get(cnpj) === null && nome !== null)) candidatos.set(cnpj, nome)
  }
  if (candidatos.size !== 1) return { tipo: 'invalido' }
  const [[cnpj, nome]] = [...candidatos]
  return { tipo: 'corrigido', cnpj, original, nome }
}

/** O que o Ivan lê no resumo do envio quando o CNPJ foi corrigido (sem ponto final: a tela acrescenta o resto da frase; o ponto final do nome, como em "S.A.", sai). */
export function fraseCnpjCorrigido(c: Extract<ConferenciaCnpj, { tipo: 'corrigido' }>): string {
  const nome = limpar(c.nome).replace(/[\s.]+$/, '')
  return `corrigi o CNPJ lido na foto: era ${formatarCnpj(c.original)}, agora ${formatarCnpj(c.cnpj)}${nome ? `, o da ${nome}` : ''}`
}

/** O que o Ivan lê no resumo do envio quando o CNPJ não fecha as contas e não há como corrigir sozinho. */
export function fraseCnpjInvalido(cnpj: string): string {
  return `o CNPJ lido na foto (${formatarCnpj(cnpj)}) não fecha as contas dos números: confira na foto`
}
