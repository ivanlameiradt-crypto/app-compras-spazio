import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, cotacao, chamar, erroDe, responder, responderAdmin, resp,
  fixarRelogio, prontaDoFulano, linhaItem, encerrar, payloadDe, randomUUID, abrir, marcas, itemDe, produtosDe,
  V_FULANO, V_BELTRANO, type Json,
} from './fixture-cotacao'

// Fase 1B — "Digitar preços"/"Colar resposta" (cot_responder_admin, 4.9), "Confirmar pedido" (cot_gravar_pedido,
// 4.13, D32, D44), "O vendedor não confirmou — desfazer pedido" (cot_desfazer_pedido, 4.13a, D67) e a economia do
// pedido contra o último preço (view cot_economia, ajuste Foozi 2).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const PEDIDO_1 = [{ numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }]
const gravar = (db: Awaited<ReturnType<typeof banco>>, id: number, itens: unknown, quem = ADMIN) =>
  chamar(db, quem, 'cot_gravar_pedido($1, $2::jsonb)', [id, JSON.stringify(itens)])

describe('cot_responder_admin', () => {
  it('grava com a origem do Ivan, sem limites, e pronta → respondida; não mexe nos envios do vendedor', async () => {
    const db = await banco()
    const { id } = await prontaDoFulano(db)
    const r = await responderAdmin(db, id, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca B' }),
      resp(2, 0, 'nao_tem')], { rev_lida: 0, pagamento: 'boleto 28 dias' }, 'ivan_digitou')
    expect(r).toMatchObject({ ok: true, reenvio: false, recebido_em: '2026-10-19T18:00:00.000000Z',
      itens: [{ numero: 1, resultado: 'gravado', rev: 1 }, { numero: 2, resultado: 'gravado', rev: 1 }], gerais: { resultado: 'gravado', rev: 1 } })
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'respondida', envios_aceitos: 0, ultimo_envio_em: null, respostas_rev: 2, gerais_origem: 'ivan_digitou' })
    expect(new Date(c.enviada_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    expect(await linhaItem(db, id, 101)).toMatchObject({ origem: 'ivan_digitou', marca_informada: 'Marca B' })
    // sem o limite de 3 s nem de 60 envios
    await db.exec(`update cot_cotacoes set envios_aceitos = 60 where id = ${id}`)
    const r2 = await responderAdmin(db, id, [resp(3, 0, 'tem', { preco: 5, base: 'kg' })], null, 'ivan_colou')
    expect(r2.itens[0].resultado).toBe('gravado')
    expect((await linhaItem(db, id, 103)).origem).toBe('ivan_colou')
    const e = await db.query<Json>('select origem from cot_envios order by recebido_em, origem')
    expect(e.rows.map((x: { origem: string }) => x.origem).sort()).toEqual(['ivan_colou', 'ivan_digitou'])
  })

  it('aceita fechada sem resultado (áudio que chegou às 17h20), sem prazo; mudança depois do consolidado soma respostas_rev', async () => {
    const db = await banco()
    const { id } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    await fixarRelogio(db, '2026-10-20T20:10:00Z')
    await como(db, 'service', 'select cot_fechar_vencidas()')
    expect((await cotacao(db, id)).status).toBe('fechada')
    const reserva = (await como(db, 'service', 'select cot_reservar_consolidado($1) as r', [(await cotacao(db, id)).semana_id]))[0].r
    expect(reserva.tipo).toBe('consolidado')
    await fixarRelogio(db, '2026-10-20T20:20:00Z')
    const r = await responderAdmin(db, id, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })], null, 'ivan_digitou')
    expect(r.itens[0].resultado).toBe('gravado')
    const c = await cotacao(db, id)
    expect([c.status, c.respostas_rev, c.consolidado_rev]).toEqual(['fechada', 1, 0])
    const v = (await como(db, 'service', 'select cot_fechar_vencidas() as r'))[0].r
    expect(v.semanas).toEqual([{ semana_id: c.semana_id, data_referencia: '2026-10-19', tipo: 'atualizado' }])
  })

  it('recusa com pedido, dispensada, substituída e cancelada; origem, envio e formato', async () => {
    const db = await banco()
    const { semana, id } = await prontaDoFulano(db)
    expect(await erroDe(responderAdmin(db, id, [], { rev_lida: 0 }, 'vendedor'))).toBe('origem inválida')
    expect(await erroDe(responderAdmin(db, 999999, [], { rev_lida: 0 }))).toBe('cotação não encontrada')
    expect(await erroDe(responderAdmin(db, id, [], { rev_lida: 0 }, 'ivan_digitou', randomUUID(), JOAO))).toBe('apenas o administrador pode fazer isso')
    expect(await erroDe(responderAdmin(db, id, [{ numero: 1 }], null))).toBe('envio inválido: rev_lida inválido no item 1')
    expect(await erroDe(responderAdmin(db, id, [], null))).toBe('envio inválido: envio vazio')
    // reenvio e envio de outra cotação
    const envio = randomUUID()
    const r1 = await responderAdmin(db, id, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })], null, 'ivan_digitou', envio)
    expect(await responderAdmin(db, id, [resp(1, 0, 'nao_tem')], null, 'ivan_digitou', envio)).toEqual({ ...r1, reenvio: true })
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await congelar(db, b)
    expect(await erroDe(responderAdmin(db, b, [resp(1, 0, 'nao_tem')], null, 'ivan_digitou', envio))).toBe('envio de outra cotação')
    // dispensada, cancelada, substituída, com pedido
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b])
    const NAO = 'esta cotação não aceita mais respostas'
    expect(await erroDe(responderAdmin(db, b, [resp(1, 0, 'nao_tem')], null))).toBe(NAO)
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await congelar(db, v2)
    expect(await erroDe(responderAdmin(db, id, [resp(2, 0, 'nao_tem')], null))).toBe(NAO)
    await gravar(db, v2, PEDIDO_1)
    expect(await erroDe(responderAdmin(db, v2, [resp(2, 0, 'nao_tem')], null))).toBe(NAO)
    await db.exec(`update cot_cotacoes set status = 'cancelada', resultado = null where id = ${v2}`)
    expect(await erroDe(responderAdmin(db, v2, [resp(2, 0, 'nao_tem')], null))).toBe(NAO)
  })

  it('"Limpar respostas do link antigo": "sem resposta" pelo Ivan apaga o que veio pelo link', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un', marca: 'Marca A' })])
    await chamar(db, ADMIN, 'cot_trocar_codigo($1)', [id])
    await responderAdmin(db, id, [resp(1, 1, 'sem_resposta')], null, 'ivan_digitou')
    expect(await linhaItem(db, id, 101)).toMatchObject({ estado: 'sem_resposta', origem: null, marca_informada: null, rev: 2 })
  })
})

describe('cot_gravar_pedido', () => {
  it('grava só os itens "No pedido", com produto, preço convertido e marca, em ordem de número; resultado pedido', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em)
                   values (104, null, 'seed', true, 1, '2026-09-27T03:00:00Z')`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const { codigo } = await congelar(db, f)
    await responder(db, codigo, [
      resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' }),
      resp(2, 0, 'tem', { preco: 3.2, base: 'un' }),
      resp(3, 0, 'tem', { preco: 12.4, base: 'embalagem', emb_gramas: 400 }),
      resp(4, 0, 'tem', { preco: 6.2, base: 'embalagem', emb_ml: 1000 }),
    ])
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    // 2 fica "Comprar na loja"; o App manda o fator em kg por caixa para o leite (1.000 ml × 1 kg/L = 1)
    const p = await gravar(db, f, [
      { numero: 4, qtd: 20, base: 'embalagem', embalagens: 20, fator: 1, preco_combinado: 6.2 },
      { numero: 1, qtd: 60, base: 'embalagem', embalagens: 5, fator: 12, preco_combinado: 31.5 },
      { numero: 3, qtd: 8, base: 'embalagem', embalagens: 20, fator: 0.4, preco_combinado: 12.4 },
    ])
    expect(p).toEqual({ cotacao_id: f, confirmado_por: ADMIN, confirmado_em: '2026-10-21T12:00:00.000000Z', itens: [
      { produto_id: 101, numero: 1, embalagens: 5, fator: 12, qtd: 60, preco_combinado: 31.5, base: 'embalagem', preco_convertido: 2.625, marca: 'Marca A' },
      { produto_id: 103, numero: 3, embalagens: 20, fator: 0.4, qtd: 8, preco_combinado: 12.4, base: 'embalagem', preco_convertido: 31, marca: null },
      { produto_id: 104, numero: 4, embalagens: 20, fator: 1, qtd: 20, preco_combinado: 6.2, base: 'embalagem', preco_convertido: 6.2, marca: null },
    ] })
    const c = await cotacao(db, f)
    expect(c).toMatchObject({ status: 'fechada', resultado: 'pedido' })
    expect(new Date(c.fechada_em).toISOString()).toBe('2026-10-21T12:00:00.000Z')
    const g = await db.query<Json>('select confirmado_por, itens from cot_pedidos where cotacao_id = $1', [f])
    expect(g.rows[0].itens).toEqual(p.itens)
    // repetir igual devolve o mesmo (idempotente, inclusive na ordem de entrada diferente); diferente recusa
    await fixarRelogio(db, '2026-10-21T13:00:00Z')
    expect(await gravar(db, f, [...([
      { numero: 1, qtd: 60, base: 'embalagem', embalagens: 5, fator: 12, preco_combinado: 31.5 },
      { numero: 3, qtd: 8, base: 'embalagem', embalagens: 20, fator: 0.4, preco_combinado: 12.4 },
      { numero: 4, qtd: 20, base: 'embalagem', embalagens: 20, fator: 1, preco_combinado: 6.2 }])])).toEqual(p)
    expect(await erroDe(gravar(db, f, PEDIDO_1))).toBe('pedido já confirmado')
    expect(await erroDe(gravar(db, f, [{ numero: 99 }]))).toBe('pedido já confirmado')
  })

  it('caixa em ml sem kg por litro: fator null e preço sem conversão; litro com kg por litro: preço ÷ kg por litro', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro) values (104, null, 'seed', true);
                   insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em)
                   values (103, null, 'seed', true, 0.8, '2026-09-27T03:00:00Z')`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const { codigo } = await congelar(db, f)
    await responder(db, codigo, [resp(4, 0, 'tem', { preco: 6.2, base: 'embalagem', emb_ml: 1000 }), resp(3, 0, 'tem', { preco: 4, base: 'litro' })])
    const p = await gravar(db, f, [
      { numero: 4, qtd: 20, base: 'embalagem', embalagens: 20, fator: null, preco_combinado: 6.2 },
      { numero: 3, qtd: 8, base: 'litro', embalagens: null, fator: null, preco_combinado: 4 },
    ])
    expect(p.itens).toEqual([
      { produto_id: 103, numero: 3, embalagens: null, fator: null, qtd: 8, preco_combinado: 4, base: 'litro', preco_convertido: 5, marca: null },
      { produto_id: 104, numero: 4, embalagens: 20, fator: null, qtd: 20, preco_combinado: 6.2, base: 'embalagem', preco_convertido: null, marca: null },
    ])
  })

  it('aceita qualquer versão viva com item "tem", inclusive a v2 pronta com respostas copiadas (D32)', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    await congelar(db, v2)
    expect((await cotacao(db, v2)).status).toBe('pronta')
    const p = await gravar(db, v2, PEDIDO_1)
    expect(p.itens[0]).toMatchObject({ produto_id: 101, preco_convertido: 2.5 })
    expect(await cotacao(db, v2)).toMatchObject({ status: 'fechada', resultado: 'pedido' })
  })

  it('recusas, na ordem do contrato', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    expect(await erroDe(gravar(db, 999999, PEDIDO_1))).toBe('cotação não encontrada')
    expect(await erroDe(gravar(db, id, PEDIDO_1, JOAO))).toBe('apenas o administrador pode fazer isso')
    expect(await erroDe(gravar(db, id, PEDIDO_1))).toBe('a cotação ainda não tem item com preço')
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12 }), resp(2, 0, 'nao_tem'),
      resp(3, 0, 'tem', { preco: 5, base: 'kg' })])
    const casos: [unknown, string][] = [
      [[], 'o pedido precisa de pelo menos um item'],
      [{ numero: 1 }, 'o pedido precisa de pelo menos um item'],
      [[PEDIDO_1[0], PEDIDO_1[0]], 'item 1 repetido no pedido'],
      [[{ ...PEDIDO_1[0], numero: 2 }], 'item 2 não está cotado com preço'],
      [[{ ...PEDIDO_1[0], numero: 4 }], 'item 4 não está cotado com preço'],
      [[{ ...PEDIDO_1[0], numero: 9 }], 'item 9 não está cotado com preço'],
      [[{ ...PEDIDO_1[0], qtd: 0 }], 'quantidade inválida no item 1'],
      [[{ ...PEDIDO_1[0], qtd: '60' }], 'quantidade inválida no item 1'],
      [[{ ...PEDIDO_1[0], base: 'kg' }], 'base incompatível no item 1'],
      [[{ numero: 3, qtd: 8, base: 'un', embalagens: null, fator: null, preco_combinado: 5 }], 'base incompatível no item 3'],
      [[{ ...PEDIDO_1[0], base: 'embalagem', embalagens: null, fator: 12 }], 'embalagem inválida no item 1'],
      [[{ ...PEDIDO_1[0], base: 'embalagem', embalagens: 1.5, fator: 12 }], 'embalagem inválida no item 1'],
      [[{ ...PEDIDO_1[0], base: 'embalagem', embalagens: 5, fator: 0 }], 'embalagem inválida no item 1'],
      [[{ ...PEDIDO_1[0], embalagens: 5 }], 'embalagem inválida no item 1'],
      [[{ ...PEDIDO_1[0], fator: 12 }], 'embalagem inválida no item 1'],
      [[{ ...PEDIDO_1[0], preco_combinado: 0 }], 'preço inválido no item 1'],
      [[{ ...PEDIDO_1[0], preco_combinado: 2.555 }], 'preço inválido no item 1'],
      [[{ ...PEDIDO_1[0], preco_combinado: null }], 'preço inválido no item 1'],
    ]
    for (const [itens, msg] of casos) expect([itens, await erroDe(gravar(db, id, itens))]).toEqual([itens, msg])
    expect((await cotacao(db, id)).resultado).toBeNull()
    // dispensada e cotação que não é viva
    await chamar(db, ADMIN, 'cot_dispensar($1)', [id])
    expect(await erroDe(gravar(db, id, PEDIDO_1))).toBe('esta cotação não aceita pedido')
    await preparar(db, semana)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    expect(await erroDe(gravar(db, b, PEDIDO_1))).toBe('esta cotação não aceita pedido')
  })
})

describe('cot_desfazer_pedido (4.13a, D67): o vendedor não confirmou ou a quantidade estava errada', () => {
  const desfazer = (db: Awaited<ReturnType<typeof banco>>, id: number, quem = ADMIN) =>
    chamar(db, quem, 'cot_desfazer_pedido($1)', [id])
  const economia = (db: Awaited<ReturnType<typeof banco>>) =>
    como(db, ADMIN, 'select itens_pedido, total_pedido, total_ultimo from cot_economia')

  it('antes do fechamento: volta a respondida; a etiqueta volta a "Em cotação", a economia esquece o pedido e o Ivan refaz o mapa', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.2, base: 'un' }), resp(2, 0, 'tem', { preco: 3.3, base: 'un' })])
    const agua = await itemDe(db, semana, 101)
    await fixarRelogio(db, '2026-10-20T12:00:00Z')
    // a quantidade digitada errada (600 un no lugar de 60) vai para a etiqueta e para a economia, 10 vezes maior
    await gravar(db, id, [{ numero: 1, qtd: 600, base: 'un', embalagens: null, fator: null, preco_combinado: 2.2 }])
    expect((await marcas(db, semana))[agua]).toMatchObject({ estado: 'pedido', vendedor: 'FORNECEDOR A' })
    expect(Number((await marcas(db, semana))[agua].qtd)).toBe(600)
    expect(await economia(db)).toEqual([{ itens_pedido: 1, total_pedido: '1320.00', total_ultimo: '1440.00' }])
    expect((await abrir(db, codigo)).estado).toBe('pedido_confirmado')

    await fixarRelogio(db, '2026-10-20T13:00:00Z')
    await desfazer(db, id)
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'respondida', resultado: null, fechada_em: null })
    expect((await db.query('select * from cot_pedidos')).rows).toEqual([])
    // o item com preço espera a decisão do Ivan ("não comprar na loja"); o sem resposta segue até o fechamento
    const m = await marcas(db, semana)
    expect(m[agua]).toMatchObject({ estado: 'em_cotacao', vendedor: 'FORNECEDOR A' })
    expect(Number(m[agua].qtd)).toBe(60)
    expect(await economia(db)).toEqual([])
    // a página volta a abrir com as respostas: o vendedor ainda pode corrigir até o fechamento
    const a = await abrir(db, codigo)
    expect(a).toMatchObject({ ok: true, estado: 'aberta' })
    expect(a.itens[0].resposta).toMatchObject({ estado: 'tem', preco_digitado: 2.2 })
    // toque duplo (ou a tela desatualizada): nada
    await desfazer(db, id)
    expect(await cotacao(db, id)).toMatchObject({ status: 'respondida', resultado: null })

    // o Ivan refaz o mapa com a quantidade certa
    await gravar(db, id, [{ numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.2 }])
    expect(await cotacao(db, id)).toMatchObject({ status: 'fechada', resultado: 'pedido' })
    expect(Number((await marcas(db, semana))[agua].qtd)).toBe(60)
    expect(await economia(db)).toEqual([{ itens_pedido: 1, total_pedido: '132.00', total_ultimo: '144.00' }])
  })

  it('depois do fechamento: volta a fechada sem resultado; "Obrigado, desta vez não" solta os itens para a loja', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await gravar(db, id, PEDIDO_1)
    const agua = await itemDe(db, semana, 101)
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    await desfazer(db, id)
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'fechada', resultado: null })
    expect(new Date(c.fechada_em).toISOString()).toBe('2026-10-21T12:00:00.000Z')
    // o robô não mexe nela de novo, e a página diz que a cotação fechou
    expect((await como(db, 'service', 'select cot_fechar_vencidas() as r'))[0].r.fechadas).toEqual([])
    expect((await abrir(db, codigo)).estado).toBe('encerrada')
    // depois do fechamento só o item com preço segue "Em cotação", até o pedido ou o Obrigado
    expect(Object.keys(await marcas(db, semana)).map(Number)).toContain(agua)
    expect((await marcas(db, semana))[agua].estado).toBe('em_cotacao')
    await chamar(db, ADMIN, 'cot_dispensar($1)', [id])
    expect(await cotacao(db, id)).toMatchObject({ status: 'fechada', resultado: 'dispensado' })
    expect((await marcas(db, semana))[agua]).toBeUndefined()
    expect(await economia(db)).toEqual([])
  })

  it('rascunho da complementar: o pedido desfeito volta a ser a viva, e o rascunho vira a Nova versão dela', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await gravar(db, id, PEDIDO_1)
    // item novo do Fulano depois do pedido → "Cotação complementar" só com ele
    await chamar(db, ADMIN, 'cot_definir_vendedor($1, $2)', [107, V_FULANO])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    expect(await cotacao(db, v2)).toMatchObject({ status: 'rascunho', complementar: true })
    expect(await produtosDe(db, v2)).toEqual([107])
    await desfazer(db, id)
    expect(await cotacao(db, v2)).toMatchObject({ status: 'rascunho', complementar: false })
    expect(await produtosDe(db, v2)).toEqual([101, 102, 103, 104, 107])
    // ao preparar, a v1 vira substituída e a resposta vem junto (o link antigo leva à v2)
    await congelar(db, v2)
    expect(await cotacao(db, id)).toMatchObject({ status: 'substituida', substituida_por: v2, resultado: null })
    expect(await linhaItem(db, v2, 101)).toMatchObject({ estado: 'tem', numero: 1, copiada_da_versao: 1 })
  })

  it('recusas, na ordem do contrato', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    expect(await erroDe(desfazer(db, 999999))).toBe('cotação não encontrada')
    expect(await erroDe(desfazer(db, id, JOAO))).toBe('apenas o administrador pode fazer isso')
    // viva sem pedido: nada muda; rascunho e dispensada não têm pedido
    await desfazer(db, id)
    expect(await cotacao(db, id)).toMatchObject({ status: 'pronta', resultado: null })
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    expect(await erroDe(desfazer(db, b))).toBe('esta cotação não tem pedido confirmado')
    await congelar(db, b)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b])
    expect(await erroDe(desfazer(db, b))).toBe('esta cotação não tem pedido confirmado')

    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await gravar(db, id, PEDIDO_1)
    await chamar(db, ADMIN, 'cot_definir_vendedor($1, $2)', [107, V_FULANO])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    // a complementar em "Comprar na loja nesta semana" não convive com uma viva: Voltar a cotar antes
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [v2])
    expect(await erroDe(desfazer(db, id))).toBe('este vendedor está em "Comprar na loja nesta semana"; toque em Voltar a cotar')
    await chamar(db, ADMIN, 'cot_voltar_a_cotar($1)', [v2])
    // a complementar já preparada é viva: uma viva por vendedor e semana
    await congelar(db, v2)
    expect(await erroDe(desfazer(db, id))).toBe('há outra cotação em andamento com este vendedor (v2): resolva a v2 antes de desfazer este pedido')
    expect(await cotacao(db, id)).toMatchObject({ status: 'fechada', resultado: 'pedido' })
    expect((await db.query('select cotacao_id from cot_pedidos')).rows).toEqual([{ cotacao_id: id }])
    // semana encerrada: o pedido fica
    await encerrar(db, semana)
    expect(await erroDe(desfazer(db, id))).toBe('a semana desta cotação não está em compra')
    expect((await cotacao(db, id)).resultado).toBe('pedido')
  })
})

describe('cot_economia (ajuste Foozi 2)', () => {
  it('linha comparável entra nas duas somas; antiga, sem referência e litro sem conversão contam à parte', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro) values (103, null, 'seed', true)`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const cf = (await congelar(db, f)).codigo
    const cb = (await congelar(db, b)).codigo
    await responder(db, cf, [
      resp(1, 0, 'tem', { preco: 2.2, base: 'un' }), // ref 2,40 ok
      resp(2, 0, 'tem', { preco: 3.3, base: 'un' }), // ref 3,00 ok
      resp(3, 0, 'tem', { preco: 4, base: 'litro' }), // litro sem conversão
      resp(4, 0, 'tem', { preco: 5.5, base: 'kg' }), // ref antiga
    ])
    await responder(db, cb, [resp(1, 0, 'tem', { preco: 3.5, base: 'kg' })]) // 106: sem referência
    await gravar(db, f, [
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.2 },
      { numero: 2, qtd: 48, base: 'un', embalagens: null, fator: null, preco_combinado: 3.3 },
      { numero: 3, qtd: 8, base: 'litro', embalagens: null, fator: null, preco_combinado: 4 },
      { numero: 4, qtd: 20, base: 'kg', embalagens: null, fator: null, preco_combinado: 5.5 },
    ])
    await gravar(db, b, [{ numero: 1, qtd: 25, base: 'kg', embalagens: null, fator: null, preco_combinado: 3.5 }])
    const r = await como(db, ADMIN, 'select * from cot_economia')
    // comparáveis: 60 × 2,20 + 48 × 3,30 = 290,40; pelo último preço 60 × 2,40 + 48 × 3 = 288,00
    expect(r).toEqual([{ semana_id: semana, data_referencia: expect.anything(), pedidos: 2, itens_pedido: 5, itens_com_referencia: 2,
      itens_sem_comparacao: 3, total_pedido: '290.40', total_ultimo: '288.00', diferenca: '2.40' }])
  })

  it('uma linha por semana com pedido; o comprador não lê', async () => {
    const db = await banco()
    const s1 = await aprovar(db)
    await preparar(db, s1)
    const f1 = await cotacaoDe(db, s1, V_FULANO)
    const c1 = (await congelar(db, f1)).codigo
    await responder(db, c1, [resp(1, 0, 'tem', { preco: 2, base: 'un' })])
    await gravar(db, f1, PEDIDO_1.map((x) => ({ ...x, preco_combinado: 2 })))
    await encerrar(db, s1)
    const s2 = await aprovar(db, payloadDe('2026-10-26'), '2026-10-26T11:00:00Z', '2026-10-26T18:00:00Z')
    await preparar(db, s2)
    const f2 = await cotacaoDe(db, s2, V_FULANO)
    const c2 = (await congelar(db, f2)).codigo
    await responder(db, c2, [resp(1, 0, 'tem', { preco: 2.6, base: 'un' })])
    await gravar(db, f2, PEDIDO_1.map((x) => ({ ...x, preco_combinado: 2.6 })))
    // semana sem pedido (a 3ª) não aparece
    const r = await como(db, ADMIN, 'select semana_id, total_pedido, total_ultimo, diferenca from cot_economia order by semana_id')
    expect(r).toEqual([
      { semana_id: s1, total_pedido: '120.00', total_ultimo: '144.00', diferenca: '-24.00' },
      { semana_id: s2, total_pedido: '156.00', total_ultimo: '144.00', diferenca: '12.00' },
    ])
    expect(await como(db, JOAO, 'select * from cot_economia')).toEqual([])
    await expect(como(db, 'anon', 'select * from cot_economia')).rejects.toThrow(/permission denied/)
  })
})
