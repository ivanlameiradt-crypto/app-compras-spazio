import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, aprovar, preparar, congelar, cotacaoDe, chamar, erroDe, itemDe, marcas,
  V_FULANO, V_BELTRANO, FULANO, payloadDe, type Json,
} from './fixture-cotacao'

// Fase 2, Bloco C1 (DESIGN-fase-2.md, C.4.3 a C.4.7 e C.10). Testes de banco no pglite, fixtures INVENTADAS
// (repositório público): vendedores "Fulano"/"Beltrano"/"ATACADÃO", telefones 55 + DDD + 90000 + 4 dígitos (D21).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const CHAVE = '15261012345678000190550010001234561000000017' // cnpj emitente (substr 7,14) = 12345678000190
const CHAVE2 = '15261099887766000155550010009999991000000012' // cnpj = 99887766000155

/** Insere uma NF-e da D direto (a fila do robô é testada em nfe.test.ts). itens = a lista de {produto_id,qtd,qtd_nf,...}. */
async function inserirNfe(db: PGlite, chave: string, vendedor: number | null, itens: Json): Promise<void> {
  await db.query(
    `insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens, vendedor_id,
       situacao, primeiro_visto_em, visto_na_fila_em, atualizado_em)
     values ($1, substr($1, 7, 14), 'FORNECEDOR A', '123', '2026-10-18', 100, true, $2::jsonb, $3, 'na_fila', now(), now(), now())`,
    [chave, JSON.stringify(itens), vendedor],
  )
}

const novoVendedor = (db: PGlite, p: Json, quem = ADMIN) => chamar(db, quem, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify(p)])
const catalogo = async (db: PGlite, produto: number): Promise<Json> =>
  (await db.query('select * from cot_catalogo where produto_id = $1', [produto])).rows[0]

describe('C1 — segurança (C.10 nº 1)', () => {
  const ADMINF: [string, string][] = [
    ['cot_vendedor_salvar', `cot_vendedor_salvar('{"nome":"X","empresa":"Y","whatsapp":"5511900000009"}'::jsonb)`],
    ['cot_vendedor_excluir', 'cot_vendedor_excluir(1)'],
    ['cot_grafia_salvar', `cot_grafia_salvar('X', 1)`],
    ['cot_grafia_remover', `cot_grafia_remover('X')`],
    ['cot_feriado_salvar', `cot_feriado_salvar('2027-01-01', 'X')`],
    ['cot_feriado_remover', `cot_feriado_remover('2027-01-01')`],
    ['cot_definir_nome', `cot_definir_nome(101, 'X')`],
    ['cot_definir_litro', 'cot_definir_litro(103, true)'],
    ['cot_confirmar_kg_por_litro', 'cot_confirmar_kg_por_litro(103, 1)'],
    ['cot_confirmar_fator', `cot_confirmar_fator(101, 1, 'fardo', 12)`],
    ['cot_tirar_fator', 'cot_tirar_fator(101)'],
    ['cot_catalogo_soltar_vendedor', 'cot_catalogo_soltar_vendedor(101)'],
    ['cot_produtos_cadastro', 'cot_produtos_cadastro()'],
    ['cot_fornecedores_sem_vendedor', 'cot_fornecedores_sem_vendedor()'],
  ]
  it('comprador recebe "apenas o administrador"; anon nem executa', async () => {
    const db = await banco()
    await aprovar(db) // semana com itens_semana para os produtos existirem
    for (const [nome, expr] of ADMINF) {
      expect([nome, await erroDe(chamar(db, JOAO, expr))]).toEqual([nome, 'apenas o administrador pode fazer isso'])
      await expect(como(db, 'anon', `select ${expr}`), nome).rejects.toThrow(/permission denied/)
    }
  })
  it('cot_exportar_cadastros só roda com a chave de serviço', async () => {
    const db = await banco()
    await expect(como(db, ADMIN, 'select cot_exportar_cadastros()')).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', 'select cot_exportar_cadastros()')).rejects.toThrow(/permission denied/)
    const [r] = await como(db, 'service', 'select cot_exportar_cadastros() as r')
    expect(r.r.vendedores).toBeInstanceOf(Array)
  })
})

describe('C1 — cot_vendedor_salvar (C.10 nº 2, 3, 5)', () => {
  it('normaliza o WhatsApp, recusa número curto e gera o código', async () => {
    const db = await banco()
    const r1 = await novoVendedor(db, { nome: 'Carlos', empresa: 'ATACADÃO', whatsapp: '(91) 90000-1234' })
    expect(r1.ok).toBe(true)
    expect(r1.codigo).toBe('atacadao')
    const [v1] = await como(db, ADMIN, 'select whatsapp, ativo from cot_vendedores where id = $1', [r1.id])
    expect([v1.whatsapp, v1.ativo]).toEqual(['5591900001234', false]) // nasce desligado (ativo:true ignorado)

    const r2 = await novoVendedor(db, { nome: 'Ana', empresa: 'ATACADÃO', whatsapp: '091 90000-4321' })
    expect(r2.codigo).toBe('atacadao_2') // já existe 'atacadao'
    const [v2] = await como(db, ADMIN, 'select whatsapp from cot_vendedores where id = $1', [r2.id])
    expect(v2.whatsapp).toBe('5591900004321')

    expect(await erroDe(novoVendedor(db, { nome: 'X', empresa: 'Y', whatsapp: '90000-1234' })))
      .toBe('WhatsApp inválido: use DDD + número, ex.: (91) 90000-1234')
  })
  it('ativo:true na entrada é ignorado: o vendedor nasce desligado', async () => {
    const db = await banco()
    const r = await novoVendedor(db, { nome: 'Z', empresa: 'ZE', whatsapp: '5591900009999', ativo: true })
    const [v] = await como(db, ADMIN, 'select ativo from cot_vendedores where id = $1', [r.id])
    expect(v.ativo).toBe(false)
  })
  it('whatsapp_repetido: o número já está em outro vendedor', async () => {
    const db = await banco()
    const r = await novoVendedor(db, { nome: 'X', empresa: 'XZ', whatsapp: FULANO.whatsapp })
    expect(r).toEqual({ ok: false, confirmar: [{ codigo: 'whatsapp_repetido', empresa: 'FORNECEDOR A' }] })
    const ok = await novoVendedor(db, { nome: 'X', empresa: 'XZ', whatsapp: FULANO.whatsapp, confirmar: ['whatsapp_repetido'] })
    expect(ok.ok).toBe(true)
  })
})

describe('C1 — ligar e desligar (C.10 nº 3, 4, 5)', () => {
  /** ATACADÃO com a grafia 'ATACADAO S.A.'; a semana troca 3 itens incluídos para essa grafia. */
  async function comAtacadao(db: PGlite): Promise<{ vendedor: number; semana: number }> {
    const r = await novoVendedor(db, { nome: 'Carlos', empresa: 'ATACADÃO', whatsapp: '5591900001234' })
    await chamar(db, ADMIN, `cot_grafia_salvar('ATACADAO S.A.', $1)`, [r.id])
    const semana = await aprovar(db, payloadDe('2026-10-19', (itens) => {
      for (const p of [101, 102, 104]) itens.find((i) => i.produto_id === p)!.fornecedor_ultima = 'ATACADAO S.A.'
      return itens
    }))
    return { vendedor: r.id, semana }
  }
  it('sem semana em compra, ligar grava sem aviso', async () => {
    const db = await banco()
    const r = await novoVendedor(db, { nome: 'Carlos', empresa: 'ATACADÃO', whatsapp: '5591900001234' })
    const on = await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify({ id: r.id, ativo: true })])
    expect(on.ok).toBe(true)
    const [v] = await como(db, ADMIN, 'select ativo from cot_vendedores where id = $1', [r.id])
    expect(v.ativo).toBe(true)
  })
  it('ligar com itens aguardando pede confirmação e não grava; confirmado, grava e a etiqueta aparece', async () => {
    const db = await banco()
    const { vendedor, semana } = await comAtacadao(db)
    const r = await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify({ id: vendedor, ativo: true })])
    expect(r.ok).toBe(false)
    expect(r.confirmar[0].codigo).toBe('aguardando')
    expect(r.confirmar[0].itens).toBe(3)
    expect(r.confirmar[0].ate).toBe('2026-10-20T15:00:00.000000Z') // ter 20/10 12:00 BRT
    const [v] = await como(db, ADMIN, 'select ativo from cot_vendedores where id = $1', [vendedor])
    expect(v.ativo).toBe(false) // nada gravado
    expect(await como(db, ADMIN, 'select count(*)::int as n from historico_alteracoes')).toEqual([{ n: expect.any(Number) }])

    await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify({ id: vendedor, ativo: true, confirmar: ['aguardando'] })])
    const m = await marcas(db, semana)
    const aguardando = Object.values(m).filter((x: Json) => x.estado === 'aguardando_cotacao' && Number(x.vendedor_id) === vendedor)
    expect(aguardando).toHaveLength(3)
  })
  it('desligar com versão viva pede cotacao_viva; confirmado, a cotação continua valendo', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const cot = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, cot) // versão viva (pronta) do Fulano
    const r = await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify({ id: V_FULANO, ativo: false })])
    expect(r.ok).toBe(false)
    expect(r.confirmar[0].codigo).toBe('cotacao_viva')
    expect(r.confirmar[0].versoes[0]).toMatchObject({ versao: 1, status: 'pronta' })
    await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)', [JSON.stringify({ id: V_FULANO, ativo: false, confirmar: ['cotacao_viva'] })])
    const [v] = await como(db, ADMIN, 'select ativo from cot_vendedores where id = $1', [V_FULANO])
    expect(v.ativo).toBe(false)
    const [c] = await como(db, ADMIN, 'select status from cot_cotacoes where id = $1', [cot])
    expect(c.status).toBe('pronta') // a viva continua
  })
  it('salvar sem mudança de valor não grava histórico', async () => {
    const db = await banco()
    const antes = (await como(db, ADMIN, 'select count(*)::int as n from historico_alteracoes'))[0].n
    await chamar(db, ADMIN, 'cot_vendedor_salvar($1::jsonb)',
      [JSON.stringify({ id: V_FULANO, nome: FULANO.nome, empresa: FULANO.empresa, whatsapp: FULANO.whatsapp })])
    const depois = (await como(db, ADMIN, 'select count(*)::int as n from historico_alteracoes'))[0].n
    expect(depois).toBe(antes)
  })
})

describe('C1 — excluir (C.10 nº 6)', () => {
  it('apaga vendedor sem referência; recusa com grafia e com CNPJ', async () => {
    const db = await banco()
    const r = await novoVendedor(db, { nome: 'Z', empresa: 'ZED', whatsapp: '5591900008888' })
    await chamar(db, ADMIN, 'cot_vendedor_excluir($1)', [r.id]) // sem referência: apaga
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_vendedores where id = $1', [r.id])).toEqual([{ n: 0 }])
    // Fulano tem grafia 'FORNECEDOR A LTDA'
    expect(await erroDe(chamar(db, ADMIN, 'cot_vendedor_excluir($1)', [V_FULANO])))
      .toBe('este vendedor já tem cotações, grafias ou produtos: use Desligar')
  })
  it('vendedor só com CNPJ da NF-e recebe a mensagem do CNPJ', async () => {
    const db = await banco()
    const r = await novoVendedor(db, { nome: 'Z', empresa: 'ZED', whatsapp: '5591900008888' })
    await db.query(`insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
                    values ('12345678000190', $1, 'ivan', 'ZED', now())`, [r.id])
    expect(await erroDe(chamar(db, ADMIN, 'cot_vendedor_excluir($1)', [r.id])))
      .toBe('este vendedor tem CNPJ da NF-e: tire o CNPJ no cartão antes')
  })
})

describe('C1 — grafias (C.10 nº 7)', () => {
  it('produtos_seguindo conta só quem segue a última compra; mover a grafia leva o CNPJ origem=nome', async () => {
    const db = await banco()
    await aprovar(db)
    const atac = await novoVendedor(db, { nome: 'Carlos', empresa: 'ATACADÃO', whatsapp: '5591900001234' })
    // CNPJ aprendido pela grafia 'FORNECEDOR A LTDA' (hoje do Fulano), origem 'nome'
    await db.query(`insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
                    values ('12345678000190', $1, 'nome', 'FORNECEDOR A LTDA', now())`, [V_FULANO])
    await db.query(`insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
                    values ('99887766000155', $1, 'ivan', 'FORNECEDOR A LTDA', now())`, [V_FULANO])
    const r = await chamar(db, ADMIN, `cot_grafia_salvar('FORNECEDOR A LTDA', $1)`, [atac.id])
    expect(r.vendedor_antes).toBe(V_FULANO)
    expect(r.cnpjs_movidos).toBe(1) // só o origem 'nome'
    const cnpjs = await como(db, ADMIN, 'select cnpj, vendedor_id from cot_fornecedores_cnpj order by cnpj')
    expect(cnpjs).toEqual([
      { cnpj: '12345678000190', vendedor_id: atac.id }, // moveu para o ATACADÃO
      { cnpj: '99887766000155', vendedor_id: V_FULANO }, // origem 'ivan' fica
    ])
  })
  it('remover a grafia apaga o CNPJ origem=nome dela e os produtos voltam a "sem vendedor"', async () => {
    const db = await banco()
    await db.query(`insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
                    values ('12345678000190', $1, 'nome', 'FORNECEDOR A LTDA', now())`, [V_FULANO])
    const r = await chamar(db, ADMIN, `cot_grafia_remover('FORNECEDOR A LTDA')`)
    expect(r.cnpjs_removidos).toBe(1)
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_fornecedores_cnpj')).toEqual([{ n: 0 }])
    expect(await erroDe(chamar(db, ADMIN, `cot_grafia_remover('FORNECEDOR A LTDA')`))).toBe('grafia não encontrada')
  })
})

describe('C1 — feriados (C.10 nº 8)', () => {
  it('recusa data passada; muda_aguardando dentro da janela', async () => {
    const db = await banco()
    await aprovar(db) // semana em compra, aprovada seg 19/10 08:00; relógio seg 15:00
    expect(await erroDe(chamar(db, ADMIN, `cot_feriado_salvar('2026-10-01', 'Velho')`))).toBe('só feriados de hoje em diante')
    // ter 20/10 cai entre o dia seguinte à aprovação (20/10) e o aguardando_ate (20/10 12:00): muda
    const r = await chamar(db, ADMIN, `cot_feriado_salvar('2026-10-20', 'Novo')`)
    expect(r.muda_aguardando).toBe(true)
    const longe = await chamar(db, ADMIN, `cot_feriado_salvar('2026-12-25', 'Natal')`)
    expect(longe.muda_aguardando).toBe(false)
  })
})

describe('C1 — nome, litro e kg por litro (C.10 nº 9, 10)', () => {
  it('definir_nome vazio volta ao nome limpo; só item em kg aceita "por litro"', async () => {
    const db = await banco()
    await aprovar(db)
    await chamar(db, ADMIN, `cot_definir_nome(101, 'Água 500')`)
    expect((await catalogo(db, 101)).nome_para_vendedor).toBe('Água 500')
    await chamar(db, ADMIN, `cot_definir_nome(101, '   ')`) // vazio → null
    expect((await catalogo(db, 101)).nome_para_vendedor).toBeNull()
    // 101 é un: recusa por litro
    expect(await erroDe(chamar(db, ADMIN, 'cot_definir_litro(101, true)'))).toBe('só itens em kg podem ser vendidos por litro')
  })
  it('kg por litro exige "por litro"; 0,1 recusado; null tira a conversão', async () => {
    const db = await banco()
    await aprovar(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_confirmar_kg_por_litro(103, 1)'))).toBe("marque 'vendido por litro' antes")
    await chamar(db, ADMIN, 'cot_definir_litro(103, true)') // 103 é kg
    expect(await erroDe(chamar(db, ADMIN, 'cot_confirmar_kg_por_litro(103, 0.1)'))).toBe('1 L precisa valer entre 0,2 e 3 kg')
    await chamar(db, ADMIN, 'cot_confirmar_kg_por_litro(103, 1)')
    expect((await catalogo(db, 103)).kg_por_litro).toBe('1')
    await chamar(db, ADMIN, 'cot_confirmar_kg_por_litro(103, null)')
    expect((await catalogo(db, 103)).kg_por_litro).toBeNull()
    // desligar "por litro" apaga a conversão
    await chamar(db, ADMIN, 'cot_confirmar_kg_por_litro(103, 1)')
    await chamar(db, ADMIN, 'cot_definir_litro(103, false)')
    const c = await catalogo(db, 103)
    expect([c.vende_por_litro, c.kg_por_litro]).toEqual([false, null])
  })
})

describe('C1 — cot_confirmar_fator (C.10 nº 11, 12)', () => {
  it('un aceita inteiro e recusa fração; kg aceita 0,5; vendedor diferente é recusado', async () => {
    const db = await banco()
    await aprovar(db)
    expect(await erroDe(chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12.5)`, [V_FULANO])))
      .toBe('em item por unidade o fator é um número inteiro, ex.: 12')
    const r = await chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12)`, [V_FULANO])
    expect(r.onde).toBe('catalogo')
    const c = await catalogo(db, 101)
    expect([c.embalagem, c.fator, c.vendedor_id, c.origem]).toEqual(['fardo', '12', V_FULANO, 'ultima_compra'])
    expect(c.fator_confirmado_em).not.toBeNull()
    // 103 é kg: 0,5 aceito
    await chamar(db, ADMIN, `cot_confirmar_fator(103, $1, 'saco', 0.5)`, [V_FULANO])
    expect((await catalogo(db, 103)).fator).toBe('0.5')
    // vendedor diferente do atual (101 é do Fulano)
    expect(await erroDe(chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12)`, [V_BELTRANO])))
      .toContain('este produto hoje é de')
  })
  it("origem 'resposta' exige a resposta; origem 'nfe' confere a NF do mesmo vendedor", async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const cot = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, cot)
    // sem resposta ainda
    expect(await erroDe(chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12, 'resposta')`, [V_FULANO])))
      .toBe('essa resposta não existe mais')
    await db.query(`update cot_itens set estado = 'tem', base = 'embalagem', fator_informado = 12, preco_digitado = 31.5
                    where cotacao_id = $1 and produto_id = 101`, [cot])
    const ok = await chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12, 'resposta')`, [V_FULANO])
    expect(ok.depois.fator).toBe(12)

    // NF-e do Fulano com fardo c/12 (108 un ÷ 9 FD); e uma de outro vendedor
    await inserirNfe(db, CHAVE, V_FULANO, [{ n: 1, produto_id: 102, qtd: 108, qtd_nf: 9, unidade_nf: 'FD', unidade_sischef: 'UN' }])
    await inserirNfe(db, CHAVE2, V_BELTRANO, [{ n: 1, produto_id: 102, qtd: 108, qtd_nf: 9, unidade_nf: 'FD', unidade_sischef: 'UN' }])
    const nf = await chamar(db, ADMIN, `cot_confirmar_fator(102, $1, 'fardo', 12, 'nfe', $2)`, [V_FULANO, CHAVE])
    expect(nf.depois.fator).toBe(12)
    // a NF do outro vendedor não serve
    expect(await erroDe(chamar(db, ADMIN, `cot_confirmar_fator(102, $1, 'fardo', 12, 'nfe', $2)`, [V_FULANO, CHAVE2])))
      .toBe('essa NF-e não tem esse fator para este produto')
  })
  it('tirar_fator e soltar_vendedor voltam ao estado da última compra', async () => {
    const db = await banco()
    await aprovar(db)
    await chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12)`, [V_FULANO])
    await chamar(db, ADMIN, 'cot_tirar_fator(101)')
    const c1 = await catalogo(db, 101)
    expect([c1.embalagem, c1.fator, c1.fator_confirmado_em]).toEqual([null, null, null])
    // 101 ficou com vendedor_id fixo pelo confirmar_fator: soltar volta a seguir a última compra
    await chamar(db, ADMIN, 'cot_catalogo_soltar_vendedor(101)')
    const c2 = await catalogo(db, 101)
    expect([c2.vendedor_id, c2.origem]).toEqual([null, 'ivan'])
    expect(await erroDe(chamar(db, ADMIN, 'cot_catalogo_soltar_vendedor(101)'))).toBe('o produto já segue a última compra')
  })
})

describe('C1 — leituras, backup, trava e auditoria (C.10 nº 13, 14, 15, 16)', () => {
  it('cot_produtos_cadastro dá uma linha por produto, com via/motivo do cot_preparar', async () => {
    const db = await banco()
    await aprovar(db)
    const linhas = await como(db, ADMIN, 'select * from cot_produtos_cadastro() order by produto_id')
    expect(linhas.map((l: Json) => Number(l.produto_id))).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110])
    expect(linhas.find((l: Json) => Number(l.produto_id) === 101)).toMatchObject({ vendedor_id: V_FULANO, via: 'ultima_compra' })
    expect(linhas.find((l: Json) => Number(l.produto_id) === 108)).toMatchObject({ vendedor_id: null, motivo: 'nunca_comprado' })
  })
  it('cot_fornecedores_sem_vendedor exclui as grafias já cadastradas (acento/espaço normalizados)', async () => {
    const db = await banco()
    await aprovar(db)
    const semv = await como(db, ADMIN, 'select * from cot_fornecedores_sem_vendedor()')
    const nomes = semv.map((s: Json) => s.nome_normalizado)
    expect(nomes).toContain('FORNECEDOR C ME') // 107, sem vendedor
    expect(nomes).not.toContain('FORNECEDOR A LTDA') // Fulano
    expect(nomes).not.toContain('FORNECEDOR B LTDA') // Beltrano
  })
  it('cot_exportar_cadastros reflete o banco com os nomes das colunas do CSV', async () => {
    const db = await banco()
    const [r] = await como(db, 'service', 'select cot_exportar_cadastros() as r')
    expect(r.r.vendedores.map((v: Json) => v.codigo)).toEqual(['beltrano', 'fulano'])
    expect(r.r.fornecedores[0]).toMatchObject({ nome_fornecedor: 'FORNECEDOR A LTDA', vendedor_codigo: 'fulano' })
    expect(r.r.feriados[0]).toMatchObject({ data: '2026-10-12' })
  })
  it('a virada: o service_role recebe permission denied no cot_aplicar_cadastros (C.10 nº 15)', async () => {
    const db = await banco()
    await expect(como(db, 'service', `select cot_aplicar_cadastros('{}'::jsonb)`)).rejects.toThrow(/permission denied/)
  })
  it('auditoria: cada função grava 1 linha; via = claude quando app.via está definido', async () => {
    const db = await banco()
    await aprovar(db)
    await chamar(db, ADMIN, `cot_definir_nome(101, 'Água 500')`)
    const [h] = await como(db, ADMIN, `select antes, depois from historico_alteracoes where tabela = 'cot_catalogo' order by id desc limit 1`)
    expect(h.depois.via).toBe('app')
    // pelo conector: app.via = claude
    await como(db, ADMIN, `select set_config('app.via', 'claude', false), cot_definir_nome(102, 'Refri 350')`)
    const [h2] = await como(db, ADMIN, `select depois from historico_alteracoes where registro = '102' order by id desc limit 1`)
    expect(h2.depois.via).toBe('claude')
  })
})
