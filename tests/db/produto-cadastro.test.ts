import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento } from './fixture-recebimento'
import { como } from './banco'
import { ADMIN, JOAO } from './fixture'

// Cadastro de PRODUTO novo pelo app (pedido do Ivan, 13/10/2026): produto_cadastro (pedidos) e produto_cadastro_concluir (a gravação final, atômica e idempotente).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()
const NOME = 'MAIONESE HELLMANNS 3KG - INSUMOS'
const CHAVE = 'maionese hellmanns 3kg insumos'

const pedir = async (db: PGlite, over: Record<string, string> = {}): Promise<string> => {
  const c = { descricao: `'${NOME}'`, chave_nome: `'${CHAVE}'`, grupo: `'ESTOQUE CONTROLADO'`, unidade: `'KG'`, origem: `'cupom'`, ...over }
  const r = await db.query<{ id: string }>(`insert into produto_cadastro (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')}) returning id`)
  return r.rows[0].id
}
const concluir = async (db: PGlite, id: string, estado: string, extra = ''): Promise<string> => {
  const r = await como(db, 'service', `select produto_cadastro_concluir('${id}'::uuid, '${estado}'${extra}) as e`)
  return (r[0] as { e: string }).e
}

describe('produto_cadastro', () => {
  it('só o admin lê; o comprador não vê nada; ninguém escreve direto pelo app', async () => {
    const db = await banco()
    await pedir(db)
    expect(await como(db, ADMIN, 'select estado from produto_cadastro')).toEqual([{ estado: 'PENDENTE' }])
    expect(await como(db, JOAO, 'select 1 from produto_cadastro')).toEqual([])
    await expect(como(db, ADMIN, `insert into produto_cadastro (descricao, chave_nome, grupo, unidade, origem) values ('X', 'x', 'G', 'KG', 'cupom')`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `update produto_cadastro set estado = 'CADASTRADO'`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `select produto_cadastro_concluir(gen_random_uuid(), 'REVISAR')`)).rejects.toThrow(/permission denied/)   // a gravação final é do robô (service_role)
  })

  it('no máximo um pedido em andamento por nome; depois de concluído ou revisado pode pedir de novo', async () => {
    const db = await banco()
    await pedir(db)
    await expect(pedir(db)).rejects.toThrow(/produto_cadastro_em_andamento|duplicate key/)
    await db.exec(`update produto_cadastro set estado = 'PROCESSANDO'`)
    await expect(pedir(db)).rejects.toThrow(/duplicate key/)
    await db.exec(`update produto_cadastro set estado = 'REVISAR', motivo = 'grupo não encontrado'`)
    await pedir(db)
    expect(await como(db, ADMIN, 'select 1 from produto_cadastro')).toHaveLength(2)
  })

  it('só aceita unidade KG ou UN (as da planilha do app), estado conhecido e nunca "pronto" sem o código do produto', async () => {
    const db = await banco()
    await expect(pedir(db, { unidade: `'PCT'` })).rejects.toThrow()
    await expect(pedir(db, { unidade: `'kg'` })).rejects.toThrow()
    await expect(pedir(db, { origem: `'outra'` })).rejects.toThrow()
    await expect(pedir(db, { descricao: `'   '` })).rejects.toThrow()
    await expect(pedir(db, { estado: `'OUTRO'` })).rejects.toThrow()
    await expect(pedir(db, { estado: `'CADASTRADO'` })).rejects.toThrow(/produto_cadastro_pronto_com_id/)
  })
})

describe('produto_cadastro_concluir', () => {
  it('CADASTRADO: o produto entra na planilha (a lista do app) com a unidade e as palavras-chave são mescladas, tudo junto com o estado', async () => {
    const db = await banco()
    const id = await pedir(db, { palavras: `'maion hellmanns'` })
    expect(await concluir(db, id, 'CADASTRADO', `, 3924999, null, 'KG', '${NOME}'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select produto_id::text, descricao, unidade from produto_planilha where produto_id = 3924999')).toEqual([{ produto_id: '3924999', descricao: NOME, unidade: 'KG' }])
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 3924999')).toEqual([{ palavras: 'maion hellmanns' }])
    expect(await como(db, ADMIN, 'select estado, produto_id::text, motivo from produto_cadastro')).toEqual([{ estado: 'CADASTRADO', produto_id: '3924999', motivo: null }])
  })

  it('palavras já existentes não são sobrescritas: a mescla usa " OU " e não repete', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade) values (3924888, '${NOME}', 'KG')`)
    await db.exec(`insert into cot_produto_busca (produto_id, palavras) values (3924888, 'maionese balde')`)
    const id = await pedir(db, { palavras: `'maion hellmanns'` })
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3924888, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 3924888')).toEqual([{ palavras: 'maionese balde OU maion hellmanns' }])
  })

  it('JA_EXISTIA: vale a unidade e a descrição do SisChef (não as digitadas); sem palavras não cria linha de busca', async () => {
    const db = await banco()
    const id = await pedir(db, { unidade: `'UN'` })
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3469720, null, 'KG', 'MOLHO AMERICAN CHEESE - INSUMOS'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select descricao, unidade from produto_planilha where produto_id = 3469720')).toEqual([{ descricao: 'MOLHO AMERICAN CHEESE - INSUMOS', unidade: 'KG' }])
    expect(await como(db, ADMIN, 'select 1 from cot_produto_busca where produto_id = 3469720')).toEqual([])
  })

  it('produto criado com unidade diferente da escolhida, ou unidade do SisChef fora de KG/UN: vira REVISAR e NADA entra na planilha', async () => {
    const db = await banco()
    const a = await pedir(db)
    expect(await concluir(db, a, 'CADASTRADO', `, 3925001, null, 'UN'`)).toBe('REVISAR')
    const b = await pedir(db, { chave_nome: `'outro nome'` })
    expect(await concluir(db, b, 'JA_EXISTIA', `, 3925002, null, 'PCT'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select 1 from produto_planilha where produto_id in (3925001, 3925002)')).toEqual([])
    const motivos = await como(db, ADMIN, 'select motivo from produto_cadastro order by criado_em')
    expect(String((motivos[0] as { motivo: string }).motivo)).toMatch(/foi criado no SisChef com a unidade UN/)
    expect(String((motivos[1] as { motivo: string }).motivo)).toMatch(/só aceita KG ou UN/)
  })

  it('a planilha já tem o produto com outra unidade: REVISAR e a linha dela não muda', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade) values (3925003, 'JA TINHA', 'UN')`)
    const id = await pedir(db)
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3925003, null, 'KG'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select unidade from produto_planilha where produto_id = 3925003')).toEqual([{ unidade: 'UN' }])
  })

  it('REVISAR guarda o motivo e os candidatos (parecidos achados no SisChef)', async () => {
    const db = await banco()
    const id = await pedir(db)
    const cands = JSON.stringify([{ produto_id: 111, descricao: 'MAIONESE HELLMANNS 3KG', unidade: 'KG' }])
    expect(await concluir(db, id, 'REVISAR', `, null, 'Achei produto parecido', null, null, '${cands}'::jsonb`)).toBe('REVISAR')
    const r = await como(db, ADMIN, 'select motivo, candidatos from produto_cadastro')
    expect(r).toEqual([{ motivo: 'Achei produto parecido', candidatos: [{ produto_id: 111, descricao: 'MAIONESE HELLMANNS 3KG', unidade: 'KG' }] }])
  })

  it('idempotente: pedido já concluído não muda de novo (devolve o estado em que está) e produto sem código é recusado', async () => {
    const db = await banco()
    const id = await pedir(db)
    expect(await concluir(db, id, 'CADASTRADO', `, 3925010, null, 'KG'`)).toBe('CADASTRADO')
    expect(await concluir(db, id, 'REVISAR', `, null, 'tentativa tardia'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select estado, motivo from produto_cadastro')).toEqual([{ estado: 'CADASTRADO', motivo: null }])
    const outro = await pedir(db, { chave_nome: `'sem codigo'` })
    await expect(concluir(db, outro, 'CADASTRADO', `, null, null, 'KG'`)).rejects.toThrow(/sem código/)
    await expect(concluir(db, outro, 'PENDENTE')).rejects.toThrow(/estado inválido/)
  })
})
