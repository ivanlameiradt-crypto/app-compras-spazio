import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO, importar } from './fixture'
import {
  semearCotacao, aprovar, preparar, congelar, cotacaoDe, chamar, erroDe, itemDe,
  V_FULANO, V_BELTRANO, payloadDe, type Json,
} from './fixture-cotacao'

// Fase 2, Bloco C2 (DESIGN-fase-2.md, C.4.8 e C.4.9, C.10 nº 18 a 22): regras da lista e fatores a confirmar.
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const CHAVE = '15261012345678000190550010001234561000000017'
const SELO = (codigo: string) => ({ codigo, texto: 'aviso' })

/** Item da semana como o robô manda (fixture-cotacao usa outro formato; aqui controlo selos e qtd por produto). */
const item = (produto_id: number, over: Json = {}): Json => ({
  produto_id, produto: `PROD ${produto_id}`, bebida: true, estoque: 1, estoque_minimo: 0, qtd_sugerida: 10,
  preco_estimado: 2, custo_medio: 2, data_ultima_compra: '2026-10-10', fornecedor_ultima: 'FORNECEDOR A LTDA',
  situacao: 'Repor', selos: [], ...over,
})
const payload = (dataRef: string, itens: Json[]): Json => ({ data_referencia: dataRef, itens })

async function inserirNfe(db: PGlite, chave: string, vendedor: number | null, itens: Json, emissao = '2026-10-18'): Promise<void> {
  await db.query(
    `insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens, vendedor_id,
       situacao, primeiro_visto_em, visto_na_fila_em, atualizado_em)
     values ($1, substr($1, 7, 14), 'FORNECEDOR A', '123', $4, 100, true, $2::jsonb, $3, 'na_fila', now(), now(), now())`,
    [chave, JSON.stringify(itens), vendedor, emissao],
  )
}

describe('C2 — importar_semana com regras (C.10 nº 18, 19, 20)', () => {
  it('sem regras, o resultado é idêntico e vem "regras": {0, 0}', async () => {
    const db = await banco()
    const r = await importar(db, payload('2026-10-19', [item(201), item(202, { qtd_sugerida: 0 })]))
    expect(r).toMatchObject({ resultado: 'criada', selos: true, regras: { barrados: 0, incluidos: 0 } })
    const l = await como(db, ADMIN, 'select produto_id, incluido, qtd_aprovada, regra from itens_semana order by produto_id')
    expect(l).toEqual([
      { produto_id: 201, incluido: true, qtd_aprovada: '10', regra: null },
      { produto_id: 202, incluido: false, qtd_aprovada: '0', regra: null },
    ])
  })
  it('barrar deixa o item fora (incluido=false, qtd 0) e o comprador não o vê (RLS via incluido)', async () => {
    const db = await banco()
    await importar(db, payload('2026-10-19', [item(201)]))                 // 201 existe na semana mais recente
    await chamar(db, ADMIN, `lista_regra_salvar(201, 'barrar', 'É da Kūkan')`)
    const r = await importar(db, payload('2026-10-26', [item(201)]))       // nova semana com a regra
    expect(r.regras).toEqual({ barrados: 1, incluidos: 0 })
    const [l] = await como(db, ADMIN, 'select incluido, qtd_aprovada, regra, regra_motivo from itens_semana where produto_id = 201 order by semana_id desc limit 1')
    expect(l).toEqual({ incluido: false, qtd_aprovada: '0', regra: 'barrar', regra_motivo: 'É da Kūkan' })
  })
  it('incluir entra só com selo linha_alta; outros selos, negativo e qtd 0 continuam fora', async () => {
    const db = await banco()
    const base = [
      item(201, { selos: [SELO('linha_alta')] }),
      item(202, { selos: [SELO('linha_alta'), SELO('preco_fora')] }),
      item(203, { bebida: false, situacao: 'ESTOQUE NEGATIVO', selos: [SELO('linha_alta')] }),
      item(204, { qtd_sugerida: 0, selos: [SELO('linha_alta')] }),
    ]
    await importar(db, payload('2026-10-19', base))
    for (const p of [201, 202, 203, 204]) await chamar(db, ADMIN, `lista_regra_salvar(${p}, 'incluir', null)`)
    const r = await importar(db, payload('2026-10-26', base))
    expect(r.regras).toEqual({ barrados: 0, incluidos: 1 }) // só o 201
    const l = await como(db, ADMIN, 'select produto_id, incluido from itens_semana where semana_id = (select max(id) from semanas) order by produto_id')
    expect(l).toEqual([
      { produto_id: 201, incluido: true }, { produto_id: 202, incluido: false },
      { produto_id: 203, incluido: false }, { produto_id: 204, incluido: false },
    ])
  })
})

describe('C2 — lista_regra_salvar/remover (C.10 nº 21)', () => {
  it('no rascunho, barrar tira e incluir repõe; em_compra não muda; barrar sem motivo é recusado', async () => {
    const db = await banco()
    await importar(db, payload('2026-10-19', [item(201), item(202, { selos: [SELO('linha_alta')] })])) // rascunho
    // barrar tira o 201 (estava dentro)
    const b = await chamar(db, ADMIN, `lista_regra_salvar(201, 'barrar', 'É da Kūkan')`)
    expect(b.efeito).toBe('tirado')
    // incluir repõe o 202 (estava fora por selo)
    const i = await chamar(db, ADMIN, `lista_regra_salvar(202, 'incluir', null)`)
    expect(i.efeito).toBe('incluido')
    const l = await como(db, ADMIN, 'select produto_id, incluido, qtd_aprovada from itens_semana order by produto_id')
    expect(l).toEqual([{ produto_id: 201, incluido: false, qtd_aprovada: '0' }, { produto_id: 202, incluido: true, qtd_aprovada: '10' }])
    // barrar sem motivo é recusado
    expect(await erroDe(chamar(db, ADMIN, `lista_regra_salvar(202, 'barrar', null)`))).toBe('diga o motivo, ex.: É da Kūkan')
    // remover limpa a regra do item sem mexer no incluido
    await chamar(db, ADMIN, 'lista_regra_remover(201)')
    const [l201] = await como(db, ADMIN, 'select incluido, regra from itens_semana where produto_id = 201')
    expect(l201).toEqual({ incluido: false, regra: null })
    expect(await erroDe(chamar(db, ADMIN, 'lista_regra_remover(201)'))).toBe('regra não encontrada')
  })
  it('semana em_compra não é mexida pela regra nova', async () => {
    const db = await banco()
    await aprovar(db, payloadDe('2026-10-19')) // em_compra
    const r = await chamar(db, ADMIN, `lista_regra_salvar(101, 'barrar', 'É da Kūkan')`)
    expect(r.efeito).toBe('nenhum')
    const [l] = await como(db, ADMIN, 'select incluido from itens_semana where produto_id = 101')
    expect(l.incluido).toBe(true) // a semana em compra não muda
  })
})

describe('C2 — cot_fatores_a_confirmar (C.10 nº 22)', () => {
  /** Congela a cotação do Fulano e grava uma resposta "tem" por embalagem com o fator dado no produto. */
  async function respostaFator(db: PGlite, semana: number, produto: number, fator: number, cot?: number): Promise<number> {
    const id = cot ?? await cotacaoDe(db, semana, V_FULANO)
    if (cot === undefined) await congelar(db, id)
    await db.query(`update cot_itens set estado = 'tem', base = 'embalagem', fator_informado = $3, preco_digitado = 10, respondido_em = now()
                    where cotacao_id = $1 and produto_id = $2`, [id, produto, fator])
    return id
  }
  const linhas = async (db: PGlite): Promise<Json[]> => como(db, ADMIN, 'select * from cot_fatores_a_confirmar() order by produto_id, fator')

  it('resposta fardo c/12 aparece; igual ao padrão some; diferente vira conflito; descartado não volta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    await respostaFator(db, semana, 101, 12) // Fulano cotou 101 em fardo c/12
    let l = await linhas(db)
    expect(l.find((x) => Number(x.produto_id) === 101)).toMatchObject({ vendedor_id: V_FULANO, fator: '12', origem: 'resposta', vezes: 1 })

    // confirma fardo c/12 como padrão: some da lista
    await chamar(db, ADMIN, `cot_confirmar_fator(101, $1, 'fardo', 12, 'resposta')`, [V_FULANO])
    l = await linhas(db)
    expect(l.find((x) => Number(x.produto_id) === 101)).toBeUndefined()

    // uma resposta com outro fator (c/6) vira conflito com o padrão c/12
    await db.query(`update cot_itens set fator_informado = 6 where cotacao_id = (select id from cot_cotacoes where semana_id = $1 and vendedor_id = $2) and produto_id = 101`, [semana, V_FULANO])
    l = await linhas(db)
    expect(l.find((x) => Number(x.produto_id) === 101)).toMatchObject({ fator: '6', conflito: true, padrao_fator: '12' })

    // descartar o fator c/6: não volta
    await chamar(db, ADMIN, 'cot_descartar_fator(101, $1, 6)', [V_FULANO])
    l = await linhas(db)
    expect(l.find((x) => Number(x.produto_id) === 101)).toBeUndefined()
  })

  it('resposta de vendedor que não é o atual não aparece; base litro/kg/un não aparece', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    // Beltrano não é o vendedor do 101 (é do Fulano): sua resposta não aparece
    const cotB = await cotacaoDe(db, semana, V_BELTRANO)
    await congelar(db, cotB)
    await db.query(`update cot_itens set estado = 'tem', base = 'embalagem', fator_informado = 12, preco_digitado = 10
                    where cotacao_id = $1 and produto_id = 105`, [cotB]) // 105 é do Beltrano — aparece
    // resposta por 'un' (não embalagem) do Fulano no 101: não aparece
    await respostaFator(db, semana, 101, 12)
    await db.query(`update cot_itens set base = 'un', fator_informado = null where cotacao_id = (select id from cot_cotacoes where semana_id = $1 and vendedor_id = $2) and produto_id = 101`, [semana, V_FULANO])
    const l = await linhas(db)
    expect(l.some((x) => Number(x.produto_id) === 101)).toBe(false) // base 'un' não conta
    expect(l.some((x) => Number(x.produto_id) === 105 && Number(x.vendedor_id) === V_BELTRANO)).toBe(true)
  })

  it("fonte 'nfe' conta NF-e; UN DIFERE (qtd null) não aparece", async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    // NF-e do Fulano para o 102 (un): 108 ÷ 9 = fardo c/12
    await inserirNfe(db, CHAVE, V_FULANO, [{ n: 1, produto_id: 102, qtd: 108, qtd_nf: 9, unidade_nf: 'FD', unidade_sischef: 'UN' }])
    // UN DIFERE: qtd null → não entra
    await inserirNfe(db, '15261012345678000190550010009999991000000015', V_FULANO,
      [{ n: 1, produto_id: 103, qtd: null, qtd_nf: 2, unidade_nf: 'SC', unidade_sischef: 'KG' }])
    const l = await linhas(db)
    const nf = l.find((x) => Number(x.produto_id) === 102)
    expect(nf).toMatchObject({ origem: 'nfe', vezes: 1, embalagem_sugerida: 'fardo' })
    expect(Number(nf.fator)).toBe(12) // round(108/9, 3) = 12.000
    expect(l.some((x) => Number(x.produto_id) === 103)).toBe(false)
  })
})
