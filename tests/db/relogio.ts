import type { PGlite } from '@electric-sql/pglite'

/**
 * Instante fixo dos testes do banco: o preparo das fixtures de cotação (seg 19/10/2026 15:00 de Brasília, igual ao
 * PREPARO de fixture-cotacao.ts). Não se usa o relógio real: as fixtures são de outubro de 2026 e as regras de 30 dias
 * (cot_agora() - interval '30 days') fariam os testes quebrarem conforme o dia passa (o de frete da NF-e quebrou no CI
 * em 08/11/2026). Pode ser trocado pela variável de ambiente RELOGIO_TESTES (ISO com fuso). Manter igual ao PREPARO:
 * importá-lo de fixture-cotacao.ts criaria um import circular (fixture-cotacao já importa este arquivo).
 */
export const RELOGIO_DOS_TESTES: string = process.env.RELOGIO_TESTES || '2026-10-19T18:00:00Z'

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
