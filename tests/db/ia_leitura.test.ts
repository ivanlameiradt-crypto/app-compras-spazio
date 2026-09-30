import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, prontaDoFulano, responderAdmin, chamar, erroDe, cotItemDe, fixarRelogio, randomUUID, V_FULANO,
} from './fixture-cotacao'
import type { PGlite } from '@electric-sql/pglite'

// Fase 2, Bloco B — banco (B.14.1). Leitura com IA: origem 'ivan_ia', config, cot_ia_iniciar/concluir/gravada/status/
// ligar e a view cot_ia_uso. Fixtures inventadas (repositório público); relógio por cot_agora(). A IA NASCE DESLIGADA:
// cada teste que precisa dela ligada chama `ligar(db)`.

const ADMIN2 = 'ivan2@spazio.com' // segundo admin, para o "só quem iniciou" de cot_ia_concluir/gravada

async function prepararIA(db: PGlite): Promise<void> {
  await semearCotacao(db)
  await db.query(`insert into usuarios (email, nome, papel, ativo) values ($1, 'Ivan 2', 'admin', true)`, [ADMIN2])
}

const atual = bancoPorArquivo(prepararIA)
const banco = () => atual()

/** Libera e liga a IA por SQL (superusuário), como o Ivan faria depois da avaliação B.14.6. */
async function ligar(db: PGlite): Promise<void> {
  await db.query(`update cot_ia_config set liberada_em = cot_agora(), ligada = true where id = 1`)
}

/** numero e rev de um item da cotação (para montar respostas). */
async function numeroRev(db: PGlite, id: number, produto: number): Promise<{ numero: number; rev: number }> {
  const r = await db.query<{ numero: number; rev: number }>(
    'select numero, rev from cot_itens where cotacao_id = $1 and produto_id = $2', [id, produto])
  return { numero: Number(r.rows[0].numero), rev: Number(r.rows[0].rev) }
}

async function iniciar(db: PGlite, id: number, caracteres = 200, imagens = 0, transcricao = false, quem = ADMIN) {
  return chamar(db, quem, 'cot_ia_iniciar($1, $2, $3, $4)', [id, caracteres, imagens, transcricao])
}

describe('origem ivan_ia nas três colunas', () => {
  it('cot_itens, cot_envios e cot_cotacoes.gerais_origem aceitam ivan_ia e recusam ivan_xx', async () => {
    const db = banco()
    const { id } = await prontaDoFulano(db)
    // cot_envios/cot_itens: cot_responder_admin com ivan_ia grava (origem ivan_ia nas linhas e no envio)
    const { numero, rev } = await numeroRev(db, id, 101)
    await responderAdmin(db, id, [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }], null, 'ivan_ia')
    const [linha] = await db.query<{ origem: string }>('select origem from cot_itens where cotacao_id = $1 and produto_id = 101', [id]).then((r) => r.rows)
    expect(linha.origem).toBe('ivan_ia')
    const [env] = await db.query<{ origem: string }>('select origem from cot_envios where cotacao_id = $1', [id]).then((r) => r.rows)
    expect(env.origem).toBe('ivan_ia')
    // ivan_xx é recusado pelo CHECK (inserção direta como superusuário)
    await expect(db.query(
      `insert into cot_envios (envio_id, cotacao_id, origem, recebido_em, resultado) values (gen_random_uuid(), $1, 'ivan_xx', now(), '{}'::jsonb)`, [id],
    )).rejects.toThrow(/cot_envios_origem_check/)
  })

  it('cot_responder_admin aceita ivan_ia e segue recusando vendedor e texto qualquer', async () => {
    const db = banco()
    const { id } = await prontaDoFulano(db)
    const { numero, rev } = await numeroRev(db, id, 101)
    const item = [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }]
    const ok = await responderAdmin(db, id, item, null, 'ivan_ia')
    expect(ok.ok).toBe(true)
    expect(await erroDe(responderAdmin(db, id, item, null, 'vendedor'))).toMatch(/origem inválida/)
    expect(await erroDe(responderAdmin(db, id, item, null, 'ivan_xx'))).toMatch(/origem inválida/)
  })
})

describe('cot_ia_iniciar', () => {
  it('comprador é recusado por exigir_admin', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    expect(await erroDe(iniciar(db, id, 200, 0, false, JOAO))).toMatch(/apenas o administrador pode fazer isso/)
  })

  it('IA desligada é recusada (nasce desligada)', async () => {
    const db = banco()
    const { id } = await prontaDoFulano(db)
    expect(await erroDe(iniciar(db, id))).toMatch(/a leitura com IA está desligada/)
  })

  it('cotação com pedido, dispensada, cancelada ou substituída não aceita mais respostas', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_cancelar($1)', [id])   // cancelada → não aceita mais respostas
    expect(await erroDe(iniciar(db, id))).toMatch(/esta cotação não aceita mais respostas/)
  })

  it('leitura inválida: 0 caracteres e 0 imagens, 8001 caracteres ou 4 imagens', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    expect(await erroDe(iniciar(db, id, 0, 0))).toMatch(/leitura inválida/)
    expect(await erroDe(iniciar(db, id, 8001, 0))).toMatch(/leitura inválida/)
    expect(await erroDe(iniciar(db, id, 100, 4))).toMatch(/leitura inválida/)
    // só imagem, sem texto, vale
    const r = await iniciar(db, id, 0, 2)
    expect(r.leitura_id).toBeGreaterThan(0)
  })

  it('a 31ª leitura do dia dá limite do dia; às 00:00 a conta zera', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    // 30 leituras de hoje (criado_em = cot_agora())
    await db.query(
      `insert into cot_leituras_ia (cotacao_id, criado_por, criado_em, caracteres, imagens, transcricao)
       select $1, $2, cot_agora(), 100, 0, false from generate_series(1, 30)`, [id, ADMIN])
    expect(await erroDe(iniciar(db, id))).toMatch(/limite de leituras com IA de hoje atingido \(30\)/)
    // um dia depois (00:05 BRT do dia seguinte): a conta do dia zera; as 30 de ontem ainda contam no mês
    await fixarRelogio(db, '2026-10-20T03:05:00Z')
    const r = await iniciar(db, id)
    expect(r.leitura_id).toBeGreaterThan(0)
  })

  it('a 151ª do mês dá limite do mês (com o dia ainda dentro do limite)', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    // 150 leituras noutro dia do mês (05/10): o dia de hoje (19/10) fica em 0, o mês em 150
    await db.query(
      `insert into cot_leituras_ia (cotacao_id, criado_por, criado_em, caracteres, imagens, transcricao)
       select $1, $2, timestamptz '2026-10-05 12:00:00Z', 100, 0, false from generate_series(1, 150)`, [id, ADMIN])
    expect(await erroDe(iniciar(db, id))).toMatch(/limite de leituras com IA do mês atingido \(150\)/)
  })

  it('lista branca: só as chaves de B.6.3, sem ref_*, avisos, qtd_sugerida, custo, whatsapp, código, empresa', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    const r = await iniciar(db, id)
    expect(Object.keys(r).sort()).toEqual(
      ['dia_semana', 'esforco', 'hoje', 'itens', 'leitura_id', 'modelo', 'uso', 'versao'])
    expect(Object.keys(r.uso).sort()).toEqual(['custo_mes_usd', 'hoje', 'limite_dia', 'limite_mes', 'mes'])
    expect(Object.keys(r.itens[0]).sort()).toEqual(
      ['codigo_fornecedor', 'descricao_fornecedor', 'embalagem', 'fator', 'nome', 'nota', 'numero', 'qtd', 'rotulo',
        'unidade', 'vende_por_litro'])
    const serial = JSON.stringify(r)
    for (const proibido of ['ref_preco', 'ref_situacao', 'avisos_ivan', 'qtd_sugerida', 'custo_medio', 'whatsapp', 'empresa'])
      expect(serial).not.toContain(proibido)
    // modelo e esforço vêm da config; nasce opus/low
    expect(r.modelo).toBe('claude-opus-5')
    expect(r.esforco).toBe('low')
  })

  it('item sem número e item desmarcado não vão; embalagem e fator só com fator confirmado', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    // 104 fica sem número (não vai); 101 ganha embalagem NÃO confirmada
    await db.query('update cot_itens set numero = null where cotacao_id = $1 and produto_id = 104', [id])
    await db.query(`update cot_itens set embalagem = 'caixa', fator = 12, fator_confirmado = false where cotacao_id = $1 and produto_id = 101`, [id])
    const r1 = await iniciar(db, id)
    expect(r1.itens.map((x: { numero: number }) => x.numero)).not.toContain(null)
    expect(r1.itens.some((x: { nome: string }) => x.nome.includes('LEITE'))).toBe(false) // 104 saiu
    const i101a = r1.itens.find((x: { nome: string }) => x.nome.includes('ÁGUA'))
    expect([i101a.embalagem, i101a.fator]).toEqual([null, null]) // fator não confirmado → null
    // confirmando o fator, embalagem e fator aparecem
    await db.query(`update cot_itens set fator_confirmado = true where cotacao_id = $1 and produto_id = 101`, [id])
    const r2 = await iniciar(db, id)
    const i101b = r2.itens.find((x: { nome: string }) => x.nome.includes('ÁGUA'))
    expect([i101b.embalagem, Number(i101b.fator)]).toEqual(['caixa', 12])
  })

  it('a proposta com mais de 180 dias é apagada na próxima leitura', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    const velha = await db.query<{ id: number }>(
      `insert into cot_leituras_ia (cotacao_id, criado_por, criado_em, caracteres, imagens, transcricao, status, proposta)
       values ($1, $2, cot_agora() - interval '200 days', 100, 0, false, 'ok', '{"itens":[]}'::jsonb) returning id`, [id, ADMIN])
    await iniciar(db, id)
    const [l] = (await db.query<{ proposta: unknown }>('select proposta from cot_leituras_ia where id = $1', [velha.rows[0].id])).rows
    expect(l.proposta).toBeNull()
  })

  it('uso.hoje reflete a leitura recém-criada', async () => {
    const db = banco()
    await ligar(db)
    const { id } = await prontaDoFulano(db)
    const r1 = await iniciar(db, id)
    expect(r1.uso.hoje).toBe(1)
    const r2 = await iniciar(db, id)
    expect(r2.uso.hoje).toBe(2)
  })
})

describe('cot_ia_concluir', () => {
  async function novaLeitura(db: PGlite): Promise<number> {
    const { id } = await prontaDoFulano(db)
    await ligar(db)
    const r = await iniciar(db, id)
    return Number(r.leitura_id)
  }
  const OK = { status: 'ok', erro: null, modelo: 'claude-opus-5', tokens_entrada: 3000, tokens_saida: 800,
    duracao_ms: 9000, itens_propostos: 4, itens_incertos: 1, custo_usd: 0.066, proposta: { itens: [] } }

  it('conclui com ok e grava a proposta', async () => {
    const db = banco()
    const leitura = await novaLeitura(db)
    await chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify(OK)])
    const [l] = (await db.query<{ status: string; custo_usd: string; proposta: unknown }>(
      'select status, custo_usd, proposta from cot_leituras_ia where id = $1', [leitura])).rows
    expect(l.status).toBe('ok')
    expect(Number(l.custo_usd)).toBeCloseTo(0.066)
    expect(l.proposta).toEqual({ itens: [] })
  })

  it('só quem iniciou; só em_andamento; a segunda chamada é recusada', async () => {
    const db = banco()
    const leitura = await novaLeitura(db)
    expect(await erroDe(chamar(db, ADMIN2, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify(OK)])))
      .toMatch(/leitura não encontrada ou já concluída/)
    await chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify(OK)])
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify(OK)])))
      .toMatch(/leitura não encontrada ou já concluída/)
  })

  it('modelo fora da lista e proposta acima de 200 kB são recusados', async () => {
    const db = banco()
    const leitura = await novaLeitura(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify({ ...OK, modelo: 'gpt-5' })])))
      .toMatch(/conclusão inválida/)
    const grande = { ...OK, proposta: { lixo: 'x'.repeat(200_001) } }
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify(grande)])))
      .toMatch(/conclusão inválida/)
    // erro com um código válido conclui; erro sem código é recusado
    await chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [leitura, JSON.stringify({ status: 'erro', erro: 'ocupada', modelo: 'claude-opus-5' })])
    const [l] = (await db.query<{ status: string; erro: string }>('select status, erro from cot_leituras_ia where id = $1', [leitura])).rows
    expect([l.status, l.erro]).toEqual(['erro', 'ocupada'])
  })
})

describe('cot_ia_gravada', () => {
  async function leituraOk(db: PGlite): Promise<{ id: number; leitura: number }> {
    const { id } = await prontaDoFulano(db)
    await ligar(db)
    const r = await iniciar(db, id)
    await chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [Number(r.leitura_id),
      JSON.stringify({ status: 'ok', modelo: 'claude-opus-5', proposta: { itens: [] } })])
    return { id, leitura: Number(r.leitura_id) }
  }
  const RESUMO = { gravados: 4, corrigidos: 1, descartados: 0, discordancias: 0 }

  it('registra a gravação; o mesmo envio de novo não muda nada; outro envio dá "leitura já gravada"', async () => {
    const db = banco()
    const { id, leitura } = await leituraOk(db)
    const { numero, rev } = await numeroRev(db, id, 101)
    const envio1 = randomUUID()
    await responderAdmin(db, id, [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }], null, 'ivan_ia', envio1)
    await chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, envio1, JSON.stringify(RESUMO)])
    const [g] = (await db.query<{ envio_id: string; itens_gravados: number }>(
      'select envio_id, itens_gravados from cot_leituras_ia where id = $1', [leitura])).rows
    expect([g.envio_id, g.itens_gravados]).toEqual([envio1, 4])
    // o mesmo envio de novo: sem erro, sem mudança
    await chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, envio1, JSON.stringify(RESUMO)])
    // outro envio (também ivan_ia): já gravada
    const outro = await numeroRev(db, id, 102)
    const envio2 = randomUUID()
    await responderAdmin(db, id, [{ numero: outro.numero, rev_lida: outro.rev, estado: 'nao_tem' }], null, 'ivan_ia', envio2)
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, envio2, JSON.stringify(RESUMO)])))
      .toMatch(/leitura já gravada/)
  })

  it('envio de outra cotação ou com origem diferente de ivan_ia é recusado', async () => {
    const db = banco()
    const { id, leitura } = await leituraOk(db)
    // origem ivan_colou na mesma cotação → recusado
    const { numero, rev } = await numeroRev(db, id, 101)
    const envioColou = randomUUID()
    await responderAdmin(db, id, [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }], null, 'ivan_colou', envioColou)
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, envioColou, JSON.stringify(RESUMO)])))
      .toMatch(/envio não confere com a leitura/)
    // envio inexistente → recusado
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, randomUUID(), JSON.stringify(RESUMO)])))
      .toMatch(/envio não confere com a leitura/)
  })

  it('resumo inválido é recusado', async () => {
    const db = banco()
    const { id, leitura } = await leituraOk(db)
    const { numero, rev } = await numeroRev(db, id, 101)
    const envio = randomUUID()
    await responderAdmin(db, id, [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }], null, 'ivan_ia', envio)
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_gravada($1, $2, $3::jsonb)', [leitura, envio, JSON.stringify({ gravados: -1 })])))
      .toMatch(/resumo inválido/)
  })
})

describe('cot_ia_status e cot_ia_ligar', () => {
  it('comprador é recusado; status tem só as chaves de B.6.3', async () => {
    const db = banco()
    expect(await erroDe(chamar(db, JOAO, 'cot_ia_status()'))).toMatch(/apenas o administrador pode fazer isso/)
    const s = await chamar(db, ADMIN, 'cot_ia_status()')
    expect(Object.keys(s).sort()).toEqual(['liberada', 'liberada_em', 'ligada', 'modelo', 'uso'])
    expect(s.ligada).toBe(false)
    expect(s.liberada).toBe(false)
  })

  it('ligar sem liberada_em dá a mensagem exata; depois de liberar, liga e grava mudado_por; desligar sempre vale', async () => {
    const db = banco()
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_ligar($1)', [true])))
      .toMatch(/A leitura com IA ainda não passou na avaliação com respostas reais\./)
    expect(await erroDe(chamar(db, ADMIN, 'cot_ia_ligar($1)', [null]))).toMatch(/informe se a leitura com IA fica ligada/)
    // libera por SQL (o Ivan faria) e liga
    await db.query(`update cot_ia_config set liberada_em = cot_agora() where id = 1`)
    const s = await chamar(db, ADMIN, 'cot_ia_ligar($1)', [true])
    expect(s.ligada).toBe(true)
    const [cfg] = (await db.query<{ ligada: boolean; mudado_por: string }>('select ligada, mudado_por from cot_ia_config where id = 1')).rows
    expect([cfg.ligada, cfg.mudado_por]).toEqual([true, ADMIN])
    // desligar vale sempre
    const s2 = await chamar(db, ADMIN, 'cot_ia_ligar($1)', [false])
    expect(s2.ligada).toBe(false)
  })
})

describe('cot_ia_uso (view)', () => {
  it('soma por semana; comprador não lê', async () => {
    const db = banco()
    const { id, semana } = await prontaDoFulano(db)
    await ligar(db)
    const r = await iniciar(db, id)
    await chamar(db, ADMIN, 'cot_ia_concluir($1, $2::jsonb)', [Number(r.leitura_id),
      JSON.stringify({ status: 'ok', modelo: 'claude-opus-5', itens_propostos: 4, custo_usd: 0.066, proposta: { itens: [] } })])
    const [uso] = await como(db, ADMIN, 'select * from cot_ia_uso where semana_id = $1', [semana])
    expect([Number(uso.leituras), Number(uso.ok), Number(uso.itens_propostos)]).toEqual([1, 1, 4])
    expect(Number(uso.custo_usd)).toBeCloseTo(0.066)
    // comprador não lê (RLS)
    expect(await como(db, JOAO, 'select * from cot_ia_uso')).toEqual([])
  })
})

describe('taxa de resposta (cot_coleta)', () => {
  it('semana respondida só por ivan_ia conta em respondidas e não em pelo_link', async () => {
    const db = banco()
    const { id, semana } = await prontaDoFulano(db)
    await ligar(db)
    const { numero, rev } = await numeroRev(db, id, 101)
    await responderAdmin(db, id, [{ numero, rev_lida: rev, estado: 'tem', preco: 2.5, base: 'un' }], null, 'ivan_ia')
    const col = await chamar(db, 'service', 'cot_coleta($1)', [semana])
    const h = (col.historico as { vendedor_id: number; respondidas: number; pelo_link: number }[])
      .find((x) => x.vendedor_id === V_FULANO)
    expect([h?.respondidas, h?.pelo_link]).toEqual([1, 0])
  })
})
