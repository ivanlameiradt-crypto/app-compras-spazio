import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { semear, ADMIN } from './fixture'

// E5 (compra repetida nos 3 tipos, pedido do Ivan de 04/11/2026): a marca "o Ivan disse que é OUTRA compra" (20261226000001_cupom_outra_compra.sql).
// As funções confirmar-cupom e enviar-compra-avulsa a gravam (service_role) e o robô a lê para não conferir de novo: duas colunas novas em `cupom`, nulas por padrão.
const atual = bancoPorArquivo(semear)
const banco = async () => atual()
const ID = '00000000-0000-0000-0000-0000000000d1'

async function criar(db: PGlite): Promise<void> {
  await db.query(`insert into cupom (id, estado, valor_a_pagar, itens, pagamento) values ($1, 'REVISAR', 12.5, '[]'::jsonb, '{}'::jsonb)`, [ID])
}

describe('a marca de "outra compra" (cupom.outra_compra_ok_em / outra_compra_ok_por)', () => {
  it('as duas colunas existem, aceitam nulo e começam nulas (cupom antigo e cupom novo sem decisão)', async () => {
    const db = await banco()
    await criar(db)
    const [c] = await como(db, ADMIN, 'select outra_compra_ok_em, outra_compra_ok_por from cupom where id = $1', [ID])
    expect(c).toEqual({ outra_compra_ok_em: null, outra_compra_ok_por: null })
    const colunas = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_name = 'cupom' and column_name in ('outra_compra_ok_em', 'outra_compra_ok_por') order by 1`)
    expect(colunas.rows).toEqual([
      { column_name: 'outra_compra_ok_em', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'outra_compra_ok_por', data_type: 'text', is_nullable: 'YES' },
    ])
  })
  it('a função do servidor (dono do banco) grava a marca e o admin a lê', async () => {
    const db = await banco()
    await criar(db)
    await db.query(`update cupom set outra_compra_ok_em = now(), outra_compra_ok_por = 'ivan@exemplo.com' where id = $1`, [ID])
    const [c] = await como(db, ADMIN, 'select outra_compra_ok_por, outra_compra_ok_em is not null as marcado from cupom where id = $1', [ID])
    expect(c).toEqual({ outra_compra_ok_por: 'ivan@exemplo.com', marcado: true })
  })
  it('é idempotente: aplicar a migração de novo (add column if not exists) não quebra nem apaga a marca', async () => {
    const db = await banco()
    await criar(db)
    await db.query(`update cupom set outra_compra_ok_em = now() where id = $1`, [ID])
    await db.query(`alter table public.cupom add column if not exists outra_compra_ok_em timestamptz, add column if not exists outra_compra_ok_por text`)
    const [c] = await como(db, ADMIN, 'select outra_compra_ok_em is not null as marcado from cupom where id = $1', [ID])
    expect(c).toEqual({ marcado: true })
  })
})
