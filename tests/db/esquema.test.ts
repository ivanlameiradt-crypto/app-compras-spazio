import { bancoPorArquivo, como } from './banco'
import { semear, ADMIN, JOAO, EX, ESTRANHO } from './fixture'

const atual = bancoPorArquivo(async (db) => {
  await semear(db)
  await db.exec(`
    insert into semanas (data_referencia, status) values ('2026-09-15', 'em_compra'), ('2026-09-22', 'rascunho');
    insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, situacao, incluido, qtd_aprovada)
      select s.id, 1, 'COCA COLA 350 ML', true, 'un', 41, 'Repor', true, 52 from semanas s;
    insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, situacao, incluido)
      select s.id, 2, 'CEBOLA EM PÓ - INSUMOS (KG)', false, 'kg', -0.04, 'ESTOQUE NEGATIVO', false from semanas s;
  `)
})
const banco = async () => atual()

describe('regras de acesso', () => {
  it('admin vê todas as semanas', async () => {
    const db = await banco()
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(2)
  })

  it('comprador só vê a semana em compra e só itens incluídos', async () => {
    const db = await banco()
    const semanas = await como(db, JOAO, 'select status from semanas')
    expect(semanas.map((s) => s.status)).toEqual(['em_compra'])
    const itens = await como(db, JOAO, 'select produto from itens_semana')
    expect(itens.map((i) => i.produto)).toEqual(['COCA COLA 350 ML'])
  })

  it('e-mail com maiúsculas entra', async () => {
    const db = await banco()
    const [r] = await como(db, 'Joao@SPAZIO.com', 'select eh_ativo() as ok')
    expect(r.ok).toBe(true)
  })

  it('e-mail não cadastrado ou desativado não vê nada', async () => {
    const db = await banco()
    for (const quem of [ESTRANHO, EX]) {
      expect(await como(db, quem, 'select * from semanas')).toHaveLength(0)
      expect(await como(db, quem, 'select * from itens_semana')).toHaveLength(0)
      expect(await como(db, quem, 'select * from usuarios where email <> email_atual()')).toHaveLength(0)
    }
  })

  it('anônimo não lê tabelas', async () => {
    const db = await banco()
    await expect(como(db, 'anon', 'select * from semanas')).rejects.toThrow(/permission denied/)
  })

  it('comprador não altera tabelas direto', async () => {
    const db = await banco()
    await expect(como(db, JOAO, `update itens_semana set qtd_aprovada = 999`)).rejects.toThrow(/permission denied/)
    await expect(
      como(db, JOAO, `insert into usuarios (email, nome, papel) values ('x@y.com', 'X', 'admin')`),
    ).rejects.toThrow(/row-level security/)
  })

  it('admin cadastra pessoa; comprador só vê a própria linha em usuarios', async () => {
    const db = await banco()
    await como(db, ADMIN, `insert into usuarios (email, nome, papel) values ('nova@spazio.com', 'Nova', 'comprador')`)
    expect(await como(db, ADMIN, 'select * from usuarios')).toHaveLength(5)
    const minhas = await como(db, JOAO, 'select email from usuarios')
    expect(minhas.map((u) => u.email)).toEqual([JOAO])
  })

  it('e-mail em usuarios precisa estar em minúsculas', async () => {
    const db = await banco()
    await expect(db.exec(`insert into usuarios (email, nome, papel) values ('A@B.com', 'A', 'comprador')`)).rejects.toThrow()
  })
})
