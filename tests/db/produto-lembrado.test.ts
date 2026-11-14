import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bancoRecebimento, chamar, ADMIN } from './fixture-recebimento'
import { como } from './banco'

// Produto lembrado por fornecedor (20261230000001, 14/11/2026): cot_nfe_produto_lembrado(cnpj) lê as notas LANÇADAS e devolve o produto que o Ivan escolheu
// por CÓD. FOR + unidade da nota, só quando todas as decisões concordam (produto e conversão).
const AQUI = dirname(fileURLToPath(import.meta.url))
const DESFAZER = join(AQUI, '../../supabase/rollback/20261230000001_produto_lembrado_por_fornecedor.desfazer.sql')

const atual = bancoRecebimento(null)
const banco = async () => atual()
const CNPJ = '12345678000190'
const OUTRO = '99887766000155'
let seq = 0
const chaveDe = (cnpj: string) => `152610${cnpj}55001000${String(++seq).padStart(9, '0')}10000000`.slice(0, 44)

interface Item { n: number; descricao: string; unidade?: string | null }
async function nota(db: PGlite, o: { cnpj?: string; situacao?: string; lancada?: string; itens: Item[]; assoc: Record<string, unknown> }): Promise<void> {
  const cnpj = o.cnpj ?? CNPJ
  const chave = chaveDe(cnpj)
  const itens = o.itens.map((i) => ({ n: i.n, descricao: i.descricao, unidade_sischef: i.unidade === undefined ? 'CX' : i.unidade }))
  const situacao = o.situacao ?? 'lancada'
  await db.query(
    `insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens, situacao, primeiro_visto_em, visto_na_fila_em, lancada_em, atualizado_em, associacoes_app)
     values ($1, $2, 'OLIVEIRA E OLIVEIRA', '1', '2026-11-01', 100, true, $3::jsonb, $4, now(), now(), $5::timestamptz, now(), $6::jsonb)`,
    [chave, cnpj, JSON.stringify(itens), situacao, situacao === 'lancada' ? (o.lancada ?? '2026-11-05T15:00:00Z') : null, JSON.stringify(o.assoc)])
}
const GUARANA = (sh: string): Item => ({ n: 1, descricao: `CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET LT 350ML SH ${sh}` })
const DEC = (conv: number | null = 12, produto = 3324211, origem = 'lista') => ({ '1': { produto_id: produto, produto_nome: 'GUARANÁ DIET LATA', unidade: 'un', conversao: conv, origem } })
const ler = async (db: PGlite, cnpj = CNPJ, quem = ADMIN) => (await como(db, quem, 'select cot_nfe_produto_lembrado($1) as r', [cnpj]))[0].r

describe('cot_nfe_produto_lembrado', () => {
  it('duas notas que concordam: devolve o produto, a conversão, vezes 2 e a última data', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('32,7000')], assoc: DEC(), lancada: '2026-11-01T15:00:00Z' })
    await nota(db, { itens: [GUARANA('35,1600')], assoc: DEC(), lancada: '2026-11-08T15:00:00Z' })
    const r = await ler(db)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cod_forn: '0009085', unidade_nota: 'CX', produto_id: 3324211, produto_nome: 'GUARANÁ DIET LATA', conversao: 12, vezes: 2 })
    expect(new Date(r[0].ultima_em).toISOString()).toBe('2026-11-08T15:00:00.000Z')
  })
  it('só uma nota lançada já vale', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('32,35')], assoc: DEC() })
    expect(await ler(db)).toHaveLength(1)
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
    await nota(db, { itens: [{ ...GUARANA('2'), unidade: 'un' }], assoc: DEC(null) })
    await nota(db, { itens: [{ ...GUARANA('3'), unidade: null }], assoc: DEC(6) })
    const r = await ler(db)
    expect(r.map((x: { unidade_nota: string; conversao: number | null }) => [x.unidade_nota, x.conversao])).toEqual([['CX', 12], ['UN', null]])
  })
  it('decisão de origem sischef e decisão sem produto ficam de fora', async () => {
    const db = await banco()
    await nota(db, { itens: [GUARANA('1')], assoc: DEC(6, 3324211, 'sischef') })
    await nota(db, { itens: [GUARANA('2')], assoc: { '1': { produto_id: null, conversao: 12, origem: 'lista' } } })
    expect(await ler(db)).toEqual([])
    await nota(db, { itens: [GUARANA('3')], assoc: DEC(12) })
    expect((await ler(db))[0]).toMatchObject({ produto_id: 3324211, vezes: 1 })
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
  it('o desfazer apaga a função', async () => {
    const db = await banco()
    await db.exec(readFileSync(DESFAZER, 'utf8'))
    const r = await db.query(`select 1 from pg_proc where proname = 'cot_nfe_produto_lembrado'`)
    expect(r.rows).toEqual([])
    await db.exec(readFileSync(join(AQUI, '../../supabase/migrations/20261230000001_produto_lembrado_por_fornecedor.sql'), 'utf8'))
  })
})
