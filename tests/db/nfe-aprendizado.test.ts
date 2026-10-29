import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, fixarRelogio, ADMIN, SEGREDO } from './fixture-recebimento'
import { JOAO } from './fixture'
import { erroDe, type Json } from './fixture-cotacao'

// Memória de embalagem das notas fiscais (pedido do Ivan, 29/10/2026): a tabela nfe_aprendizado e as 2 funções do robô de NF-e
// (nfe_aprendizado_ler / nfe_aprendizado_gravar). Cadeia inteira de migrations; tudo INVENTADO (repositório público).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()

const CNPJ = '12345678000190'
const CNPJ2 = '99887766000155'
/** Chave de acesso de 44 dígitos: UF 15 + AAMM 2610 + CNPJ (posições 7 a 20) + modelo 55 + série 001 + número da nota (9) + tpEmis, cNF e DV (10). */
const chave = (cnpj: string, nf: number): string => `152610${cnpj}55001${String(nf).padStart(9, '0')}1000000007`
const NF_A = chave(CNPJ, 90049)
const NF_B = chave(CNPJ, 90050)
const NF_C = chave(CNPJ, 90051)

/** Um item como o robô manda: o refrigerante que vem em fardo de 6 ("6 UN" na nota), R$ 42,00 a unidade da nota. */
function item(over: Json = {}): Json {
  return { chave: NF_A, cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'REFRIGERANTE LATA 350 ML', fator: 6, preco_ref: 42,
    descricao: 'REFRIG COLA 6X350ML', ...over }
}

interface Linha {
  emitente_cnpj: string; cod_forn: string; unidade_nota: string; produto_id: number; produto_nome: string | null
  fator: number; preco_ref: number | null; descricao_exemplo: string | null; vezes: number; ultima_chave: string | null
}
/** A linha que o item() acima deve criar. */
const LINHA: Linha = { emitente_cnpj: CNPJ, cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'REFRIGERANTE LATA 350 ML', fator: 6,
  preco_ref: 42, descricao_exemplo: 'REFRIG COLA 6X350ML', vezes: 1, ultima_chave: NF_A }

/** O que nfe_aprendizado_ler devolve por linha (a linha inteira da tabela). */
type LinhaJson = Linha & { id: string; criado_em: string; atualizado_em: string }

const gravar = (db: PGlite, itens: Json, seg: string = SEGREDO, quem = 'anon'): Promise<Json> =>
  chamar(db, quem, 'nfe_aprendizado_gravar($1, $2::jsonb)', [seg, JSON.stringify(itens)])
const ler = (db: PGlite, cnpj: string | null = CNPJ, seg: string = SEGREDO, quem = 'anon'): Promise<LinhaJson[]> =>
  chamar(db, quem, 'nfe_aprendizado_ler($1, $2)', [seg, cnpj])

/** A tabela como o admin lê (ordem estável; numéricos viram número). */
async function linhas(db: PGlite): Promise<Linha[]> {
  const rs = await como(db, ADMIN, `select emitente_cnpj, cod_forn, unidade_nota, produto_id, produto_nome, fator, preco_ref, descricao_exemplo, vezes, ultima_chave
    from nfe_aprendizado order by emitente_cnpj, cod_forn, unidade_nota`)
  return rs.map((r) => ({ ...r, produto_id: Number(r.produto_id), fator: Number(r.fator), vezes: Number(r.vezes),
    preco_ref: r.preco_ref === null ? null : Number(r.preco_ref) }))
}
const total = async (db: PGlite): Promise<number> => (await linhas(db)).length

/** criado_em e atualizado_em da única linha da tabela, em UTC. */
async function carimbos(db: PGlite): Promise<{ criado: string; atualizado: string }> {
  const [r] = await como(db, ADMIN, `select to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as criado,
    to_char(atualizado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as atualizado from nfe_aprendizado`)
  return r
}

const msg = (n: number, resto: string): string => `memória de embalagem inválida (item ${n}): ${resto}`
const MSG_LISTA = 'memória de embalagem inválida: esperava uma lista (array) de itens'
const MSG_CNPJ = 'CNPJ inválido: informe os 14 dígitos do emitente'

describe('chave de teste', () => {
  it('a chave inventada tem 44 dígitos e o CNPJ nas posições 7 a 20', () => {
    for (const c of [NF_A, NF_B, NF_C]) {
      expect(c).toMatch(/^[0-9]{44}$/)
      expect(c.slice(6, 20)).toBe(CNPJ)
    }
    expect(chave(CNPJ2, 1).slice(6, 20)).toBe(CNPJ2)
  })
})

describe('credencial do robô (cot_nfe_exigir_robo)', () => {
  it('gravar: sem segredo, vazio ou errado → "não autorizado" e nada é gravado (nem com o lote vazio)', async () => {
    const db = await banco()
    for (const seg of ['', 'errado', 'x'.repeat(64)]) {
      expect(await erroDe(gravar(db, [item()], seg))).toBe('não autorizado')
      expect(await erroDe(gravar(db, [], seg))).toBe('não autorizado')
    }
    expect(await erroDe(chamar(db, 'anon', 'nfe_aprendizado_gravar(null, $1::jsonb)', [JSON.stringify([item()])]))).toBe('não autorizado')
    expect(await total(db)).toBe(0)
  })

  it('ler: sem segredo, vazio ou errado → "não autorizado" (mesmo com o CNPJ inválido, o segredo é conferido primeiro)', async () => {
    const db = await banco()
    await gravar(db, [item()])
    for (const seg of ['', 'errado', 'x'.repeat(64)]) {
      expect(await erroDe(ler(db, CNPJ, seg))).toBe('não autorizado')
      expect(await erroDe(ler(db, 'lixo', seg))).toBe('não autorizado')
    }
    expect(await erroDe(chamar(db, 'anon', 'nfe_aprendizado_ler(null, $1)', [CNPJ]))).toBe('não autorizado')
  })

  it('sem o segredo cot_nfe_robo no Vault as duas dão "não autorizado" (nunca aceitam vazio = vazio)', async () => {
    const db = await banco()
    await db.exec('truncate vault.decrypted_secrets')
    expect(await erroDe(gravar(db, [item()], ''))).toBe('não autorizado')
    expect(await erroDe(gravar(db, [item()], SEGREDO))).toBe('não autorizado')
    expect(await erroDe(ler(db, CNPJ, ''))).toBe('não autorizado')
    expect(await erroDe(ler(db, CNPJ, SEGREDO))).toBe('não autorizado')
    expect(await total(db)).toBe(0)
  })

  it('com o segredo certo o anon executa as duas; o admin e o comprador (authenticated) não executam nenhuma', async () => {
    const db = await banco()
    expect(Number(await gravar(db, [item()]))).toBe(1)
    expect(await ler(db)).toHaveLength(1)
    for (const quem of [ADMIN, JOAO]) {
      await expect(gravar(db, [item()], SEGREDO, quem)).rejects.toThrow(/permission denied/)
      await expect(ler(db, CNPJ, SEGREDO, quem)).rejects.toThrow(/permission denied/)
    }
    expect(await total(db)).toBe(1)
  })

  it('as duas são security definer com search_path = public', async () => {
    const db = await banco()
    const r = await db.query<{ f: string; definer: boolean; config: string[] | null }>(
      `select p.proname as f, p.prosecdef as definer, p.proconfig as config from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname in ('nfe_aprendizado_ler', 'nfe_aprendizado_gravar') order by 1`)
    expect(r.rows).toEqual([
      { f: 'nfe_aprendizado_gravar', definer: true, config: ['search_path=public'] },
      { f: 'nfe_aprendizado_ler', definer: true, config: ['search_path=public'] },
    ])
  })
})

describe('gravar — cria e atualiza', () => {
  it('cria a linha: o CNPJ vem da chave (posições 7 a 20), a unidade fica em maiúsculas, vezes 1; devolve quantas gravou', async () => {
    const db = await banco()
    await fixarRelogio(db, '2026-10-29T12:00:00Z')
    expect(Number(await gravar(db, [item({ unidade_nota: 'un' })]))).toBe(1)
    expect(await linhas(db)).toEqual([LINHA])
    expect(await carimbos(db)).toEqual({ criado: '2026-10-29T12:00:00Z', atualizado: '2026-10-29T12:00:00Z' })
  })

  it('o mesmo produto e o mesmo fator de novo: vezes 2 (e 3...); atualiza chave, preço, descrição e atualizado_em; criado_em fica', async () => {
    const db = await banco()
    await fixarRelogio(db, '2026-10-29T12:00:00Z')
    await gravar(db, [item()])
    await fixarRelogio(db, '2026-10-30T09:30:00Z')
    expect(Number(await gravar(db, [item({ chave: NF_B, preco_ref: 45.5, descricao: 'REFRIG COLA 6 X 350 ML (NOVA)' })]))).toBe(1)
    expect(await linhas(db)).toEqual([{ ...LINHA, vezes: 2, ultima_chave: NF_B, preco_ref: 45.5, descricao_exemplo: 'REFRIG COLA 6 X 350 ML (NOVA)' }])
    expect(await carimbos(db)).toEqual({ criado: '2026-10-29T12:00:00Z', atualizado: '2026-10-30T09:30:00Z' })
    await gravar(db, [item({ chave: NF_C })])
    expect((await linhas(db))[0]).toMatchObject({ vezes: 3, ultima_chave: NF_C })
    expect(await total(db)).toBe(1)
  })

  it('preco_ref que não vem (ausente, null, vazio ou 0) não apaga a referência enquanto o fator é o mesmo; um preço novo a troca', async () => {
    const db = await banco()
    await gravar(db, [item()])
    const sem: Json[] = [{ preco_ref: undefined }, { preco_ref: null }, { preco_ref: '' }, { preco_ref: 0 }, { preco_ref: '0.00' }]
    let vezes = 1
    for (const over of sem) {
      await gravar(db, [item(over)])
      vezes += 1
      expect([JSON.stringify(over), await linhas(db)]).toEqual([JSON.stringify(over), [{ ...LINHA, vezes, preco_ref: 42 }]])
    }
    await gravar(db, [item({ preco_ref: 47.25 })])
    expect(await linhas(db)).toEqual([{ ...LINHA, vezes: vezes + 1, preco_ref: 47.25 }])
  })

  it('fator novo (mesmo produto): substitui o fator, vezes volta a 1 e o preço antigo sai (era de outra embalagem)', async () => {
    const db = await banco()
    await gravar(db, [item()])
    await gravar(db, [item({ chave: NF_B })])   // vezes 2
    await gravar(db, [item({ chave: NF_C, fator: 12, preco_ref: 80 })])
    expect(await linhas(db)).toEqual([{ ...LINHA, fator: 12, preco_ref: 80, vezes: 1, ultima_chave: NF_C }])
    await gravar(db, [item({ chave: NF_A, fator: 6, preco_ref: undefined })])   // volta ao fardo de 6, sem preço: o de 80 era do fardo de 12
    expect(await linhas(db)).toEqual([{ ...LINHA, fator: 6, preco_ref: null, vezes: 1, ultima_chave: NF_A }])
    await gravar(db, [item({ chave: NF_B, fator: 6 })])   // e repetir o novo fator volta a contar
    expect((await linhas(db))[0]).toMatchObject({ fator: 6, vezes: 2 })
  })

  it('produto novo (mesmo fator): substitui o produto e o nome, vezes volta a 1; o produto antigo não fica como segunda linha', async () => {
    const db = await banco()
    await gravar(db, [item()])
    await gravar(db, [item({ chave: NF_B })])   // vezes 2
    await gravar(db, [item({ chave: NF_C, produto_id: 202, produto_nome: 'REFRIGERANTE LATA 269 ML', preco_ref: 40 })])
    expect(await linhas(db)).toEqual([{ ...LINHA, produto_id: 202, produto_nome: 'REFRIGERANTE LATA 269 ML', preco_ref: 40, vezes: 1, ultima_chave: NF_C }])
    // produto novo sem nome: o nome do produto antigo não pode ficar (seria o nome errado)
    await gravar(db, [item({ chave: NF_A, produto_id: 303, produto_nome: undefined })])
    expect(await linhas(db)).toEqual([{ ...LINHA, produto_id: 303, produto_nome: null, vezes: 1 }])
  })

  it('produto e fator novos juntos: substitui tudo, vezes 1', async () => {
    const db = await banco()
    await gravar(db, [item()])
    await gravar(db, [item({ chave: NF_B, produto_id: 202, produto_nome: 'OUTRO', fator: 24, preco_ref: 150 })])
    expect(await linhas(db)).toEqual([{ ...LINHA, produto_id: 202, produto_nome: 'OUTRO', fator: 24, preco_ref: 150, vezes: 1, ultima_chave: NF_B }])
  })

  it('o mesmo produto com outro nome ou sem nome: o nome novo vale, e a falta de nome não apaga o que já havia; a descrição segue a mesma regra', async () => {
    const db = await banco()
    await gravar(db, [item()])
    await gravar(db, [item({ chave: NF_B, produto_nome: 'REFRIGERANTE LATA 350 ML (RENOMEADO)' })])
    await gravar(db, [item({ chave: NF_C, produto_nome: undefined, descricao: undefined })])
    expect(await linhas(db)).toEqual([{ ...LINHA, vezes: 3, ultima_chave: NF_C, produto_nome: 'REFRIGERANTE LATA 350 ML (RENOMEADO)' }])
  })

  it('a chave é CNPJ + código + unidade: outra unidade, outro código e outro CNPJ são linhas separadas; unidade em minúsculas ou com espaços é a mesma', async () => {
    const db = await banco()
    await gravar(db, [
      item(),
      item({ unidade_nota: 'FD', fator: 12 }),                       // mesmo código, outra unidade
      item({ cod_forn: '17254', fator: 12 }),                         // outro código (o fardo de 12 tem código próprio)
      item({ chave: chave(CNPJ2, 1) }),                               // outro fornecedor com o mesmo código
    ])
    const chaves = (await linhas(db)).map((l) => `${l.emitente_cnpj}|${l.cod_forn}|${l.unidade_nota}|${l.fator}|${l.vezes}`)
    expect(chaves).toEqual([`${CNPJ}|17253|FD|12|1`, `${CNPJ}|17253|UN|6|1`, `${CNPJ}|17254|UN|12|1`, `${CNPJ2}|17253|UN|6|1`])
    await gravar(db, [item({ unidade_nota: ' un ' })])
    expect((await linhas(db)).map((l) => `${l.cod_forn}|${l.unidade_nota}|${l.vezes}`)).toEqual(['17253|FD|1', '17253|UN|2', '17254|UN|1', '17253|UN|1'])
  })

  it('lote com vários itens: grava todos e devolve quantos; itens repetidos no lote valem na ordem em que vêm', async () => {
    const db = await banco()
    expect(Number(await gravar(db, [item({ cod_forn: '1' }), item({ cod_forn: '2' }), item({ cod_forn: '3' })]))).toBe(3)
    expect(await total(db)).toBe(3)
    // a nota traz o mesmo código em duas linhas: cada item é uma gravação (mesmo fator soma; fator diferente, o último vence)
    expect(Number(await gravar(db, [item({ cod_forn: '7' }), item({ cod_forn: '7' })]))).toBe(2)
    expect((await linhas(db)).find((l) => l.cod_forn === '7')).toMatchObject({ fator: 6, vezes: 2 })
    expect(Number(await gravar(db, [item({ cod_forn: '8', fator: 6 }), item({ cod_forn: '8', fator: 12 })]))).toBe(2)
    expect((await linhas(db)).find((l) => l.cod_forn === '8')).toMatchObject({ fator: 12, vezes: 1 })
  })

  it('textos: sem espaços nas pontas, nome e descrição cortados em 200, vazios viram null; código numérico no JSON vira texto', async () => {
    const db = await banco()
    await gravar(db, [item({ cod_forn: '  17253\n', unidade_nota: ' fd ', produto_nome: '  LATA  ', descricao: 'x'.repeat(250) })])
    await gravar(db, [item({ cod_forn: 555, produto_nome: '', descricao: '   ' })])
    expect(await linhas(db)).toEqual([
      { ...LINHA, cod_forn: '17253', unidade_nota: 'FD', produto_nome: 'LATA', descricao_exemplo: 'x'.repeat(200) },
      { ...LINHA, cod_forn: '555', produto_nome: null, descricao_exemplo: null },
    ])
  })

  it('números como texto são aceitos (fator "6", produto_id "101", preco_ref "42.50")', async () => {
    const db = await banco()
    await gravar(db, [item({ fator: '6', produto_id: '101', preco_ref: '42.50' })])
    expect(await linhas(db)).toEqual([{ ...LINHA, preco_ref: 42.5 }])
  })
})

describe('gravar — validação (tudo ou nada)', () => {
  /** Cada item ruim, com a mensagem esperada. Item 2 de um lote [bom, ruim, bom]. */
  const RUINS: Array<[string, Json, string]> = [
    // fator: precisa ser número maior que 1
    ['fator 1', item({ fator: 1 }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator "1.00" (texto)', item({ fator: '1.00' }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator 0', item({ fator: 0 }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator 0.99', item({ fator: 0.99 }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator negativo', item({ fator: -6 }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator texto', item({ fator: 'seis' }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator NaN', item({ fator: 'NaN' }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator ausente', item({ fator: undefined }), msg(2, 'fator precisa ser um número maior que 1')],
    ['fator null', item({ fator: null }), msg(2, 'fator precisa ser um número maior que 1')],
    // código do fornecedor
    ['sem cod_forn', item({ cod_forn: undefined }), msg(2, 'cod_forn (código do fornecedor na nota) é obrigatório')],
    ['cod_forn vazio', item({ cod_forn: '' }), msg(2, 'cod_forn (código do fornecedor na nota) é obrigatório')],
    ['cod_forn só espaços', item({ cod_forn: '   ' }), msg(2, 'cod_forn (código do fornecedor na nota) é obrigatório')],
    ['cod_forn null', item({ cod_forn: null }), msg(2, 'cod_forn (código do fornecedor na nota) é obrigatório')],
    ['cod_forn de 61 caracteres', item({ cod_forn: 'a'.repeat(61) }), msg(2, 'cod_forn passa de 60 caracteres')],
    // unidade da nota
    ['sem unidade_nota', item({ unidade_nota: undefined }), msg(2, 'unidade_nota é obrigatória')],
    ['unidade_nota vazia', item({ unidade_nota: '  ' }), msg(2, 'unidade_nota é obrigatória')],
    ['unidade_nota de 11 caracteres', item({ unidade_nota: 'ABCDEFGHIJK' }), msg(2, 'unidade_nota passa de 10 caracteres')],
    // produto
    ['sem produto_id', item({ produto_id: undefined }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    ['produto_id 0', item({ produto_id: 0 }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    ['produto_id negativo', item({ produto_id: -5 }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    ['produto_id texto', item({ produto_id: 'abc' }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    ['produto_id decimal', item({ produto_id: 12.5 }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    ['produto_id null', item({ produto_id: null }), msg(2, 'produto_id precisa ser um número inteiro maior que 0')],
    // chave da nota
    ['chave curta (43)', item({ chave: NF_A.slice(0, 43) }), msg(2, 'a chave da nota precisa ter 44 dígitos')],
    ['chave longa (45)', item({ chave: `${NF_A}1` }), msg(2, 'a chave da nota precisa ter 44 dígitos')],
    ['chave com letras', item({ chave: 'A'.repeat(44) }), msg(2, 'a chave da nota precisa ter 44 dígitos')],
    ['chave ausente', item({ chave: undefined }), msg(2, 'a chave da nota precisa ter 44 dígitos')],
    ['chave null', item({ chave: null }), msg(2, 'a chave da nota precisa ter 44 dígitos')],
    // preço de referência (opcional, mas se vier tem de ser número)
    ['preco_ref texto', item({ preco_ref: 'caro' }), msg(2, 'preco_ref precisa ser um número (ou ficar de fora)')],
    ['preco_ref negativo', item({ preco_ref: -3 }), msg(2, 'preco_ref precisa ser um número (ou ficar de fora)')],
    ['preco_ref booleano', item({ preco_ref: true }), msg(2, 'preco_ref precisa ser um número (ou ficar de fora)')],
    // o item nem é um objeto
    ['item número', 5, msg(2, 'o item precisa ser um objeto')],
    ['item texto', 'x', msg(2, 'o item precisa ser um objeto')],
    ['item null', null, msg(2, 'o item precisa ser um objeto')],
    ['item lista', [], msg(2, 'o item precisa ser um objeto')],
  ]

  it('item inválido derruba o lote INTEIRO: erro claro em português com o número do item, e nem os itens bons do mesmo lote são gravados', async () => {
    const db = await banco()
    for (const [nome, ruim, esperado] of RUINS) {
      const lote = [item({ cod_forn: '111' }), ruim, item({ cod_forn: '333' })]
      expect([nome, await erroDe(gravar(db, lote))]).toEqual([nome, esperado])
      expect([nome, await total(db)]).toEqual([nome, 0])
    }
  })

  it('item inválido também não mexe no que já estava aprendido (nem os itens bons que atualizariam linhas existentes)', async () => {
    const db = await banco()
    await gravar(db, [item()])
    const antes = await linhas(db)
    expect(await erroDe(gravar(db, [item({ chave: NF_B }), item({ fator: 1 })]))).toBe(msg(2, 'fator precisa ser um número maior que 1'))
    expect(await erroDe(gravar(db, [item({ fator: 1 }), item({ chave: NF_B })]))).toBe(msg(1, 'fator precisa ser um número maior que 1'))
    expect(await linhas(db)).toEqual(antes)
  })

  it('o erro aponta o PRIMEIRO item ruim; e, depois de um lote recusado, um lote bom grava normalmente', async () => {
    const db = await banco()
    expect(await erroDe(gravar(db, [item(), item({ fator: 1 }), item({ cod_forn: null })]))).toBe(msg(2, 'fator precisa ser um número maior que 1'))
    expect(await total(db)).toBe(0)
    expect(Number(await gravar(db, [item(), item({ cod_forn: '2' })]))).toBe(2)
    expect(await total(db)).toBe(2)
  })

  it('lote vazio devolve 0, não grava nada e só confere o segredo', async () => {
    const db = await banco()
    expect(Number(await gravar(db, []))).toBe(0)
    expect(await total(db)).toBe(0)
    expect(await erroDe(gravar(db, [], 'errado'))).toBe('não autorizado')
  })

  it('o que não é lista dá erro e nada é gravado: objeto, texto, número, booleano, JSON null e NULL do SQL', async () => {
    const db = await banco()
    for (const p of [{}, { chave: NF_A }, 'x', 5, true, null]) {
      expect([JSON.stringify(p), await erroDe(gravar(db, p))]).toEqual([JSON.stringify(p), MSG_LISTA])
    }
    expect(await erroDe(chamar(db, 'anon', 'nfe_aprendizado_gravar($1, $2::jsonb)', [SEGREDO, null]))).toBe(MSG_LISTA)
    expect(await total(db)).toBe(0)
  })

  it('o lote tem no máximo 1000 itens: 1000 grava, 1001 é recusado', async () => {
    const db = await banco()
    const lote = (n: number): Json[] => Array.from({ length: n }, (_, i) => item({ cod_forn: `P${i}` }))
    expect(await erroDe(gravar(db, lote(1001)))).toBe('memória de embalagem inválida: lote com mais de 1000 itens')
    expect(await total(db)).toBe(0)
    expect(Number(await gravar(db, lote(1000)))).toBe(1000)
    expect(await total(db)).toBe(1000)
  })
})

describe('ler', () => {
  it('devolve só as linhas do CNPJ pedido, em ordem de cod_forn (texto, ordem binária) e depois de unidade_nota', async () => {
    const db = await banco()
    await gravar(db, [
      item({ cod_forn: '9' }), item({ cod_forn: '10' }), item({ cod_forn: 'B1' }), item({ cod_forn: '2A' }), item({ cod_forn: 'a1' }),
      item({ cod_forn: '9', unidade_nota: 'FD', fator: 12 }),
      item({ chave: chave(CNPJ2, 7), cod_forn: '1' }), item({ chave: chave(CNPJ2, 7), cod_forn: '0' }),
    ])
    expect((await ler(db)).map((l) => `${l.cod_forn}/${l.unidade_nota}`)).toEqual(['10/UN', '2A/UN', '9/FD', '9/UN', 'B1/UN', 'a1/UN'])
    expect((await ler(db, CNPJ2)).map((l) => `${l.emitente_cnpj}/${l.cod_forn}`)).toEqual([`${CNPJ2}/0`, `${CNPJ2}/1`])
  })

  it('sem nada aprendido daquele CNPJ devolve a lista vazia []', async () => {
    const db = await banco()
    expect(await ler(db)).toEqual([])
    await gravar(db, [item()])
    expect(await ler(db, CNPJ2)).toEqual([])
  })

  it('cada linha traz o que o robô precisa, com os tipos certos (números como número; sem referência = null, não some)', async () => {
    const db = await banco()
    await gravar(db, [item(), item({ cod_forn: '555', preco_ref: null, produto_nome: undefined, descricao: undefined })])
    const [a, b] = await ler(db)
    expect(a).toMatchObject({ emitente_cnpj: CNPJ, cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'REFRIGERANTE LATA 350 ML', fator: 6,
      preco_ref: 42, descricao_exemplo: 'REFRIG COLA 6X350ML', vezes: 1, ultima_chave: NF_A })
    expect(b).toMatchObject({ cod_forn: '555', preco_ref: null, produto_nome: null, descricao_exemplo: null })
    expect(Object.keys(b)).toEqual(expect.arrayContaining(['preco_ref', 'produto_nome', 'descricao_exemplo', 'criado_em', 'atualizado_em']))
    expect(typeof a.id).toBe('string')
    expect(Number.isNaN(Date.parse(a.atualizado_em))).toBe(false)
  })

  it('o que o robô grava o robô lê de volta igualzinho, inclusive depois de atualizar', async () => {
    const db = await banco()
    await gravar(db, [item()])
    await gravar(db, [item({ chave: NF_B, preco_ref: 44 })])
    expect(await ler(db)).toMatchObject([{ ...LINHA, vezes: 2, ultima_chave: NF_B, preco_ref: 44 }])
  })

  it('aceita o CNPJ com pontuação (só os dígitos contam)', async () => {
    const db = await banco()
    await gravar(db, [item()])
    expect(await ler(db, '12.345.678/0001-90')).toEqual(await ler(db))
    expect(await ler(db, ' 12345678000190 ')).toHaveLength(1)
  })

  it('CNPJ inválido dá erro claro (em vez de lista vazia, que esconderia um robô lendo o CNPJ errado)', async () => {
    const db = await banco()
    for (const ruim of [null, '', '   ', '123', '1234567800019', '123456780001900', 'abcdefghijklmn']) {
      expect([ruim, await erroDe(ler(db, ruim))]).toEqual([ruim, MSG_CNPJ])
    }
  })
})

describe('a tabela nfe_aprendizado', () => {
  const inserir = (db: PGlite, over: Record<string, string> = {}): Promise<Json> => {
    const v: Record<string, string> = { emitente_cnpj: `'${CNPJ}'`, cod_forn: `'17253'`, unidade_nota: `'UN'`, produto_id: '101', fator: '6', ...over }
    return como(db, 'service', `insert into nfe_aprendizado (${Object.keys(v).join(', ')}) values (${Object.values(v).join(', ')})`)
  }

  it('só o admin lê: o comprador não vê nada (RLS), o anon recebe permission denied', async () => {
    const db = await banco()
    await gravar(db, [item(), item({ cod_forn: '2' })])
    expect(await como(db, ADMIN, 'select cod_forn from nfe_aprendizado order by 1')).toEqual([{ cod_forn: '17253' }, { cod_forn: '2' }])
    expect(await como(db, JOAO, 'select 1 from nfe_aprendizado')).toEqual([])
    await expect(como(db, 'anon', 'select 1 from nfe_aprendizado')).rejects.toThrow(/permission denied/)
    const [r] = (await db.query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where oid = 'public.nfe_aprendizado'::regclass`)).rows
    expect(r.rls).toBe(true)
  })

  it('ninguém escreve direto: anon, comprador e admin recebem permission denied (insert, update, delete, truncate); só a chave de serviço escreve', async () => {
    const db = await banco()
    await inserir(db)   // a chave de serviço escreve (e prova que a tabela e o insert de teste estão certos)
    expect(await total(db)).toBe(1)
    for (const quem of ['anon', JOAO, ADMIN]) {
      for (const sql of [
        `insert into nfe_aprendizado (emitente_cnpj, cod_forn, unidade_nota, produto_id, fator) values ('${CNPJ}', '999', 'UN', 1, 6)`,
        `update nfe_aprendizado set fator = 99`,
        `delete from nfe_aprendizado`,
        `truncate nfe_aprendizado`,
      ]) {
        await expect(como(db, quem, sql), `${quem}: ${sql}`).rejects.toThrow(/permission denied/)
      }
    }
    expect(await linhas(db)).toEqual([{ ...LINHA, ultima_chave: null, preco_ref: null, produto_nome: null, descricao_exemplo: null }])
  })

  it('as regras da tabela valem até para quem escreve direto: fator ≤ 1, CNPJ sem 14 dígitos, unidade em minúscula, vezes 0, produto 0, código vazio, chave curta, preço 0', async () => {
    const db = await banco()
    const casos: Array<[string, Record<string, string>, RegExp]> = [
      ['fator 1', { fator: '1' }, /nfe_aprendizado_fator_check/],
      ['fator 0', { fator: '0' }, /nfe_aprendizado_fator_check/],
      ['fator negativo', { fator: '-6' }, /nfe_aprendizado_fator_check/],
      ['CNPJ de 13 dígitos', { emitente_cnpj: `'1234567800019'` }, /nfe_aprendizado_emitente_cnpj_check/],
      ['CNPJ com letras', { emitente_cnpj: `'1234567800019X'` }, /nfe_aprendizado_emitente_cnpj_check/],
      ['unidade em minúsculas', { unidade_nota: `'un'` }, /nfe_aprendizado_unidade_nota_check/],
      ['unidade vazia', { unidade_nota: `''` }, /nfe_aprendizado_unidade_nota_check/],
      ['vezes 0', { vezes: '0' }, /nfe_aprendizado_vezes_check/],
      ['produto_id 0', { produto_id: '0' }, /nfe_aprendizado_produto_id_check/],
      ['cod_forn vazio', { cod_forn: `''` }, /nfe_aprendizado_cod_forn_check/],
      ['cod_forn com espaço nas pontas', { cod_forn: `' 17253'` }, /nfe_aprendizado_cod_forn_check/],
      ['ultima_chave curta', { ultima_chave: `'123'` }, /nfe_aprendizado_ultima_chave_check/],
      ['preco_ref 0', { preco_ref: '0' }, /nfe_aprendizado_preco_ref_check/],
    ]
    for (const [nome, over, esperado] of casos) {
      await expect(inserir(db, over), nome).rejects.toThrow(esperado)
    }
    expect(await total(db)).toBe(0)
    await inserir(db)
    await expect(inserir(db), 'mesma chave: CNPJ + código + unidade').rejects.toThrow(/nfe_aprendizado_chave_unica/)
    await inserir(db, { unidade_nota: `'FD'` })   // outra unidade: pode
    await inserir(db, { cod_forn: `'17254'` })     // outro código: pode
    expect(await total(db)).toBe(3)
  })
})
