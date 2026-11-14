import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO } from './fixture-recebimento'
import type { Json } from './fixture-cotacao'

// Etapa 6 (14/11/2026): sugestões ESTRUTURADAS do robô (20261229000001_sugestoes_estruturadas_do_robo.sql): cot_nfe.lancamento_sugestoes e cupom.sugestoes, nulas por padrão;
// cot_nfe_marcar_estado grava a lista do campo opcional "sugestoes" de `p`, com a MESMA assinatura de sempre.
const AQUI = dirname(fileURLToPath(import.meta.url))
const MIGRACAO = join(AQUI, '../../supabase/migrations/20261229000001_sugestoes_estruturadas_do_robo.sql')
const DESFAZER = join(AQUI, '../../supabase/rollback/20261229000001_sugestoes_estruturadas_do_robo.desfazer.sql')

const atual = bancoRecebimento(null)
const banco = async () => atual()
const CHAVE = '15261012345678000190550010001234561000000017'
const CUPOM = '00000000-0000-0000-0000-0000000000e6'
const SUG = [
  { codigo: 'conversao_desnecessaria', item_n: 5, acao: 'tirar_conversao', dados: { numero: 0.24 } },
  { codigo: 'itens_mesmo_codigo', item_n: 1, acao: 'associar_no_sischef', dados: { itens: [1, 2], cod_for: '0009085' } },
]

async function nota(db: PGlite): Promise<void> {
  const n = { chave: CHAVE, emitente: 'FORNECEDOR A LTDA', numero: '000123456', emissao: '2026-10-18', valor_nf: 378,
    totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
    itens: [{ n: 1, cod_forn: '17253', descricao: 'REFRIG COLA', qtd_nf: 9, unidade_nf: 'FD', produto_id: null, associacao: null, qtd: null, unidade_sischef: 'UN', v_prod: 0, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }] }
  const leitura = { lida_em: '2026-10-20T15:03:10Z', completa: true, origem: 'agendada', notas: [n] }
  await chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify(leitura)])
}
const estado = (db: PGlite, p: Json, seg = SEGREDO) => chamar(db, 'anon', 'cot_nfe_marcar_estado($1, $2::jsonb)', [seg, JSON.stringify(p)])
const lida = async (db: PGlite) => (await como(db, ADMIN, 'select lancamento_estado, lancamento_motivo, lancamento_sugestoes from cot_nfe where chave = $1', [CHAVE]))[0]
const cupomNovo = (db: PGlite) => db.query(`insert into cupom (id, estado, valor_a_pagar, itens, pagamento) values ($1, 'REVISAR', 12.5, '[]'::jsonb, '{}'::jsonb)`, [CUPOM])

describe('as colunas novas (cot_nfe.lancamento_sugestoes e cupom.sugestoes)', () => {
  it('existem como jsonb, aceitam nulo e começam nulas', async () => {
    const db = await banco()
    await nota(db)
    await cupomNovo(db)
    expect((await lida(db)).lancamento_sugestoes).toBeNull()
    const [c] = await como(db, ADMIN, 'select sugestoes from cupom where id = $1', [CUPOM])
    expect(c.sugestoes).toBeNull()
    const cols = await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_name, column_name, data_type, is_nullable from information_schema.columns
        where (table_name = 'cot_nfe' and column_name = 'lancamento_sugestoes') or (table_name = 'cupom' and column_name = 'sugestoes') order by 1`)
    expect(cols.rows).toEqual([
      { table_name: 'cot_nfe', column_name: 'lancamento_sugestoes', data_type: 'jsonb', is_nullable: 'YES' },
      { table_name: 'cupom', column_name: 'sugestoes', data_type: 'jsonb', is_nullable: 'YES' },
    ])
  })
  it('só aceitam lista (array) de até 20 itens', async () => {
    const db = await banco()
    await nota(db)
    await expect(db.query(`update cot_nfe set lancamento_sugestoes = '{"a":1}'::jsonb where chave = $1`, [CHAVE])).rejects.toThrow(/check/)
    await expect(db.query(`update cot_nfe set lancamento_sugestoes = (select jsonb_agg(i) from generate_series(1, 21) i) where chave = $1`, [CHAVE])).rejects.toThrow(/check/)
    await cupomNovo(db)
    await expect(db.query(`update cupom set sugestoes = '"texto"'::jsonb where id = $1`, [CUPOM])).rejects.toThrow(/check/)
    await db.query(`update cupom set sugestoes = $2::jsonb where id = $1`, [CUPOM, JSON.stringify(SUG)])
    const [c] = await como(db, ADMIN, 'select sugestoes from cupom where id = $1', [CUPOM])
    expect(c.sugestoes).toEqual(SUG)
  })
  it('o admin lê e quem não é admin não vê nada (a RLS da tabela vale para a coluna nova)', async () => {
    const db = await banco()
    await nota(db)
    await db.query(`update cot_nfe set lancamento_sugestoes = $2::jsonb where chave = $1`, [CHAVE, JSON.stringify(SUG)])
    expect((await lida(db)).lancamento_sugestoes).toEqual(SUG)
    expect(await como(db, 'joao@spazio.com', 'select lancamento_sugestoes from cot_nfe where chave = $1', [CHAVE])).toEqual([])
  })
  it('o service_role (backup) lê as duas colunas', async () => {
    const db = await banco()
    await nota(db)
    await db.exec('set role service_role')
    try {
      expect((await db.query('select lancamento_sugestoes from cot_nfe')).rows).toHaveLength(1)
      await db.query('select sugestoes from cupom')
    } finally { await db.exec('reset role') }
  })
})

describe('cot_nfe_marcar_estado com sugestões', () => {
  it('grava a lista junto do estado e do motivo', async () => {
    const db = await banco()
    await nota(db)
    expect(Number(await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'texto do robô', sugestoes: SUG }))).toBe(1)
    expect(await lida(db)).toEqual({ lancamento_estado: 'revisar', lancamento_motivo: 'texto do robô', lancamento_sugestoes: SUG })
  })
  it('a chamada ANTIGA (sem "sugestoes") continua valendo e o novo estado SUBSTITUI a lista anterior', async () => {
    const db = await banco()
    await nota(db)
    await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'a', sugestoes: SUG })
    expect(Number(await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'b' }))).toBe(1)
    expect(await lida(db)).toEqual({ lancamento_estado: 'revisar', lancamento_motivo: 'b', lancamento_sugestoes: null })
  })
  it('lista malformada (não é array, vazia, grande demais) é ignorada: o estado e o motivo gravam do mesmo jeito', async () => {
    const db = await banco()
    await nota(db)
    const grande = Array.from({ length: 21 }, (_, i) => ({ codigo: 'x', item_n: i, acao: 'a', dados: {} }))
    const pesada = [{ codigo: 'x', item_n: 1, acao: 'a', dados: { lixo: 'y'.repeat(9000) } }]
    for (const ruim of [{ a: 1 }, 'texto', 7, [], grande, pesada]) {
      expect(Number(await estado(db, { chave: CHAVE, estado: 'erro', motivo: 'm', sugestoes: ruim }))).toBe(1)
      expect(await lida(db)).toEqual({ lancamento_estado: 'erro', lancamento_motivo: 'm', lancamento_sugestoes: null })
    }
  })
  it('continua recusando segredo errado e estado inválido, e ignorando nota já lançada e chave desconhecida', async () => {
    const db = await banco()
    await nota(db)
    await expect(estado(db, { chave: CHAVE, estado: 'revisar', sugestoes: SUG }, 'errado')).rejects.toThrow()
    await expect(estado(db, { chave: CHAVE, estado: 'lancando', sugestoes: SUG })).rejects.toThrow(/estado inválido/)
    expect(Number(await estado(db, { chave: '9'.repeat(44), estado: 'revisar', sugestoes: SUG }))).toBe(0)
    await db.query(`update cot_nfe set situacao = 'lancada' where chave = $1`, [CHAVE])
    expect(Number(await estado(db, { chave: CHAVE, estado: 'revisar', sugestoes: SUG }))).toBe(0)
    expect((await lida(db)).lancamento_sugestoes).toBeNull()
  })
  it('existe UMA função só com esse nome (sem segunda versão que dê ambiguidade no PostgREST) e authenticated continua sem executar', async () => {
    const db = await banco()
    const f = await db.query<{ args: string }>(`select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'cot_nfe_marcar_estado' and pronamespace = 'public'::regnamespace`)
    expect(f.rows).toEqual([{ args: 'p_segredo text, p jsonb' }])
    await expect(como(db, ADMIN, `select cot_nfe_marcar_estado($1, '{}'::jsonb)`, [SEGREDO])).rejects.toThrow(/permission denied/)
  })
})

describe('idempotência e desfazer', () => {
  it('aplicar a migração de novo não quebra nem apaga as sugestões já gravadas', async () => {
    const db = await banco()
    await nota(db)
    await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'm', sugestoes: SUG })
    await db.exec(readFileSync(MIGRACAO, 'utf8'))
    expect((await lida(db)).lancamento_sugestoes).toEqual(SUG)
  })
  it('o script de desfazer apaga as colunas, devolve a função antiga (que ignora "sugestoes") e deixa o motivo intacto; depois dá para reaplicar', async () => {
    const db = await banco()
    await nota(db)
    await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'm', sugestoes: SUG })
    await db.exec(readFileSync(DESFAZER, 'utf8'))
    const cols = await db.query(`select 1 from information_schema.columns where (table_name = 'cot_nfe' and column_name = 'lancamento_sugestoes') or (table_name = 'cupom' and column_name = 'sugestoes')`)
    expect(cols.rows).toHaveLength(0)
    expect(Number(await estado(db, { chave: CHAVE, estado: 'erro', motivo: 'depois', sugestoes: SUG }))).toBe(1)
    const [r] = await como(db, ADMIN, 'select lancamento_estado, lancamento_motivo from cot_nfe where chave = $1', [CHAVE])
    expect(r).toEqual({ lancamento_estado: 'erro', lancamento_motivo: 'depois' })
    await db.exec(readFileSync(MIGRACAO, 'utf8'))
    expect(Number(await estado(db, { chave: CHAVE, estado: 'revisar', motivo: 'de novo', sugestoes: SUG }))).toBe(1)
    expect((await lida(db)).lancamento_sugestoes).toEqual(SUG)
  })
})
