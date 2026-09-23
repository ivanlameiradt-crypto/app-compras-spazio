import { bancoPorArquivo, como } from './banco'
import { semear, importar, idItem, idSemana, PAYLOAD, ADMIN, JOAO, MARIA } from './fixture'

const atual = bancoPorArquivo(semear)
const banco = async () => atual()

describe('importar_semana', () => {
  it('cria a semana em rascunho com unidade, negativo e incluído calculados', async () => {
    const db = await banco()
    const r = await importar(db)
    expect(r.resultado).toBe('criada')
    const itens = await como(db, ADMIN, 'select produto_id, unidade, negativo, incluido, qtd_aprovada from itens_semana order by produto_id')
    expect(itens.map((i) => [Number(i.produto_id), i.unidade, i.negativo, i.incluido, Number(i.qtd_aprovada)])).toEqual([
      [1, 'un', false, true, 52],
      [2, 'un', false, true, 148], // bebida negativa é compra real
      [3, 'kg', false, true, 1.2],
      [4, 'kg', true, false, 0], // insumo negativo fica de fora
      [5, 'un', false, false, 0], // coberto: só catálogo
    ])
    const [s] = await como(db, ADMIN, 'select status from semanas')
    expect(s.status).toBe('rascunho')
  })

  it('reenviar em rascunho substitui sem duplicar', async () => {
    const db = await banco()
    await importar(db)
    const r = await importar(db, { ...PAYLOAD, itens: PAYLOAD.itens.slice(0, 2) })
    expect(r.resultado).toBe('substituida')
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(1)
    expect(await como(db, ADMIN, 'select * from itens_semana')).toHaveLength(2)
  })

  it('reenviar depois de aprovada é ignorado', async () => {
    const db = await banco()
    await importar(db)
    await como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db)])
    const r = await importar(db, { ...PAYLOAD, itens: PAYLOAD.itens.slice(0, 1) })
    expect(r.resultado).toBe('ja_aprovada')
    expect(await como(db, ADMIN, 'select * from itens_semana')).toHaveLength(5)
  })

  it('é tudo ou nada: item inválido não deixa semana pela metade', async () => {
    const db = await banco()
    const ruim = { ...PAYLOAD, itens: [...PAYLOAD.itens, { produto_id: 9, produto: null, bebida: true, estoque: 1, qtd_sugerida: 1, situacao: 'Repor' }] }
    await expect(importar(db, ruim)).rejects.toThrow()
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(0)
  })

  it('lista vazia é recusada', async () => {
    const db = await banco()
    await expect(importar(db, { data_referencia: '2026-09-22', itens: [] })).rejects.toThrow(/vazia/)
  })

  it('usuário do app não consegue chamar importar_semana', async () => {
    const db = await banco()
    await expect(como(db, ADMIN, `select importar_semana('{}'::jsonb)`)).rejects.toThrow(/permission denied/)
  })
})

describe('revisão do administrador', () => {
  it('ajusta quantidade, tira e inclui item no rascunho', async () => {
    const db = await banco()
    await importar(db)
    const coca = await idItem(db, 1)
    const cebola = await idItem(db, 4)
    await como(db, ADMIN, 'select ajustar_item($1, 60, true)', [coca])
    await como(db, ADMIN, 'select ajustar_item($1, 0.5, true)', [cebola])
    const [c] = await como(db, ADMIN, 'select qtd_aprovada, incluido from itens_semana where id = $1', [coca])
    expect([Number(c.qtd_aprovada), c.incluido]).toEqual([60, true])
    await como(db, ADMIN, 'select ajustar_item($1, 60, false)', [coca])
    const [c2] = await como(db, ADMIN, 'select incluido from itens_semana where id = $1', [coca])
    expect(c2.incluido).toBe(false)
    const [ce] = await como(db, ADMIN, 'select incluido from itens_semana where id = $1', [cebola])
    expect(ce.incluido).toBe(true)
  })

  it('comprador não ajusta nem aprova', async () => {
    const db = await banco()
    await importar(db)
    await expect(como(db, JOAO, 'select ajustar_item($1, 1, true)', [await idItem(db, 1)])).rejects.toThrow(/administrador/)
    await expect(como(db, JOAO, 'select aprovar_semana($1)', [await idSemana(db)])).rejects.toThrow(/administrador/)
  })

  it('aprovar libera para compradores e trava ajustes', async () => {
    const db = await banco()
    await importar(db)
    await como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db)])
    expect(await como(db, JOAO, 'select * from semanas')).toHaveLength(1)
    await expect(como(db, ADMIN, 'select ajustar_item($1, 1, true)', [await idItem(db, 1)])).rejects.toThrow(/rascunho/)
  })

  it('não aprova uma semana nova com outra ainda em compra', async () => {
    const db = await banco()
    await importar(db, { ...PAYLOAD, data_referencia: '2026-09-15' })
    await como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db, '2026-09-15')])
    await importar(db)
    await expect(como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db)])).rejects.toThrow(/encerre a semana anterior/)
  })

  it('não encerra semana com compra aberta', async () => {
    const db = await banco()
    await importar(db)
    const s = await idSemana(db)
    await como(db, ADMIN, 'select aprovar_semana($1)', [s])
    await como(db, JOAO, `select abrir_compra('00000000-0000-0000-0000-000000000001', $1, 'Atacadão')`, [s])
    await expect(como(db, ADMIN, 'select encerrar_semana($1)', [s])).rejects.toThrow(/compras abertas/)
  })

  it('I2: a mensagem de compras abertas nomeia loja e comprador de cada uma', async () => {
    const db = await banco()
    await importar(db)
    const s = await idSemana(db)
    await como(db, ADMIN, 'select aprovar_semana($1)', [s])
    await como(db, JOAO, `select abrir_compra('00000000-0000-0000-0000-000000000001', $1, 'ATACADÃO')`, [s])
    await como(db, MARIA, `select abrir_compra('00000000-0000-0000-0000-000000000002', $1, 'FEIRA')`, [s])
    await expect(como(db, ADMIN, 'select encerrar_semana($1)', [s]))
      .rejects.toThrow(/há compras abertas nesta semana: ATACADÃO \(joao\), FEIRA \(maria\); peça para fecharem antes/)
  })

  it('I2: só existe uma semana em_compra por vez (índice único de banco, defesa a mais além da aplicação)', async () => {
    const db = await banco()
    await db.exec(`insert into semanas (data_referencia, status) values ('2026-09-08', 'em_compra')`)
    await expect(
      db.exec(`insert into semanas (data_referencia, status) values ('2026-09-15', 'em_compra')`),
    ).rejects.toThrow(/semanas_uma_em_compra/)
  })
})
