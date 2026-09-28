import type { PGlite } from '@electric-sql/pglite'
import { como } from './banco'

// PostgREST de mentira sobre o PGlite, para o teste de integração da cotação (tests/db/cotacao_integracao.test.ts):
// as três partes (App, página do vendedor e robô) chamam o banco pelo PostgREST, e o que precisa ser conferido é o
// que ELE faria com o corpo de cada uma. Como o PostgREST:
//  - RPC chama a função POR NOME: `select f(p_a := x.p_a) from jsonb_to_record(<corpo>) as x(p_a <tipo do parâmetro>)`;
//    chave do corpo que não é parâmetro (ou parâmetro obrigatório que falta) = "função não encontrada" (PGRST202);
//    JSON null vira SQL null; lista JSON num parâmetro bigint[] vira array;
//  - devolve JSON: o valor da função (jsonb, bigint, boolean…), a lista de linhas de uma função `returns table`, null no
//    void; leitura de tabela/view = lista de linhas com as colunas pedidas (numeric como número, carimbo como texto ISO);
//  - cada requisição é uma transação com o papel de quem chama (anon, authenticated com o e-mail, service_role): RLS,
//    grants e exigir_admin() valem como em produção;
//  - erro vira { message, code } (P0001 das regras, 42501 de permissão…), como o supabase-js entrega ao App.
// Só o que o App, a página e o robô usam: rpc e from().select() com eq/neq/gte/in/or/order/limit/maybeSingle.
// O teste privado do robô (compra-semanal/tests/app_real/cotacao_robo.test.ts, pelo apelido @app-db) serve estas mesmas
// funções por HTTP em 127.0.0.1 para o cot_banco.py de verdade.

export interface RespostaRest { data: unknown; error: { message: string; code?: string } | null; status: number }

interface Parametro { nome: string; tipo: string; comDefault: boolean }
interface Assinatura { parametros: Parametro[]; conjunto: boolean; retorno: string }

const NOME = /^[a-z_][a-z0-9_]*$/

async function assinaturas(db: PGlite, nome: string): Promise<Assinatura[]> {
  // modos: null = todos IN; 'i'/'b'/'v' entram na chamada; 'o'/'t' são colunas de saída (returns table)
  const r = await db.query<{ nomes: string[] | null; modos: string[] | null; tipos: string[]; ndef: number; conjunto: boolean; retorno: string }>(
    `select p.proargnames as nomes, p.proargmodes::text[] as modos, p.pronargdefaults as ndef, p.proretset as conjunto,
            format_type(p.prorettype, null) as retorno,
            array(select format_type(u.t, null) from unnest(p.proargtypes) with ordinality u(t, i) order by u.i) as tipos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [nome])
  return r.rows.map((l) => {
    const nomesEntrada = (l.nomes ?? []).filter((_, i) => !l.modos || ['i', 'b', 'v'].includes(l.modos[i]))
    const n = l.tipos.length
    return {
      parametros: l.tipos.map((tipo, i) => ({ nome: nomesEntrada[i] ?? '', tipo, comDefault: i >= n - l.ndef })),
      conjunto: l.conjunto,
      retorno: l.retorno,
    }
  })
}

function falha(e: unknown, status = 400): RespostaRest {
  const x = e as { message?: string; code?: string }
  const code = x.code
  return { data: null, error: { message: x.message ?? String(e), code }, status: code === '42501' ? 403 : status }
}

/** POST /rest/v1/rpc/<nome> com o corpo JSON, como `quem` (e-mail do usuário, 'anon' ou 'service'). */
export async function rpcRest(db: PGlite, quem: string, nome: string, corpo: Record<string, unknown> = {}): Promise<RespostaRest> {
  if (!NOME.test(nome)) return falha({ message: `nome de função inválido: ${nome}`, code: 'PGRST202' }, 404)
  // o corpo passa por JSON, como no fio (undefined some, Date vira texto)
  const json = JSON.parse(JSON.stringify(corpo ?? {})) as Record<string, unknown>
  const chaves = Object.keys(json)
  const candidatas = (await assinaturas(db, nome)).filter((a) =>
    chaves.every((k) => a.parametros.some((p) => p.nome === k)) &&
    a.parametros.every((p) => p.comDefault || chaves.includes(p.nome)))
  if (candidatas.length !== 1) {
    return falha({
      message: `Could not find the function public.${nome}(${chaves.join(', ')}) in the schema cache`, code: 'PGRST202',
    }, 404)
  }
  const a = candidatas[0]
  const usados = a.parametros.filter((p) => chaves.includes(p.nome))
  const chamada = `public.${nome}(${usados.map((p) => `${p.nome} := x.${p.nome}`).join(', ')})`
  // os argumentos saem do corpo JSON com o tipo declarado do parâmetro, como no PostgREST
  const args = usados.length === 0 ? '' : `jsonb_to_record($1::jsonb) as x(${usados.map((p) => `${p.nome} ${p.tipo}`).join(', ')})`
  const sql = a.conjunto
    ? `select coalesce(jsonb_agg(to_jsonb(_linha)), '[]'::jsonb) as r from (select y.* from ` +
      `${args ? `${args} cross join lateral ` : ''}${chamada} y) _linha`
    : a.retorno === 'void'
      ? `select ${chamada} as r${args ? ` from ${args}` : ''}`
      : `select to_jsonb(${chamada}) as r${args ? ` from ${args}` : ''}`
  try {
    const linhas = await como(db, quem, sql, usados.length === 0 ? [] : [JSON.stringify(json)])
    const r = a.retorno === 'void' ? null : (linhas[0]?.r ?? null)
    return { data: r, error: null, status: a.retorno === 'void' ? 204 : 200 }
  } catch (e) {
    return falha(e)
  }
}

// ---------- leitura de tabela/view (GET /rest/v1/<tabela>?select=…)

/** Filtro do `.or()` do supabase-js (árvore lógica do PostgREST): "a.eq.1,and(b.is.null,c.gt.\"2026-…\")". */
function arvore(texto: string, param: (v: unknown) => string, juntar = ' or '): string {
  const partes: string[] = []
  let nivel = 0, aspas = false, atual = ''
  for (const ch of texto) {
    if (ch === '"') aspas = !aspas
    if (!aspas && ch === '(') nivel++
    if (!aspas && ch === ')') nivel--
    if (!aspas && nivel === 0 && ch === ',') { partes.push(atual); atual = ''; continue }
    atual += ch
  }
  if (atual) partes.push(atual)
  const termos = partes.map((p) => {
    const m = /^(and|or)\((.*)\)$/.exec(p)
    if (m) return `(${arvore(m[2], param, m[1] === 'and' ? ' and ' : ' or ')})`
    const f = /^([a-z_][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/.exec(p)
    if (!f) throw new Error(`filtro que o teste não entende: ${p}`)
    const [, col, op, bruto] = f
    const valor = bruto.replace(/^"(.*)"$/, '$1')
    if (op === 'is') {
      if (!['null', 'true', 'false'].includes(valor)) throw new Error(`is.${valor}`)
      return `${col} is ${valor}`
    }
    if (op === 'in') {
      const lista = /^\((.*)\)$/.exec(valor)
      if (!lista) throw new Error(`in sem parênteses: ${p}`)
      return `${col}::text = any(${param(lista[1].split(',').map((x) => x.replace(/^"(.*)"$/, '$1')))}::text[])`
    }
    const sinal = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]
    return `${col} ${sinal} ${param(valor)}`
  })
  return termos.join(juntar)
}

export class ConsultaRest implements PromiseLike<RespostaRest> {
  private colunas = '*'
  private filtros: string[] = []
  private params: unknown[] = []
  private ordem: string[] = []
  private limite: number | null = null
  private uma = false

  constructor(private db: PGlite, private quem: string, private tabela: string) {}

  private p(v: unknown): string {
    this.params.push(v)
    return `$${this.params.length}`
  }
  select(colunas = '*') {
    if (!/^[a-z0-9_*,\s]+$/.test(colunas)) throw new Error(`select que o teste não entende: ${colunas}`)
    this.colunas = colunas
    return this
  }
  eq(c: string, v: unknown) { this.filtros.push(`${c} = ${this.p(v)}`); return this }
  neq(c: string, v: unknown) { this.filtros.push(`${c} <> ${this.p(v)}`); return this }
  gte(c: string, v: unknown) { this.filtros.push(`${c} >= ${this.p(v)}`); return this }
  in(c: string, vs: unknown[]) { this.filtros.push(`${c}::text = any(${this.p(vs.map(String))}::text[])`); return this }
  or(texto: string) { this.filtros.push(`(${arvore(texto, (v) => this.p(v))})`); return this }
  order(c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const nulos = o.nullsFirst === undefined ? '' : o.nullsFirst ? ' nulls first' : ' nulls last'
    this.ordem.push(`${c} ${o.ascending === false ? 'desc' : 'asc'}${nulos}`)
    return this
  }
  limit(n: number) { this.limite = n; return this }
  maybeSingle() { this.uma = true; return this }

  private async executar(): Promise<RespostaRest> {
    if (!NOME.test(this.tabela)) return falha({ message: `tabela inválida: ${this.tabela}`, code: '42P01' })
    const sql = `select coalesce(jsonb_agg(to_jsonb(_linha)), '[]'::jsonb) as r from (select ${this.colunas} from public.${this.tabela}` +
      (this.filtros.length ? ` where ${this.filtros.join(' and ')}` : '') +
      (this.ordem.length ? ` order by ${this.ordem.join(', ')}` : '') +
      (this.limite !== null ? ` limit ${Math.trunc(this.limite)}` : '') + ') _linha'
    try {
      const [l] = await como(this.db, this.quem, sql, this.params)
      const linhas = l.r as unknown[]
      if (!this.uma) return { data: linhas, error: null, status: 200 }
      if (linhas.length > 1) return falha({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
      return { data: linhas[0] ?? null, error: null, status: 200 }
    } catch (e) {
      return falha(e)
    }
  }

  then<A = RespostaRest, B = never>(ok?: ((r: RespostaRest) => A | PromiseLike<A>) | null,
    erro?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.executar().then(ok, erro)
  }
}

/** Cliente no formato do supabase-js (só rpc e from) que fala com o PGlite como `quem()`. */
export function clienteRest(db: () => PGlite, quem: () => string) {
  return {
    rpc: (nome: string, args: Record<string, unknown> = {}) => rpcRest(db(), quem(), nome, args),
    from: (tabela: string) => new ConsultaRest(db(), quem(), tabela),
  }
}
