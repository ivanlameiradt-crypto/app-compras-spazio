// tests/db/pgliteSupabase.ts — um "supabase-js" mínimo sobre o PGlite (Postgres de verdade, em memória), para provar as Edge Functions CONTRA O ESQUEMA REAL das migrações.
// Cobre exatamente as cadeias que supabase/functions/cadastrar-fornecedor/index.ts usa, e roda cada pedido como service_role (como a Edge Function).
// Assim o teste prova nomes de coluna, CHECKs, NOT NULL, o índice único parcial (23505) e grants — coisas que a lógica pura (deps falsas) não alcança.
// Origem: revisão independente do PR 63 (31/10/2026), que achou que o index.ts não tinha NENHUM teste de verdade e ficava fora do tsc.
import type { PGlite } from '@electric-sql/pglite'
import { como } from './banco'

type Linha = Record<string, unknown>
type Erro = { code?: string; message: string }
const ID = /^[a-z_][a-z0-9_]*$/
const ident = (s: string): string => { if (!ID.test(s)) throw new Error(`identificador inválido: ${s}`); return s }

export interface Registro { sql: string; params: unknown[] }

class Consulta {
  private filtros: { sql: string; valor: unknown }[] = []
  private colunas = '*'
  private ordem = ''
  private limite = ''
  private modo: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private dados: Linha | null = null
  private conflito = ''
  private comRetorno = false
  constructor(private db: PGlite, private tabela: string, private log: Registro[]) {}

  select(colunas = '*') {
    const cols = colunas.trim() === '*' ? '*' : colunas.split(',').map((c) => ident(c.trim())).join(', ')
    if (this.modo === 'select') this.colunas = cols
    else { this.comRetorno = true; this.colunas = cols }
    return this
  }
  eq(coluna: string, valor: unknown) { this.filtros.push({ sql: `${ident(coluna)} = $?`, valor }); return this }
  lt(coluna: string, valor: unknown) { this.filtros.push({ sql: `${ident(coluna)} < $?`, valor }); return this }
  in(coluna: string, valores: unknown[]) { this.filtros.push({ sql: `${ident(coluna)}::text = any($?::text[])`, valor: valores }); return this }
  order(coluna: string, o?: { ascending?: boolean }) { this.ordem = ` order by ${ident(coluna)} ${o?.ascending === false ? 'desc' : 'asc'}`; return this }
  limit(n: number) { this.limite = ` limit ${Number(n)}`; return this }
  insert(linha: Linha) { this.modo = 'insert'; this.dados = linha; return this }
  upsert(linha: Linha, o?: { onConflict?: string }) { this.modo = 'upsert'; this.dados = linha; this.conflito = ident(o?.onConflict ?? 'id'); return this }
  update(mudancas: Linha) { this.modo = 'update'; this.dados = mudancas; return this }

  private async rodar(): Promise<{ data: Linha[] | null; error: Erro | null }> {
    const params: unknown[] = []
    const p = (v: unknown) => { params.push(v); return `$${params.length}` }
    const onde = (): string => this.filtros.length === 0 ? '' : ' where ' + this.filtros.map((f) => f.sql.replace('$?', p(f.valor))).join(' and ')
    const t = `public.${ident(this.tabela)}`
    let sql: string
    if (this.modo === 'select') {
      sql = `select ${this.colunas} from ${t}${onde()}${this.ordem}${this.limite}`
    } else if (this.modo === 'insert' || this.modo === 'upsert') {
      const cols = Object.keys(this.dados!).map(ident)
      const vals = cols.map((c) => p(this.dados![c]))
      sql = `insert into ${t} (${cols.join(', ')}) values (${vals.join(', ')})`
      if (this.modo === 'upsert') sql += ` on conflict (${this.conflito}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`
      sql += ` returning ${this.comRetorno ? this.colunas : '*'}`
    } else {
      const sets = Object.keys(this.dados!).map((c) => `${ident(c)} = ${p(this.dados![c])}`)
      sql = `update ${t} set ${sets.join(', ')}${onde()} returning *`
    }
    this.log.push({ sql, params })
    try {
      const linhas = (await como(this.db, 'service', sql, params)) as Linha[]
      return { data: linhas, error: null }
    } catch (e) {
      const x = e as { code?: string; message?: string }
      return { data: null, error: { code: x.code, message: x.message ?? String(e) } }
    }
  }
  async maybeSingle() {
    const r = await this.rodar()
    if (r.error) return { data: null, error: r.error }
    if ((r.data ?? []).length > 1) return { data: null, error: { code: 'PGRST116', message: 'mais de uma linha' } }
    return { data: (r.data ?? [])[0] ?? null, error: null }
  }
  async single() {
    const r = await this.rodar()
    if (r.error) return { data: null, error: r.error }
    if ((r.data ?? []).length !== 1) return { data: null, error: { code: 'PGRST116', message: 'esperava 1 linha' } }
    return { data: r.data![0], error: null }
  }
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
    return this.rodar().then((r) => (this.modo === 'select' || this.comRetorno ? r : { data: null, error: r.error })).then(resolve, reject)
  }
}

/** O cliente "admin" (service_role) que o index.ts recebe de createClient. `tokens` = token → e-mail (auth.getUser). */
export function clienteSobrePglite(db: PGlite, tokens: Record<string, string>, log: Registro[] = []) {
  return {
    auth: {
      async getUser(token: string) {
        const email = tokens[token]
        return email ? { data: { user: { email } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
    },
    from: (tabela: string) => new Consulta(db, tabela, log),
  }
}
