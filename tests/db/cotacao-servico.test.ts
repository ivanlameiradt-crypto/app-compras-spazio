import { bancoPorArquivo, como } from './banco'
import { ADMIN } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, cotacao, chamar, erroDe, responder, responderAdmin, resp,
  fixarRelogio, encerrar, payloadDe, V_FULANO, V_BELTRANO, FULANO, type Json,
} from './fixture-cotacao'

// Fase 1B — funções do robô (service_role, contrato 6): coleta (com a taxa de resposta, D40), compare-and-set
// dos e-mails (D2, D3), fechamento das vencidas, reserva do consolidado (D4) e os cadastros (D5).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()
type Db = Awaited<ReturnType<typeof banco>>

const servico = async (db: Db, expr: string, params: unknown[] = []) => (await como(db, 'service', `select ${expr} as r`, params))[0].r

async function duasEnviadas(db: Db) {
  const semana = await aprovar(db)
  await preparar(db, semana)
  const f = await cotacaoDe(db, semana, V_FULANO)
  const b = await cotacaoDe(db, semana, V_BELTRANO)
  const cf = (await congelar(db, f)).codigo as string
  const cb = (await congelar(db, b)).codigo as string
  for (const id of [f, b]) await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
  return { semana, f, b, cf, cb }
}

describe('cot_coleta', () => {
  it('formato, sem telefone nem código; itens com nota, marca, referência e delta; pendentes de preparar', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await chamar(db, ADMIN, `cot_definir_nota(101, 'sem gás')`)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const cf = (await congelar(db, f)).codigo
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' })],
      { rev_lida: 0, pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 0, frete: null, entrega: 'dia seguinte', observacao: null })
    await fixarRelogio(db, '2026-10-20T15:17:00Z')
    const c = await servico(db, 'cot_coleta()')
    expect(JSON.stringify(c)).not.toContain(FULANO.whatsapp)
    expect(JSON.stringify(c)).not.toContain(cf)
    expect(Object.keys(c).sort()).toEqual(['agora', 'agora_local', 'cotacoes', 'historico', 'pendentes_preparar', 'semana_em_compra', 'semanas', 'vendedores'])
    expect(c).toMatchObject({
      agora: '2026-10-20T15:17:00.000000Z', agora_local: '2026-10-20 12:17',
      semana_em_compra: { id: semana, data_referencia: '2026-10-19', aprovada_em: '2026-10-19T11:00:00.000000Z', aguardando_ate: '2026-10-20T15:00:00.000000Z' },
      semanas: [{ id: semana, data_referencia: '2026-10-19', status: 'em_compra' }],
      pendentes_preparar: [], // às 12:17 de ter a etiqueta do Beltrano já venceu
      vendedores: [
        { id: V_FULANO, codigo: 'fulano', nome: 'Fulano', empresa: 'FORNECEDOR A (Centro)', rotulo: 'FORNECEDOR A', ativo: true },
        { id: V_BELTRANO, codigo: 'beltrano', nome: 'Beltrano', empresa: 'FORNECEDOR B (Bairro)', rotulo: 'FORNECEDOR B', ativo: true }],
      historico: [
        { vendedor_id: V_FULANO, enviadas: 1, respondidas: 1, pelo_link: 1 },
        { vendedor_id: V_BELTRANO, enviadas: 0, respondidas: 0, pelo_link: 0 }],
    })
    const cot = c.cotacoes.find((x: { id: number }) => x.id === f)
    expect(cot).toMatchObject({ semana_id: semana, vendedor_id: V_FULANO, versao: 1, complementar: false, substituida_por: null,
      status: 'respondida', resultado: null, prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00', acessos: 0,
      envios_aceitos: 1, respostas_rev: 1, notificado_hash: null, cobranca_em: null, consolidado_em: null, consolidado_rev: null,
      gerais: { pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 0, frete: null, entrega: 'dia seguinte',
        observacao: null, rev: 1, origem: 'vendedor' },
      resumo: { itens: 4, respondidos: 1, tem: 1, nao_tem: 0, parciais: 0, com_referencia: 1, total_cotado: 157.5, total_ultimo: 144,
        gerais_respondidas: true },
      pedido: null })
    expect(cot.itens).toHaveLength(4)
    expect(cot.itens[0]).toMatchObject({ numero: 1, produto_id: 101, produto: 'ÁGUA MINERAL 500ML', nome: 'ÁGUA MINERAL 500ML',
      nota_vendedor: 'sem gás', marca_informada: 'Marca A', ref_preco: 2.4, ref_data: '2026-10-09', ref_situacao: 'ok',
      delta: 0.0938, preco_convertido: 2.625, fator_informado: 12, avisos_ivan: ['fator_nao_confirmado'], origem: 'vendedor', rev: 1,
      qtd_sugerida: 60, incluido: true })
    const rasc = c.cotacoes.find((x: { vendedor_id: number }) => x.vendedor_id === V_BELTRANO)
    expect(rasc).toMatchObject({ status: 'rascunho', prazo: null, itens: [{ numero: null }, { numero: null }] })
  })

  it('pendentes_preparar: vendedores ativos com item "aguardando" (o que só tem pronta sem sinal inclusive)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    await congelar(db, await cotacaoDe(db, semana, V_FULANO))
    await fixarRelogio(db, '2026-10-19T19:17:00Z')
    const c = await servico(db, 'cot_coleta()')
    expect(c.pendentes_preparar).toEqual([
      { vendedor_id: V_FULANO, codigo: 'fulano', rotulo: 'FORNECEDOR A', empresa: 'FORNECEDOR A (Centro)', nome: 'Fulano', itens: 4 },
      { vendedor_id: V_BELTRANO, codigo: 'beltrano', rotulo: 'FORNECEDOR B', empresa: 'FORNECEDOR B (Bairro)', nome: 'Beltrano', itens: 2 }])
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [await cotacaoDe(db, semana, V_FULANO)])
    expect((await servico(db, 'cot_coleta()')).pendentes_preparar.map((x: { vendedor_id: number }) => x.vendedor_id)).toEqual([V_BELTRANO])
  })

  it('taxa de resposta: semana em que o Ivan só colou a resposta conta em "respondidas" e não em "pelo link" (D40)', async () => {
    const db = await banco()
    const { semana, f, b, cf } = await duasEnviadas(db)
    await responderAdmin(db, b, [resp(1, 0, 'nao_tem')], null, 'ivan_colou')
    await responder(db, cf, [], { rev_lida: 0, entrega: 'amanhã' })
    const c = await servico(db, 'cot_coleta($1)', [semana])
    expect(c.historico).toEqual([
      { vendedor_id: V_FULANO, enviadas: 1, respondidas: 1, pelo_link: 1 },
      { vendedor_id: V_BELTRANO, enviadas: 1, respondidas: 1, pelo_link: 0 }])
    expect(f).toBeGreaterThan(0)
  })

  it('taxa de resposta: cotação cancelada (e a versão que levaria a ela) não conta; a dispensada conta (D40)', async () => {
    const db = await banco()
    // semana 19/10, o "ensaio": as duas respondidas pelo link e depois canceladas; a do Beltrano, pela v2
    const { semana, f, b, cf, cb } = await duasEnviadas(db)
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 31.5, base: 'embalagem', emb_unidades: 12 })])
    await responder(db, cb, [], { rev_lida: 0, entrega: 'amanhã' })
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f])
    const b2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [b])
    await congelar(db, b2)
    await chamar(db, ADMIN, 'cot_cancelar($1)', [b2])
    expect([(await cotacao(db, b)).status, (await cotacao(db, b)).envios_aceitos]).toEqual(['substituida', 1])
    await encerrar(db, semana)
    // semana 26/10, a de verdade: Fulano responde por texto (o Ivan cola); Beltrano pelo link e leva "Obrigado, desta vez não"
    const s2 = await aprovar(db, payloadDe('2026-10-26'), '2026-10-26T11:00:00Z', '2026-10-26T18:00:00Z')
    await preparar(db, s2)
    const f2 = await cotacaoDe(db, s2, V_FULANO)
    const g2 = await cotacaoDe(db, s2, V_BELTRANO)
    await congelar(db, f2)
    const cg2 = (await congelar(db, g2)).codigo as string
    for (const id of [f2, g2]) await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [id])
    await responderAdmin(db, f2, [resp(1, 0, 'nao_tem')], null, 'ivan_colou')
    await responder(db, cg2, [], { rev_lida: 0, entrega: 'amanhã' })
    await chamar(db, ADMIN, 'cot_dispensar($1)', [g2])
    const esperado = [
      { vendedor_id: V_FULANO, enviadas: 1, respondidas: 1, pelo_link: 0 },
      { vendedor_id: V_BELTRANO, enviadas: 1, respondidas: 1, pelo_link: 1 }]
    expect((await servico(db, 'cot_coleta($1)', [s2])).historico).toEqual(esperado)
    expect((await servico(db, 'cot_coleta()')).historico).toEqual(esperado)
    // só com as canceladas na janela, o vendedor continua na lista, com zero
    expect((await servico(db, 'cot_coleta($1)', [semana])).historico).toEqual([
      { vendedor_id: V_FULANO, enviadas: 0, respondidas: 0, pelo_link: 0 },
      { vendedor_id: V_BELTRANO, enviadas: 0, respondidas: 0, pelo_link: 0 }])
  })

  it('escopo: sem semana → a em compra e as com fechamento há menos de 8 dias; com semana → só ela', async () => {
    const db = await banco()
    const { semana } = await duasEnviadas(db)
    await encerrar(db, semana)
    const s2 = await aprovar(db, payloadDe('2026-10-26'), '2026-10-26T11:00:00Z', '2026-10-26T18:00:00Z')
    let c = await servico(db, 'cot_coleta()')
    expect(c.semanas.map((s: { id: number }) => s.id)).toEqual([semana, s2])
    expect(c.semana_em_compra.id).toBe(s2)
    await fixarRelogio(db, '2026-10-28T20:00:01Z') // fechamento da semana 19/10 há mais de 8 dias
    c = await servico(db, 'cot_coleta()')
    expect(c.semanas.map((s: { id: number }) => s.id)).toEqual([s2])
    expect(c.cotacoes).toEqual([])
    c = await servico(db, 'cot_coleta($1)', [semana])
    expect(c.semanas.map((s: { id: number }) => s.id)).toEqual([semana])
    expect(c.cotacoes.map((x: { semana_id: number }) => x.semana_id)).toEqual([semana, semana])
  })
})

describe('compare-and-set dos e-mails', () => {
  it('cot_marcar_notificado: troca só se o hash é o esperado; a devolução restaura notificado_em', async () => {
    const db = await banco()
    const { f } = await duasEnviadas(db)
    expect(await servico(db, `cot_marcar_notificado($1, null, 'h1', '2026-10-19T18:30:00Z')`, [f])).toBe(true)
    expect(await servico(db, `cot_marcar_notificado($1, null, 'h2', '2026-10-19T18:31:00Z')`, [f])).toBe(false)
    expect(await servico(db, `cot_marcar_notificado($1, 'h1', 'h2', '2026-10-19T18:40:00Z')`, [f])).toBe(true)
    // o e-mail falhou: devolve
    expect(await servico(db, `cot_marcar_notificado($1, 'h2', 'h1', '2026-10-19T18:30:00Z')`, [f])).toBe(true)
    const c = await cotacao(db, f)
    expect([c.notificado_hash, new Date(c.notificado_em).toISOString()]).toEqual(['h1', '2026-10-19T18:30:00.000Z'])
  })

  it('cobrança: marca uma vez, libera se o e-mail falhar', async () => {
    const db = await banco()
    const { f } = await duasEnviadas(db)
    expect(await servico(db, 'cot_marcar_cobranca($1)', [f])).toBe(true)
    expect(await servico(db, 'cot_marcar_cobranca($1)', [f])).toBe(false)
    expect(await servico(db, 'cot_liberar_cobranca($1)', [f])).toBe(true)
    expect(await servico(db, 'cot_liberar_cobranca($1)', [f])).toBe(false)
    expect(await servico(db, 'cot_marcar_cobranca($1)', [f])).toBe(true)
  })

  it('aviso "Cotações ainda não enviadas": true só na primeira vez por vendedor e semana; desmarcar devolve quantas', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    expect(await servico(db, `cot_marcar_aviso($1, $2, 'preparar')`, [semana, V_FULANO])).toBe(true)
    expect(await servico(db, `cot_marcar_aviso($1, $2, 'preparar')`, [semana, V_FULANO])).toBe(false)
    expect(await servico(db, `cot_marcar_aviso($1, $2, 'preparar')`, [semana, V_BELTRANO])).toBe(true)
    expect(await servico(db, `cot_desmarcar_aviso($1, $2::bigint[], 'preparar')`, [semana, [V_FULANO, V_BELTRANO]])).toBe(2)
    expect(await servico(db, `cot_marcar_aviso($1, $2, 'preparar')`, [semana, V_FULANO])).toBe(true)
    expect(await erroDe(servico(db, `cot_marcar_aviso($1, $2, 'outro')`, [semana, V_FULANO]))).toBe('tipo de aviso inválido')
    expect(await erroDe(servico(db, `cot_desmarcar_aviso($1, $2::bigint[], 'outro')`, [semana, [V_FULANO]]))).toBe('tipo de aviso inválido')
  })
})

describe('fechamento e consolidado', () => {
  it('cot_fechar_vencidas: enviada/respondida 5 min depois do fechamento; pronta nunca; lista o consolidado pendente', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await congelar(db, f)
    await congelar(db, b)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    await fixarRelogio(db, '2026-10-20T20:04:59Z')
    expect(await servico(db, 'cot_fechar_vencidas()')).toEqual({ agora: '2026-10-20T20:04:59.000000Z', fechadas: [], expirados: [], semanas: [] })
    await fixarRelogio(db, '2026-10-20T20:05:00Z')
    expect(await servico(db, 'cot_fechar_vencidas()')).toEqual({ agora: '2026-10-20T20:05:00.000000Z', fechadas: [f], expirados: [],
      semanas: [{ semana_id: semana, data_referencia: '2026-10-19', tipo: 'consolidado' }] })
    expect((await cotacao(db, b)).status).toBe('pronta')
    expect(new Date((await cotacao(db, f)).fechada_em).toISOString()).toBe('2026-10-20T20:05:00.000Z')
  })

  it('duas cotações com fechamento em dias diferentes: 1º consolidado parcial, 2º final; reserva dupla → só uma reserva', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f) // fecha ter 20/10 17:00
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    await fixarRelogio(db, '2026-10-20T12:00:00Z') // ter 09:00: a do Beltrano fecha qua 21/10 17:00
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await congelar(db, b)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    await fixarRelogio(db, '2026-10-20T20:10:00Z')
    await servico(db, 'cot_fechar_vencidas()')
    const r1 = await servico(db, 'cot_reservar_consolidado($1)', [semana])
    expect(r1).toEqual({ semana_id: semana, tipo: 'consolidado', reservada_em: '2026-10-20T20:10:00.000000Z', parcial: true,
      ids: [f], antes: [{ id: f, consolidado_em: null, consolidado_rev: null }] })
    expect(await servico(db, 'cot_reservar_consolidado($1)', [semana])).toEqual({ semana_id: semana, tipo: null, reservada_em: null,
      parcial: true, ids: [], antes: [] })
    await fixarRelogio(db, '2026-10-21T20:10:00Z')
    expect((await servico(db, 'cot_fechar_vencidas()')).semanas).toEqual([{ semana_id: semana, data_referencia: '2026-10-19', tipo: 'consolidado' }])
    const r2 = await servico(db, 'cot_reservar_consolidado($1)', [semana])
    expect(r2).toMatchObject({ tipo: 'consolidado', parcial: false, ids: [b] })
    // o e-mail falhou: libera e reserva de novo
    expect(await servico(db, 'cot_liberar_consolidado($1::jsonb)', [JSON.stringify(r2)])).toBe(1)
    expect((await cotacao(db, b)).consolidado_em).toBeNull()
    expect((await servico(db, 'cot_reservar_consolidado($1)', [semana])).ids).toEqual([b])
  })

  it('pedido gravado antes do prazo espera o fechamento; mudança depois do consolidado → "atualizado"', async () => {
    const db = await banco()
    const { semana, f, cf } = await duasEnviadas(db)
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    await fixarRelogio(db, '2026-10-20T13:00:00Z')
    expect((await servico(db, 'cot_fechar_vencidas()')).semanas).toEqual([])
    expect((await servico(db, 'cot_reservar_consolidado($1)', [semana])).tipo).toBeNull()
    await fixarRelogio(db, '2026-10-20T20:10:00Z')
    const r = await servico(db, 'cot_reservar_consolidado($1)', [semana])
    expect(r).toMatchObject({ tipo: 'consolidado', parcial: false })
    expect(r.ids.sort()).toEqual([f, (await cotacaoDe(db, semana, V_BELTRANO))].sort())
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await responderAdmin(db, b, [resp(1, 0, 'nao_tem')], null, 'ivan_digitou')
    expect((await servico(db, 'cot_fechar_vencidas()')).semanas).toEqual([{ semana_id: semana, data_referencia: '2026-10-19', tipo: 'atualizado' }])
    const a = await servico(db, 'cot_reservar_consolidado($1)', [semana])
    expect(a).toMatchObject({ tipo: 'atualizado', ids: [b], antes: [{ id: b, consolidado_rev: 0 }] })
    expect((await cotacao(db, b)).consolidado_rev).toBe(1)
    expect(await servico(db, 'cot_liberar_consolidado($1::jsonb)', [JSON.stringify(a)])).toBe(1)
    expect((await cotacao(db, b)).consolidado_rev).toBe(0)
  })
})

describe('cot_aplicar_cadastros (D5)', () => {
  const V = (codigo: string, whatsapp = '5511900000009', ativo = 'true') =>
    ({ codigo, nome: codigo.toUpperCase(), empresa: `${codigo.toUpperCase()} (Loja)`, whatsapp, ativo })
  const CAT = (produto_id: string, vendedor_codigo: string, extra: Record<string, string> = {}) => ({
    produto_id, vendedor_codigo, nome_para_vendedor: '', embalagem: '', fator: '', fator_confirmado_em: '', vende_por_litro: '',
    kg_por_litro: '', kg_por_litro_confirmado_em: '', descricao_fornecedor: '', codigo_fornecedor: '', descricao_de_fornecedor: '',
    nota_vendedor: '', ...extra })
  const aplicar = (db: Db, p: object) => servico(db, 'cot_aplicar_cadastros($1::jsonb)', [JSON.stringify(p)])

  it('aplica na ordem, só as linhas que mudaram; datas de confirmação viram 00:00 de Brasília', async () => {
    const db = await banco()
    await aprovar(db)
    const p = {
      vendedores: [{ linha: 2, ...V('ciclano') }],
      fornecedores: [{ linha: 2, nome_fornecedor: 'Fornecedor  Ciclano Ltda', vendedor_codigo: 'ciclano' }],
      catalogo: [{ linha: 2, ...CAT('104', '', { vende_por_litro: 'true', kg_por_litro: '1', kg_por_litro_confirmado_em: '2026-09-27',
        nota_vendedor: 'caixa 1 L' }) },
      { linha: 3, ...CAT('101', 'ciclano', { embalagem: 'fardo', fator: '12', descricao_fornecedor: 'AGUA 500', codigo_fornecedor: '9',
        descricao_de_fornecedor: 'Fornecedor Ciclano LTDA' }) }],
      feriados: [{ linha: 2, data: '2026-11-02', nome: 'Finados' }],
    }
    expect(await aplicar(db, p)).toEqual({ vendedores: { linhas: 1, aplicadas: 1 }, fornecedores: { linhas: 1, aplicadas: 1 },
      catalogo: { linhas: 2, aplicadas: 2 }, feriados: { linhas: 1, aplicadas: 1 } })
    const k = await db.query<Json>('select * from cot_catalogo order by produto_id')
    expect(k.rows[0]).toMatchObject({ produto_id: 101, origem: 'seed', embalagem: 'fardo', fator: '12', fator_confirmado_em: null,
      descricao_de_fornecedor: 'FORNECEDOR CICLANO LTDA', nota_vendedor: null })
    expect(k.rows[1]).toMatchObject({ produto_id: 104, vendedor_id: null, vende_por_litro: true, kg_por_litro: '1', nota_vendedor: 'caixa 1 L' })
    expect(new Date(k.rows[1].kg_por_litro_confirmado_em).toISOString()).toBe('2026-09-27T03:00:00.000Z')
    expect((await db.query<Json>(`select nome_normalizado from cot_fornecedores where nome_original = 'Fornecedor  Ciclano Ltda'`)).rows[0].nome_normalizado)
      .toBe('FORNECEDOR CICLANO LTDA')
    // de novo, igual: nada aplicado (o número da linha não entra no hash)
    const p2 = { ...p, vendedores: [{ ...p.vendedores[0], linha: 5 }] }
    expect(await aplicar(db, p2)).toEqual({ vendedores: { linhas: 1, aplicadas: 0 }, fornecedores: { linhas: 1, aplicadas: 0 },
      catalogo: { linhas: 2, aplicadas: 0 }, feriados: { linhas: 1, aplicadas: 0 } })
    expect(await aplicar(db, {})).toEqual({ vendedores: { linhas: 0, aplicadas: 0 }, fornecedores: { linhas: 0, aplicadas: 0 },
      catalogo: { linhas: 0, aplicadas: 0 }, feriados: { linhas: 0, aplicadas: 0 } })
  })

  it('troca de vendedor pelo CSV tem efeito; a escolha do App só é desfeita por mudança na linha do próprio produto', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    const cat102 = CAT('102', 'beltrano', { descricao_fornecedor: 'REFRIG', codigo_fornecedor: '1', descricao_de_fornecedor: 'FORNECEDOR B LTDA' })
    await aplicar(db, { catalogo: [{ linha: 2, ...cat102 }] })
    let p = await preparar(db, semana)
    expect(p.itens.find((i: { produto_id: number }) => i.produto_id === 102)).toMatchObject({ vendedor_id: V_BELTRANO, via: 'catalogo' })
    // o Ivan troca no App e escreve uma nota
    await chamar(db, ADMIN, 'cot_definir_vendedor(102, $1)', [V_FULANO])
    await chamar(db, ADMIN, `cot_definir_nota(102, 'lata 350')`)
    // um push que só muda vendedores.csv (a linha do 102 igual) não desfaz a escolha
    await aplicar(db, { vendedores: [{ linha: 2, ...V('ciclano') }], catalogo: [{ linha: 2, ...cat102 }] })
    let k = (await db.query<Json>('select vendedor_id, origem, nota_vendedor from cot_catalogo where produto_id = 102')).rows[0]
    expect(k).toEqual({ vendedor_id: V_FULANO, origem: 'ivan', nota_vendedor: 'lata 350' })
    // mudança na própria linha: decisão nova do Ivan (substitui tudo, inclusive a nota; vazio = null)
    await aplicar(db, { catalogo: [{ linha: 2, ...cat102, nome_para_vendedor: 'REFRIGERANTE LATA' }] })
    k = (await db.query<Json>('select vendedor_id, origem, nota_vendedor, nome_para_vendedor, descricao_fornecedor from cot_catalogo where produto_id = 102')).rows[0]
    expect(k).toEqual({ vendedor_id: V_BELTRANO, origem: 'seed', nota_vendedor: null, nome_para_vendedor: 'REFRIGERANTE LATA', descricao_fornecedor: 'REFRIG' })
    // apagar a linha do CSV não apaga nada
    await aplicar(db, { catalogo: [] })
    expect((await db.query<Json>('select count(*)::int as n from cot_catalogo')).rows[0].n).toBe(1)
    p = await preparar(db, semana)
    expect(p.itens.find((i: { produto_id: number }) => i.produto_id === 102)).toMatchObject({ vendedor_id: V_BELTRANO })
  })

  it('qualquer linha inválida recusa tudo, com arquivo, linha e motivo', async () => {
    const db = await banco()
    await aprovar(db)
    const casos: [object, string][] = [
      [{ vendedores: [{ linha: 2, ...V('Maiusculo') }] }, 'cadastro inválido: vendedores linha 2: codigo inválido'],
      [{ vendedores: [{ linha: 3, ...V('ciclano', '11900000001') }] }, 'cadastro inválido: vendedores linha 3: whatsapp inválido'],
      [{ vendedores: [{ linha: 2, ...V('ciclano', '5511900000009', 'sim') }] }, 'cadastro inválido: vendedores linha 2: ativo precisa ser true ou false'],
      [{ vendedores: [{ linha: 2, ...V('ciclano') }, { linha: 3, ...V('ciclano') }] }, 'cadastro inválido: vendedores linha 3: chave repetida no arquivo'],
      [{ fornecedores: [{ linha: 2, nome_fornecedor: 'X', vendedor_codigo: 'ninguem' }] }, 'cadastro inválido: fornecedores linha 2: vendedor_codigo desconhecido'],
      [{ catalogo: [{ linha: 2, ...CAT('abc', '') }] }, 'cadastro inválido: catalogo linha 2: produto_id inválido'],
      [{ catalogo: [{ linha: 2, ...CAT('101', '', { fator: '1,5' }) }] }, 'cadastro inválido: catalogo linha 2: fator inválido'],
      [{ catalogo: [{ linha: 2, ...CAT('101', '', { fator_confirmado_em: '2026-09-27' }) }] }, 'cadastro inválido: catalogo linha 2: fator_confirmado_em sem fator'],
      [{ catalogo: [{ linha: 2, ...CAT('101', '', { descricao_fornecedor: 'X' }) }] },
        'cadastro inválido: catalogo linha 2: descricao_de_fornecedor obrigatório com descrição ou código'],
      [{ catalogo: [{ linha: 2, ...CAT('101', '', { nota_vendedor: 'n'.repeat(81) }) }] }, 'cadastro inválido: catalogo linha 2: nota_vendedor com mais de 80 caracteres'],
      [{ catalogo: [{ linha: 2, ...CAT('101', '', { nota_vendedor: 'a\tb' }) }] }, 'cadastro inválido: catalogo linha 2: nota_vendedor com caractere inválido'],
      [{ feriados: [{ linha: 4, data: '2026-02-30', nome: 'X' }] }, 'cadastro inválido: feriados linha 4: data inválida'],
    ]
    for (const [p, msg] of casos) {
      // uma linha boa antes da ruim: nada é aplicado
      const comBoa = { ...p, vendedores: [{ linha: 1, ...V('bom') }, ...((p as { vendedores?: object[] }).vendedores ?? [])] }
      expect(await erroDe(aplicar(db, comBoa))).toBe(msg)
    }
    expect((await db.query<Json>(`select count(*)::int as n from cot_vendedores where codigo = 'bom'`)).rows[0].n).toBe(0)
    expect((await db.query<Json>('select count(*)::int as n from cot_cadastros_aplicados')).rows[0].n).toBe(0)
  })
})
