import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO } from './fixture-recebimento'
import { ESTRANHO, JOAO } from './fixture'
import { erroDe, type Json } from './fixture-cotacao'

// Memória de embalagem das notas fiscais, fase 2 (29/10/2026): nfe_aprendizado_esquecer, a única porta do admin para apagar uma linha da memória
// (a tabela não aceita escrita direta). Cadeia inteira de migrations; tudo INVENTADO (repositório público).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()

const CNPJ = '12345678000190'
const CNPJ2 = '99887766000155'
/** Chave de acesso de 44 dígitos: UF 15 + AAMM 2610 + CNPJ (posições 7 a 20) + modelo 55 + série 001 + número da nota (9) + tpEmis, cNF e DV (10). */
const chave = (cnpj: string, nf: number): string => `152610${cnpj}55001${String(nf).padStart(9, '0')}1000000007`

/** Um item como o robô manda (nfe_aprendizado_gravar): o refrigerante que vem em fardo de 6. */
const item = (over: Json = {}): Json => ({
  chave: chave(CNPJ, 90049), cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'REFRIGERANTE LATA 350 ML', fator: 6, preco_ref: 42,
  descricao: 'REFRIG COLA 6X350ML', ...over,
})
const gravar = (db: PGlite, itens: Json[]): Promise<Json> => chamar(db, 'anon', 'nfe_aprendizado_gravar($1, $2::jsonb)', [SEGREDO, JSON.stringify(itens)])
const esquecer = (db: PGlite, cnpj: string | null, cod: string | null, un: string | null, quem: string = ADMIN): Promise<Json> =>
  chamar(db, quem, 'nfe_aprendizado_esquecer($1, $2, $3)', [cnpj, cod, un])

/** As quatro linhas de partida: o mesmo código em UN e em CX, outro código, e o mesmo código em outro fornecedor. */
async function semear(db: PGlite): Promise<void> {
  await gravar(db, [
    item(),                                                                                              // A: CNPJ / 17253 / UN  (fator 6)
    item({ unidade_nota: 'CX', fator: 2 }),                                                              // B: CNPJ / 17253 / CX  (fator 2)
    item({ cod_forn: '17254', produto_id: 102, produto_nome: 'GUARANA LATA 350 ML', fator: 12 }),        // C: CNPJ / 17254 / UN  (fator 12)
    item({ chave: chave(CNPJ2, 1), produto_id: 103, produto_nome: 'OUTRO FORNECEDOR', fator: 24 }),      // D: CNPJ2 / 17253 / UN (fator 24)
  ])
}
interface Resumo { cnpj: string; cod: string; un: string; produto: number; fator: number }
async function linhas(db: PGlite): Promise<Resumo[]> {
  const rs = await como(db, ADMIN, 'select emitente_cnpj, cod_forn, unidade_nota, produto_id, fator from nfe_aprendizado order by emitente_cnpj, cod_forn, unidade_nota')
  return rs.map((r) => ({ cnpj: r.emitente_cnpj, cod: r.cod_forn, un: r.unidade_nota, produto: Number(r.produto_id), fator: Number(r.fator) }))
}
const A: Resumo = { cnpj: CNPJ, cod: '17253', un: 'UN', produto: 101, fator: 6 }
const B: Resumo = { cnpj: CNPJ, cod: '17253', un: 'CX', produto: 101, fator: 2 }
const C: Resumo = { cnpj: CNPJ, cod: '17254', un: 'UN', produto: 102, fator: 12 }
const D: Resumo = { cnpj: CNPJ2, cod: '17253', un: 'UN', produto: 103, fator: 24 }
const TODAS = [B, A, C, D]   // na ordem de linhas(): CNPJ, depois código, depois unidade (CX vem antes de UN)
const semA = [B, C, D]

describe('nfe_aprendizado_esquecer — o admin apaga UMA linha', () => {
  it('apaga a linha da chave (CNPJ + código + unidade), devolve 1 e deixa todas as outras como estavam', async () => {
    const db = await banco()
    await semear(db)
    expect(await linhas(db)).toEqual(TODAS)
    expect(Number(await esquecer(db, CNPJ, '17253', 'UN'))).toBe(1)
    expect(await linhas(db)).toEqual(semA)
  })

  it('o mesmo código em outra unidade, outro código e o mesmo código em outro fornecedor NÃO são apagados (cada um por vez)', async () => {
    const db = await banco()
    await semear(db)
    expect(Number(await esquecer(db, CNPJ, '17253', 'CX'))).toBe(1)
    expect(await linhas(db)).toEqual([A, C, D])
    expect(Number(await esquecer(db, CNPJ2, '17253', 'UN'))).toBe(1)
    expect(await linhas(db)).toEqual([A, C])
    expect(Number(await esquecer(db, CNPJ, '17254', 'UN'))).toBe(1)
    expect(await linhas(db)).toEqual([A])
  })

  it('devolve 0 quando a linha não existe e não mexe em nada (chave que nunca existiu, ou que já foi esquecida)', async () => {
    const db = await banco()
    await semear(db)
    expect(Number(await esquecer(db, CNPJ, '99999', 'UN'))).toBe(0)       // código que nunca existiu
    expect(Number(await esquecer(db, CNPJ, '17253', 'PCT'))).toBe(0)      // unidade que nunca existiu
    expect(Number(await esquecer(db, '11111111000111', '17253', 'UN'))).toBe(0)   // fornecedor que nunca existiu
    expect(await linhas(db)).toEqual(TODAS)
    expect(Number(await esquecer(db, CNPJ, '17253', 'UN'))).toBe(1)
    expect(Number(await esquecer(db, CNPJ, '17253', 'UN'))).toBe(0)       // de novo: já foi
    expect(await linhas(db)).toEqual(semA)
  })

  it('tabela vazia: devolve 0', async () => {
    const db = await banco()
    expect(Number(await esquecer(db, CNPJ, '17253', 'UN'))).toBe(0)
  })

  it('o CNPJ pode vir com pontuação (só os dígitos contam)', async () => {
    const db = await banco()
    await semear(db)
    expect(Number(await esquecer(db, '12.345.678/0001-90', '17253', 'UN'))).toBe(1)
    expect(await linhas(db)).toEqual(semA)
  })

  it('o código sem os espaços das pontas e a unidade em maiúsculas, como o robô grava', async () => {
    const db = await banco()
    await semear(db)
    expect(Number(await esquecer(db, CNPJ, '  17253\t', ' un '))).toBe(1)
    expect(await linhas(db)).toEqual(semA)
  })

  it('o código é texto exato: "017253" não apaga a linha de "17253"', async () => {
    const db = await banco()
    await semear(db)
    expect(Number(await esquecer(db, CNPJ, '017253', 'UN'))).toBe(0)
    expect(await linhas(db)).toEqual(TODAS)
  })

  it('depois de esquecer, o robô lê o resto e pode aprender de novo (a linha nasce outra vez com vezes = 1)', async () => {
    const db = await banco()
    await gravar(db, [item(), item({ chave: chave(CNPJ, 90050) })])    // duas notas: vezes = 2
    const antes = await chamar(db, 'anon', 'nfe_aprendizado_ler($1, $2)', [SEGREDO, CNPJ])
    expect(antes.map((l: Json) => [l.cod_forn, Number(l.vezes)])).toEqual([['17253', 2]])
    await esquecer(db, CNPJ, '17253', 'UN')
    expect(await chamar(db, 'anon', 'nfe_aprendizado_ler($1, $2)', [SEGREDO, CNPJ])).toEqual([])
    await gravar(db, [item({ chave: chave(CNPJ, 90051), fator: 12 })])
    const depois = await chamar(db, 'anon', 'nfe_aprendizado_ler($1, $2)', [SEGREDO, CNPJ])
    expect(depois.map((l: Json) => [l.cod_forn, Number(l.fator), Number(l.vezes)])).toEqual([['17253', 12, 1]])
  })
})

describe('nfe_aprendizado_esquecer — só o admin logado', () => {
  it('o comprador (authenticated, não admin) recebe "não autorizado" e nada é apagado', async () => {
    const db = await banco()
    await semear(db)
    expect(await erroDe(esquecer(db, CNPJ, '17253', 'UN', JOAO))).toBe('não autorizado')
    expect(await linhas(db)).toEqual(TODAS)
  })

  it('usuário logado que não está cadastrado, e admin desativado, também recebem "não autorizado"', async () => {
    const db = await banco()
    await semear(db)
    await db.exec(`insert into usuarios (email, nome, papel, ativo) values ('ex-admin@spazio.com', 'Ex-admin', 'admin', false)`)
    expect(await erroDe(esquecer(db, CNPJ, '17253', 'UN', ESTRANHO))).toBe('não autorizado')
    expect(await erroDe(esquecer(db, CNPJ, '17253', 'UN', 'ex-admin@spazio.com'))).toBe('não autorizado')
    expect(await linhas(db)).toEqual(TODAS)
  })

  it('a conferência do admin vem ANTES da conferência dos dados: o comprador com CNPJ inválido também recebe "não autorizado" (não vaza nada)', async () => {
    const db = await banco()
    expect(await erroDe(esquecer(db, 'lixo', '', '', JOAO))).toBe('não autorizado')
  })

  it('o anon não executa a função (permission denied) e nada é apagado', async () => {
    const db = await banco()
    await semear(db)
    await expect(esquecer(db, CNPJ, '17253', 'UN', 'anon')).rejects.toThrow(/permission denied/)
    expect(await linhas(db)).toEqual(TODAS)
  })

  it('a chave de serviço, sem usuário logado, também recebe "não autorizado" (a porta é só do admin do app)', async () => {
    const db = await banco()
    await semear(db)
    expect(await erroDe(esquecer(db, CNPJ, '17253', 'UN', 'service'))).toBe('não autorizado')
    expect(await linhas(db)).toEqual(TODAS)
  })

  it('o admin continua sem poder apagar direto na tabela (a função é a única porta)', async () => {
    const db = await banco()
    await semear(db)
    await expect(como(db, ADMIN, `delete from nfe_aprendizado where cod_forn = '17253'`)).rejects.toThrow(/permission denied/)
    expect(await linhas(db)).toEqual(TODAS)
  })
})

describe('nfe_aprendizado_esquecer — dados fora do formato (erro em português, nada é apagado)', () => {
  it.each([
    ['CNPJ curto', '123', '17253', 'UN', 'CNPJ inválido: informe os 14 dígitos do emitente'],
    ['CNPJ comprido', '123456780001900', '17253', 'UN', 'CNPJ inválido: informe os 14 dígitos do emitente'],
    ['CNPJ vazio', '', '17253', 'UN', 'CNPJ inválido: informe os 14 dígitos do emitente'],
    ['CNPJ nulo', null, '17253', 'UN', 'CNPJ inválido: informe os 14 dígitos do emitente'],
    ['código vazio', CNPJ, '', 'UN', 'informe o código do produto na nota (cod_forn)'],
    ['código só de espaços', CNPJ, '   ', 'UN', 'informe o código do produto na nota (cod_forn)'],
    ['código nulo', CNPJ, null, 'UN', 'informe o código do produto na nota (cod_forn)'],
    ['unidade vazia', CNPJ, '17253', '', 'informe a unidade da nota'],
    ['unidade só de espaços', CNPJ, '17253', '  ', 'informe a unidade da nota'],
    ['unidade nula', CNPJ, '17253', null, 'informe a unidade da nota'],
  ])('%s', async (_nome, cnpj, cod, un, mensagem) => {
    const db = await banco()
    await semear(db)
    expect(await erroDe(esquecer(db, cnpj, cod, un))).toBe(mensagem)
    expect(await linhas(db)).toEqual(TODAS)
  })
})

describe('nfe_aprendizado_esquecer — histórico (para dar para recriar a linha se foi engano)', () => {
  it('guarda no histórico quem apagou e a linha inteira que foi apagada', async () => {
    const db = await banco()
    await semear(db)
    await esquecer(db, '12.345.678/0001-90', '17253', 'UN')
    const h = await como(db, ADMIN, `select quem, tabela, registro, antes, depois from historico_alteracoes where tabela = 'nfe_aprendizado'`)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ quem: ADMIN, tabela: 'nfe_aprendizado', registro: `${CNPJ}/17253/UN`, depois: { via: 'app' } })
    expect(h[0].antes).toMatchObject({ emitente_cnpj: CNPJ, cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'REFRIGERANTE LATA 350 ML', fator: 6, vezes: 1 })
  })

  it('quando não havia o que esquecer (0) o histórico não ganha linha; e recusas também não', async () => {
    const db = await banco()
    await semear(db)
    await esquecer(db, CNPJ, '99999', 'UN')
    await erroDe(esquecer(db, CNPJ, '17253', 'UN', JOAO))
    await erroDe(esquecer(db, 'lixo', '17253', 'UN'))
    expect(await como(db, ADMIN, `select 1 from historico_alteracoes where tabela = 'nfe_aprendizado'`)).toEqual([])
  })
})

describe('nfe_aprendizado_esquecer — a função em si', () => {
  it('é security definer com search_path = public e devolve inteiro', async () => {
    const db = await banco()
    const r = await db.query<{ definer: boolean; config: string[] | null; retorno: string }>(
      `select p.prosecdef as definer, p.proconfig as config, pg_get_function_result(p.oid) as retorno from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'nfe_aprendizado_esquecer'`)
    expect(r.rows).toEqual([{ definer: true, config: ['search_path=public'], retorno: 'integer' }])
  })

  it('só o authenticated executa: nem o anon nem o público', async () => {
    const db = await banco()
    for (const [papel, pode] of [['authenticated', true], ['anon', false]] as const) {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.nfe_aprendizado_esquecer(text, text, text)', 'execute') as ok`, [papel])
      expect([papel, r.rows[0].ok]).toEqual([papel, pode])
    }
    const publico = await db.query<{ acl: string | null }>(
      `select p.proacl::text as acl from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'nfe_aprendizado_esquecer'`)
    expect(publico.rows[0].acl).not.toBeNull()                       // lista de permissões explícita (nula = o padrão do Postgres, que dá EXECUTE ao público)
    expect(publico.rows[0].acl).not.toMatch(/(^|[{,])=X/)            // nenhum "=X/..." (PUBLIC) na lista
  })
})
