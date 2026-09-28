import { bancoPorArquivo, como } from './banco'
import { ADMIN } from './fixture'
import { semearCotacao, aprovar, preparar, cotacaoDe, congelar, cotacao, fixarRelogio, V_FULANO, PAYLOAD_COTACAO, type Json } from './fixture-cotacao'

// Fase 1B — regras puras da cotação (contrato 3.6, 3.8, 1.1): nome limpo, normalização, prazo e
// fechamento, validade da etiqueta, formatos de hora e data. Nomes de produto inventados com a mesma forma
// dos reais (os 232 nomes reais são conferidos no teste privado).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

async function um<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await (await banco()).query<{ v: T }>(sql, params)
  return r.rows[0].v
}

describe('cot_nome_limpo (7.3.3): o nome que vai ao vendedor', () => {
  const CASOS: [string, string][] = [
    // os 9 fora do padrão " - INSUMOS (X)"
    ['MOLHO VERDE TRADICIONAL- INSUMOS (KG)', 'MOLHO VERDE TRADICIONAL'],
    ['GELO CUBO- INSUMOS (SC)', 'GELO CUBO'],
    ['MACARRÃO PARAFUSO- INSUMOS (KG)', 'MACARRÃO PARAFUSO'],
    ['UVA VERDE- INSUMOS (KG)', 'UVA VERDE'],
    ['VINAGRE DE MAÇÃ- INSUMOS (KG)', 'VINAGRE DE MAÇÃ'],
    ['VINAGRE P/ SALADA- INSUMOS (KG)', 'VINAGRE P/ SALADA'],
    ['MAIONESE DE ERVAS (KG)', 'MAIONESE DE ERVAS'],
    ['MOLHO ROSÉ DA CASA (KG)', 'MOLHO ROSÉ DA CASA'],
    ['BETERRABA - UND -INSUMOS (KG)', 'BETERRABA'],
    // 3 "(UN)" e um "INSUMO (UN)"
    ['OVO CAIPIRA - INSUMOS (UN)', 'OVO CAIPIRA'],
    ['GUARDANAPO - INSUMOS (UN)', 'GUARDANAPO'],
    ['PALITO - INSUMOS (UN)', 'PALITO'],
    ['PÃO DE FORMA - INSUMO (UN)', 'PÃO DE FORMA'],
    // os 3 "- UND -"
    ['ABOBRINHA - UND - INSUMOS (KG)', 'ABOBRINHA'],
    ['PEPINO - UND -INSUMOS (KG)', 'PEPINO'],
    ['CHUCHU- UND - INSUMOS (KG)', 'CHUCHU'],
    // INTREGAL / INTREGRAL, "INSUMO" no singular, espaços dentro das parênteses, e bebida sem sufixo
    ['CREME DE LEITE INTREGAL - INSUMOS (KG)', 'CREME DE LEITE INTEGRAL'],
    ['IOGURTE INTREGRAL - INSUMOS (KG)', 'IOGURTE INTEGRAL'],
    ['MOSTARDA ESCURA - INSUMO (KG)', 'MOSTARDA ESCURA'],
    ['FARINHA ESPECIAL - INSUMOS ( KG )', 'FARINHA ESPECIAL'],
    ['SUCO LATA  350 ML', 'SUCO LATA 350 ML'],
    ['ÁGUA COM GÁS 500ML', 'ÁGUA COM GÁS 500ML'],
  ]

  it.each(CASOS)('%s → %s', async (entrada, esperado) => {
    expect(await um('select cot_nome_limpo($1) as v', [entrada])).toBe(esperado)
  })

  it('não sobra "INSUMO", "(" nem "UND" nos nomes de exemplo', async () => {
    for (const [entrada] of CASOS) {
      const s = await um<string>('select cot_nome_limpo($1) as v', [entrada])
      expect(s).not.toMatch(/INSUMO|\(|\bUND\b/i)
    }
  })
})

describe('cot_normalizar: maiúsculas, sem acento (sem unaccent), espaços simples', () => {
  it.each([
    ['  Fornecedor  A   Ltda ', 'FORNECEDOR A LTDA'],
    ['Açougue São João', 'ACOUGUE SAO JOAO'],
    ['açúcar ÍNDIO Ñandu', 'ACUCAR INDIO NANDU'],
    ['ÁÀÂÃÄ éèêë íìîï óòôõö úùûü ç', 'AAAAA EEEE IIII OOOOO UUUU C'],
  ])('%s → %s', async (entrada, esperado) => {
    expect(await um('select cot_normalizar($1) as v', [entrada])).toBe(esperado)
  })
})

describe('prazo e fechamento (7.3.4): fixados no Preparar, com feriados e janela mínima de 16 h', () => {
  // [momento do Preparar em UTC, prazo esperado, fechamento esperado] — a tabela inteira da spec
  const TABELA: [string, string, string, string][] = [
    ['seg 21/09 15:00', '2026-09-21T18:00:00Z', '2026-09-22T15:00:00.000000Z', '2026-09-22T20:00:00.000000Z'],
    ['seg 21/09 20:00 (janela = 16 h exatas)', '2026-09-21T23:00:00Z', '2026-09-22T15:00:00.000000Z', '2026-09-22T20:00:00.000000Z'],
    ['seg 21/09 20:01', '2026-09-21T23:01:00Z', '2026-09-23T15:00:00.000000Z', '2026-09-23T20:00:00.000000Z'],
    ['ter 22/09 09:00 (aprovou tarde)', '2026-09-22T12:00:00Z', '2026-09-23T15:00:00.000000Z', '2026-09-23T20:00:00.000000Z'],
    ['sex 09/10 15:00 (seg 12/10 é feriado)', '2026-10-09T18:00:00Z', '2026-10-13T15:00:00.000000Z', '2026-10-13T20:00:00.000000Z'],
    ['seg 19/10 15:00', '2026-10-19T18:00:00Z', '2026-10-20T15:00:00.000000Z', '2026-10-20T20:00:00.000000Z'],
  ]

  it.each(TABELA)('%s', async (_nome, t, prazo, fechamento) => {
    const [r] = (await (await banco()).query<{ p: string; f: string }>(
      'select cot_iso(prazo) as p, cot_iso(fechamento) as f from cot_calcular_prazo($1::timestamptz)', [t])).rows
    expect([r.p, r.f]).toEqual([prazo, fechamento])
  })

  it('não depende do TimeZone da sessão (UTC no Supabase, local no pglite)', async () => {
    const db = await banco()
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Sao_Paulo', 'Etc/GMT+3']) {
      await db.exec(`set timezone = '${tz}'`)
      for (const [, t, prazo, fechamento] of TABELA) {
        const [r] = (await db.query<{ p: string; f: string; l: string }>(
          'select cot_iso(prazo) as p, cot_iso(fechamento) as f, cot_local(prazo) as l from cot_calcular_prazo($1::timestamptz)', [t])).rows
        expect([tz, r.p, r.f]).toEqual([tz, prazo, fechamento])
        expect(r.l).toMatch(/ 12:00$/)
      }
    }
    await db.exec(`set timezone = 'Etc/GMT+3'`)
  })

  it('o Preparar grava prazo e fechamento; cot_dados_envio mais tarde nunca muda o prazo', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await fixarRelogio(db, '2026-10-09T18:00:00Z') // sex 09/10 15:00 (relógio de teste; a semana é a de 19/10)
    await preparar(db, semana)
    const id = await cotacaoDe(db, semana, V_FULANO)
    const d = await congelar(db, id)
    expect([d.prazo, d.fechamento, d.prazo_local, d.fechamento_local]).toEqual([
      '2026-10-13T15:00:00.000000Z', '2026-10-13T20:00:00.000000Z', '2026-10-13 12:00', '2026-10-13 17:00'])
    await fixarRelogio(db, '2026-10-14T13:00:00Z')
    const [r] = await como(db, ADMIN, 'select cot_dados_envio($1) as r', [id])
    expect([r.r.prazo, r.r.fechamento]).toEqual([d.prazo, d.fechamento])
    const c = await cotacao(db, id)
    expect(new Date(c.prazo).toISOString()).toBe('2026-10-13T15:00:00.000Z')
  })
})

describe('validade da etiqueta "Aguardando cotação": 12h do primeiro dia útil depois da aprovação', () => {
  it('aprovada seg 08:00 → até ter 12:00', async () => {
    const db = await banco()
    const semana = await aprovar(db, PAYLOAD_COTACAO, '2026-10-19T11:00:00Z')
    expect(await um('select cot_iso(cot_aguardando_ate($1)) as v', [semana])).toBe('2026-10-20T15:00:00.000000Z')
  })

  it('aprovada sex 09/10 → até ter 13/10 12:00 (seg 12/10 é feriado)', async () => {
    const db = await banco()
    const semana = await aprovar(db, PAYLOAD_COTACAO, '2026-10-09T12:00:00Z')
    expect(await um('select cot_iso(cot_aguardando_ate($1)) as v', [semana])).toBe('2026-10-13T15:00:00.000000Z')
  })

  it('aprovada sáb 23h (BRT) → até seg 12:00; semana sem aprovação → null', async () => {
    const db = await banco()
    const semana = await aprovar(db, PAYLOAD_COTACAO, '2026-10-18T02:00:00Z') // sáb 17/10 23:00 BRT
    expect(await um('select cot_iso(cot_aguardando_ate($1)) as v', [semana])).toBe('2026-10-19T15:00:00.000000Z')
    await db.query<Json>('update semanas set aprovada_em = null')
    expect(await um('select cot_aguardando_ate($1) as v', [semana])).toBeNull()
  })
})

describe('formatos (contrato 1.1)', () => {
  it('cot_iso: UTC com microssegundos e Z; null → null', async () => {
    expect(await um(`select cot_iso('2026-10-20 12:00-03'::timestamptz) as v`)).toBe('2026-10-20T15:00:00.000000Z')
    expect(await um(`select cot_iso(null) as v`)).toBeNull()
  })

  it('cot_hora_br: "17h", "9h07", "10h15" em Brasília', async () => {
    expect(await um(`select array[cot_hora_br('2026-10-20T20:00Z'), cot_hora_br('2026-10-20T12:07Z'), cot_hora_br('2026-10-20T13:15Z')] as v`))
      .toEqual(['17h', '9h07', '10h15'])
  })

  it('dia da semana curto por array explícito e dd/mm', async () => {
    expect(await um(`select array(select cot_dia_curto(d::date) || ' ' || cot_ddmm(d::date)
                       from generate_series(0, 6) g, lateral (select date '2026-10-18' + g) x(d)) as v`))
      .toEqual(['dom 18/10', 'seg 19/10', 'ter 20/10', 'qua 21/10', 'qui 22/10', 'sex 23/10', 'sáb 24/10'])
  })

  it('validade como datas absolutas: hoje, amanhã, próxima quarta e sexta, sem repetir, em ordem de data', async () => {
    expect(await um(`select cot_validade_opcoes('2026-10-19') as v`)).toEqual([
      { data: '2026-10-19', rotulo: 'hoje 19/10' }, { data: '2026-10-20', rotulo: 'amanhã 20/10' },
      { data: '2026-10-21', rotulo: 'qua 21/10' }, { data: '2026-10-23', rotulo: 'sex 23/10' }])
    // terça: a quarta é amanhã (fica "amanhã")
    expect(await um(`select cot_validade_opcoes('2026-10-20') as v`)).toEqual([
      { data: '2026-10-20', rotulo: 'hoje 20/10' }, { data: '2026-10-21', rotulo: 'amanhã 21/10' },
      { data: '2026-10-23', rotulo: 'sex 23/10' }])
    // quarta: a próxima quarta é a da semana seguinte
    expect(await um(`select cot_validade_opcoes('2026-10-21') as v`)).toEqual([
      { data: '2026-10-21', rotulo: 'hoje 21/10' }, { data: '2026-10-22', rotulo: 'amanhã 22/10' },
      { data: '2026-10-23', rotulo: 'sex 23/10' }, { data: '2026-10-28', rotulo: 'qua 28/10' }])
  })

  it('código do link: 32 caracteres base64url, diferente a cada geração', async () => {
    const db = await banco()
    const r = await db.query<{ c: string }>('select cot_gerar_codigo() as c from generate_series(1, 50)')
    const codigos = r.rows.map((x) => x.c)
    for (const c of codigos) expect(c).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(new Set(codigos).size).toBe(50)
  })
})
