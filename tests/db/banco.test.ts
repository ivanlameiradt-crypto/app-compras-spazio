import { bancoPorArquivo, como } from './banco'

const banco = bancoPorArquivo()

describe('banco de teste', () => {
  it('roda SQL como usuário autenticado com e-mail no JWT', async () => {
    const [r] = await como(banco(), 'Joao@Spazio.com', `select auth.jwt() ->> 'email' as email, current_user as papel`)
    expect(r.email).toBe('Joao@Spazio.com')
    expect(r.papel).toBe('authenticated')
  })

  it('volta a ser superusuário depois (set local)', async () => {
    const db = banco()
    await como(db, 'a@b.com', 'select 1')
    const r = await db.query<{ u: string }>('select current_user as u')
    expect(r.rows[0].u).not.toBe('authenticated')
  })

  it('cada teste começa com o banco vazio e os ids do zero', async () => {
    const db = banco()
    expect((await db.query('select * from usuarios')).rows).toHaveLength(0)
    await db.exec(`insert into semanas (data_referencia) values ('2026-09-22')`)
    const r = await db.query<{ id: number }>('select id from semanas')
    expect(Number(r.rows[0].id)).toBe(1)
  })

  it('… inclusive depois de um teste que gravou dados', async () => {
    const db = banco()
    expect((await db.query('select * from semanas')).rows).toHaveLength(0)
    await db.exec(`insert into semanas (data_referencia) values ('2026-09-29')`)
    const r = await db.query<{ id: number }>('select id from semanas')
    expect(Number(r.rows[0].id)).toBe(1)
  })
})
