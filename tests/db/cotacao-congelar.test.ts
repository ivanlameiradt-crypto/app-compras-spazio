import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, codigoDe, cotacao, chamar, produtosDe, cotItemDe, erroDe,
  abrir, responder, responderAdmin, resp, encerrar, fixarRelogio, prontaDoFulano,
  V_FULANO, V_BELTRANO, PAYLOAD_COTACAO, APROVADA_EM, PREPARO, FULANO, type Json,
} from './fixture-cotacao'

// Fase 1B — congelar (7.3.3, contrato 4.4 e 3.7), versões, desfazer, trocar link, cancelar, "Já enviei" e a
// definição única de "pronta sem sinal de envio" (3.1, D36).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const numeros = (d: { itens: { numero: number; produto_id: number }[] }) => d.itens.map((i) => [i.numero, i.produto_id])

describe('cot_congelar', () => {
  it('numera bebidas primeiro e depois pelo nome sem acento; gera código, prazo e fechamento', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const d = await congelar(db, f)
    // ÁGUA antes de REFRIGERANTE (sem acento; com o byte do "Á" ela iria para o fim), AÇÚCAR antes de LEITE
    expect(numeros(d)).toEqual([[1, 101], [2, 102], [3, 103], [4, 104]])
    expect(d).toMatchObject({
      cotacao_id: f, semana_id: semana, data_referencia: '2026-10-19', versao: 1, complementar: false, substitui_versao: null,
      status: 'pronta', prazo: '2026-10-20T15:00:00.000000Z', fechamento: '2026-10-20T20:00:00.000000Z',
      prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00',
      vendedor: { id: V_FULANO, codigo: 'fulano', nome: 'Fulano', empresa: FULANO.empresa, rotulo: 'FORNECEDOR A', whatsapp: FULANO.whatsapp },
    })
    expect(d.codigo).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(d.itens[0]).toEqual({ numero: 1, produto_id: 101, nome: 'ÁGUA MINERAL 500ML', qtd: 60, unidade: 'un', rotulo: 'un',
      vende_por_litro: false, embalagem: null, fator: null, nota: null })
    const c = await cotacao(db, f)
    expect(c.status).toBe('pronta')
    expect(new Date(c.congelada_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    const h = await db.query<Json>(`select encode(codigo_hash, 'hex') = encode(sha256(convert_to($1, 'UTF8')), 'hex') as ok from cot_cotacoes where id = $2`, [d.codigo, f])
    expect(h.rows[0].ok).toBe(true)
    // Beltrano: sem bebida; FARINHA antes de GELO
    const b = await congelar(db, await cotacaoDe(db, semana, V_BELTRANO))
    expect(numeros(b)).toEqual([[1, 106], [2, 105]])
    expect(b.itens[1]).toMatchObject({ nome: 'GELO ESCAMA', unidade: 'un', rotulo: 'saco' })
  })

  it('idempotente em pronta: toque duplo devolve o mesmo código e o mesmo prazo, mesmo mais tarde', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const d1 = await congelar(db, f)
    await fixarRelogio(db, '2026-10-20T01:30:00Z')
    const d2 = await congelar(db, f)
    expect(d2).toEqual(d1)
  })

  it('só em rascunho; semana em compra; ao menos um item marcado', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    expect(await erroDe(congelar(db, 999999))).toBe('cotação não encontrada')
    expect(await erroDe(congelar(db, f, JOAO))).toBe('apenas o administrador pode fazer isso')
    for (const p of [105, 106]) await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, b, p)])
    expect(await erroDe(congelar(db, b))).toBe('marque pelo menos um item antes de preparar a mensagem')
    // os dois itens do Beltrano passam ao Fulano sem a aba atualizar: o rascunho do Beltrano fica vazio
    await chamar(db, ADMIN, 'cot_marcar_item($1, true)', [await cotItemDe(db, b, 105)])
    await chamar(db, ADMIN, 'cot_definir_vendedor(105, $1)', [V_FULANO])
    await chamar(db, ADMIN, 'cot_definir_vendedor(106, $1)', [V_FULANO])
    expect(await erroDe(congelar(db, b))).toBe('nenhum item para cotar com este vendedor; atualize a aba')
    expect((await cotacao(db, b)).status).toBe('rascunho') // a exceção desfaz tudo
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f])
    expect(await erroDe(congelar(db, f))).toBe('esta cotação não está em rascunho')
    await preparar(db, semana)
    const f2 = await cotacaoDe(db, semana, V_FULANO)
    await encerrar(db, semana)
    expect(await erroDe(congelar(db, f2))).toBe('a semana desta cotação não está em compra')
  })

  it('qtd = quantidade aprovada (não a sugerida), com a sugerida guardada para o Ivan', async () => {
    const db = await banco()
    const r = await como(db, 'service', 'select importar_semana($1::jsonb) as r', [JSON.stringify(PAYLOAD_COTACAO)])
    const semana = Number(r[0].r.semana_id)
    const i101 = (await db.query<Json>('select id from itens_semana where produto_id = 101')).rows[0].id
    await como(db, ADMIN, 'select ajustar_item($1, 72, true)', [i101])
    await como(db, ADMIN, 'select aprovar_semana($1)', [semana])
    await db.query<Json>('update semanas set aprovada_em = $1', [APROVADA_EM])
    await fixarRelogio(db, PREPARO)
    await preparar(db, semana)
    const d = await congelar(db, await cotacaoDe(db, semana, V_FULANO))
    expect(d.itens[0]).toMatchObject({ produto_id: 101, qtd: 72 })
    const x = await db.query<Json>('select qtd, qtd_sugerida from cot_itens where produto_id = 101')
    expect([Number(x.rows[0].qtd), Number(x.rows[0].qtd_sugerida)]).toEqual([72, 60])
  })

  it('embalagem e fator só confirmados e do catálogo deste vendedor; descrição só de fornecedor deste vendedor', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`
      insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator, fator_confirmado_em, descricao_fornecedor,
                                codigo_fornecedor, descricao_de_fornecedor) values
        (101, ${V_FULANO}, 'seed', 'fardo', 12, '2026-10-01T03:00:00Z', 'AGUA MIN S/GAS 500ML', '7890001', 'FORNECEDOR A LTDA'),
        (102, ${V_FULANO}, 'seed', 'fardo', 6, null, 'REFRIG LT 350', '7890002', 'FORNECEDOR B LTDA')`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const d = await congelar(db, f)
    expect(d.itens[0]).toMatchObject({ embalagem: 'fardo', fator: 12 })
    expect(d.itens[1]).toMatchObject({ embalagem: null, fator: null }) // fator não confirmado não vai ao vendedor
    const x = await db.query<Json>(`select produto_id, embalagem, fator, fator_confirmado, descricao_fornecedor, codigo_fornecedor
                                from cot_itens where cotacao_id = $1 and produto_id in (101, 102) order by produto_id`, [f])
    expect(x.rows).toEqual([
      { produto_id: 101, embalagem: 'fardo', fator: '12', fator_confirmado: true, descricao_fornecedor: 'AGUA MIN S/GAS 500ML', codigo_fornecedor: '7890001' },
      // a descrição do 102 veio de NF do FORNECEDOR B (Beltrano): não aparece na cotação do Fulano
      { produto_id: 102, embalagem: 'fardo', fator: '6', fator_confirmado: false, descricao_fornecedor: null, codigo_fornecedor: null },
    ])
  })

  it('índices: nunca duas versões vivas nem dois rascunhos do mesmo vendedor na semana', async () => {
    const db = await banco()
    const { semana, id } = await prontaDoFulano(db)
    await expect(db.query<Json>(`insert into cot_cotacoes (semana_id, vendedor_id, versao, status, congelada_em, prazo, fechamento)
                           values ($1, $2, 9, 'enviada', now(), now(), now())`, [semana, V_FULANO])).rejects.toThrow(/cot_cotacoes_uma_viva/)
    await db.query<Json>(`insert into cot_cotacoes (semana_id, vendedor_id, versao) values ($1, $2, 10)`, [semana, V_FULANO])
    await expect(db.query<Json>(`insert into cot_cotacoes (semana_id, vendedor_id, versao) values ($1, $2, 11)`, [semana, V_FULANO]))
      .rejects.toThrow(/cot_cotacoes_um_rascunho/)
    await expect(db.query<Json>(`insert into cot_cotacoes (semana_id, vendedor_id, versao, status) values ($1, $2, 12, 'liberada')`, [semana, V_FULANO]))
      .rejects.toThrow(/cot_cotacoes_um_rascunho/)
    expect(id).toBeGreaterThan(0)
  })
})

describe('versões: Nova versão, substituição e cópia das respostas', () => {
  it('v2 mantém os números, itens novos no fim, número de item que saiu nunca é reutilizado', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f1)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f1])
    await chamar(db, ADMIN, 'cot_definir_vendedor(107, $1)', [V_FULANO])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    expect(await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])).toBe(f2) // devolve o rascunho que já existe
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f2, 102)])
    const d2 = await congelar(db, f2)
    expect([d2.versao, d2.substitui_versao, d2.complementar]).toEqual([2, 1, false])
    expect(numeros(d2)).toEqual([[1, 101], [3, 103], [4, 104], [5, 107]])
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f2])
    const f3 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f2])
    // o desmarcado na v2 vem desmarcado; marcado de novo, volta com o número dele
    expect(await produtosDe(db, f3, true)).toEqual([101, 103, 104, 107])
    await chamar(db, ADMIN, 'cot_marcar_item($1, true)', [await cotItemDe(db, f3, 102)])
    const d3 = await congelar(db, f3)
    expect(numeros(d3)).toEqual([[1, 101], [2, 102], [3, 103], [4, 104], [5, 107]])
    expect((await cotacao(db, f1)).status).toBe('substituida')
    expect((await cotacao(db, f1)).substituida_por).toBe(f2)
    expect((await cotacao(db, f2)).substituida_por).toBe(f3)
  })

  it('substituição: copia respostas (com a marca), condições, notificação e último envio; recalcula conversão e avisos', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator) values (101, ${V_FULANO}, 'seed', 'fardo', 12)`)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    const cod1 = (await congelar(db, f1)).codigo
    const r = await responder(db, cod1, [
      resp(1, 0, 'tem', { preco: 30, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' }),
      resp(2, 0, 'nao_tem', { similar_desc: 'lata 310 ml', similar_preco: 2.9 }),
    ], { rev_lida: 0, pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 300, frete: 0, entrega: 'amanhã', observacao: null })
    expect(r.ok).toBe(true)
    await db.exec(`update cot_cotacoes set notificado_hash = 'abc123', notificado_em = '2026-10-19T18:30:00Z' where id = ${f1}`)
    // o Ivan confirma o fator: a v2 recalcula o aviso com o retrato novo
    await db.exec(`update cot_catalogo set fator_confirmado_em = '2026-10-19T18:40:00Z' where produto_id = 101`)
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    await congelar(db, f2)
    const v1 = await db.query<Json>('select * from cot_itens where cotacao_id = $1 order by numero', [f1])
    const v2 = await db.query<Json>('select * from cot_itens where cotacao_id = $1 order by numero', [f2])
    expect(v1.rows[0].avisos_ivan).toEqual(['fator_nao_confirmado'])
    expect(v2.rows[0]).toMatchObject({ estado: 'tem', preco_digitado: '30.00', base: 'embalagem', emb_unidades: 12, marca_informada: 'Marca A',
      preco_convertido: '2.5000', fator_informado: '12', avisos_ivan: [], origem: 'vendedor', copiada_da_versao: 1, rev: 0, fator_confirmado: true })
    expect(new Date(v2.rows[0].respondido_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    expect(v2.rows[1]).toMatchObject({ estado: 'nao_tem', similar_desc: 'lata 310 ml', similar_preco: '2.90', avisos_ivan: ['similar'], copiada_da_versao: 1 })
    expect(v2.rows[2]).toMatchObject({ estado: 'sem_resposta', copiada_da_versao: null })
    const c1 = await cotacao(db, f1)
    const c2 = await cotacao(db, f2)
    expect(c2).toMatchObject({ status: 'pronta', pagamento: 'boleto 28 dias', pedido_minimo: '300', frete: '0', entrega: 'amanhã',
      gerais_origem: 'vendedor', gerais_rev: 0, respostas_rev: 0, notificado_hash: 'abc123', envios_aceitos: 0, acessos: 0,
      enviada_em: null, primeiro_acesso: null })
    expect(c2.validade).toEqual(c1.validade)
    expect(new Date(c2.notificado_em).toISOString()).toBe('2026-10-19T18:30:00.000Z')
    expect(new Date(c2.ultimo_envio_em).toISOString()).toBe(new Date(c1.ultimo_envio_em).toISOString()) // D33
    expect([c1.status, c1.substituida_por]).toEqual(['substituida', f2])
    // o link da v1 leva à v2
    const a = await abrir(db, cod1)
    expect(a).toMatchObject({ ok: true, estado: 'substituida', texto: 'Esta cotação foi atualizada (v2)',
      nova: { versao: 2, codigo: await codigoDe(db, f2) }, itens: [], gerais: null })
  })

  it('cobranca_em copiada só quando o prazo da nova versão é igual ao da anterior', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f1)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f1])
    await db.exec(`update cot_cotacoes set cobranca_em = '2026-10-19T18:20:00Z' where id = ${f1}`)
    await fixarRelogio(db, '2026-10-19T19:00:00Z') // seg 16:00: mesmo prazo (ter 12:00)
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    await congelar(db, f2)
    const c2 = await cotacao(db, f2)
    expect(new Date(c2.prazo).toISOString()).toBe('2026-10-20T15:00:00.000Z')
    expect(new Date(c2.cobranca_em).toISOString()).toBe('2026-10-19T18:20:00.000Z')
    await fixarRelogio(db, '2026-10-20T21:00:00Z') // ter 18:00, depois do fechamento: "Nova versão (prazo novo)"
    const f3 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f2])
    await congelar(db, f3)
    const c3 = await cotacao(db, f3)
    expect(new Date(c3.prazo).toISOString()).toBe('2026-10-21T15:00:00.000Z') // qua 12:00
    expect(c3.cobranca_em).toBeNull()
  })

  it('não substitui cotação com pedido: a próxima é complementar e sem cópia; recusas da Nova versão', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao(999999)'))).toBe('cotação não encontrada')
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [id, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao($1)', [id]))).toBe('não há item novo para uma cotação complementar')
    await chamar(db, ADMIN, 'cot_definir_vendedor(108, $1)', [V_FULANO])
    const c2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    const d = await congelar(db, c2)
    expect([d.complementar, d.substitui_versao, d.versao]).toEqual([true, null, 2])
    expect(numeros(d)).toEqual([[5, 108]])
    expect(await cotacao(db, id)).toMatchObject({ status: 'fechada', resultado: 'pedido', substituida_por: null })
    const x = await db.query<Json>('select estado, copiada_da_versao from cot_itens where cotacao_id = $1', [c2])
    expect(x.rows).toEqual([{ estado: 'sem_resposta', copiada_da_versao: null }])
    // cancelada não gera nova versão
    await chamar(db, ADMIN, 'cot_cancelar($1)', [c2])
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao($1)', [c2]))).toBe('não dá para gerar nova versão desta cotação')
    // semana encerrada
    await encerrar(db, semana)
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao($1)', [id]))).toBe('a semana desta cotação não está em compra')
  })

  it('corrida: responder na v1 e depois congelar a v2 → a resposta vem copiada', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    const r = await responder(db, codigo, [resp(3, 0, 'tem', { preco: 4.8, base: 'kg' })])
    expect(r.itens[0].resultado).toBe('gravado')
    await fixarRelogio(db, '2026-10-19T18:10:00Z')
    await congelar(db, v2)
    const x = await db.query<Json>('select estado, preco_convertido, copiada_da_versao from cot_itens where cotacao_id = $1 and numero = 3', [v2])
    expect(x.rows[0]).toEqual({ estado: 'tem', preco_convertido: '4.8000', copiada_da_versao: 1 })
    expect(semana).toBeGreaterThan(0)
  })

  it('corrida: congelar a v2 e depois responder na v1 → "substituida" com o link da v2, nada gravado na v1', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await congelar(db, v2)
    const r = await responder(db, codigo, [resp(3, 0, 'tem', { preco: 4.8, base: 'kg' })])
    expect(r).toEqual({ ok: false, erro: 'estado', estado: 'substituida', texto: 'Esta cotação foi atualizada (v2)',
      nova: { versao: 2, codigo: await codigoDe(db, v2) } })
    const c = await cotacao(db, id)
    expect([c.respostas_rev, c.envios_aceitos]).toEqual([0, 0])
    expect((await db.query<Json>(`select count(*)::int as n from cot_itens where cotacao_id = $1 and estado <> 'sem_resposta'`, [id])).rows[0].n).toBe(0)
  })
})

describe('Desfazer (não enviei), Nova versão e Obrigado: pronta sem sinal × com sinal (D36)', () => {
  it('Desfazer na pronta sem sinal: volta a rascunho, o código antigo vira código inválido e o Preparar dá prazo novo', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await db.exec(`update cot_cotacoes set cobranca_em = now() where id = ${id}`)
    await chamar(db, ADMIN, 'cot_descongelar($1)', [id])
    await chamar(db, ADMIN, 'cot_descongelar($1)', [id]) // idempotente
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'rascunho', codigo_hash: null, prazo: null, fechamento: null, congelada_em: null,
      cobranca_em: null, consolidado_em: null, versao: 1 })
    expect((await db.query<Json>('select count(*)::int as n from cot_codigos')).rows[0].n).toBe(0)
    expect((await db.query<Json>('select count(*)::int as n from cot_itens where numero is not null')).rows[0].n).toBe(0)
    expect(await abrir(db, codigo)).toEqual({ ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' })
    await fixarRelogio(db, '2026-10-20T12:00:00Z') // ter 09:00
    await preparar(db, semana)
    const d = await congelar(db, id)
    expect(d.prazo).toBe('2026-10-21T15:00:00.000000Z')
    expect(numeros(d)).toEqual([[1, 101], [2, 102], [3, 103], [4, 104]])
  })

  it('Desfazer recusado depois de "Já enviei", de acesso, de resposta e na versão que substituiu outra', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const codB = (await congelar(db, b)).codigo
    // acesso (a prévia não conta)
    await abrir(db, codigo, true)
    await chamar(db, ADMIN, 'cot_descongelar($1)', [id])
    await preparar(db, semana)
    const cod2 = (await congelar(db, id)).codigo
    await db.exec(`update cot_cotacoes set primeiro_acesso = now() where id = ${id}`) // link aberto (sem mudar o status)
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [id]))).toBe('o link já foi aberto; use Cancelar ou Nova versão')
    await db.exec(`update cot_cotacoes set primeiro_acesso = null where id = ${id}`)
    // resposta (colada pelo Ivan)
    await responderAdmin(db, b, [resp(1, 0, 'nao_tem')])
    await db.exec(`update cot_cotacoes set status = 'pronta', enviada_em = null where id = ${b}`)
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [b]))).toBe('a cotação já tem resposta; use Cancelar ou Nova versão')
    await db.exec(`update cot_cotacoes set respostas_rev = 0 where id = ${b}`)
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [b]))).toBe('a cotação já tem resposta; use Cancelar ou Nova versão')
    // "Já enviei"
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [id]))).toBe('só dá para desfazer uma cotação preparada e ainda não enviada')
    await db.exec(`update cot_cotacoes set status = 'pronta' where id = ${id}`)
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [id]))).toBe('você já marcou "Já enviei"; use Cancelar ou Nova versão')
    await db.exec(`update cot_cotacoes set status = 'enviada' where id = ${id}`)
    // a v2 que substituiu a v1
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await congelar(db, v2)
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [v2]))).toBe('esta versão substituiu outra que o vendedor já tinha; use Cancelar')
    expect(await erroDe(chamar(db, JOAO, 'cot_descongelar($1)', [v2]))).toBe('apenas o administrador pode fazer isso')
    expect([cod2, codB].every((c) => c.length === 32)).toBe(true)
  })

  it('Nova versão e Obrigado recusam só a pronta sem sinal; nenhum dos dois manda para o Desfazer quando há sinal', async () => {
    const db = await banco()
    const { id } = await prontaDoFulano(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao($1)', [id]))).toBe('esta cotação ainda não foi enviada: use Desfazer (não enviei)')
    expect(await erroDe(chamar(db, ADMIN, 'cot_dispensar($1)', [id]))).toBe('esta cotação ainda não foi enviada: use Desfazer ou Cancelar')
    // "Já enviei" → Nova versão aceita; a v2 congelada substituiu a v1 (tem sinal): aceita Nova versão e Obrigado
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await congelar(db, v2)
    expect((await cotacao(db, v2)).status).toBe('pronta')
    const v3 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [v2])
    expect((await cotacao(db, v3)).versao).toBe(3)
    await chamar(db, ADMIN, 'cot_dispensar($1)', [v2])
    await chamar(db, ADMIN, 'cot_dispensar($1)', [v2]) // idempotente
    expect(await cotacao(db, v2)).toMatchObject({ status: 'fechada', resultado: 'dispensado' })
  })

  it('pronta aberta depois do fechamento: aceita Nova versão (prazo novo) e Obrigado, não o Desfazer', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await fixarRelogio(db, '2026-10-20T21:00:00Z') // ter 18:00
    const a = await abrir(db, codigo)
    expect(a).toMatchObject({ ok: true, estado: 'encerrada', texto: 'Cotação encerrada às 17h de ter 20/10. Obrigado!' })
    expect((await cotacao(db, id)).status).toBe('pronta') // encerrada: não vira enviada
    expect(await erroDe(chamar(db, ADMIN, 'cot_descongelar($1)', [id]))).toBe('o link já foi aberto; use Cancelar ou Nova versão')
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    expect((await cotacao(db, v2)).versao).toBe(2)
    await chamar(db, ADMIN, 'cot_dispensar($1)', [id])
    expect(await cotacao(db, id)).toMatchObject({ status: 'fechada', resultado: 'dispensado' })
    expect(semana).toBeGreaterThan(0)
  })

  it('Obrigado: recusas', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_dispensar(999999)'))).toBe('cotação não encontrada')
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [id, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    expect(await erroDe(chamar(db, ADMIN, 'cot_dispensar($1)', [id]))).toBe('pedido já confirmado')
    await db.exec(`update cot_cotacoes set status = 'cancelada', resultado = null where id = ${id}`)
    expect(await erroDe(chamar(db, ADMIN, 'cot_dispensar($1)', [id]))).toBe('não dá para dispensar esta cotação')
  })
})

describe('"Já enviei", Cancelar, Trocar link e cot_dados_envio', () => {
  it('"Já enviei": pronta → enviada; idempotente; rascunho recusado', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    expect(await erroDe(chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f]))).toBe('esta cotação não está preparada')
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    const c = await cotacao(db, f)
    expect(c.status).toBe('enviada')
    expect(new Date(c.enviada_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    expect(new Date((await cotacao(db, f)).enviada_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    expect(await erroDe(chamar(db, ADMIN, 'cot_confirmar_envio(999999)'))).toBe('cotação não encontrada')
  })

  it('Cancelar: pronta, enviada ou respondida; o código passa a responder "cancelada"', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    expect(await erroDe(chamar(db, ADMIN, 'cot_cancelar($1)', [f]))).toBe('só dá para cancelar cotação preparada, enviada ou respondida')
    const cod = (await congelar(db, f)).codigo
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f])
    expect((await abrir(db, cod)).texto).toBe('Esta cotação foi cancelada pelo Ivan.')
  })

  it('Trocar link: o novo abre, o antigo e os das versões anteriores viram código inválido; contadores zerados', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    const cod2 = (await congelar(db, v2)).codigo
    expect((await abrir(db, codigo)).estado).toBe('substituida')
    await abrir(db, cod2)
    const r = await responder(db, cod2, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    expect(r.ok).toBe(true)
    const antes = await cotacao(db, v2)
    expect([antes.envios_aceitos, antes.tentativas_na_janela, antes.abrir_na_janela]).toEqual([1, 1, 1])
    const d = await chamar(db, ADMIN, 'cot_trocar_codigo($1)', [v2])
    expect(d.codigo).not.toBe(cod2)
    for (const velho of [codigo, cod2]) {
      expect((await abrir(db, velho)).erro).toBe('codigo_invalido')
    }
    const c1 = await cotacao(db, id)
    expect(c1.codigo_hash).toBeNull()
    const depois = await cotacao(db, v2)
    expect(depois).toMatchObject({ envios_aceitos: 0, tentativas_janela_inicio: null, tentativas_na_janela: 0,
      abrir_janela_inicio: null, abrir_na_janela: 0, respostas_rev: 1 })
    expect(new Date(depois.ultimo_envio_em).toISOString()).toBe(new Date(antes.ultimo_envio_em).toISOString())
    const a = await abrir(db, d.codigo)
    expect(a).toMatchObject({ ok: true, estado: 'aberta', versao: 2 })
    expect(a.itens[0].resposta).toMatchObject({ estado: 'tem', preco_digitado: 2.5 }) // respostas ficam (quem limpa é o Ivan)
    expect(await erroDe(chamar(db, ADMIN, 'cot_trocar_codigo($1)', [id]))).toBe('só dá para trocar o link de uma cotação viva')
    expect(await erroDe(chamar(db, ADMIN, 'cot_trocar_codigo(999999)'))).toBe('cotação não encontrada')
  })

  it('cot_dados_envio só lê; rascunho e liberada pedem o Preparar', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    expect(await erroDe(chamar(db, ADMIN, 'cot_dados_envio($1)', [f]))).toBe('cotação em rascunho: toque em Preparar mensagem')
    expect(await erroDe(chamar(db, ADMIN, 'cot_dados_envio(999999)'))).toBe('cotação não encontrada')
    expect(await erroDe(chamar(db, JOAO, 'cot_dados_envio($1)', [f]))).toBe('apenas o administrador pode fazer isso')
    const d = await congelar(db, f)
    const antes = await cotacao(db, f)
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    expect(await chamar(db, ADMIN, 'cot_dados_envio($1)', [f])).toEqual(d)
    expect(await cotacao(db, f)).toEqual(antes)
    // o código expirado/trocado sai null
    await db.exec(`delete from cot_codigos where cotacao_id = ${f}`)
    expect((await chamar(db, ADMIN, 'cot_dados_envio($1)', [f])).codigo).toBeNull()
  })
})
