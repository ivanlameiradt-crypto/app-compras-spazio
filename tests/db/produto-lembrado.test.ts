import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bancoRecebimento, chamar, ADMIN } from './fixture-recebimento'
import { como } from './banco'

// Produto lembrado por fornecedor (20261230000001, 14/11/2026): cot_nfe_produto_lembrado(cnpj) lê as notas LANÇADAS e devolve o produto que o Ivan escolheu
// por CÓD. FOR + unidade da nota, só quando todas as decisões concordam (produto e conversão), com preço por unidade da nota e unidade do produto;
// cot_nfe_associar_lembrado grava sozinho (origem 'lembrado', nunca sobrescreve) e cot_nfe_recusar_lembrado guarda a recusa do Ivan.
const AQUI = dirname(fileURLToPath(import.meta.url))
const MIGRACAO = join(AQUI, '../../supabase/migrations/20261230000001_produto_lembrado_por_fornecedor.sql')
const DESFAZER = join(AQUI, '../../supabase/rollback/20261230000001_produto_lembrado_por_fornecedor.desfazer.sql')

const atual = bancoRecebimento(null)
const banco = async () => atual()
const CNPJ = '12345678000190'
const OUTRO = '99887766000155'
let seq = 0
const chaveDe = (cnpj: string) => `152610${cnpj}55001000${String(++seq).padStart(9, '0')}10000000`.slice(0, 44)

interface Item { n: number; descricao: string; unidade?: string | null; valor?: number; qtd?: number; produto_id?: number | null }
async function nota(db: PGlite, o: { cnpj?: string; situacao?: string; lancada?: string | null; itens: Item[]; assoc?: Record<string, unknown> | null }): Promise<string> {
  const cnpj = o.cnpj ?? CNPJ
  const chave = chaveDe(cnpj)
  const itens = o.itens.map((i) => ({ n: i.n, descricao: i.descricao, unidade_sischef: i.unidade === undefined ? 'CX' : i.unidade, valor: i.valor ?? 75, qtd: i.qtd ?? 2, produto_id: i.produto_id ?? null }))
  const situacao = o.situacao ?? 'lancada'
  const lancada = situacao !== 'lancada' ? null : o.lancada === undefined ? '2026-11-05T15:00:00Z' : o.lancada
  await db.query(
    `insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens, situacao, primeiro_visto_em, visto_na_fila_em, lancada_em, atualizado_em, associacoes_app)
     values ($1, $2, 'OLIVEIRA E OLIVEIRA', '1', '2026-11-01', 100, true, $3::jsonb, $4, now(), now(), $5::timestamptz, now(), $6::jsonb)`,
    [chave, cnpj, JSON.stringify(itens), situacao, lancada, o.assoc == null ? null : JSON.stringify(o.assoc)])
  return chave
}
const GUARANA = (sh: string, extra: Partial<Item> = {}): Item => ({ n: 1, descricao: `CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET LT 350ML SH ${sh}`, ...extra })
const DEC = (conv: number | null = 12, produto = 3324211, origem = 'lista', unidade: string | null = 'un') => ({ '1': { produto_id: produto, produto_nome: 'GUARANÁ DIET LATA', unidade, conversao: conv, origem } })
const ler = async (db: PGlite, cnpj = CNPJ, quem = ADMIN) => (await como(db, quem, 'select cot_nfe_produto_lembrado($1) as r', [cnpj]))[0].r
const autoAssociar = async (db: PGlite, chave: string, n = 1, produto = 101, conv: number | null = 12, quem = ADMIN) =>
  (await como(db, quem, 'select cot_nfe_associar_lembrado($1, $2, $3, $4) as r', [chave, n, produto, conv]))[0].r
const recusar = (db: PGlite, chave: string, n = 1, quem = ADMIN) => como(db, quem, 'select cot_nfe_recusar_lembrado($1, $2)', [chave, n])
const insumo = (db: PGlite) => db.exec(`insert into semanas (data_referencia, status) values ('2026-11-09', 'em_compra');
  insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, situacao, incluido) select id, 101, 'GUARANA DIET LATA', true, 'un', 1, 'Repor', true from semanas`)
const assocDe = async (db: PGlite, chave: string) => (await db.query<{ a: Record<string, Record<string, unknown>> | null; r: number[] | null }>('select associacoes_app a, lembrado_recusado r from cot_nfe where chave = $1', [chave])).rows[0]

describe('cot_nfe_produto_lembrado', () => {
  it('duas notas que concordam: produto, conversão, unidade, preço por unidade da nota, vezes 2 e a última data', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('32,7000', { valor: 70, qtd: 2 })], assoc: DEC(), lancada: '2026-11-01T15:00:00Z' })
    await nota(db, { itens: [GUARANA('35,1600', { valor: 75, qtd: 2 })], assoc: DEC(), lancada: '2026-11-08T15:00:00Z' })
    const r = await ler(db)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cod_forn: '0009085', unidade_nota: 'CX', produto_id: 3324211, produto_nome: 'GUARANÁ DIET LATA', unidade: 'un', conversao: 12, preco_ref: 37.5, vezes: 2 })
    expect(new Date(r[0].ultima_em).toISOString()).toBe('2026-11-08T15:00:00.000Z')
  })
  it('só uma nota lançada já vale; sem valor ou quantidade na linha o preço fica nulo', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('32,35', { valor: 0 })], assoc: DEC() })
    const r = await ler(db)
    expect(r).toHaveLength(1)
    expect(r[0].preco_ref).toBeNull()
  })
  it('nota sem lancada_em: ultima_em nula (nunca outra data)', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(), lancada: null })
    expect((await ler(db))[0].ultima_em).toBeNull()
  })
  it('produtos diferentes: não devolve nada', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(12, 3324211) })
    await nota(db, { itens: [GUARANA('2')], assoc: DEC(12, 1111) })
    expect(await ler(db)).toEqual([])
  })
  it('conversão diferente: não devolve nada', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(12) })
    await nota(db, { itens: [GUARANA('2')], assoc: DEC(6) })
    expect(await ler(db)).toEqual([])
  })
  it('uma com conversão e outra sem: não devolve; as duas sem: devolve conversão nula', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(12) })
    await nota(db, { itens: [GUARANA('2')], assoc: DEC(null) })
    expect(await ler(db)).toEqual([])
    await db.query(`update cot_nfe set associacoes_app = $1::jsonb`, [JSON.stringify(DEC(null))])
    const r = await ler(db)
    expect(r).toHaveLength(1)
    expect(r[0].conversao).toBeNull()
  })
  it('nota na fila (ou que saiu da fila) é ignorada', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(), situacao: 'na_fila' })
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(), situacao: 'saiu_da_fila' })
    expect(await ler(db)).toEqual([])
    await nota(db, { itens: [GUARANA('2')], assoc: DEC(6), situacao: 'na_fila' })
    await nota(db, { itens: [GUARANA('3')], assoc: DEC(12) })
    expect((await ler(db))[0]).toMatchObject({ conversao: 12, vezes: 1 })
  })
  it('outro CNPJ não entra; CNPJ com pontuação é aceito', async () => {
    const db = await banco()
    await nota(db, { cnpj: OUTRO, itens: [GUARANA('1')], assoc: DEC() })
    expect(await ler(db)).toEqual([])
    expect(await ler(db, '99.887.766/0001-55')).toHaveLength(1)
  })
  it('unidade separa: CX e UN são linhas diferentes; item sem unidade fica de fora', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(12) })
    await nota(db, { itens: [GUARANA('2', { unidade: 'un' })], assoc: DEC(null) })
    await nota(db, { itens: [GUARANA('3', { unidade: null })], assoc: DEC(6) })
    const r = await ler(db)
    expect(r.map((x: { unidade_nota: string; conversao: number | null }) => [x.unidade_nota, x.conversao])).toEqual([['CX', 12], ['UN', null]])
  })
  it('decisões de origem sischef e lembrado (gravação automática) e sem produto ficam de fora do aprendizado', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(6, 3324211, 'sischef') })
    await nota(db, { itens: [GUARANA('2')], assoc: DEC(6, 3324211, 'lembrado') })
    await nota(db, { itens: [GUARANA('2')], assoc: { '1': { produto_id: null, conversao: 12, origem: 'lista' } } })
    expect(await ler(db)).toEqual([])
    await nota(db, { itens: [GUARANA('3')], assoc: DEC(12) })
    expect((await ler(db))[0]).toMatchObject({ produto_id: 3324211, conversao: 12, vezes: 1 })
  })
  it('sem CÓD. FOR na descrição: fica de fora; casa o item pelo n, não pela posição', async () => {
    const db = await banco()
    await nota(db, { itens: [{ n: 1, descricao: 'GUARANA SEM CODIGO' }], assoc: DEC() })
    expect(await ler(db)).toEqual([])
    await nota(db, { itens: [{ n: 2, descricao: 'COD FOR 777 OUTRO' }, { n: 1, descricao: 'cód. for: 0009085 X' }], assoc: DEC() })
    expect((await ler(db)).map((x: { cod_forn: string }) => x.cod_forn)).toEqual(['0009085'])
  })
  it('quem não é admin é recusado; anon não executa', async () => {
    const db = await banco()
    await expect(ler(db, CNPJ, 'joao@spazio.com')).rejects.toThrow()
    await expect(chamar(db, 'anon', 'cot_nfe_produto_lembrado($1)', [CNPJ])).rejects.toThrow()
  })
  it('CNPJ inválido dá erro claro; sem nada lançado devolve []', async () => {
    const db = await banco()
    await expect(ler(db, '123')).rejects.toThrow(/CNPJ inválido/)
    expect(await ler(db)).toEqual([])
  })
})

describe('cot_nfe_associar_lembrado e cot_nfe_recusar_lembrado', () => {
  it('grava com origem lembrado, a conversão e o nome da lista de insumos', async () => {
    const db = await banco()
    await insumo(db)
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')] })
    expect(await autoAssociar(db, chave)).toBe(true)
    const d = (await assocDe(db, chave)).a!['1']
    expect(d).toMatchObject({ produto_id: 101, origem: 'lembrado', conversao: 12, por: ADMIN })
    expect(String(d.produto_nome)).not.toBe('')
  })
  it('NUNCA sobrescreve: item que já tem decisão (outra tela gravou antes) devolve false e fica como estava', async () => {
    const db = await banco()
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')], assoc: DEC(6, 102, 'lista') })
    expect(await autoAssociar(db, chave)).toBe(false)
    expect((await assocDe(db, chave)).a!['1']).toMatchObject({ produto_id: 102, conversao: 6, origem: 'lista' })
  })
  it('item recusado pelo Ivan: não grava (nem depois); a recusa não repete o n', async () => {
    const db = await banco()
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')] })
    await recusar(db, chave)
    await recusar(db, chave)
    expect((await assocDe(db, chave)).r).toEqual([1])
    expect(await autoAssociar(db, chave)).toBe(false)
    expect((await assocDe(db, chave)).a).toBeNull()
  })
  it('mesmas travas de cot_nfe_associar: nota lançada, produto fora da lista, conversão inválida, item do SisChef', async () => {
    const db = await banco()
    const lancada = await nota(db, { itens: [GUARANA('1')] })
    await expect(autoAssociar(db, lancada)).rejects.toThrow(/não está mais na fila/)
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1'), { n: 2, descricao: 'CÓD. FOR: 5 X', produto_id: 101 }] })
    await expect(autoAssociar(db, chave, 1, 987654)).rejects.toThrow(/fora da lista de insumos/)
    await expect(autoAssociar(db, chave, 1, 101, 0)).rejects.toThrow(/maior que zero/)
    await expect(autoAssociar(db, chave, 2)).rejects.toThrow(/já está associado no SisChef/)
    await expect(autoAssociar(db, chave, 9)).rejects.toThrow(/item não encontrado/)
  })
  it('só o admin: outro usuário é recusado nas duas; anon não executa', async () => {
    const db = await banco()
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')] })
    await expect(autoAssociar(db, chave, 1, 101, 12, 'joao@spazio.com')).rejects.toThrow()
    await expect(recusar(db, chave, 1, 'joao@spazio.com')).rejects.toThrow()
    await expect(chamar(db, 'anon', 'cot_nfe_associar_lembrado($1, 1, 101, 12)', [chave])).rejects.toThrow()
    await expect(chamar(db, 'anon', 'cot_nfe_recusar_lembrado($1, 1)', [chave])).rejects.toThrow()
  })
  it('a gravação automática não entra no aprendizado depois que a nota é lançada', async () => {
    const db = await banco()
    await insumo(db)
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')] })
    expect(await autoAssociar(db, chave)).toBe(true)
    await db.query(`update cot_nfe set situacao = 'lancada', lancada_em = now() where chave = $1`, [chave])
    expect(await ler(db)).toEqual([])
  })
  it('a coluna lembrado_recusado: nula por padrão, só lista, e o service_role (backup) lê', async () => {
    const db = await banco()
    const chave = await nota(db, { situacao: 'na_fila', itens: [GUARANA('1')] })
    expect((await assocDe(db, chave)).r).toBeNull()
    await expect(db.query(`update cot_nfe set lembrado_recusado = '{"a":1}'::jsonb where chave = $1`, [chave])).rejects.toThrow(/check/)
    await db.exec('set role service_role')
    try { expect((await db.query('select lembrado_recusado from cot_nfe')).rows).toHaveLength(1) } finally { await db.exec('reset role') }
  })
  it('o desfazer apaga as funções e a coluna; a migração roda de novo', async () => {
    const db = await banco()
    await db.exec(readFileSync(DESFAZER, 'utf8'))
    expect((await db.query(`select proname from pg_proc where proname like 'cot_nfe_%lembrado'`)).rows).toEqual([])
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'cot_nfe' and column_name = 'lembrado_recusado'`)).rows).toEqual([])
    await db.exec(readFileSync(MIGRACAO, 'utf8'))
  })
})
