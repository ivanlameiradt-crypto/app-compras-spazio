import type { PGlite } from '@electric-sql/pglite'
import { beforeEach } from 'vitest'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO } from './fixture-recebimento'
import { JOAO } from './fixture'
import { erroDe, type Json } from './fixture-cotacao'

// Histórico de compras do SisChef (11/11/2026): as tabelas compra_historico_produto e compra_historico e a função do robô compra_historico_gravar.
// Cadeia inteira de migrations; tudo INVENTADO (repositório público).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()

// Segredo próprio do robô do histórico (inventado), diferente do cot_nfe_robo.
const SEG = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f'
beforeEach(async () => {
  await atual().exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('compra_historico_robo', '${SEG}')`)
})

function produto(over: Json = {}): Json {
  return { produto_id: 123, nome: 'BATATA', unidade: 'kg', grupo: 'HORTIFRUTI', visto_em: '2026-11-11',
    linhas: [['2026-10-28', 'FORNECEDOR A', 'REF PEDIDO 1', 120.0, 0.79, 0.79], ['2026-10-21', 'FORNECEDOR B', '', 100, 0.8, 0.75]], ...over }
}

const gravar = (db: PGlite, lote: Json, seg: string = SEG, quem = 'anon'): Promise<Json> =>
  chamar(db, quem, 'compra_historico_gravar($1, $2::jsonb)', [seg, JSON.stringify(lote)])

async function linhas(db: PGlite): Promise<Json[]> {
  const rs = await como(db, ADMIN, `select produto_id, to_char(data, 'YYYY-MM-DD') as data, fornecedor, referencia, qtd, preco_unit, custo_liquido, pos
    from compra_historico order by produto_id, pos`)
  return rs.map((r) => ({ ...r, produto_id: Number(r.produto_id), qtd: Number(r.qtd), preco_unit: Number(r.preco_unit),
    custo_liquido: Number(r.custo_liquido), pos: Number(r.pos) }))
}
const produtos = (db: PGlite): Promise<Json[]> =>
  como(db, ADMIN, `select produto_id::int as id, nome, unidade, grupo, to_char(visto_em, 'YYYY-MM-DD') as visto from compra_historico_produto order by 1`)

describe('segredo do robô (compra_historico_exigir_robo)', () => {
  it('sem segredo, vazio, errado ou o do robô de NF-e → "não autorizado" e nada é gravado', async () => {
    const db = await banco()
    for (const seg of ['', 'errado', SEGREDO]) {
      expect(await erroDe(gravar(db, [produto()], seg))).toBe('não autorizado')
      expect(await erroDe(gravar(db, [], seg))).toBe('não autorizado')
    }
    expect(await erroDe(chamar(db, 'anon', 'compra_historico_gravar(null, $1::jsonb)', [JSON.stringify([produto()])]))).toBe('não autorizado')
    expect(await linhas(db)).toEqual([])
    expect(await produtos(db)).toEqual([])
  })

  it('sem o segredo no Vault recusa tudo (nunca aceita vazio = vazio)', async () => {
    const db = await banco()
    await db.exec(`delete from vault.decrypted_secrets where name = 'compra_historico_robo'`)
    expect(await erroDe(gravar(db, [produto()], ''))).toBe('não autorizado')
    expect(await erroDe(gravar(db, [produto()], SEG))).toBe('não autorizado')
    expect(await produtos(db)).toEqual([])
  })
})

describe('gravar em espelho', () => {
  it('grava o produto e as linhas na ordem (unidade em maiúsculas, referência vazia vira null)', async () => {
    const db = await banco()
    expect(Number(await gravar(db, [produto()]))).toBe(1)
    expect(await produtos(db)).toEqual([{ id: 123, nome: 'BATATA', unidade: 'KG', grupo: 'HORTIFRUTI', visto: '2026-11-11' }])
    expect(await linhas(db)).toEqual([
      { produto_id: 123, data: '2026-10-28', fornecedor: 'FORNECEDOR A', referencia: 'REF PEDIDO 1', qtd: 120, preco_unit: 0.79, custo_liquido: 0.79, pos: 1 },
      { produto_id: 123, data: '2026-10-21', fornecedor: 'FORNECEDOR B', referencia: null, qtd: 100, preco_unit: 0.8, custo_liquido: 0.75, pos: 2 },
    ])
  })

  it('lote vazio devolve 0', async () => {
    const db = await banco()
    expect(Number(await gravar(db, []))).toBe(0)
  })

  it('regravar troca as linhas (idempotente) e não toca produto que não veio no lote', async () => {
    const db = await banco()
    await gravar(db, [produto(), produto({ produto_id: 456, nome: 'CEBOLA' })])
    expect(Number(await gravar(db, [produto()]))).toBe(1)
    expect(Number(await gravar(db, [produto()]))).toBe(1)
    expect((await linhas(db)).length).toBe(4)
    await gravar(db, [produto({ linhas: [['2026-11-04', 'FORNECEDOR C', 'X', 50, 1, 1]] })])
    const ls = await linhas(db)
    expect(ls.filter((l) => l.produto_id === 123)).toEqual([
      { produto_id: 123, data: '2026-11-04', fornecedor: 'FORNECEDOR C', referencia: 'X', qtd: 50, preco_unit: 1, custo_liquido: 1, pos: 1 }])
    expect(ls.filter((l) => l.produto_id === 456)).toHaveLength(2)
    await gravar(db, [produto({ linhas: [] })])
    expect((await linhas(db)).filter((l) => l.produto_id === 123)).toEqual([])
  })

  it('item inválido derruba o lote inteiro, com mensagem em português', async () => {
    const db = await banco()
    await gravar(db, [produto({ produto_id: 9 })])
    const antes = await linhas(db)
    const ruins: [Json, RegExp][] = [
      [{ produto_id: 0, linhas: [] }, /produto_id/],
      [{ produto_id: '12', linhas: [] }, /produto_id/],
      [{ produto_id: 5 }, /linhas precisa ser uma lista/],
      [produto({ linhas: [['2026-02-30', 'F', '', 1, 1, 1]] }), /data/],
      [produto({ linhas: [['2026-10-01', '', '', 1, 1, 1]] }), /fornecedor/],
      [produto({ linhas: [['2026-10-01', 'F', '', 0, 1, 1]] }), /quantidade/],
      [produto({ linhas: [['2026-10-01', 'F', '', 1, -1, 1]] }), /preço unitário/],
      [produto({ linhas: [['2026-10-01', 'F', '', 1, 1, '1']] }), /custo líquido/],
      [produto({ linhas: [['2026-10-01', 'F', '', 1, 1]] }), /6 campos/],
      [produto({ visto_em: 'ontem' }), /visto_em/],
      [produto({ produto_id: 77 }), /repetido/],
    ]
    for (const [ruim, re] of ruins) {
      // o 1º produto (válido) troca as linhas do 9: se o lote não fosse tudo ou nada, o 9 ficaria sem linhas
      const e = await erroDe(gravar(db, [produto({ produto_id: 9, linhas: [] }), produto({ produto_id: 77 }), ruim]))
      expect([JSON.stringify(ruim), e]).toEqual([JSON.stringify(ruim), expect.stringMatching(re)])
      expect(String(e)).toMatch(/^histórico de compras inválido/)
    }
    expect(await erroDe(gravar(db, { produto_id: 1 }))).toMatch(/esperava uma lista/)
    expect(await linhas(db)).toEqual(antes)
    expect((await produtos(db)).map((p) => p.id)).toEqual([9])
  })

  it('limites: 200 produtos e 60 linhas por produto', async () => {
    const db = await banco()
    const linha = ['2026-10-01', 'F', '', 1, 1, 1]
    const muitos = (n: number) => Array.from({ length: n }, (_, k) => ({ produto_id: k + 1, linhas: [linha] }))
    expect(Number(await gravar(db, muitos(200)))).toBe(200)
    expect(await erroDe(gravar(db, muitos(201)))).toMatch(/mais de 200 produtos/)
    expect(Number(await gravar(db, [produto({ linhas: Array(60).fill(linha) })]))).toBe(1)
    expect(await erroDe(gravar(db, [produto({ linhas: Array(61).fill(linha) })]))).toMatch(/mais de 60 linhas/)
  })
})

describe('permissões', () => {
  it('anon executa a gravação; admin e comprador (authenticated) não; as internas ninguém de fora', async () => {
    const db = await banco()
    for (const quem of [ADMIN, JOAO]) {
      await expect(gravar(db, [produto()], SEG, quem)).rejects.toThrow(/permission denied/)
    }
    for (const f of ['compra_historico_exigir_robo(text)', 'compra_historico_data(jsonb)', 'compra_historico_numero(jsonb)']) {
      for (const papel of ['anon', 'authenticated']) {
        const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${f}', 'execute') as ok`, [papel])
        expect([f, papel, r.rows[0].ok]).toEqual([f, papel, false])
      }
    }
    expect(Number(await gravar(db, [produto()]))).toBe(1)
  })

  it('admin lê; comprador não vê nada; ninguém escreve direto', async () => {
    const db = await banco()
    await gravar(db, [produto()])
    expect(await linhas(db)).toHaveLength(2)
    expect(await como(db, JOAO, 'select * from compra_historico')).toEqual([])
    expect(await como(db, JOAO, 'select * from compra_historico_produto')).toEqual([])
    for (const quem of [ADMIN, JOAO]) {
      await expect(como(db, quem, `insert into compra_historico_produto (produto_id) values (999)`)).rejects.toThrow(/permission denied/)
      await expect(como(db, quem, `delete from compra_historico`)).rejects.toThrow(/permission denied/)
    }
    for (const t of ['compra_historico', 'compra_historico_produto']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await db.query<{ ok: boolean }>(`select has_table_privilege('anon', $1, $2) as ok`, [`public.${t}`, priv])
        expect([t, priv, r.rows[0].ok]).toEqual([t, priv, false])
      }
    }
  })
})
