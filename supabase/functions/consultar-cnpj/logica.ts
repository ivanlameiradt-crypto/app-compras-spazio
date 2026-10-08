// supabase/functions/consultar-cnpj/logica.ts
// Lógica pura da Edge Function consultar-cnpj (pedido do Ivan, 08/10/2026): o app pergunta os dados públicos de um CNPJ (razão social, nome fantasia, estado e
// município) para o Ivan cadastrar um fornecedor sem digitar. Só o admin consulta. As consultas vão em fontes públicas, uma depois da outra (a primeira que
// responder vale; hoje a BrasilAPI chegou a dar 503): cada fonte é um adaptador que devolve os dados normalizados ou levanta. Sem globais do Deno nem rede:
// as fontes e o usuário entram por `deps`.

export interface DadosCnpj { cnpj: string; razao_social: string; nome_fantasia: string; uf: string; municipio: string; situacao: string }
/** Uma fonte pública: devolve os dados, `null` se ela diz que o CNPJ não existe, ou levanta se está fora do ar. */
export type Fonte = (cnpj: string) => Promise<DadosCnpj | null>
export interface Deps {
  buscarUsuario(email: string): Promise<{ papel: string; ativo: boolean } | null>
  fontes: Fonte[]
}
export interface Resultado { status: number; corpo: Record<string, unknown> }

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** 14 dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function cnpjValido(v: unknown): boolean {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()

/** BrasilAPI: { razao_social, nome_fantasia, uf, municipio, descricao_situacao_cadastral }. */
export function deBrasilApi(j: Record<string, unknown>, cnpj: string): DadosCnpj | null {
  if (!j || typeof j.razao_social !== 'string' || texto(j.razao_social) === '') return null
  return { cnpj, razao_social: texto(j.razao_social), nome_fantasia: texto(j.nome_fantasia), uf: texto(j.uf).toUpperCase(), municipio: texto(j.municipio), situacao: texto(j.descricao_situacao_cadastral) }
}
/** CNPJ.ws pública: { razao_social, estabelecimento: { nome_fantasia, estado: { sigla }, cidade: { nome }, situacao_cadastral } }. */
export function deCnpjWs(j: Record<string, unknown>, cnpj: string): DadosCnpj | null {
  const e = (j?.estabelecimento ?? null) as Record<string, unknown> | null
  if (!j || !e || typeof j.razao_social !== 'string' || texto(j.razao_social) === '') return null
  const estado = (e.estado ?? {}) as Record<string, unknown>
  const cidade = (e.cidade ?? {}) as Record<string, unknown>
  return { cnpj, razao_social: texto(j.razao_social), nome_fantasia: texto(e.nome_fantasia), uf: texto(estado.sigla).toUpperCase(), municipio: texto(cidade.nome), situacao: texto(e.situacao_cadastral) }
}
/** ReceitaWS: { status: 'OK'|'ERROR', nome, fantasia, uf, municipio, situacao }. */
export function deReceitaWs(j: Record<string, unknown>, cnpj: string): DadosCnpj | null {
  if (!j || j.status === 'ERROR' || typeof j.nome !== 'string' || texto(j.nome) === '') return null
  return { cnpj, razao_social: texto(j.nome), nome_fantasia: texto(j.fantasia), uf: texto(j.uf).toUpperCase(), municipio: texto(j.municipio), situacao: texto(j.situacao) }
}

export async function tratar(corpo: unknown, chamador: string, deps: Deps): Promise<Resultado> {
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }
  const c = corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {}
  const cnpj = soDigitos(c.cnpj)
  if (!cnpjValido(cnpj)) return { status: 400, corpo: { erro: 'o CNPJ não está certo: confira os 14 números' } }

  let inexistente = 0
  for (const fonte of deps.fontes) {
    try {
      const d = await fonte(cnpj)
      if (d && d.uf.length === 2 && d.municipio !== '') return { status: 200, corpo: { ...d } }
      if (d === null) inexistente += 1
    } catch { /* fonte fora do ar ou limite de consultas: tenta a próxima */ }
  }
  if (inexistente > 0 && inexistente === deps.fontes.length) return { status: 404, corpo: { erro: 'esse CNPJ não aparece na consulta pública: confira os números' } }
  return { status: 502, corpo: { erro: 'não consegui consultar o CNPJ agora: preencha os dados à mão' } }
}
