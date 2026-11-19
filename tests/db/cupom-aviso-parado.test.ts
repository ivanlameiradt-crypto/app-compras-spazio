import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { novoBanco, como } from './banco'

// Aviso ao dono quando um cupom fica parado no app (decisão do Ivan, 19/11/2026): a marca durável de "já avisado" (20261231000004_cupom_aviso_parado.sql).
// Quem grava é o robô (service_role), no fluxo "Reaper do cupom" do repositório sischef-monitor-notas; aqui só se prova a coluna, a marca dos cupons antigos e o desfazer.
const AQUI = dirname(fileURLToPath(import.meta.url))
const NOME = '20261231000004_cupom_aviso_parado.sql'
const MIGRACAO = readFileSync(join(AQUI, '../../supabase/migrations', NOME), 'utf8')
const DESFAZER = readFileSync(join(AQUI, '../../supabase/rollback/20261231000004_cupom_aviso_parado.desfazer.sql'), 'utf8')

const criar = (db: PGlite, id: string, estado: string) =>
  db.query(`insert into cupom (id, estado, valor_a_pagar, itens, pagamento) values ($1, $2, 12.5, '[]'::jsonb, '{}'::jsonb)`, [id, estado])
const marca = async (db: PGlite, id: string) =>
  (await db.query<{ avisado: boolean }>('select aviso_parado_em is not null as avisado from cupom where id = $1', [id])).rows[0].avisado
const ANTIGO_PARADO = '00000000-0000-0000-0000-0000000000a1'
const ANTIGO_NA_FILA = '00000000-0000-0000-0000-0000000000a2'
const ANTIGO_LANCADO = '00000000-0000-0000-0000-0000000000a3'
const NOVO = '00000000-0000-0000-0000-0000000000a4'

let db: PGlite
beforeAll(async () => {
  // o banco de produção de hoje: todas as migrações ANTES desta, já com cupons gravados
  db = await novoBanco(NOME)
  await criar(db, ANTIGO_PARADO, 'REVISAR')
  await criar(db, ANTIGO_NA_FILA, 'PENDENTE')
  await criar(db, ANTIGO_LANCADO, 'LANCADO')
  await db.exec(MIGRACAO)
})
afterAll(async () => { await db?.close() })

describe('a marca de "dono já avisado do cupom parado" (cupom.aviso_parado_em)', () => {
  it('a coluna existe, é data com fuso e aceita nulo', async () => {
    const colunas = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_name = 'cupom' and column_name = 'aviso_parado_em'`)
    expect(colunas.rows).toEqual([{ column_name: 'aviso_parado_em', data_type: 'timestamp with time zone', is_nullable: 'YES' }])
  })
  it('o cupom que JÁ estava parado nasce marcado (sem enxurrada de avisos antigos); o da fila e o lançado ficam sem marca', async () => {
    expect(await marca(db, ANTIGO_PARADO)).toBe(true)
    expect(await marca(db, ANTIGO_NA_FILA)).toBe(false)
    expect(await marca(db, ANTIGO_LANCADO)).toBe(false)
  })
  it('cupom novo que para DEPOIS da migração nasce sem marca (é o que o robô vai avisar)', async () => {
    await criar(db, NOVO, 'REVISAR')
    expect(await marca(db, NOVO)).toBe(false)
  })
  it('é idempotente: aplicar de novo não quebra e NÃO marca o cupom novo que ainda espera o aviso', async () => {
    await db.exec(MIGRACAO)
    expect(await marca(db, NOVO)).toBe(false)
    expect(await marca(db, ANTIGO_PARADO)).toBe(true)
  })
  it('o robô e o backup (service_role) leem a coluna', async () => {
    const [r] = await como(db, 'service', 'select aviso_parado_em from cupom where id = $1', [NOVO])
    expect(r).toEqual({ aviso_parado_em: null })
  })
  it('o desfazer apaga a coluna e pode rodar duas vezes', async () => {
    await db.exec(DESFAZER)
    await db.exec(DESFAZER)
    const colunas = await db.query(`select 1 from information_schema.columns where table_name = 'cupom' and column_name = 'aviso_parado_em'`)
    expect(colunas.rows).toEqual([])
  })
})
