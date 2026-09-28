import type { PGlite } from '@electric-sql/pglite'

/**
 * Relógio de negócio da cotação (contrato 7): recria public.cot_agora() com a mesma assinatura e
 * atributos da migration, devolvendo o instante `quando` (ISO, ex.: '2026-10-19T18:00:00Z'), ou now()
 * com null. `create or replace` mantém as permissões (a função continua sem grant).
 * Usado também pelos testes privados (@app-db/relogio).
 */
export async function fixarRelogio(db: PGlite, quando: string | null): Promise<void> {
  if (quando !== null && Number.isNaN(Date.parse(quando))) throw new Error(`instante inválido: ${quando}`)
  const corpo = quando === null ? 'select now()' : `select '${quando}'::timestamptz`
  await db.exec(
    `create or replace function public.cot_agora() returns timestamptz ` +
      `language sql stable set search_path = public as $$ ${corpo} $$`,
  )
}
