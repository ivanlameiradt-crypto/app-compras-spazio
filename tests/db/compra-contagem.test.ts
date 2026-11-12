import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, aprovar, ADMIN } from './fixture-recebimento'
import { JOAO, EX, ESTRANHO } from './fixture'
import { erroDe } from './fixture-cotacao'

// Contagem da prateleira da "Lista da semana" (11/11/2026): tabela compra_contagem e função compra_contagem_salvar.
// Cadeia inteira de migrations; tudo INVENTADO (repositório público).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()

const salvar = (db: PGlite, quem: string, semana: number, produto: number, qtd: number | null): Promise<unknown> =>
  chamar(db, quem, 'compra_contagem_salvar($1, $2, $3::numeric)', [semana, produto, qtd])

const contagens = (db: PGlite) =>
  como(db, 'service', `select semana_id::int as semana, produto_id::int as produto, qtd::float as qtd, contado_por, contado_em is not null as tem_hora
    from compra_contagem order by produto_id`)

describe('compra_contagem_salvar', () => {
  it('admin e comprador ativo gravam e leem; contado_por é o e-mail de quem contou', async () => {
    const db = await banco()
    const semana = await aprovar(db) // em_compra, produtos 101..110
    await salvar(db, ADMIN, semana, 101, 12.5)
    await salvar(db, JOAO, semana, 102, 3)
    expect(await contagens(db)).toEqual([
      { semana, produto: 101, qtd: 12.5, contado_por: ADMIN, tem_hora: true },
      { semana, produto: 102, qtd: 3, contado_por: JOAO, tem_hora: true },
    ])
    for (const quem of [ADMIN, JOAO]) {
      expect(await como(db, quem, 'select produto_id from compra_contagem')).toHaveLength(2)
    }
  })

  it('regravar troca o valor e quem contou; zero é uma contagem válida', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await salvar(db, ADMIN, semana, 101, 5)
    await salvar(db, JOAO, semana, 101, 0)
    expect(await contagens(db)).toEqual([{ semana, produto: 101, qtd: 0, contado_por: JOAO, tem_hora: true }])
  })

  it('qtd null apaga a contagem (e apagar o que não existe não dá erro)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await salvar(db, ADMIN, semana, 101, 5)
    await salvar(db, ADMIN, semana, 101, null)
    await salvar(db, ADMIN, semana, 102, null)
    expect(await contagens(db)).toEqual([])
  })

  it('semana rascunho aceita; semana encerrada recusa (gravar e apagar)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.query(`update semanas set status = 'rascunho' where id = $1`, [semana])
    await salvar(db, ADMIN, semana, 101, 1)
    await db.query(`update semanas set status = 'encerrada' where id = $1`, [semana])
    expect(await erroDe(salvar(db, ADMIN, semana, 101, 2))).toMatch(/encerrada/)
    expect(await erroDe(salvar(db, ADMIN, semana, 101, null))).toMatch(/encerrada/)
    expect((await contagens(db))[0].qtd).toBe(1)
  })

  it('semana que não existe e produto fora da semana recusam', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    expect(await erroDe(salvar(db, ADMIN, semana + 999, 101, 1))).toMatch(/semana não encontrada/)
    expect(await erroDe(salvar(db, ADMIN, semana, 99999, 1))).toMatch(/não está na lista desta semana/)
    expect(await contagens(db)).toEqual([])
  })

  it('quantidade negativa ou com mais de 3 casas recusa; 3 casas passa', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    expect(await erroDe(salvar(db, ADMIN, semana, 101, -1))).toMatch(/negativa/)
    expect(await erroDe(salvar(db, ADMIN, semana, 101, 1.2345))).toMatch(/3 casas/)
    await salvar(db, ADMIN, semana, 101, 1.234)
    expect(await contagens(db)).toHaveLength(1)
  })
})

describe('permissões', () => {
  it('inativo, desconhecido e anônimo não gravam nem leem', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await salvar(db, ADMIN, semana, 101, 5)
    for (const quem of [EX, ESTRANHO]) {
      expect(await erroDe(salvar(db, quem, semana, 101, 9))).toMatch(/sem acesso/)
      expect(await como(db, quem, 'select * from compra_contagem')).toEqual([])
    }
    await expect(salvar(db, 'anon', semana, 101, 9)).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', 'select * from compra_contagem')).rejects.toThrow(/permission denied/)
    expect((await contagens(db))[0].qtd).toBe(5)
  })

  it('ninguém escreve direto na tabela (authenticated e anon); a chave de serviço pode', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    for (const quem of [ADMIN, JOAO, 'anon']) {
      await expect(como(db, quem, `insert into compra_contagem (semana_id, produto_id, qtd, contado_por, contado_em) values (${semana}, 101, 1, 'x', now())`))
        .rejects.toThrow(/permission denied/)
      await expect(como(db, quem, 'update compra_contagem set qtd = 1')).rejects.toThrow(/permission denied/)
      await expect(como(db, quem, 'delete from compra_contagem')).rejects.toThrow(/permission denied/)
    }
    await como(db, 'service', `insert into compra_contagem (semana_id, produto_id, qtd, contado_por, contado_em) values (${semana}, 101, 1, 'x', now())`)
    expect(await contagens(db)).toHaveLength(1)
  })

  it('a função é só de authenticated (anon e o público não executam)', async () => {
    const db = await banco()
    for (const [papel, esperado] of [['anon', false], ['authenticated', true]] as const) {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.compra_contagem_salvar(bigint,bigint,numeric)', 'execute') as ok`, [papel])
      expect([papel, r.rows[0].ok]).toEqual([papel, esperado])
    }
  })

  it('apagar a semana apaga as contagens dela (cascade)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await salvar(db, ADMIN, semana, 101, 5)
    await db.query('delete from semanas where id = $1', [semana])
    expect(await contagens(db)).toEqual([])
  })
})
