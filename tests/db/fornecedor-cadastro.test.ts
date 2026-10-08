import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento } from './fixture-recebimento'
import { como } from './banco'
import { ADMIN, JOAO } from './fixture'

// Cadastro de fornecedor pelo app (pedido do Ivan, 08/10/2026): fornecedor_cadastro (pedidos) e fornecedor_app (fantasia, só do app).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()
const CNPJ = '63540861000182'

const pedir = (db: PGlite, over = '') => db.exec(
  `insert into fornecedor_cadastro (cnpj, razao_social, nome_fantasia, uf, municipio${over ? ', ' + over.split('=')[0] : ''}) values ('${CNPJ}', 'A. N. DA SILVA DESCARTAVEIS LTDA', 'AN', 'PA', 'Abaetetuba'${over ? ', ' + over.split('=')[1] : ''})`)

describe('fornecedor_cadastro e fornecedor_app', () => {
  it('só o admin lê; o comprador não vê nada; ninguém escreve direto pelo app', async () => {
    const db = await banco()
    await pedir(db)
    await db.exec(`insert into fornecedor_app (cnpj, razao_social, nome_fantasia) values ('${CNPJ}', 'A. N. DA SILVA DESCARTAVEIS LTDA', 'AN')`)
    expect(await como(db, ADMIN, 'select estado from fornecedor_cadastro')).toEqual([{ estado: 'PENDENTE' }])
    expect(await como(db, ADMIN, 'select nome_fantasia from fornecedor_app')).toEqual([{ nome_fantasia: 'AN' }])
    expect(await como(db, JOAO, 'select 1 from fornecedor_cadastro')).toEqual([])
    expect(await como(db, JOAO, 'select 1 from fornecedor_app')).toEqual([])
    await expect(como(db, ADMIN, `insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio) values ('${CNPJ}', 'X', 'PA', 'Y')`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `update fornecedor_cadastro set estado = 'CADASTRADO'`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `insert into fornecedor_app (cnpj, razao_social) values ('${CNPJ}', 'X')`)).rejects.toThrow(/permission denied/)
  })

  it('no máximo um pedido em andamento por CNPJ; depois de concluído (ou revisado) pode pedir de novo', async () => {
    const db = await banco()
    await pedir(db)
    await expect(pedir(db)).rejects.toThrow(/fornecedor_cadastro_em_andamento|duplicate key/)
    await db.exec(`update fornecedor_cadastro set estado = 'PROCESSANDO'`)
    await expect(pedir(db)).rejects.toThrow(/duplicate key/)
    await db.exec(`update fornecedor_cadastro set estado = 'REVISAR', motivo = 'não achei o município'`)
    await pedir(db)                                                              // novo pedido depois do REVISAR
    expect(await como(db, ADMIN, 'select estado from fornecedor_cadastro order by criado_em, estado')).toHaveLength(2)
  })

  it('recusa CNPJ que não tem 14 dígitos, UF em minúscula, estado desconhecido e razão vazia', async () => {
    const db = await banco()
    await expect(db.exec(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio) values ('123', 'X', 'PA', 'Y')`)).rejects.toThrow()
    await expect(db.exec(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio) values ('${CNPJ}', 'X', 'pa', 'Y')`)).rejects.toThrow()
    await expect(db.exec(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio, estado) values ('${CNPJ}', 'X', 'PA', 'Y', 'OUTRO')`)).rejects.toThrow()
    await expect(db.exec(`insert into fornecedor_cadastro (cnpj, razao_social, uf, municipio) values ('${CNPJ}', '   ', 'PA', 'Y')`)).rejects.toThrow()
  })
})
