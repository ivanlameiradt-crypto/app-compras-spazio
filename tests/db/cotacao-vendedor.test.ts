import { bancoPorArquivo, como, limpar } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, codigoDe, cotacao, chamar, cotItemDe, abrir, responder,
  responderAdmin, resp, fixarRelogio, prontaDoFulano, muitas, randomUUID, linhaItem, V_FULANO, V_BELTRANO, FULANO, type Json,
} from './fixture-cotacao'

// Fase 1B — as duas funções da página do vendedor (contrato 5.1 e 5.2): estado efetivo, lista branca de
// chaves, regras de aceite, validação, conversão (7.3.8), avisos e a marca informada (D50). Nunca levantam
// exceção por regra de negócio: sempre devolvem JSON com ok.
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const CHAVES_ABRIR = ['ok', 'estado', 'texto', 'loja', 'vendedor_nome', 'versao', 'complementar', 'substitui_versao', 'prazo',
  'fechamento', 'agora', 'prazo_local', 'fechamento_local', 'agora_local', 'segundos_para_fechar', 'validade_opcoes', 'itens',
  'gerais', 'gerais_rev', 'nova'].sort()
const CHAVES_ITEM = ['numero', 'nome', 'nota', 'qtd', 'unidade', 'rotulo', 'vende_por_litro', 'embalagem', 'fator', 'kg_por_litro',
  'descricao_fornecedor', 'codigo_fornecedor', 'resposta', 'rev'].sort()
const CHAVES_RESPOSTA = ['estado', 'preco_digitado', 'base', 'emb_unidades', 'emb_gramas', 'emb_ml', 'preco_convertido', 'tenho_so',
  'similar_desc', 'similar_preco', 'a_partir_de', 'marca_informada', 'confirmado_pelo_vendedor', 'avisos_vendedor'].sort()
const CHAVES_GERAIS = ['pagamento', 'validade', 'pedido_minimo', 'frete', 'entrega', 'observacao'].sort()
const PROIBIDO = /ref_|avisos_ivan|custo|qtd_sugerida|whatsapp|produto_id|origem|5511900000001|item_semana/

const INVALIDO = { ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' }
const FORMATO = 'Não consegui ler o envio. Se não funcionar, responda pelo WhatsApp com o número do item e o preço.'
const LIMITE_RESP = 'Muitos envios nesta cotação. Se precisar corrigir algo, responda pelo WhatsApp com o número do item e o preço.'

const chaves = (o: object) => Object.keys(o).sort()

describe('cotacao_abrir: o que o vendedor recebe', () => {
  it('lista branca de chaves (sem referência, avisos do Ivan, custo, sugerido, telefone, produto nem origem)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator, fator_confirmado_em, descricao_fornecedor,
                     codigo_fornecedor, descricao_de_fornecedor, nota_vendedor)
                   values (101, ${V_FULANO}, 'seed', 'fardo', 12, '2026-10-01T03:00:00Z', 'AGUA MIN S/GAS 500ML', '7890001',
                     'FORNECEDOR A LTDA', 'fardo c/12')`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const { codigo } = await congelar(db, f)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' })],
      { rev_lida: 0, pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 0, frete: null, entrega: 'dia seguinte', observacao: null })
    await fixarRelogio(db, '2026-10-19T19:10:00Z')
    const a = await abrir(db, codigo)
    expect(chaves(a)).toEqual(CHAVES_ABRIR)
    for (const it of a.itens) {
      expect(chaves(it)).toEqual(CHAVES_ITEM)
      expect(chaves(it.resposta)).toEqual(CHAVES_RESPOSTA)
    }
    expect(chaves(a.gerais)).toEqual(CHAVES_GERAIS)
    expect(JSON.stringify(a)).not.toMatch(PROIBIDO)
    expect(a).toMatchObject({
      ok: true, estado: 'aberta', texto: null, loja: 'Spazio Gourmet', vendedor_nome: 'Fulano', versao: 1, complementar: false,
      substitui_versao: null, prazo: '2026-10-20T15:00:00.000000Z', fechamento: '2026-10-20T20:00:00.000000Z',
      agora: '2026-10-19T19:10:00.000000Z', prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00',
      agora_local: '2026-10-19 16:10', segundos_para_fechar: 89400, gerais_rev: 1, nova: null,
      gerais: { pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 0, frete: null, entrega: 'dia seguinte', observacao: null },
      validade_opcoes: [
        { data: '2026-10-19', rotulo: 'hoje 19/10' }, { data: '2026-10-20', rotulo: 'amanhã 20/10' },
        { data: '2026-10-21', rotulo: 'qua 21/10' }, { data: '2026-10-23', rotulo: 'sex 23/10' }],
    })
    expect(a.itens.map((i: { numero: number }) => i.numero)).toEqual([1, 2, 3, 4])
    expect(a.itens[0]).toEqual({
      numero: 1, nome: 'ÁGUA MINERAL 500ML', nota: 'fardo c/12', qtd: 60, unidade: 'un', rotulo: 'un', vende_por_litro: false,
      embalagem: 'fardo', fator: 12, kg_por_litro: null, descricao_fornecedor: 'AGUA MIN S/GAS 500ML', codigo_fornecedor: '7890001',
      resposta: { estado: 'tem', preco_digitado: 31.5, base: 'embalagem', emb_unidades: 12, emb_gramas: null, emb_ml: null,
        preco_convertido: 2.625, tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null,
        marca_informada: 'Marca A', confirmado_pelo_vendedor: false, avisos_vendedor: [] },
      rev: 1,
    })
    // estado ≠ aberta: mesmas chaves, sem itens nem condições
    await fixarRelogio(db, '2026-10-20T20:00:00Z')
    const e = await abrir(db, codigo)
    expect(chaves(e)).toEqual(CHAVES_ABRIR)
    expect(e).toMatchObject({ ok: true, estado: 'encerrada', itens: [], gerais: null, gerais_rev: 0, validade_opcoes: [], nova: null,
      segundos_para_fechar: 0, texto: 'Cotação encerrada às 17h de ter 20/10. Obrigado!' })
  })

  it('só itens marcados; descrição e código só do fornecedor deste vendedor; kg por litro só confirmado', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, descricao_fornecedor, codigo_fornecedor, descricao_de_fornecedor,
                     vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em) values
                     (102, ${V_FULANO}, 'seed', 'REFRIG LT', '77', 'FORNECEDOR B LTDA', false, null, null),
                     (104, ${V_FULANO}, 'seed', null, null, null, true, 1.03, null)`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f, 103)])
    const { codigo } = await congelar(db, f)
    const a = await abrir(db, codigo)
    expect(a.itens.map((i: { nome: string }) => i.nome)).toEqual(['ÁGUA MINERAL 500ML', 'REFRIGERANTE LATA 350 ML', 'LEITE INTEGRAL'])
    expect(a.itens[1]).toMatchObject({ descricao_fornecedor: null, codigo_fornecedor: null })
    expect(a.itens[2]).toMatchObject({ numero: 3, unidade: 'kg', vende_por_litro: true, kg_por_litro: null })
  })

  it('não-prévia: 1º acesso grava e pronta → enviada; prévia não grava nem muda status (e devolve o mesmo)', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    const p = await abrir(db, codigo, true, ADMIN)
    expect(await cotacao(db, id)).toMatchObject({ status: 'pronta', primeiro_acesso: null, acessos: 0, enviada_em: null })
    await fixarRelogio(db, '2026-10-19T18:30:00Z')
    const a = await abrir(db, codigo)
    expect({ ...a, agora: null, agora_local: null, segundos_para_fechar: null })
      .toEqual({ ...p, agora: null, agora_local: null, segundos_para_fechar: null })
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'enviada', acessos: 1 })
    expect(new Date(c.primeiro_acesso).toISOString()).toBe('2026-10-19T18:30:00.000Z')
    expect(new Date(c.enviada_em).toISOString()).toBe('2026-10-19T18:30:00.000Z')
    await fixarRelogio(db, '2026-10-19T18:40:00Z')
    await abrir(db, codigo)
    const c2 = await cotacao(db, id)
    expect(c2.acessos).toBe(2)
    expect(new Date(c2.primeiro_acesso).toISOString()).toBe('2026-10-19T18:30:00.000Z')
    expect(new Date(c2.ultimo_acesso).toISOString()).toBe('2026-10-19T18:40:00.000Z')
    expect(new Date(c2.enviada_em).toISOString()).toBe('2026-10-19T18:30:00.000Z')
  })

  it('formato inválido: não busca cotação, conta só no balde de inválidos', async () => {
    const db = await banco()
    const { id } = await prontaDoFulano(db)
    const antes = await cotacao(db, id)
    for (const c of [null, '', 'curto', 'x'.repeat(33), 'a'.repeat(31) + '!', ' '.repeat(32)]) {
      expect(await abrir(db, c)).toEqual(INVALIDO)
    }
    expect(await cotacao(db, id)).toEqual(antes)
    const l = await db.query<Json>(`select balde, chamadas from cot_limites order by balde`)
    expect(l.rows).toEqual([{ balde: 'invalidos', chamadas: 6 }])
  })

  it('código no formato e inexistente conta nos inválidos; código válido nunca toca esse balde', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    expect(await abrir(db, 'A'.repeat(32))).toEqual(INVALIDO)
    await abrir(db, codigo)
    await abrir(db, codigo, true)
    const l = await db.query<Json>(`select balde, chamadas from cot_limites order by balde`)
    expect(l.rows).toEqual([{ balde: 'invalidos', chamadas: 1 }, { balde: 'validos', chamadas: 2 }])
  })

  it('120 aberturas por hora por cotação (a prévia conta); passada a hora, abre de novo', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    expect(await muitas(db, 'anon', 119, 'cotacao_abrir($1, false)', [codigo])).toEqual({ ok: 119 })
    expect((await abrir(db, codigo, true)).ok).toBe(true)
    expect(await abrir(db, codigo)).toEqual({ ok: false, erro: 'limite', texto: 'Muitas aberturas seguidas; tente em alguns minutos.' })
    expect(await abrir(db, codigo, true)).toMatchObject({ ok: false, erro: 'limite' })
    await fixarRelogio(db, '2026-10-19T18:59:59Z')
    expect((await abrir(db, codigo)).erro).toBe('limite')
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    expect((await abrir(db, codigo)).ok).toBe(true)
  })

  it('balde global de válidos (3.000/min) cheio → limite; no minuto seguinte, abre', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    await db.exec(`insert into cot_limites (balde, janela_inicio, chamadas) values ('validos', '2026-10-19T18:00:00Z', 3000)`)
    expect(await abrir(db, codigo)).toEqual({ ok: false, erro: 'limite', texto: 'Muitas aberturas seguidas; tente em alguns minutos.' })
    await fixarRelogio(db, '2026-10-19T18:01:00Z')
    expect((await abrir(db, codigo)).ok).toBe(true)
  })

  it('estados efetivos (5.4) com os textos exatos', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    const cod1 = (await congelar(db, f1)).codigo
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const codB = (await congelar(db, b)).codigo
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    expect((await abrir(db, cod1)).estado).toBe('aberta')
    // Beltrano dispensado às 10h15 de ter
    await fixarRelogio(db, '2026-10-20T13:15:00Z')
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b])
    expect(await abrir(db, codB)).toMatchObject({ estado: 'encerrada_pelo_ivan', texto: 'Cotação encerrada pelo Ivan em 20/10 às 10h15. Obrigado!', itens: [] })
    // v2 do Fulano: a v1 leva à v2
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    const cod2 = (await congelar(db, f2)).codigo
    expect(await abrir(db, cod1)).toMatchObject({ estado: 'substituida', texto: 'Esta cotação foi atualizada (v2)', nova: { versao: 2, codigo: cod2 } })
    // a v2 sem código (expirado ou apagado) → o link da v1 não leva a lugar nenhum
    await db.exec(`delete from cot_codigos where cotacao_id = ${f2}`)
    expect(await abrir(db, cod1)).toMatchObject({ ok: true, estado: 'codigo_invalido', texto: INVALIDO.texto, nova: null })
    await db.exec(`insert into cot_codigos (cotacao_id, codigo) values (${f2}, '${cod2}')`)
    // pedido na v2 → v1 e v2 dizem "pedido confirmado"
    await responder(db, cod2, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f2, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    const PEDIDO = { estado: 'pedido_confirmado', texto: 'O Ivan já confirmou o pedido com você pelo WhatsApp. Obrigado!' }
    expect(await abrir(db, cod2)).toMatchObject(PEDIDO)
    expect(await abrir(db, cod1)).toMatchObject(PEDIDO)
  })

  it('estados efetivos: cancelada (inclusive pela versão nova cancelada), dispensada pela cadeia, encerrada, fechada', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    const cod2 = (await congelar(db, v2)).codigo
    await chamar(db, ADMIN, 'cot_cancelar($1)', [v2])
    const CANCELADA = { ok: true, estado: 'cancelada', texto: 'Esta cotação foi cancelada pelo Ivan.', nova: null, itens: [] }
    expect(await abrir(db, cod2)).toMatchObject(CANCELADA)
    expect(await abrir(db, codigo)).toMatchObject(CANCELADA)
    // cadeia até uma dispensada
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const codB = (await congelar(db, b)).codigo
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    const b2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [b])
    await congelar(db, b2)
    await fixarRelogio(db, '2026-10-20T12:07:00Z')
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b2])
    expect(await abrir(db, codB)).toMatchObject({ estado: 'encerrada_pelo_ivan', texto: 'Cotação encerrada pelo Ivan em 20/10 às 9h07. Obrigado!' })
    // viva depois do fechamento e fechada sem resultado → encerrada (hora do fechamento)
    await preparar(db, semana)
    const f3 = await cotacaoDe(db, semana, V_FULANO)
    const cod3 = (await congelar(db, f3)).codigo
    await fixarRelogio(db, '2026-10-21T21:00:00Z')
    const ENC = { estado: 'encerrada', texto: 'Cotação encerrada às 17h de qua 21/10. Obrigado!' }
    expect(await abrir(db, cod3)).toMatchObject(ENC)
    await db.exec(`update cot_cotacoes set status = 'fechada', fechada_em = now() where id = ${f3}`)
    expect(await abrir(db, cod3)).toMatchObject(ENC)
  })

  it('o admin logado também abre (prévia do App)', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    expect((await abrir(db, codigo, true, ADMIN)).estado).toBe('aberta')
    expect((await abrir(db, codigo, true, JOAO)).estado).toBe('aberta')
  })
})

describe('cotacao_responder: aceite, idempotência e concorrência', () => {
  it('aceita pronta (vira respondida, com enviada_em), enviada e respondida; formato exato da resposta', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await fixarRelogio(db, '2026-10-19T19:12:03Z')
    const envio = randomUUID()
    const r = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: ' Marca A ' }),
      resp(3, 0, 'nao_tem')], { rev_lida: 0, pagamento: 'Pix', validade: '2026-10-21', pedido_minimo: null, frete: 15, entrega: 'dia seguinte',
      observacao: 'Entrego até 10h.\nLigue antes.' }, envio)
    expect(chaves(r)).toEqual(['gerais', 'itens', 'ok', 'recebido_em', 'reenvio'])
    expect(r).toMatchObject({ ok: true, reenvio: false, recebido_em: '2026-10-19T19:12:03.000000Z' })
    expect(r.itens[0]).toEqual({ numero: 1, resultado: 'gravado', rev: 1, erro: null, avisos_vendedor: [],
      valor_atual: { estado: 'tem', preco_digitado: 31.5, base: 'embalagem', emb_unidades: 12, emb_gramas: null, emb_ml: null,
        preco_convertido: 2.625, tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null, marca_informada: 'Marca A',
        confirmado_pelo_vendedor: false, avisos_vendedor: [] } })
    expect(r.itens[1]).toMatchObject({ numero: 3, resultado: 'gravado', rev: 1, erro: null, valor_atual: { estado: 'nao_tem', marca_informada: null } })
    expect(r.gerais).toEqual({ resultado: 'gravado', rev: 1, erro: null, valor_atual: { pagamento: 'Pix', validade: '2026-10-21',
      pedido_minimo: null, frete: 15, entrega: 'dia seguinte', observacao: 'Entrego até 10h.\nLigue antes.' } })
    expect(JSON.stringify(r)).not.toMatch(PROIBIDO)
    const c = await cotacao(db, id)
    expect(c).toMatchObject({ status: 'respondida', envios_aceitos: 1, respostas_rev: 2, gerais_rev: 1, gerais_origem: 'vendedor' })
    expect(new Date(c.enviada_em).toISOString()).toBe('2026-10-19T19:12:03.000Z')
    const x = await linhaItem(db, id, 101)
    expect(x).toMatchObject({ origem: 'vendedor', marca_informada: 'Marca A', rev: 1 })
    expect(new Date(x.respondido_em).toISOString()).toBe('2026-10-19T19:12:03.000Z')
    const e = await db.query<Json>('select origem, cotacao_id from cot_envios where envio_id = $1', [envio])
    expect(e.rows[0]).toEqual({ origem: 'vendedor', cotacao_id: id })
    // enviada e respondida também aceitam
    await fixarRelogio(db, '2026-10-19T19:13:00Z')
    expect((await responder(db, codigo, [resp(2, 0, 'nao_tem')])).ok).toBe(true)
  })

  it('aceita até 17:04:59 e recusa às 17:05:00 (depois do fechamento o estado é "encerrada")', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await fixarRelogio(db, '2026-10-20T20:04:59Z')
    expect((await responder(db, codigo, [resp(1, 0, 'nao_tem')])).ok).toBe(true)
    await fixarRelogio(db, '2026-10-20T20:05:00Z')
    expect(await responder(db, codigo, [resp(2, 0, 'nao_tem')])).toEqual({ ok: false, erro: 'estado', estado: 'encerrada',
      texto: 'Cotação encerrada às 17h de ter 20/10. Obrigado!', nova: null })
    expect((await cotacao(db, id)).respostas_rev).toBe(1)
  })

  it('envio_id repetido devolve o mesmo resultado, mesmo depois do fechamento e de nova versão; de outra cotação → erro', async () => {
    const db = await banco()
    const { semana, id, codigo } = await prontaDoFulano(db)
    const envio = randomUUID()
    const r1 = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })], null, envio)
    await fixarRelogio(db, '2026-10-19T18:00:10Z')
    const r2 = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 9, base: 'un' })], null, envio)
    expect(r2).toEqual({ ...r1, reenvio: true })
    expect((await linhaItem(db, id, 101)).preco_digitado).toBe('2.50')
    const v2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [id])
    await congelar(db, v2)
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    expect(await responder(db, codigo, [resp(1, 0, 'tem', { preco: 9, base: 'un' })], null, envio)).toEqual({ ...r1, reenvio: true })
    // o mesmo envio_id pela página de outra cotação
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    const codB = (await congelar(db, b)).codigo
    expect(await responder(db, codB, [resp(1, 0, 'nao_tem')], null, envio)).toEqual({ ok: false, erro: 'envio_de_outra_cotacao', texto: FORMATO })
  })

  it('dois envios seguidos na mesma sessão, usando o rev devolvido, sem conflito', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    const r1 = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' }), resp(2, 0, 'nao_tem')],
      { rev_lida: 0, pagamento: 'Pix' })
    await fixarRelogio(db, '2026-10-19T18:00:03Z')
    const r2 = await responder(db, codigo, [resp(1, r1.itens[0].rev, 'tem', { preco: 2.4, base: 'un' }), resp(2, r1.itens[1].rev, 'tem', { preco: 3, base: 'un' })],
      { rev_lida: r1.gerais.rev, pagamento: 'boleto' })
    expect(r2.itens.map((i: { resultado: string; rev: number }) => [i.resultado, i.rev])).toEqual([['gravado', 2], ['gravado', 2]])
    expect([r2.gerais.resultado, r2.gerais.rev]).toEqual(['gravado', 2])
  })

  it('conflito por item: o Ivan grava (rev 1), o vendedor manda rev_lida 0 → só esse item volta, os outros gravam', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await responderAdmin(db, id, [resp(2, 0, 'tem', { preco: 3.1, base: 'un' })], { rev_lida: 0, pagamento: 'boleto' }, 'ivan_colou')
    const r = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' }), resp(2, 0, 'tem', { preco: 2.9, base: 'un' })],
      { rev_lida: 0, pagamento: 'Pix' })
    expect(r.itens[0]).toMatchObject({ resultado: 'gravado', rev: 1 })
    expect(r.itens[1]).toMatchObject({ numero: 2, resultado: 'conflito', rev: 1, erro: null, valor_atual: { estado: 'tem', preco_digitado: 3.1 } })
    expect(r.gerais).toEqual({ resultado: 'conflito', rev: 1, erro: null, valor_atual: { pagamento: 'boleto', validade: null,
      pedido_minimo: null, frete: null, entrega: null, observacao: null } })
    expect((await linhaItem(db, id, 102)).origem).toBe('ivan_colou')
  })

  it('só conflito ou erro: o envio é aceito, mas a cotação não vira respondida (D24)', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    const r = await responder(db, codigo, [resp(99, 0, 'nao_tem'), resp(1, 5, 'nao_tem')])
    expect(r.itens).toEqual([
      { numero: 99, resultado: 'erro', rev: null, valor_atual: null, avisos_vendedor: [], erro: 'numero_inexistente' },
      expect.objectContaining({ numero: 1, resultado: 'conflito', rev: 0 }),
    ])
    expect(await cotacao(db, id)).toMatchObject({ status: 'enviada', envios_aceitos: 1, respostas_rev: 0 })
  })

  it('número de item desmarcado não existe para o vendedor', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f, 104)])
    const { codigo } = await congelar(db, f)
    const r = await responder(db, codigo, [resp(4, 0, 'nao_tem')])
    expect(r.itens[0].erro).toBe('numero_inexistente')
  })
})

describe('cotacao_responder: validação (3.10) e formato', () => {
  const casos: [string, object, string][] = [
    ['tem sem preço', resp(1, 0, 'tem', { base: 'un' }), 'sem_preco'],
    ['tem sem base', resp(1, 0, 'tem', { preco: 2 }), 'base_incompativel'],
    ['un cotado por kg', resp(1, 0, 'tem', { preco: 2, base: 'kg' }), 'base_incompativel'],
    ['un cotado por litro', resp(1, 0, 'tem', { preco: 2, base: 'litro' }), 'base_incompativel'],
    ['kg cotado por un', resp(3, 0, 'tem', { preco: 2, base: 'un' }), 'base_incompativel'],
    ['base inventada', resp(1, 0, 'tem', { preco: 2, base: 'duzia' }), 'base_incompativel'],
    ['embalagem de un em gramas', resp(1, 0, 'tem', { preco: 2, base: 'embalagem', emb_gramas: 500 }), 'base_incompativel'],
    ['embalagem de kg em unidades', resp(3, 0, 'tem', { preco: 2, base: 'embalagem', emb_unidades: 6 }), 'base_incompativel'],
    ['gramas e ml juntos', resp(3, 0, 'tem', { preco: 2, base: 'embalagem', emb_gramas: 500, emb_ml: 500 }), 'base_incompativel'],
    ['embalagem com base kg', resp(3, 0, 'tem', { preco: 2, base: 'kg', emb_gramas: 500 }), 'base_incompativel'],
    ['embalagem de un sem quantidade', resp(1, 0, 'tem', { preco: 2, base: 'embalagem' }), 'sem_embalagem'],
    ['embalagem de kg sem gramas nem ml', resp(3, 0, 'tem', { preco: 2, base: 'embalagem' }), 'sem_embalagem'],
    ['preço com 3 casas', resp(1, 0, 'tem', { preco: 2.555, base: 'un' }), 'valor_invalido'],
    ['preço zero', resp(1, 0, 'tem', { preco: 0, base: 'un' }), 'valor_invalido'],
    ['preço acima de 1.000.000', resp(1, 0, 'tem', { preco: 1000000.01, base: 'un' }), 'valor_invalido'],
    ['preço em texto', resp(1, 0, 'tem', { preco: '2,50', base: 'un' }), 'valor_invalido'],
    ['emb_unidades fracionado', resp(1, 0, 'tem', { preco: 2, base: 'embalagem', emb_unidades: 1.5 }), 'valor_invalido'],
    ['emb_unidades 10.001', resp(1, 0, 'tem', { preco: 2, base: 'embalagem', emb_unidades: 10001 }), 'valor_invalido'],
    ['emb_gramas 0,5', resp(3, 0, 'tem', { preco: 2, base: 'embalagem', emb_gramas: 0.5 }), 'valor_invalido'],
    ['emb_gramas 100.001', resp(3, 0, 'tem', { preco: 2, base: 'embalagem', emb_gramas: 100001 }), 'valor_invalido'],
    ['emb_ml 100.001', resp(3, 0, 'tem', { preco: 2, base: 'embalagem', emb_ml: 100001 }), 'valor_invalido'],
    ['tenho_so zero', resp(1, 0, 'tem', { preco: 2, base: 'un', tenho_so: 0 }), 'valor_invalido'],
    ['a_partir_de acima do teto', resp(1, 0, 'tem', { preco: 2, base: 'un', a_partir_de: 1000001 }), 'valor_invalido'],
    ['similar_preco com 3 casas', resp(1, 0, 'nao_tem', { similar_desc: 'x', similar_preco: 1.234 }), 'valor_invalido'],
    ['similar com 201 caracteres', resp(1, 0, 'nao_tem', { similar_desc: 'x'.repeat(201) }), 'texto_invalido'],
    ['similar com caractere de controle', resp(1, 0, 'nao_tem', { similar_desc: 'lata\u0007' }), 'texto_invalido'],
    ['similar que não é texto', resp(1, 0, 'nao_tem', { similar_desc: 12 }), 'texto_invalido'],
    ['marca com 61 caracteres', resp(1, 0, 'tem', { preco: 2, base: 'un', marca: 'm'.repeat(61) }), 'texto_invalido'],
    ['marca com quebra de linha', resp(1, 0, 'tem', { preco: 2, base: 'un', marca: 'Marca\nA' }), 'texto_invalido'],
    ['marca que não é texto', resp(1, 0, 'tem', { preco: 2, base: 'un', marca: 7 }), 'texto_invalido'],
    ['marca com "não tem"', resp(1, 0, 'nao_tem', { marca: 'Marca A' }), 'valor_invalido'],
    ['preço com "não tem"', resp(1, 0, 'nao_tem', { preco: 2 }), 'valor_invalido'],
    ['preço com "sem resposta"', resp(1, 0, 'sem_resposta', { preco: 2 }), 'valor_invalido'],
    ['marca com "sem resposta"', resp(1, 0, 'sem_resposta', { marca: 'Marca A' }), 'valor_invalido'],
    ['confirmado que não é booleano', resp(1, 0, 'tem', { preco: 2, base: 'un', confirmado: 'sim' }), 'valor_invalido'],
  ]

  it.each(casos)('%s', async (_nome, it_, erro) => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    const r = await responder(db, codigo, [it_])
    expect(r.ok).toBe(true)
    expect(r.itens[0]).toMatchObject({ resultado: 'erro', erro, rev: 0 })
    expect(r.itens[0].valor_atual).toMatchObject({ estado: 'sem_resposta' })
    expect((await cotacao(db, id)).respostas_rev).toBe(0)
  })

  it('limites que passam: 1.000.000 com 2 casas, marca de 60, similar de 200, emb 10.000 un e 100.000 g', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    const r = await responder(db, codigo, [
      resp(1, 0, 'tem', { preco: 1000000, base: 'embalagem', emb_unidades: 10000, marca: 'm'.repeat(60), confirmado: true }),
      resp(2, 0, 'nao_tem', { similar_desc: 's'.repeat(200), similar_preco: 0.01 }),
      resp(3, 0, 'tem', { preco: 99.99, base: 'embalagem', emb_gramas: 100000 }),
      resp(4, 0, 'tem', { preco: 0.01, base: 'kg', tenho_so: 1000000, a_partir_de: 0.001 }),
    ])
    expect(r.itens.map((i: { resultado: string }) => i.resultado)).toEqual(['gravado', 'gravado', 'gravado', 'gravado'])
  })

  it('"sem resposta" limpa o item, inclusive a marca (D25); "não tem" aceita similar', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un', marca: 'Marca A', tenho_so: 10 })])
    await fixarRelogio(db, '2026-10-19T18:00:05Z')
    const r = await responder(db, codigo, [resp(1, 1, 'sem_resposta'), resp(2, 0, 'nao_tem', { similar_desc: 'lata 310 ml', similar_preco: 2.8 })])
    expect(r.itens[0]).toMatchObject({ resultado: 'gravado', rev: 2 })
    const x = await linhaItem(db, id, 101)
    expect(x).toMatchObject({ estado: 'sem_resposta', preco_digitado: null, base: null, marca_informada: null, tenho_so: null,
      preco_convertido: null, origem: null, respondido_em: null, avisos_ivan: [], avisos_vendedor: [] })
    expect(await linhaItem(db, id, 102)).toMatchObject({ estado: 'nao_tem', similar_desc: 'lata 310 ml', avisos_ivan: ['similar'] })
    // texto vazio depois do trim vale como ausente (contrato 1.2), também no "sem resposta"
    await fixarRelogio(db, '2026-10-19T18:00:10Z')
    const r2 = await responder(db, codigo, [resp(1, 2, 'sem_resposta', { similar_desc: '  ', marca: '' }),
      resp(3, 0, 'tem', { preco: 5, base: 'kg', marca: '   ', similar_desc: '' })])
    expect(r2.itens.map((i: Json) => i.resultado)).toEqual(['gravado', 'gravado'])
    expect(await linhaItem(db, id, 103)).toMatchObject({ marca_informada: null, similar_desc: null, avisos_ivan: [] })
  })

  it('condições gerais: textos, validade entre hoje e hoje + 366, mínimo e frete ≥ 0 com 2 casas', async () => {
    const db = await banco()
    const { codigo } = await prontaDoFulano(db)
    const g = async (gerais: object, seg: number) => {
      await fixarRelogio(db, `2026-10-19T18:${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}Z`)
      return (await responder(db, codigo, [], { rev_lida: 0, ...gerais })).gerais
    }
    let s = 0
    for (const [gerais, erro] of [
      [{ validade: '2026-10-18' }, 'valor_invalido'],
      [{ validade: '2027-10-21' }, 'valor_invalido'],
      [{ validade: '2026-02-30' }, 'valor_invalido'],
      [{ validade: '21/10/2026' }, 'valor_invalido'],
      [{ validade: 20261021 }, 'valor_invalido'],
      [{ pedido_minimo: -1 }, 'valor_invalido'],
      [{ frete: 1.005 }, 'valor_invalido'],
      [{ frete: '15' }, 'valor_invalido'],
      [{ pedido_minimo: 1000000.01 }, 'valor_invalido'],
      [{ pagamento: 'p'.repeat(201) }, 'texto_invalido'],
      [{ pagamento: 'Pix\nboleto' }, 'texto_invalido'],
      [{ entrega: 5 }, 'texto_invalido'],
      [{ observacao: 'o'.repeat(1001) }, 'texto_invalido'],
      [{ observacao: 'tab\taqui' }, 'texto_invalido'],
    ] as [object, string][]) {
      s += 4
      expect([gerais, await g(gerais, s)]).toEqual([gerais, expect.objectContaining({ resultado: 'erro', erro, rev: 0 })])
    }
    s += 4
    const ok = await g({ validade: '2027-10-20', pedido_minimo: 0, frete: 0, observacao: 'linha 1\r\nlinha 2', pagamento: '  ' }, s)
    expect(ok).toMatchObject({ resultado: 'gravado', rev: 1, valor_atual: { validade: '2027-10-20', pedido_minimo: 0, frete: 0,
      observacao: 'linha 1\r\nlinha 2', pagamento: null } })
  })

  it('formato do envio: cada problema → "formato", nada gravado', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    const chamarBruto = async (envio: string | null, itens: string | null, gerais: string | null) => {
      const [r] = await como(db, 'anon', 'select cotacao_responder($1, $2, $3::jsonb, $4::jsonb) as r', [codigo, envio, itens, gerais])
      return r.r
    }
    const u = () => randomUUID()
    const muitos = JSON.stringify(Array.from({ length: 101 }, (_, i) => resp(i + 1, 0, 'nao_tem')))
    for (const [envio, itens, gerais] of [
      [null, '[]', '{"rev_lida":0}'],
      [u(), '{"numero":1}', null],
      [u(), null, '{"rev_lida":0}'],
      [u(), muitos, null],
      [u(), '[1]', null],
      [u(), '[{"numero":1.5,"rev_lida":0,"estado":"nao_tem"}]', null],
      [u(), '[{"numero":"1","rev_lida":0,"estado":"nao_tem"}]', null],
      [u(), '[{"numero":0,"rev_lida":0,"estado":"nao_tem"}]', null],
      [u(), '[{"numero":1,"rev_lida":-1,"estado":"nao_tem"}]', null],
      [u(), '[{"numero":1,"estado":"nao_tem"}]', null],
      [u(), '[{"numero":1,"rev_lida":0,"estado":"talvez"}]', null],
      [u(), '[{"numero":1,"rev_lida":0,"estado":"nao_tem"},{"numero":1,"rev_lida":0,"estado":"nao_tem"}]', null],
      [u(), '[]', '{"pagamento":"Pix"}'],
      [u(), '[]', '[1]'],
      [u(), '[]', null], // D29: envio vazio
    ] as [string | null, string | null, string | null][]) {
      expect([itens, gerais, await chamarBruto(envio, itens, gerais)]).toEqual([itens, gerais, { ok: false, erro: 'formato', texto: FORMATO }])
    }
    expect(await cotacao(db, id)).toMatchObject({ envios_aceitos: 0, respostas_rev: 0, gerais_rev: 0, status: 'pronta' })
    expect((await db.query<Json>('select count(*)::int as n from cot_envios')).rows[0].n).toBe(0)
  })

  it('código inválido ou fora do formato → codigo_invalido, sem tocar cotação', async () => {
    const db = await banco()
    await prontaDoFulano(db)
    expect(await responder(db, 'nao-e-um-codigo', [resp(1, 0, 'nao_tem')])).toEqual(INVALIDO)
    expect(await responder(db, 'B'.repeat(32), [resp(1, 0, 'nao_tem')])).toEqual(INVALIDO)
  })
})

describe('cotacao_responder: limites da cotação', () => {
  it('60 envios aceitos por código → limite; 1 envio a cada 3 s → devagar (a página tenta de novo com o mesmo envio_id)', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    const envio = randomUUID()
    await responder(db, codigo, [resp(1, 0, 'nao_tem')])
    await fixarRelogio(db, '2026-10-19T18:00:02Z')
    expect(await responder(db, codigo, [resp(2, 0, 'nao_tem')], null, envio)).toEqual({ ok: false, erro: 'devagar', texto: 'Aguarde alguns segundos.', espera_s: 3 })
    await fixarRelogio(db, '2026-10-19T18:00:03Z')
    expect((await responder(db, codigo, [resp(2, 0, 'nao_tem')], null, envio)).ok).toBe(true)
    await db.exec(`update cot_cotacoes set envios_aceitos = 59 where id = ${id}`)
    await fixarRelogio(db, '2026-10-19T18:00:06Z')
    expect((await responder(db, codigo, [resp(3, 0, 'nao_tem')])).ok).toBe(true)
    await fixarRelogio(db, '2026-10-19T18:00:09Z')
    expect(await responder(db, codigo, [resp(4, 0, 'nao_tem')])).toEqual({ ok: false, erro: 'limite', texto: LIMITE_RESP })
    expect((await cotacao(db, id)).envios_aceitos).toBe(60)
  })

  it('200 tentativas por hora, contando recusadas e reenvios; passada a hora, volta', async () => {
    const db = await banco()
    const { id, codigo } = await prontaDoFulano(db)
    const itens = JSON.stringify([resp(1, 0, 'nao_tem')])
    const envio = randomUUID()
    // a 1ª é aceita; as outras 199 (mesmo envio_id: reenvio) contam como tentativas
    expect(await muitas(db, 'anon', 200, `cotacao_responder($1, $2::uuid, $3::jsonb, null)`, [codigo, envio, itens])).toEqual({ ok: 200 })
    expect((await cotacao(db, id)).tentativas_na_janela).toBe(200)
    expect(await responder(db, codigo, [resp(1, 0, 'nao_tem')], null, envio)).toEqual({ ok: false, erro: 'limite', texto: LIMITE_RESP })
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    expect(await responder(db, codigo, [resp(1, 0, 'nao_tem')], null, envio)).toMatchObject({ ok: true, reenvio: true })
    expect((await cotacao(db, id)).envios_aceitos).toBe(1)
  })
})

describe('conversão e avisos (7.3.8)', () => {
  /** Banco limpo, semana aprovada com `sql` aplicado ao catálogo e a cotação do Fulano congelada. */
  async function comCatalogo(sql: string) {
    const db = await banco()
    await limpar(db)
    await semearCotacao(db)
    const semana = await aprovar(db)
    await db.exec(sql)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const { codigo } = await congelar(db, f)
    return { db, id: f, codigo }
  }

  it('R$ 31,50 fardo c/6 → 5,2500/un; R$ 12,40 pacote de 400 g → 31,0000/kg', async () => {
    const { db, id, codigo } = await comCatalogo('select 1')
    const r = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 6 }),
      resp(3, 0, 'tem', { preco: 12.4, base: 'embalagem', emb_gramas: 400 })])
    expect(r.itens.map((i: any) => i.valor_atual.preco_convertido)).toEqual([5.25, 31])
    expect((await linhaItem(db, id, 101)).fator_informado).toBe('6')
    expect((await linhaItem(db, id, 103)).fator_informado).toBe('0.4')
    expect((await linhaItem(db, id, 103)).preco_convertido).toBe('31.0000')
  })

  it('"pacote 500 g" contra fator confirmado 0,5 → sem fator_diferente; "pacote 1 kg" → fator_diferente', async () => {
    const { db, id, codigo } = await comCatalogo(`insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator, fator_confirmado_em)
      values (103, ${V_FULANO}, 'seed', 'pacote', 0.5, '2026-10-01T03:00:00Z')`)
    const r = await responder(db, codigo, [resp(3, 0, 'tem', { preco: 2.5, base: 'embalagem', emb_gramas: 500 })])
    expect(r.itens[0].avisos_vendedor).toEqual([])
    expect((await linhaItem(db, id, 103)).avisos_ivan).toEqual([])
    await fixarRelogio(db, '2026-10-19T18:00:03Z')
    const r2 = await responder(db, codigo, [resp(3, 1, 'tem', { preco: 5, base: 'embalagem', emb_gramas: 1000 })])
    expect(r2.itens[0].avisos_vendedor).toEqual(['fator_diferente'])
    expect((await linhaItem(db, id, 103)).avisos_ivan).toEqual(['fator_nao_confirmado'])
    // "Está certo": confirmado limpa o aviso do vendedor para aquele valor
    await fixarRelogio(db, '2026-10-19T18:00:06Z')
    const r3 = await responder(db, codigo, [resp(3, 2, 'tem', { preco: 5, base: 'embalagem', emb_gramas: 1000, confirmado: true })])
    expect(r3.itens[0]).toMatchObject({ avisos_vendedor: [], valor_atual: { confirmado_pelo_vendedor: true, avisos_vendedor: [] } })
  })

  it('preço por litro sem kg por litro → convertido null + litro_sem_fator; com 1 L = 1 kg confirmado → convertido', async () => {
    const { db, id, codigo } = await comCatalogo(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro)
      values (104, null, 'seed', true)`)
    const r = await responder(db, codigo, [resp(4, 0, 'tem', { preco: 5.2, base: 'litro' })])
    expect(r.itens[0].valor_atual.preco_convertido).toBeNull()
    expect(await linhaItem(db, id, 104)).toMatchObject({ vende_por_litro: true, kg_por_litro: null, avisos_ivan: ['litro_sem_fator'] })
    await fixarRelogio(db, '2026-10-19T18:00:03Z')
    await responder(db, codigo, [resp(4, 1, 'tem', { preco: 5.2, base: 'embalagem', emb_ml: 1000 })])
    expect(await linhaItem(db, id, 104)).toMatchObject({ preco_convertido: null, fator_informado: null, avisos_ivan: ['litro_sem_fator'] })

    const outro = await comCatalogo(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em)
      values (104, null, 'seed', true, 1, '2026-09-27T03:00:00Z')`)
    const r2 = await responder(outro.db, outro.codigo, [resp(4, 0, 'tem', { preco: 5.2, base: 'litro' })])
    expect(r2.itens[0].valor_atual.preco_convertido).toBe(5.2)
    await fixarRelogio(outro.db, '2026-10-19T18:00:03Z')
    await responder(outro.db, outro.codigo, [resp(4, 1, 'tem', { preco: 6.2, base: 'embalagem', emb_ml: 1000 })])
    expect(await linhaItem(outro.db, outro.id, 104)).toMatchObject({ preco_convertido: '6.2000', kg_por_litro: '1', avisos_ivan: [] })
    // kg por litro não confirmado não vale
    const semConf = await comCatalogo(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro, kg_por_litro)
      values (104, null, 'seed', true, 1)`)
    const r3 = await responder(semConf.db, semConf.codigo, [resp(4, 0, 'tem', { preco: 5.2, base: 'litro' })])
    expect(r3.itens[0].valor_atual.preco_convertido).toBeNull()
  })

  it('avisos ao vendedor: centavos, valor alto (pelo litro quando não há conversão) e a ordem', async () => {
    const { db, codigo } = await comCatalogo('select 1')
    const r = await responder(db, codigo, [
      resp(1, 0, 'tem', { preco: 0.42, base: 'embalagem', emb_unidades: 12 }),
      resp(2, 0, 'tem', { preco: 0.42, base: 'un' }), // un a R$ 0,42: plausível, sem aviso
      resp(3, 0, 'tem', { preco: 0.9, base: 'kg' }),
      resp(4, 0, 'tem', { preco: 1707, base: 'kg' }),
    ])
    expect(r.itens.map((i: any) => i.avisos_vendedor)).toEqual([['centavos'], [], ['centavos'], ['valor_alto']])
    await fixarRelogio(db, '2026-10-19T18:00:03Z')
    const r2 = await responder(db, codigo, [resp(1, 1, 'tem', { preco: 0.5, base: 'embalagem', emb_unidades: 1 })])
    expect(r2.itens[0].avisos_vendedor).toEqual(['centavos'])
    const semConv = await comCatalogo(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro) values (104, null, 'seed', true)`)
    const r3 = await responder(semConv.db, semConv.codigo, [resp(4, 0, 'tem', { preco: 301, base: 'embalagem', emb_ml: 1000 })])
    expect(r3.itens[0].avisos_vendedor).toEqual(['valor_alto'])
  })

  it('a resposta ao vendedor é idêntica com último preço 1, 10 ou 100 (sem oráculo); os avisos do Ivan mudam', async () => {
    const { db, id, codigo } = await comCatalogo('select 1')
    const vistos: unknown[] = []
    const doIvan: unknown[] = []
    let rev = 0
    let seg = 0
    for (const ref of [1, 10, 100]) {
      await db.query<Json>('update cot_itens set ref_preco = $1 where cotacao_id = $2 and produto_id = 103', [ref, id])
      await fixarRelogio(db, `2026-10-19T18:00:${String(seg).padStart(2, '0')}Z`)
      seg += 3
      const r = await responder(db, codigo, [resp(3, rev, 'tem', { preco: 10, base: 'kg' })])
      rev = r.itens[0].rev
      vistos.push({ ...r.itens[0], rev: null, recebido_em: null })
      doIvan.push((await linhaItem(db, id, 103)).avisos_ivan)
    }
    expect(vistos[1]).toEqual(vistos[0])
    expect(vistos[2]).toEqual(vistos[0])
    expect(doIvan).toEqual([['unidade_suspeita'], [], ['unidade_suspeita']])
  })

  it('acima de R$ 500 sem referência: grava e só avisa o Ivan', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const { codigo } = await congelar(db, b)
    const r = await responder(db, codigo, [resp(1, 0, 'tem', { preco: 600, base: 'kg' })]) // 106, sem referência
    expect(r.itens[0]).toMatchObject({ resultado: 'gravado', avisos_vendedor: ['valor_alto'] })
    expect((await linhaItem(db, b, 106)).avisos_ivan).toEqual(['acima_500_sem_ref'])
  })

  it('avisos ao Ivan: parcial, similar e "a partir de"', async () => {
    const { db, id, codigo } = await comCatalogo('select 1')
    await responder(db, codigo, [
      resp(1, 0, 'tem', { preco: 2.4, base: 'un', tenho_so: 40, a_partir_de: 100, similar_desc: 'sem gás 510 ml' }),
      resp(2, 0, 'tem', { preco: 3, base: 'un', tenho_so: 48, a_partir_de: 48 }),
    ])
    expect((await linhaItem(db, id, 101)).avisos_ivan).toEqual(['parcial', 'similar', 'a_partir_de'])
    expect((await linhaItem(db, id, 102)).avisos_ivan).toEqual([])
    expect(FULANO.codigo).toBe('fulano')
  })
})
