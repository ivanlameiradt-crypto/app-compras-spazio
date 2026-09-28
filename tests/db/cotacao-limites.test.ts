import { bancoPorArquivo, como } from './banco'
import { ADMIN } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, cotacao, chamar, abrir, responder, resp, fixarRelogio,
  muitas, randomUUID, V_FULANO, V_BELTRANO, type Json,
} from './fixture-cotacao'

// Fase 1B — limites das funções anônimas (7.3.9, contrato 3.12 e D38): balde de inválidos separado do de
// válidos; com código existente, o limite da própria cotação vem antes do balde global; códigos expiram 14
// dias depois do fechamento; "Trocar link" zera os contadores (D39).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

/** Semana com as duas cotações congeladas e enviadas; devolve ids e códigos. */
async function duas(db: Awaited<ReturnType<typeof banco>>) {
  const semana = await aprovar(db)
  await preparar(db, semana)
  const f = await cotacaoDe(db, semana, V_FULANO)
  const b = await cotacaoDe(db, semana, V_BELTRANO)
  const codF = (await congelar(db, f)).codigo as string
  const codB = (await congelar(db, b)).codigo as string
  for (const id of [f, b]) await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
  return { semana, f, b, codF, codB }
}

async function baldes(db: Awaited<ReturnType<typeof banco>>): Promise<Record<string, number>> {
  const r = await db.query<{ balde: string; chamadas: number }>('select balde, chamadas from cot_limites')
  return Object.fromEntries(r.rows.map((x) => [x.balde, x.chamadas]))
}

describe('balde de inválidos (600/min)', () => {
  it('700 chamadas com código lixo: só elas recebem "devagar"; um código válido abre e responde no mesmo minuto', async () => {
    const db = await banco()
    const { f, codF } = await duas(db)
    const lixoFora = await muitas(db, 'anon', 350, `cotacao_abrir('lixo', false)`)
    const lixoNoFormato = await muitas(db, 'anon', 350, `cotacao_responder(repeat('Z', 32), gen_random_uuid(), '[]'::jsonb, '{"rev_lida":0}'::jsonb)`)
    expect(lixoFora).toEqual({ codigo_invalido: 350 })
    expect(lixoNoFormato).toEqual({ codigo_invalido: 250, devagar: 100 })
    expect(await abrir(db, 'lixo')).toEqual({ ok: false, erro: 'devagar', texto: 'Muitas tentativas; tente em alguns minutos.', espera_s: 60 })
    const a = await abrir(db, codF)
    expect([a.ok, a.estado]).toEqual([true, 'aberta'])
    const r = await responder(db, codF, [resp(1, 0, 'nao_tem')])
    expect(r.itens[0].resultado).toBe('gravado')
    expect(await baldes(db)).toEqual({ invalidos: 701, validos: 2 })
    expect((await cotacao(db, f)).status).toBe('respondida')
    // no minuto seguinte o balde de inválidos recomeça
    await fixarRelogio(db, '2026-10-19T18:01:00Z')
    expect(await abrir(db, 'lixo')).toMatchObject({ erro: 'codigo_invalido' })
  })
})

describe('limite da própria cotação antes do balde global (D38)', () => {
  it('3.500 chamadas por minuto com o código de uma cotação fechada: só ela recebe "limite"; outro código abre e responde', async () => {
    const db = await banco()
    const { f, b, codF, codB } = await duas(db)
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b]) // cotação do Beltrano encerrada pelo Ivan
    const abrirB = await muitas(db, 'anon', 1750, 'cotacao_abrir($1, false)', [codB])
    const responderB = await muitas(db, 'anon', 1750, `cotacao_responder($1, gen_random_uuid(), '[{"numero":1,"rev_lida":0,"estado":"nao_tem"}]'::jsonb, null)`, [codB])
    expect(abrirB).toEqual({ ok: 120, limite: 1630 })
    expect(responderB).toEqual({ estado: 200, limite: 1550 })
    // o balde global recebeu só o que passou pelo limite da cotação: 120 + 200
    expect(await baldes(db)).toEqual({ validos: 320 })
    const a = await abrir(db, codF)
    expect(a).toMatchObject({ ok: true, estado: 'aberta' })
    const r = await responder(db, codF, [resp(2, 0, 'nao_tem')])
    expect(r).toMatchObject({ ok: true, itens: [{ resultado: 'gravado' }] })
    const c = await cotacao(db, b)
    expect([c.abrir_na_janela, c.tentativas_na_janela, c.envios_aceitos, c.respostas_rev]).toEqual([1750, 1750, 0, 0])
    expect((await cotacao(db, f)).status).toBe('respondida')
  })

  it('reenvio do mesmo envio_id e chamada em cotação fechada contam nas 200 tentativas', async () => {
    const db = await banco()
    const { f, codF } = await duas(db)
    const envio = randomUUID()
    expect((await responder(db, codF, [resp(1, 0, 'nao_tem')], null, envio)).ok).toBe(true)
    expect(await muitas(db, 'anon', 99, `cotacao_responder($1, $2::uuid, '[]'::jsonb, '{"rev_lida":0}'::jsonb)`, [codF, envio])).toEqual({ ok: 99 })
    expect((await cotacao(db, f)).tentativas_na_janela).toBe(100)
    await fixarRelogio(db, '2026-10-20T20:10:00Z') // depois do fechamento
    await como(db, 'service', 'select cot_fechar_vencidas()')
    expect((await cotacao(db, f)).status).toBe('fechada')
    // na janela nova: 200 chamadas na fechada (recusadas por estado) e a 201ª já é "limite", mesmo sendo reenvio
    expect(await muitas(db, 'anon', 200, `cotacao_responder($1, gen_random_uuid(), '[]'::jsonb, '{"rev_lida":0}'::jsonb)`, [codF])).toEqual({ estado: 200 })
    expect(await responder(db, codF, [resp(1, 0, 'nao_tem')], null, envio)).toMatchObject({ ok: false, erro: 'limite' })
  })
})

describe('códigos expiram 14 dias depois do fechamento', () => {
  it('cot_fechar_vencidas apaga o código; o link passa a "Este link não vale mais"', async () => {
    const db = await banco()
    const { f, b, codF, codB } = await duas(db)
    await fixarRelogio(db, '2026-11-03T19:59:59Z')
    let r = (await como(db, 'service', 'select cot_fechar_vencidas() as r'))[0].r
    expect(r.expirados).toEqual([])
    expect(r.fechadas).toEqual([f, b])
    expect((await abrir(db, codF)).estado).toBe('encerrada')
    await fixarRelogio(db, '2026-11-03T20:00:00Z')
    r = (await como(db, 'service', 'select cot_fechar_vencidas() as r'))[0].r
    expect(r.expirados).toEqual([f, b])
    expect(r.fechadas).toEqual([])
    for (const c of [codF, codB]) {
      expect(await abrir(db, c)).toEqual({ ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' })
    }
    expect((await db.query<Json>('select count(*)::int as n from cot_codigos')).rows[0].n).toBe(0)
    expect((await cotacao(db, f)).codigo_hash).toBeNull()
    expect((await chamar(db, ADMIN, 'cot_dados_envio($1)', [f])).codigo).toBeNull()
    r = (await como(db, 'service', 'select cot_fechar_vencidas() as r'))[0].r
    expect(r.expirados).toEqual([])
  })
})

describe('"Trocar link" zera os contadores (D39)', () => {
  it('60 envios com o código A → Trocar link → o código B envia e é aceito', async () => {
    const db = await banco()
    const { f, codF } = await duas(db)
    const base = Date.parse('2026-10-19T18:00:00Z')
    let n = 0
    const passo = async () => fixarRelogio(db, new Date(base + 3000 * n++).toISOString())
    for (let i = 0; i < 60; i++) {
      await passo()
      const r = await responder(db, codF, [resp(1, i, 'tem', { preco: 2 + i, base: 'un' })])
      expect([i, r.ok]).toEqual([i, true])
    }
    await passo()
    expect(await responder(db, codF, [resp(1, 60, 'nao_tem')])).toMatchObject({ ok: false, erro: 'limite' })
    const antes = await cotacao(db, f)
    expect(antes.envios_aceitos).toBe(60)
    const d = await chamar(db, ADMIN, 'cot_trocar_codigo($1)', [f])
    await passo()
    expect(await responder(db, codF, [resp(1, 60, 'nao_tem')])).toMatchObject({ ok: false, erro: 'codigo_invalido' })
    const r = await responder(db, d.codigo, [resp(1, 60, 'nao_tem')])
    expect(r).toMatchObject({ ok: true, itens: [{ resultado: 'gravado', rev: 61 }] })
    const depois = await cotacao(db, f)
    expect([depois.envios_aceitos, depois.tentativas_na_janela, depois.respostas_rev]).toEqual([1, 1, 61])
  })
})
