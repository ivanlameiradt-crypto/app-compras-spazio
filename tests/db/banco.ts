import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach } from 'vitest'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(AQUI, '../../supabase/migrations')

/** Postgres em memória com o shim do Supabase e todas as migrations (menos storage, que só existe no Supabase). */
export async function novoBanco(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(AQUI, 'shim-supabase.sql'), 'utf8'))
  let arquivos: string[] = []
  try {
    arquivos = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !f.includes('storage')).sort()
  } catch {
    arquivos = []
  }
  for (const f of arquivos) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  return db
}

/** Apaga todos os dados e reinicia os ids: o banco volta ao estado de recém-criado. */
export async function limpar(db: PGlite): Promise<void> {
  await db.exec(
    'truncate usuarios, semanas, itens_semana, compras, compras_itens, historico_alteracoes restart identity cascade',
  )
}

/**
 * Um banco por arquivo de teste (criar um PGlite leva segundos). Antes de cada teste ele é
 * esvaziado e recebe `preparar`, então todo teste começa do mesmo jeito que num banco novo.
 */
export function bancoPorArquivo(preparar?: (db: PGlite) => Promise<void>): () => PGlite {
  let db: PGlite | undefined
  beforeAll(async () => { db = await novoBanco() })
  beforeEach(async () => {
    await limpar(db!)
    if (preparar) await preparar(db!)
  })
  afterAll(async () => { await db?.close() })
  return () => db!
}

/** Executa `sql` como: um e-mail (papel authenticated), 'anon' ou 'service' (service_role). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function como(db: PGlite, quem: string, sql: string, params: unknown[] = []): Promise<any[]> {
  return db.transaction(async (tx) => {
    if (quem === 'service') {
      await tx.exec('set local role service_role')
    } else if (quem === 'anon') {
      await tx.exec('set local role anon')
    } else {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ email: quem, role: 'authenticated' }),
      ])
      await tx.exec('set local role authenticated')
    }
    return (await tx.query(sql, params)).rows
  })
}
