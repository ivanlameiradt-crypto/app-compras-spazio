import type { PGlite } from '@electric-sql/pglite'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { limpar, novoBanco } from './banco'
import { ADMIN, JOAO, semear } from './fixture'
import { APROVADA_EM, DATA_REF, FULANO, BELTRANO, PAYLOAD_COTACAO, V_BELTRANO, V_FULANO, type Json } from './fixture-cotacao'
import { rpcRest, ConsultaRest } from './postgrest'
import { fixarRelogio } from './relogio'

// Fase 1B — teste de integração das quatro frentes contra o SQL de verdade da migration 20261001000001_cotacao.sql.
// Nada aqui chama o banco "por dentro": tudo passa pelo PostgREST de mentira (tests/db/postgrest.ts), que chama as
// funções POR NOME com o corpo JSON, no papel de quem chama, como o PostgREST de produção. Cada parte manda o que manda
// de verdade:
//  - App: as funções de src/lib/api.ts (o supabase-js trocado pelo PostgREST de mentira), com os dados montados por
//    src/cotacao (leitor do "Colar resposta", mapa do pedido, mensagens);
//  - página do vendedor (anon): o corpo exato que o app.js monta (`chamar('cotacao_abrir', …)` e o montarEnvio);
//  - robô (service_role): o corpo exato do cot_banco.py e do cot_cadastros.py, e confere que a resposta tem o
//    formato que o cot_coleta.py, o cot_fechamento.py e o cot_emails.py leem. (O código Python do robô roda de verdade
//    contra este mesmo PostgREST, por HTTP, no teste privado compra-semanal/tests/app_real/cotacao_robo.test.ts.)
// Semana inventada da fixture-cotacao (seg 19/10/2026): Fulano (FORNECEDOR A) e Beltrano (FORNECEDOR B).

const alvo = vi.hoisted(() => ({ db: null as unknown, quem: 'ivan@spazio.com' }))
vi.mock('../../src/lib/supabase', async () => {
  const { clienteRest } = await import('./postgrest')
  return { supabase: clienteRest(() => alvo.db as PGlite, () => alvo.quem) }
})

import * as api from '../../src/lib/api'
import { converter } from '../../src/cotacao/conversao'
import { lerColagem } from '../../src/cotacao/leitorTexto'
import { dadosEnvioDe, linkCotacao, mensagemCotacao, mensagemPedido, URL_PAGINA } from '../../src/cotacao/mensagens'
import { montarPedido, sugestaoLoja } from '../../src/cotacao/pedido'
import type { EntradaItem, ItemCotacao } from '../../src/lib/tipos'

let db: PGlite
beforeAll(async () => {
  db = await novoBanco()
  alvo.db = db
  await semear(db)
})
afterAll(async () => { await db?.close() })

const relogio = (quando: string) => fixarRelogio(db, quando)

// ---------- as três "bocas" do banco

/** O robô: POST /rest/v1/rpc/<nome> com a chave de serviço e o corpo do cot_banco.py (`rpc(nome, args or {})`). */
async function robo(nome: string, corpo: Record<string, unknown> = {}): Promise<Json> {
  const r = await rpcRest(db, 'service', nome, corpo)
  if (r.error) throw new Error(`${nome}: ${r.error.message} (${r.error.code})`)
  return r.data
}
/** A página do vendedor: POST /rest/v1/rpc/<nome> com a chave anônima (app.js, `chamar`). HTTP 200 sempre. */
async function pagina(nome: 'cotacao_abrir' | 'cotacao_responder', corpo: Record<string, unknown>): Promise<Json> {
  const r = await rpcRest(db, 'anon', nome, corpo)
  if (r.error) throw new Error(`${nome}: ${r.error.message} (${r.error.code})`)
  expect(r.status).toBe(200)
  return r.data
}
/** O App como `quem` (o admin por padrão; JOAO é comprador). */
async function comoApp<T>(quem: string, f: () => Promise<T>): Promise<T> {
  const antes = alvo.quem
  alvo.quem = quem
  try {
    return await f()
  } finally {
    alvo.quem = antes
  }
}

// ---------- o que o app.js da página monta (montarEnvio, contrato 5.2): item "tem" com TODAS as chaves (as vazias em
// null), "não tenho" só com o similar, condições com as 6 chaves + rev_lida. O mesmo formato é conferido do lado da
// página em cotacao/tests/contrato.test.js (montarEnvio → estes objetos).
const temPagina = (numero: number, rev_lida: number, r: Record<string, unknown>) => ({
  numero, rev_lida, estado: 'tem', preco: null, base: null, emb_unidades: null, emb_gramas: null, emb_ml: null,
  tenho_so: null, similar_desc: null, similar_preco: null, a_partir_de: null, marca: null, confirmado: false, ...r,
})
const naoTemPagina = (numero: number, rev_lida: number) => ({ numero, rev_lida, estado: 'nao_tem', similar_desc: null, similar_preco: null })
const geraisPagina = (rev_lida: number, g: Record<string, unknown>) => ({
  rev_lida, pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null, ...g,
})

// ---------- formatos exatos do contrato (listas brancas)
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ // cot_iso: o datetime.fromisoformat do robô lê (troca o Z)
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
const chaves = (o: object) => Object.keys(o).sort()
const RESPOSTA_ITEM = ['a_partir_de', 'avisos_vendedor', 'base', 'confirmado_pelo_vendedor', 'emb_gramas', 'emb_ml', 'emb_unidades',
  'estado', 'marca_informada', 'preco_convertido', 'preco_digitado', 'similar_desc', 'similar_preco', 'tenho_so']
const ABERTURA = ['agora', 'agora_local', 'complementar', 'estado', 'fechamento', 'fechamento_local', 'gerais', 'gerais_rev', 'itens', 'loja',
  'nova', 'ok', 'prazo', 'prazo_local', 'segundos_para_fechar', 'substitui_versao', 'texto', 'validade_opcoes', 'vendedor_nome', 'versao']
const ITEM_ABERTURA = ['codigo_fornecedor', 'descricao_fornecedor', 'embalagem', 'fator', 'kg_por_litro', 'nome', 'nota', 'numero', 'qtd',
  'resposta', 'rev', 'rotulo', 'unidade', 'vende_por_litro']
const DADOS_ENVIO = ['codigo', 'complementar', 'cotacao_id', 'data_referencia', 'fechamento', 'fechamento_local', 'itens', 'prazo',
  'prazo_local', 'semana_id', 'status', 'substitui_versao', 'vendedor', 'versao']
const COLETA = ['agora', 'agora_local', 'cotacoes', 'historico', 'pendentes_preparar', 'semana_em_compra', 'semanas', 'vendedores']
const COLETA_COTACAO = ['acessos', 'cobranca_em', 'complementar', 'congelada_em', 'consolidado_em', 'consolidado_rev', 'enviada_em',
  'envios_aceitos', 'fechada_em', 'fechamento', 'fechamento_local', 'gerais', 'id', 'itens', 'notificado_em', 'notificado_hash', 'pedido',
  'prazo', 'prazo_local', 'primeiro_acesso', 'respostas_rev', 'resultado', 'resumo', 'semana_id', 'status', 'substituida_por',
  'ultimo_acesso', 'ultimo_envio_em', 'vendedor_id', 'versao']
const COLETA_ITEM = ['a_partir_de', 'avisos_ivan', 'avisos_vendedor', 'base', 'confirmado_pelo_vendedor', 'copiada_da_versao', 'delta',
  'emb_gramas', 'emb_ml', 'emb_unidades', 'embalagem', 'estado', 'fator', 'fator_confirmado', 'fator_informado', 'incluido',
  'item_semana_id', 'kg_por_litro', 'marca_informada', 'nome', 'nota_vendedor', 'numero', 'origem', 'preco_convertido',
  'preco_digitado', 'produto', 'produto_id', 'qtd', 'qtd_sugerida', 'ref_data', 'ref_preco', 'ref_situacao', 'respondido_em', 'rev',
  'rotulo', 'similar_desc', 'similar_preco', 'tenho_so', 'unidade', 'vende_por_litro']
const COLETA_GERAIS = ['entrega', 'frete', 'observacao', 'origem', 'pagamento', 'pedido_minimo', 'rev', 'validade']
const RESUMO = ['com_referencia', 'gerais_respondidas', 'itens', 'nao_tem', 'parciais', 'respondidos', 'tem', 'total_cotado', 'total_ultimo']
// o que o robô lê (cot_coleta.py: hash_respostas, tem_envio_novo, para_cobrar, nao_enviadas)
const CAMPOS_ITEM_ROBO = ['estado', 'preco_digitado', 'base', 'emb_unidades', 'emb_gramas', 'emb_ml', 'tenho_so', 'similar_desc',
  'similar_preco', 'a_partir_de', 'marca_informada', 'confirmado_pelo_vendedor']
const CAMPOS_GERAIS_ROBO = ['pagamento', 'validade', 'pedido_minimo', 'frete', 'entrega', 'observacao']
const PEDIDO_LINHA = ['base', 'embalagens', 'fator', 'marca', 'numero', 'preco_combinado', 'preco_convertido', 'produto_id', 'qtd']

/** Todo carimbo que o robô recebe no formato do cot_iso (…Z) e todo *_local no formato 'AAAA-MM-DD HH:MM'. */
function conferirCarimbos(o: Json, onde = 'coleta'): void {
  if (Array.isArray(o)) { o.forEach((x, i) => conferirCarimbos(x, `${onde}[${i}]`)); return }
  if (o === null || typeof o !== 'object') return
  for (const [k, v] of Object.entries(o)) {
    if (v === null) continue
    if (/(_em|_acesso|^prazo|^fechamento|^agora|aguardando_ate)$/.test(k) && typeof v === 'string') {
      expect(v, `${onde}.${k}`).toMatch(k.endsWith('_local') ? LOCAL : ISO_Z)
    } else if (k.endsWith('_local')) {
      expect(v, `${onde}.${k}`).toMatch(LOCAL)
    } else {
      conferirCarimbos(v, `${onde}.${k}`)
    }
  }
}

// ---------- cadastros: depois da virada (C1) o cot_aplicar_cadastros saiu do service_role (a virada aposenta o
// CSV do robô), então o seed grava o estado direto (o mesmo que o robô gravava): 2 vendedores (ids 1 e 2), 2
// grafias, o catálogo do 101 (fardo c/12, descrição e código da NF-e) e do 104 (por litro, 1 L = 1 kg) e o feriado.
async function semearCadastros(): Promise<void> {
  await db.exec(`
    insert into cot_vendedores (codigo, nome, empresa, whatsapp, ativo) values
      ('${FULANO.codigo}', '${FULANO.nome}', '${FULANO.empresa}', '${FULANO.whatsapp}', true),
      ('${BELTRANO.codigo}', '${BELTRANO.nome}', '${BELTRANO.empresa}', '${BELTRANO.whatsapp}', true);
    insert into cot_fornecedores (nome_normalizado, nome_original, vendedor_id) values
      ('FORNECEDOR A LTDA', 'FORNECEDOR A LTDA', ${V_FULANO}),
      ('FORNECEDOR B LTDA', 'FORNECEDOR B LTDA', ${V_BELTRANO});
    insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator, fator_confirmado_em,
                              vende_por_litro, descricao_fornecedor, codigo_fornecedor, descricao_de_fornecedor, atualizado_em)
      values (101, ${V_FULANO}, 'seed', 'fardo', 12, '2026-10-01T03:00:00Z', false,
              'AGUA MIN S/GAS 500ML', '7890001', 'FORNECEDOR A LTDA', '2026-10-01T03:00:00Z');
    insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro, kg_por_litro, kg_por_litro_confirmado_em, atualizado_em)
      values (104, null, 'seed', true, 1, '2026-09-27T03:00:00Z', '2026-09-27T03:00:00Z');
    insert into cot_feriados (data, nome) values ('2026-10-12', 'Nossa Senhora Aparecida');
  `)
}

/** Cadastros e semana (robô) e aprovação (App) às 08h de seg 19/10; relógio às 15h. Devolve o id da semana. */
async function semanaAprovada(): Promise<number> {
  await semearCadastros()
  const imp = await robo('importar_semana', { p: PAYLOAD_COTACAO }) // app_envio.py: POST rpc/importar_semana com {"p": payload}
  const id = Number(imp.semana_id)
  await api.aprovarSemana(id)
  await db.query('update semanas set aprovada_em = $1 where id = $2', [APROVADA_EM, id])
  await relogio('2026-10-19T18:00:00Z') // seg 15:00: o Ivan abre a aba Cotações
  return id
}

/** O hash do robô é opaco para o banco: basta um hex de 64 como o sha256 do cot_coleta.py. */
const hashDe = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

// ---------- estado compartilhado do fluxo (os testes abaixo são passos em sequência)
let semana = 0
let fulanoId = 0
let beltranoId = 0
let codigoF = ''
let codigoB = ''
let envio1 = ''

describe('fluxo completo: App → página → App → robô, com os formatos de cada um', () => {
  it('cadastros (App, depois da virada) e a lista da semana (app_envio.py); App aprova', async () => {
    await semearCadastros()

    // app_envio.py: POST rpc/importar_semana com {"p": payload}
    const imp = await robo('importar_semana', { p: PAYLOAD_COTACAO })
    semana = Number(imp.semana_id)
    // vigia (cot_banco.ler_semana): GET semanas?data_referencia=eq.<data>&select=id,status com a chave de serviço
    const lida = await new ConsultaRest(db, 'service', 'semanas').select('id,status').eq('data_referencia', DATA_REF)
    expect(lida).toMatchObject({ error: null, data: [{ id: semana, status: 'rascunho' }] })

    await api.aprovarSemana(semana)
    await db.query('update semanas set aprovada_em = $1 where id = $2', [APROVADA_EM, semana])
    await relogio('2026-10-19T18:00:00Z') // seg 15:00: o Ivan abre a aba Cotações
  })

  it('App: Preparar, Nota, marcar item e Preparar mensagem (cot_preparar → cot_congelar → cot_dados_envio)', async () => {
    const p = await api.prepararCotacoes(semana)
    expect(chaves(p)).toEqual(['agora', 'aguardando_ate', 'aprovada_em', 'atravessados', 'cartoes', 'data_referencia', 'depois_do_resultado',
      'fora_da_enviada', 'itens', 'presos', 'sem_vendedor', 'semana_id'])
    expect(p.cartoes.map((c) => c.vendedor_id).sort()).toEqual([V_FULANO, V_BELTRANO])
    expect(p.sem_vendedor.map((s) => s.motivo).sort()).toEqual(['fornecedor_sem_vendedor', 'nunca_comprado'])
    expect(p.itens.find((i) => i.produto_id === 101)).toMatchObject({ vendedor_id: V_FULANO, via: 'catalogo', preso_com: null })
    expect(p.itens.find((i) => i.produto_id === 104)).toMatchObject({ vendedor_id: V_FULANO, via: 'ultima_compra' })

    // leituras da aba (colunas explícitas do api.ts contra as tabelas e views de verdade)
    const vendedores = await api.listarVendedores()
    expect(vendedores.map((v) => v.codigo)).toEqual(['fulano', 'beltrano'])
    const cots = await api.cotacoesDaSemana(semana)
    expect(cots.map((c) => [c.vendedor_id, c.status])).toEqual([[V_FULANO, 'rascunho'], [V_BELTRANO, 'rascunho']])
    fulanoId = cots[0].id
    beltranoId = cots[1].id
    expect(p.cartoes.find((c) => c.vendedor_id === V_FULANO)?.cotacoes).toEqual([fulanoId])

    // Nota do Ivan (cot_definir_nota) e o próximo Preparar leva a nota ao rascunho
    await api.definirNota(103, 'cristal, pacote de 1 kg')
    await api.prepararCotacoes(semana)
    let itens = await api.itensDasCotacoes([fulanoId])
    // (no rascunho ainda não há número: a ordem da leitura é a do nome, que depende da collation do banco)
    expect(itens.map((i) => [i.produto_id, i.incluido, i.nota_vendedor]).sort((x, y) => Number(x[0]) - Number(y[0]))).toEqual(
      [[101, true, null], [102, true, null], [103, true, 'cristal, pacote de 1 kg'], [104, true, null]])
    // desmarca e marca de novo (cot_marcar_item)
    const acucar = itens.find((i) => i.produto_id === 103) as ItemCotacao
    await api.marcarItemCotacao(acucar.id, false)
    expect((await api.itensDasCotacoes([fulanoId])).find((i) => i.id === acucar.id)?.incluido).toBe(false)
    await api.marcarItemCotacao(acucar.id, true)

    // Preparar mensagem
    const d = await api.congelarCotacao(fulanoId)
    expect(chaves(d)).toEqual(DADOS_ENVIO)
    expect(d).toMatchObject({
      cotacao_id: fulanoId, semana_id: semana, data_referencia: DATA_REF, versao: 1, complementar: false, substitui_versao: null,
      status: 'pronta', prazo: '2026-10-20T15:00:00.000000Z', fechamento: '2026-10-20T20:00:00.000000Z',
      prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00',
      vendedor: { id: V_FULANO, codigo: 'fulano', nome: 'Fulano', empresa: 'FORNECEDOR A (Centro)', rotulo: 'FORNECEDOR A', whatsapp: FULANO.whatsapp },
    })
    expect(d.itens.map((i) => [i.numero, i.produto_id, i.nome, i.qtd, i.unidade, i.rotulo, i.vende_por_litro, i.embalagem, i.fator, i.nota])).toEqual([
      [1, 101, 'ÁGUA MINERAL 500ML', 60, 'un', 'un', false, 'fardo', 12, null],
      [2, 102, 'REFRIGERANTE LATA 350 ML', 48, 'un', 'un', false, null, null, null],
      [3, 103, 'AÇÚCAR CRISTAL', 8, 'kg', 'kg', false, null, null, 'cristal, pacote de 1 kg'],
      [4, 104, 'LEITE INTEGRAL', 20, 'kg', 'kg', true, null, null, null],
    ])
    codigoF = d.codigo as string
    expect(codigoF).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(await api.dadosEnvio(fulanoId)).toEqual(d)

    // o link que o App manda é o que a página lê (só o "#c=")
    expect(linkCotacao(codigoF)).toBe(`${URL_PAGINA}#c=${codigoF}`)
    const msg = mensagemCotacao(d)
    expect(msg).toContain(`#c=${codigoF}`)
    expect(msg).toContain('3. AÇÚCAR CRISTAL – 8 kg (cristal, pacote de 1 kg) – R$')
    expect(msg).toContain('1. ÁGUA MINERAL 500ML – 60 un (5 fd c/12) – R$')
    expect(msg).toContain('Prazo: terça, 20/10, até 12h.')

    // "Abrir o WhatsApp de novo" monta a mensagem das leituras (dadosEnvioDe): tem de ser a mesma que o vendedor recebeu
    const [c] = await api.cotacoesDaSemana(semana)
    itens = await api.itensDasCotacoes([fulanoId])
    const codigos = await api.codigosDasCotacoes([fulanoId])
    expect(codigos).toEqual({ [fulanoId]: codigoF })
    const v = vendedores.find((x) => x.id === V_FULANO)!
    const dasLeituras = dadosEnvioDe(c, itens, v, codigos[fulanoId], { data_referencia: DATA_REF, substitui_versao: null })
    expect(mensagemCotacao(dasLeituras)).toBe(msg)
    expect({ ...dasLeituras, prazo: null, fechamento: null }).toEqual({ ...d, prazo: null, fechamento: null })
    expect(new Date(dasLeituras.prazo).getTime()).toBe(new Date(d.prazo).getTime())

    // checagem de saúde do App: cotacao_abrir em prévia (não grava acesso nem muda o status)
    const saude = await api.abrirComoVendedor(codigoF)
    expect(saude).toMatchObject({ ok: true, estado: 'aberta', vendedor_nome: 'Fulano' })
    if (saude.ok) expect(saude.itens).toHaveLength(d.itens.length)
    expect((await api.cotacoesDaSemana(semana))[0]).toMatchObject({ status: 'pronta', primeiro_acesso: null, acessos: 0 })
  })

  it('página: abre (cotacao_abrir) e responde (cotacao_responder) com o corpo do app.js', async () => {
    await relogio('2026-10-19T18:05:00Z')
    // app.js: chamar('cotacao_abrir', { p_codigo: esta.codigo, p_previa: esta.previa })
    const a = await pagina('cotacao_abrir', { p_codigo: codigoF, p_previa: false })
    expect(chaves(a)).toEqual(ABERTURA)
    expect(a).toMatchObject({
      ok: true, estado: 'aberta', texto: null, loja: 'Spazio Gourmet', vendedor_nome: 'Fulano', versao: 1, complementar: false,
      substitui_versao: null, prazo_local: '2026-10-20 12:00', fechamento_local: '2026-10-20 17:00', agora_local: '2026-10-19 15:05',
      segundos_para_fechar: 25 * 3600 + 55 * 60, // seg 15h05 → ter 17h gerais_rev: 0, nova: null,
      gerais: { pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null },
    })
    expect(a.validade_opcoes.map((o: Json) => o.data)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23'])
    expect(a.itens).toHaveLength(4)
    for (const it of a.itens) {
      expect(chaves(it)).toEqual(ITEM_ABERTURA)
      expect(chaves(it.resposta)).toEqual(RESPOSTA_ITEM)
      expect(it.rev).toBe(0)
    }
    expect(a.itens[0]).toMatchObject({ numero: 1, embalagem: 'fardo', fator: 12, descricao_fornecedor: 'AGUA MIN S/GAS 500ML', codigo_fornecedor: '7890001' })
    expect(a.itens[2]).toMatchObject({ numero: 3, nota: 'cristal, pacote de 1 kg' })
    expect(a.itens[3]).toMatchObject({ numero: 4, vende_por_litro: true, kg_por_litro: 1 })
    // nada de referência, custo, telefone ou dado de outra cotação no que a página recebe
    const texto = JSON.stringify(a)
    for (const proibido of ['ref_', 'avisos_ivan', 'custo', 'qtd_sugerida', FULANO.whatsapp, 'produto_id', 'origem']) {
      expect(texto).not.toContain(proibido)
    }
    expect((await api.cotacoesDaSemana(semana))[0]).toMatchObject({ status: 'enviada', acessos: 1 })

    // app.js montarEnvio: fardo com 12 (a embalagem confirmada já vem marcada) e marca; "não tenho"; leite pelo litro
    await relogio('2026-10-19T18:10:00Z')
    envio1 = randomUUID()
    const corpo = {
      p_codigo: codigoF, p_envio_id: envio1,
      p_itens: [
        temPagina(1, 0, { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' }),
        naoTemPagina(3, 0),
        temPagina(4, 0, { preco: 6.2, base: 'litro' }),
      ],
      p_gerais: geraisPagina(0, { pagamento: 'boleto 28 dias', validade: '2026-10-21', pedido_minimo: 0, frete: 15, entrega: 'dia seguinte',
        observacao: 'Entrego até 10h.' }),
    }
    const r = await pagina('cotacao_responder', corpo)
    expect(chaves(r)).toEqual(['gerais', 'itens', 'ok', 'recebido_em', 'reenvio'])
    expect(r).toMatchObject({ ok: true, reenvio: false, recebido_em: '2026-10-19T18:10:00.000000Z' })
    expect(r.itens.map((x: Json) => [x.numero, x.resultado, x.rev, x.erro])).toEqual([[1, 'gravado', 1, null], [3, 'gravado', 1, null], [4, 'gravado', 1, null]])
    for (const x of r.itens) {
      expect(chaves(x)).toEqual(['avisos_vendedor', 'erro', 'numero', 'resultado', 'rev', 'valor_atual'])
      expect(chaves(x.valor_atual)).toEqual(RESPOSTA_ITEM)
    }
    expect(r.itens[0].valor_atual).toMatchObject({ estado: 'tem', preco_digitado: 31.5, base: 'embalagem', emb_unidades: 12,
      preco_convertido: 2.625, marca_informada: 'Marca A', confirmado_pelo_vendedor: false, avisos_vendedor: [] })
    expect(r.itens[2].valor_atual).toMatchObject({ estado: 'tem', base: 'litro', preco_convertido: 6.2 })
    expect(r.gerais).toEqual({ resultado: 'gravado', rev: 1, erro: null, valor_atual: { pagamento: 'boleto 28 dias',
      validade: '2026-10-21', pedido_minimo: 0, frete: 15, entrega: 'dia seguinte', observacao: 'Entrego até 10h.' } })

    // resposta perdida: a página tenta de novo com o MESMO envio_id (2 s depois) → o banco devolve o mesmo, com reenvio
    await relogio('2026-10-19T18:10:02Z')
    const de_novo = await pagina('cotacao_responder', corpo)
    expect(de_novo).toEqual({ ...r, reenvio: true })

    // o rev devolvido é o rev_lida do próximo envio: troca a marca do item 1; o item 3 mandado com o rev velho dá conflito
    await relogio('2026-10-19T18:11:00Z')
    const r2 = await pagina('cotacao_responder', {
      p_codigo: codigoF, p_envio_id: randomUUID(),
      p_itens: [temPagina(1, r.itens[0].rev, { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca B' }), naoTemPagina(3, 0)],
      p_gerais: null,
    })
    expect(r2.itens.map((x: Json) => [x.numero, x.resultado, x.rev])).toEqual([[1, 'gravado', 2], [3, 'conflito', 1]])
    expect(r2.itens[0].valor_atual.marca_informada).toBe('Marca B')
    expect(r2.gerais).toBeNull()

    // a conta ao vivo do App (conversao.ts) dá o mesmo que o banco gravou
    const itens = await api.itensDasCotacoes([fulanoId])
    for (const [numero, entrada] of [
      [1, { numero: 1, rev_lida: 0, estado: 'tem', preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca B' }],
      [4, { numero: 4, rev_lida: 0, estado: 'tem', preco: 6.2, base: 'litro' }],
    ] as [number, EntradaItem][]) {
      const i = itens.find((x) => x.numero === numero)!
      const conta = converter(i, entrada)
      expect([conta.erro, conta.preco_convertido, conta.fator_informado, conta.avisos_vendedor, conta.avisos_ivan])
        .toEqual([null, i.preco_convertido, i.fator_informado, i.avisos_vendedor, i.avisos_ivan])
    }
    expect(itens.find((x) => x.numero === 1)).toMatchObject({ origem: 'vendedor', delta: 0.0938, marca_informada: 'Marca B' })
  })

  it('robô: coleta das 16h17 — resposta nova (compare-and-set do hash) e "Cotações ainda não enviadas"', async () => {
    await relogio('2026-10-19T19:17:00Z')
    // cot_banco.coleta(): rpc('cot_coleta', {})
    const d = await robo('cot_coleta', {})
    expect(chaves(d)).toEqual(COLETA)
    conferirCarimbos(d)
    const texto = JSON.stringify(d)
    for (const proibido of [FULANO.whatsapp, BELTRANO.whatsapp, codigoF]) expect(texto).not.toContain(proibido)
    expect(d.semana_em_compra).toEqual({ id: semana, data_referencia: DATA_REF, aprovada_em: '2026-10-19T11:00:00.000000Z',
      aguardando_ate: '2026-10-20T15:00:00.000000Z' })
    // Beltrano ainda não recebeu: os 2 itens dele seguem "Aguardando cotação" (sai no aviso das 16h17, D41)
    expect(d.pendentes_preparar).toEqual([{ vendedor_id: V_BELTRANO, codigo: 'beltrano', rotulo: 'FORNECEDOR B',
      empresa: BELTRANO.empresa, nome: 'Beltrano', itens: 2 }])
    const c = d.cotacoes.find((x: Json) => x.id === fulanoId)
    expect(chaves(c)).toEqual(COLETA_COTACAO)
    expect(chaves(c.gerais)).toEqual(COLETA_GERAIS)
    expect(chaves(c.resumo)).toEqual(RESUMO)
    for (const i of c.itens) {
      expect(chaves(i)).toEqual(COLETA_ITEM)
      for (const k of CAMPOS_ITEM_ROBO) expect(i, k).toHaveProperty(k)
    }
    for (const k of CAMPOS_GERAIS_ROBO) expect(c.gerais).toHaveProperty(k)
    expect(c).toMatchObject({ status: 'respondida', ultimo_envio_em: '2026-10-19T18:11:00.000000Z', notificado_hash: null, notificado_em: null,
      gerais: { origem: 'vendedor', rev: 1 }, resumo: { itens: 4, respondidos: 3, tem: 2, nao_tem: 1 }, pedido: null })
    expect(c.itens.find((i: Json) => i.numero === 1)).toMatchObject({ origem: 'vendedor', marca_informada: 'Marca B', preco_digitado: 31.5 })
    expect(d.historico).toEqual([
      { vendedor_id: V_FULANO, enviadas: 1, respondidas: 1, pelo_link: 1 },
      { vendedor_id: V_BELTRANO, enviadas: 0, respondidas: 0, pelo_link: 0 },
    ])

    // 1. resposta nova: reserva com o hash novo e o ultimo_envio_em lido; a segunda coleta não consegue a mesma reserva
    const h = hashDe(c.itens)
    const reserva = { p_cotacao: fulanoId, p_hash_antigo: c.notificado_hash, p_hash_novo: h, p_em: c.ultimo_envio_em }
    expect(await robo('cot_marcar_notificado', reserva)).toBe(true)
    expect(await robo('cot_marcar_notificado', reserva)).toBe(false)
    // e-mail falhou: devolve (hash e carimbo antigos) e reserva de novo
    expect(await robo('cot_marcar_notificado', { p_cotacao: fulanoId, p_hash_antigo: h, p_hash_novo: null, p_em: null })).toBe(true)
    expect(await robo('cot_marcar_notificado', reserva)).toBe(true)
    const d2 = await robo('cot_coleta', {})
    const c2 = d2.cotacoes.find((x: Json) => x.id === fulanoId)
    // tem_envio_novo do robô: ultimo_envio_em > notificado_em → falso agora (mesmo instante, mesmo texto)
    expect([c2.notificado_hash, c2.notificado_em]).toEqual([h, c.ultimo_envio_em])

    // 3. cotações ainda não enviadas: marca por vendedor (uma vez), devolve se o e-mail falhar
    const aviso = { p_semana: semana, p_vendedor: V_BELTRANO, p_tipo: 'preparar' }
    expect(await robo('cot_marcar_aviso', aviso)).toBe(true)
    expect(await robo('cot_marcar_aviso', aviso)).toBe(false)
    expect(await robo('cot_desmarcar_aviso', { p_semana: semana, p_vendedores: [V_BELTRANO], p_tipo: 'preparar' })).toBe(1)
    expect(await robo('cot_marcar_aviso', aviso)).toBe(true)
  })

  it('App: Beltrano preparado e "Já enviei"; Ivan cola a resposta do Fulano (leitor de texto → cot_responder_admin)', async () => {
    await relogio('2026-10-19T19:30:00Z')
    const d = await api.congelarCotacao(beltranoId)
    codigoB = d.codigo as string
    expect(d.itens.map((i) => [i.numero, i.produto_id, i.rotulo, i.qtd])).toEqual([[1, 106, 'kg', 25], [2, 105, 'saco', 3]])
    expect(mensagemCotacao(d)).toContain('2. GELO ESCAMA – 3 sacos – R$')
    await api.confirmarEnvio(beltranoId)
    expect((await api.cotacoesDaSemana(semana)).find((c) => c.id === beltranoId)).toMatchObject({ status: 'enviada' })

    // ter 09:00: o Fulano respondeu o item 2 pelo WhatsApp; o Ivan cola
    await relogio('2026-10-20T12:00:00Z')
    const itens = await api.itensDasCotacoes([fulanoId])
    const colado = [
      '[20/10, 09:14] Fulano: 2. REFRIGERANTE LATA 350 ML – 48 un – R$ 42,00 fd c/12',
      '[20/10, 09:15] Fulano: 7. CANELA – R$ 50,00',
      '[20/10, 09:15] Fulano: entrego amanhã cedo',
    ].join('\n')
    const lida = lerColagem(colado, itens)
    expect(lida.foraDaVersao).toEqual([7])
    expect(lida.naoEntendidas).toEqual(['entrego amanhã cedo'])
    expect(lida.reconhecidos).toEqual([{ numero: 2, rev_lida: 0, estado: 'tem', preco: 42, base: 'embalagem', emb_unidades: 12,
      emb_gramas: null, emb_ml: null }])
    const envio = randomUUID()
    const r = await api.responderComoAdmin(fulanoId, envio, lida.reconhecidos, null, 'ivan_colou')
    expect(r).toMatchObject({ ok: true, reenvio: false, gerais: null, itens: [{ numero: 2, resultado: 'gravado', rev: 1, erro: null }] })
    // o mesmo envio de novo (toque duplo, rede): idempotente
    expect(await api.responderComoAdmin(fulanoId, envio, lida.reconhecidos, null, 'ivan_colou')).toEqual({ ...r, reenvio: true })

    const depois = await api.itensDasCotacoes([fulanoId])
    const i2 = depois.find((x) => x.numero === 2)!
    expect(i2).toMatchObject({ origem: 'ivan_colou', preco_convertido: 3.5, fator_informado: 12, avisos_ivan: ['fator_nao_confirmado'], delta: 0.1667 })
    const conta = converter(itens.find((x) => x.numero === 2)!, lida.reconhecidos[0])
    expect([conta.preco_convertido, conta.fator_informado, conta.avisos_vendedor, conta.avisos_ivan])
      .toEqual([i2.preco_convertido, i2.fator_informado, i2.avisos_vendedor, i2.avisos_ivan])
    // o resumo do cartão (cot_resumo): totais só sobre referência ok (D10)
    const [res] = await api.resumosDasCotacoes([fulanoId])
    expect(res).toMatchObject({ itens: 4, respondidos: 4, tem: 3, nao_tem: 1, com_referencia: 2, total_cotado: 325.5, total_ultimo: 288 })
  })

  it('robô: coleta das 12h17 — cobrança do Beltrano, e a colagem do Ivan não gera e-mail de resposta', async () => {
    await relogio('2026-10-20T15:17:00Z')
    const d = await robo('cot_coleta', {})
    conferirCarimbos(d)
    const b = d.cotacoes.find((x: Json) => x.id === beltranoId)
    // para_cobrar do cot_coleta.py
    expect(b).toMatchObject({ status: 'enviada', cobranca_em: null, resumo: { respondidos: 0, gerais_respondidas: false } })
    expect(new Date(b.prazo) <= new Date(d.agora) && new Date(d.agora) < new Date(b.fechamento)).toBe(true)
    expect(await robo('cot_marcar_cobranca', { p_cotacao: beltranoId })).toBe(true)
    expect(await robo('cot_marcar_cobranca', { p_cotacao: beltranoId })).toBe(false)
    expect(await robo('cot_liberar_cobranca', { p_cotacao: beltranoId })).toBe(true)
    expect(await robo('cot_marcar_cobranca', { p_cotacao: beltranoId })).toBe(true)
    // o Ivan colou: ultimo_envio_em (só do vendedor) não andou → tem_envio_novo continua falso
    const f = d.cotacoes.find((x: Json) => x.id === fulanoId)
    expect(f.ultimo_envio_em).toBe(f.notificado_em)
    expect(f.itens.find((i: Json) => i.numero === 2)).toMatchObject({ origem: 'ivan_colou' })
    // a etiqueta "Aguardando" do Beltrano já venceu e ele já recebeu: nada pendente de preparar
    expect(d.pendentes_preparar).toEqual([])
  })

  it('App: Confirmar pedido pelo mapa (montarPedido, sugestão aceita) → cot_gravar_pedido; etiquetas e economia', async () => {
    await relogio('2026-10-20T19:00:00Z')
    const itens = await api.itensDasCotacoes([fulanoId])
    const sugestao = sugestaoLoja(itens)
    expect(sugestao).toEqual([2]) // REFRIGERANTE +16,7% sobre o último preço
    const mapa = montarPedido(itens)
    expect(mapa).toEqual([
      { numero: 1, qtd: 60, base: 'embalagem', embalagens: 5, fator: 12, preco_combinado: 31.5 },
      { numero: 2, qtd: 48, base: 'embalagem', embalagens: 4, fator: 12, preco_combinado: 42 },
      { numero: 4, qtd: 20, base: 'litro', embalagens: null, fator: null, preco_combinado: 6.2 },
    ])
    const noPedido = mapa.filter((l) => !sugestao.includes(l.numero)) // [Aceitar sugestão]
    const pedido = await api.gravarPedido(fulanoId, noPedido)
    expect(chaves(pedido)).toEqual(['confirmado_em', 'confirmado_por', 'cotacao_id', 'itens'])
    expect(pedido).toMatchObject({ cotacao_id: fulanoId, confirmado_por: ADMIN, confirmado_em: '2026-10-20T19:00:00.000000Z' })
    for (const l of pedido.itens) expect(chaves(l)).toEqual(PEDIDO_LINHA)
    expect(pedido.itens).toEqual([
      { produto_id: 101, numero: 1, embalagens: 5, fator: 12, qtd: 60, preco_combinado: 31.5, base: 'embalagem', preco_convertido: 2.625, marca: 'Marca B' },
      { produto_id: 104, numero: 4, embalagens: null, fator: null, qtd: 20, preco_combinado: 6.2, base: 'litro', preco_convertido: 6.2, marca: null },
    ])
    // toque duplo: o mesmo pedido de novo é idempotente
    expect(await api.gravarPedido(fulanoId, noPedido)).toEqual(pedido)
    const lido = await api.pedidoDaCotacao(fulanoId)
    expect(lido?.itens).toEqual(pedido.itens)
    expect(new Date(lido!.confirmado_em).getTime()).toBe(new Date(pedido.confirmado_em).getTime())

    // mensagem do pedido (10.3) com o total com frete das condições do vendedor
    const [c] = await api.cotacoesDaSemana(semana)
    const msg = mensagemPedido(await api.dadosEnvio(fulanoId), pedido, c, c.entrega)
    expect(msg).toContain('1. ÁGUA MINERAL 500ML – 5 fardos c/12 (60 un) – R$ 31,50 o fardo')
    expect(msg).toContain('Total com frete: R$ 296,50 (itens R$ 281,50 + frete R$ 15,00)')

    // etiquetas (cot_marcas_semana) para o admin e para o comprador
    await relogio('2026-10-20T19:05:00Z')
    // qtd (D63): a do pedido e a das linhas da cotação, como número (o App compara com a aprovada)
    const esperado = [
      { produto: 101, estado: 'pedido', vendedor: 'FORNECEDOR A', qtd: 60 },
      { produto: 104, estado: 'pedido', vendedor: 'FORNECEDOR A', qtd: 20 },
      { produto: 105, estado: 'em_cotacao', vendedor: 'FORNECEDOR B', qtd: 3 },
      { produto: 106, estado: 'em_cotacao', vendedor: 'FORNECEDOR B', qtd: 25 },
    ]
    const itensSemana = await api.itensDaSemana(semana)
    const produtoDe = (id: number) => itensSemana.find((i) => i.id === id)?.produto_id
    for (const quem of [ADMIN, JOAO]) {
      const m = await comoApp(quem, () => api.marcasDaSemana(semana))
      expect(m.map((x) => ({ produto: produtoDe(x.item_semana_id), estado: x.estado, vendedor: x.vendedor, qtd: x.qtd }))
        .sort((a, b) => (a.produto ?? 0) - (b.produto ?? 0)), quem).toEqual(esperado)
      for (const x of m) expect(chaves(x)).toEqual(['ate', 'estado', 'item_semana_id', 'qtd', 'vendedor', 'vendedor_id'])
    }

    // a página do Fulano agora diz "pedido confirmado"
    const a = await pagina('cotacao_abrir', { p_codigo: codigoF, p_previa: false })
    expect(a).toMatchObject({ ok: true, estado: 'pedido_confirmado', texto: 'O Ivan já confirmou o pedido com você pelo WhatsApp. Obrigado!',
      itens: [], gerais: null, gerais_rev: 0, validade_opcoes: [] })

    // economia (cot_economia) e o pedido visto de outra semana (Revisão)
    expect(await api.economiaSemanas()).toEqual([{ semana_id: semana, data_referencia: DATA_REF, pedidos: 1, itens_pedido: 2,
      itens_com_referencia: 1, itens_sem_comparacao: 1, total_pedido: 157.5, total_ultimo: 144, diferenca: 13.5 }])
    const recentes = await api.pedidosRecentes(semana + 1, '2026-10-12T03:00:00.000Z')
    expect(recentes.map((p) => [p.cotacao_id, p.semana_id, p.vendedor_id, p.itens.length])).toEqual([[fulanoId, semana, V_FULANO, 2]])
    expect(await api.pedidosRecentes(semana, '2026-10-12T03:00:00.000Z')).toEqual([])
    // cotações de outras semanas ainda vivas (o filtro .or() do api.ts): a do Beltrano sim, a com pedido não
    expect((await api.cotacoesAnterioresVivas(semana + 1)).map((c2) => c2.id)).toEqual([beltranoId])
  })

  it('robô: fechamento das 17h10 — fecha, reserva o consolidado, devolve a reserva quando o e-mail falha', async () => {
    await relogio('2026-10-20T20:10:00Z')
    // cot_banco.fechar_vencidas(): rpc('cot_fechar_vencidas') → corpo {}
    const r = await robo('cot_fechar_vencidas', {})
    expect(r).toEqual({ agora: '2026-10-20T20:10:00.000000Z', fechadas: [beltranoId], expirados: [],
      semanas: [{ semana_id: semana, data_referencia: DATA_REF, tipo: 'consolidado' }] })
    const res = await robo('cot_reservar_consolidado', { p_semana: semana })
    expect(res).toEqual({ semana_id: semana, tipo: 'consolidado', reservada_em: '2026-10-20T20:10:00.000000Z', parcial: false,
      ids: [fulanoId, beltranoId],
      antes: [{ id: fulanoId, consolidado_em: null, consolidado_rev: null }, { id: beltranoId, consolidado_em: null, consolidado_rev: null }] })

    // cot_fechamento.py: coleta(p_semana) para o e-mail e a planilha
    const d = await robo('cot_coleta', { p_semana: semana })
    conferirCarimbos(d)
    expect(d.semanas).toEqual([{ id: semana, data_referencia: DATA_REF, status: 'em_compra' }])
    const f = d.cotacoes.find((x: Json) => x.id === fulanoId)
    expect(f).toMatchObject({ status: 'fechada', resultado: 'pedido', consolidado_rev: 6 }) // 5 gravações de item + 1 das condições
    expect(chaves(f.pedido)).toEqual(['confirmado_em', 'confirmado_por', 'itens'])
    expect(f.pedido.itens).toEqual(JSON.parse(JSON.stringify((await api.pedidoDaCotacao(fulanoId))!.itens)))
    expect(d.cotacoes.find((x: Json) => x.id === beltranoId)).toMatchObject({ status: 'fechada', resultado: null, cobranca_em: expect.stringMatching(ISO_Z) })

    // e-mail falhou: cot_liberar_consolidado recebe o JSON da própria reserva
    expect(await robo('cot_liberar_consolidado', { p_reserva: res })).toBe(2)
    const de_novo = await robo('cot_reservar_consolidado', { p_semana: semana })
    expect(de_novo).toMatchObject({ tipo: 'consolidado', ids: [fulanoId, beltranoId] })
    // outra execução no mesmo dia: nada a reservar
    expect(await robo('cot_reservar_consolidado', { p_semana: semana })).toMatchObject({ tipo: null, ids: [], antes: [], reservada_em: null })

    // depois do fechamento, "Em cotação" só fica no item com preço (nenhum no Beltrano); o pedido continua
    const m = await api.marcasDaSemana(semana)
    expect(m.map((x) => x.estado)).toEqual(['pedido', 'pedido'])
    // a página do Beltrano: encerrada
    const b = await pagina('cotacao_abrir', { p_codigo: codigoB, p_previa: false })
    expect(b).toMatchObject({ ok: true, estado: 'encerrada', texto: 'Cotação encerrada às 17h de ter 20/10. Obrigado!', itens: [] })
    const tarde = await pagina('cotacao_responder', { p_codigo: codigoB, p_envio_id: randomUUID(),
      p_itens: [temPagina(2, 0, { preco: 10, base: 'un' })], p_gerais: null })
    expect(tarde).toEqual({ ok: false, erro: 'estado', estado: 'encerrada', texto: 'Cotação encerrada às 17h de ter 20/10. Obrigado!', nova: null })
  })

  it('App: resposta atrasada digitada pelo Ivan → "Consolidado atualizado" no fechamento seguinte; Obrigado', async () => {
    await relogio('2026-10-20T20:30:00Z')
    const itens = await api.itensDasCotacoes([beltranoId])
    const gelo = itens.find((i) => i.produto_id === 105)!
    const entrada: EntradaItem = { numero: gelo.numero as number, rev_lida: gelo.rev, estado: 'tem', preco: 10, base: 'un',
      emb_unidades: null, emb_gramas: null, emb_ml: null, tenho_so: null, a_partir_de: null, similar_desc: null, similar_preco: null, marca: null }
    const r = await api.responderComoAdmin(beltranoId, randomUUID(), [entrada], null, 'ivan_digitou')
    expect(r.itens[0]).toMatchObject({ resultado: 'gravado', rev: 1 })
    // com preço, o item volta a "Em cotação" até o pedido ou o Obrigado
    expect((await api.marcasDaSemana(semana)).map((x) => x.estado).sort()).toEqual(['em_cotacao', 'pedido', 'pedido'])

    await relogio('2026-10-21T20:10:00Z')
    const r2 = await robo('cot_fechar_vencidas', {})
    expect(r2).toMatchObject({ fechadas: [], expirados: [], semanas: [{ semana_id: semana, tipo: 'atualizado' }] })
    expect(await robo('cot_reservar_consolidado', { p_semana: semana })).toMatchObject({ tipo: 'atualizado', ids: [beltranoId] })
    const d = await robo('cot_coleta', { p_semana: semana })
    // taxa de resposta (D40): a resposta digitada pelo Ivan conta em respondidas, não em pelo_link
    expect(d.historico).toEqual([
      { vendedor_id: V_FULANO, enviadas: 1, respondidas: 1, pelo_link: 1 },
      { vendedor_id: V_BELTRANO, enviadas: 1, respondidas: 1, pelo_link: 0 },
    ])

    await api.dispensarCotacao(beltranoId) // "Obrigado, desta vez não"
    expect((await api.marcasDaSemana(semana)).map((x) => x.estado)).toEqual(['pedido', 'pedido'])
  })

  it('robô: 14 dias depois do fechamento os links expiram; a página e o App veem o link morto', async () => {
    await relogio('2026-11-03T20:10:00Z')
    const r = await robo('cot_fechar_vencidas', {})
    expect(r.expirados).toEqual([fulanoId, beltranoId])
    expect(await pagina('cotacao_abrir', { p_codigo: codigoF, p_previa: false })).toEqual({ ok: false, erro: 'codigo_invalido',
      texto: 'Este link não vale mais. Peça um novo ao Ivan pelo WhatsApp.' })
    expect((await api.dadosEnvio(fulanoId)).codigo).toBeNull()
    expect(await api.codigosDasCotacoes([fulanoId, beltranoId])).toEqual({})
  })
})

describe('toda chamada do App acha a função pelo nome dos parâmetros (nenhum PGRST202)', () => {
  it('as ações que o fluxo não usou respondem com a regra do banco, não com "função não encontrada"', async () => {
    // estado final do fluxo acima: Fulano com pedido, Beltrano dispensado, semana ainda em compra
    const chamadas: [string, () => Promise<unknown>, RegExp][] = [
      ['cot_descongelar', () => api.descongelarCotacao(fulanoId), /só dá para desfazer/],
      ['cot_trocar_codigo', () => api.trocarCodigo(fulanoId), /só dá para trocar o link de uma cotação viva/],
      ['cot_nova_versao', () => api.novaVersao(fulanoId), /não há item novo para uma cotação complementar/],
      ['cot_cancelar', () => api.cancelarCotacao(fulanoId), /só dá para cancelar/],
      ['cot_liberar_loja', () => api.liberarLoja(fulanoId), /só dá para liberar um vendedor em rascunho/],
      ['cot_voltar_a_cotar', () => api.voltarACotar(fulanoId), /não está em "Comprar na loja"/],
      ['cot_dispensar', () => api.dispensarCotacao(fulanoId), /pedido já confirmado/],
      ['cot_desfazer_pedido', () => api.desfazerPedido(beltranoId), /esta cotação não tem pedido confirmado/],
      ['cot_marcar_item', () => api.marcarItemCotacao(999999, true), /item da cotação não encontrado/],
      ['cot_definir_vendedor', () => api.definirVendedor(999999, V_FULANO), /produto desconhecido/],
      ['cot_definir_nota', () => api.definirNota(999999, 'x'), /produto desconhecido/],
      ['cot_confirmar_envio', () => api.confirmarEnvio(999999), /cotação não encontrada/],
      ['cot_congelar', () => api.congelarCotacao(999999), /cotação não encontrada/],
      ['cot_gravar_pedido', () => api.gravarPedido(beltranoId, [{ numero: 1, qtd: 1, base: 'kg', embalagens: null, fator: null, preco_combinado: 1 }]),
        /esta cotação não aceita pedido/],
      ['cot_responder_admin', () => api.responderComoAdmin(fulanoId, randomUUID(), [], null, 'ivan_digitou'), /esta cotação não aceita mais respostas/],
    ]
    for (const [nome, f, regra] of chamadas) {
      const erro = await f().then(() => null, (e: api.ErroApi) => e)
      expect(erro, nome).toBeInstanceOf(api.ErroApi)
      expect(erro?.code, `${nome}: ${erro?.message}`).toBe('P0001')
      expect(erro?.message, nome).toMatch(regra)
    }
    // "Trocar vendedor" de verdade (produto da semana) grava sem erro
    await api.definirVendedor(107, V_BELTRANO)
    // o comprador não chama as funções do admin: a recusa é de permissão, não de nome
    const recusa = await comoApp(JOAO, () => api.prepararCotacoes(semana).then(() => null, (e: api.ErroApi) => e))
    expect(recusa?.code).toBe('42501')
    // e a página (anon) não chama nada além das duas funções dela
    const anon = await rpcRest(db, 'anon', 'cot_coleta', {})
    expect(anon.error?.code).toBe('42501')
  })
})

describe('Nova versão e Trocar link: o link antigo leva à v2, a v2 herda respostas e aviso, e o Ivan limpa o que veio pelo link', () => {
  it('App (novaVersao, congelar, trocarCodigo, responderComoAdmin) × página (cotacao_abrir) × robô (cot_coleta)', async () => {
    await limpar(db)
    await semear(db)
    const s = await semanaAprovada()
    await api.prepararCotacoes(s)
    const v1 = (await api.cotacoesDaSemana(s)).find((c) => c.vendedor_id === V_FULANO)!
    const d1 = await api.congelarCotacao(v1.id)
    await relogio('2026-10-19T18:10:00Z')
    const r = await pagina('cotacao_responder', { p_codigo: d1.codigo, p_envio_id: randomUUID(),
      p_itens: [temPagina(1, 0, { preco: 31.5, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' })], p_gerais: null })
    expect(r.itens[0]).toMatchObject({ resultado: 'gravado', rev: 1 })
    // o robô avisou a resposta (reserva do hash)
    await relogio('2026-10-19T19:17:00Z')
    const cv1 = (await robo('cot_coleta', {})).cotacoes.find((x: Json) => x.id === v1.id)
    const h = hashDe(cv1.itens)
    expect(await robo('cot_marcar_notificado', { p_cotacao: v1.id, p_hash_antigo: null, p_hash_novo: h, p_em: cv1.ultimo_envio_em })).toBe(true)

    // Nova versão (o rascunho v2 leva os itens do vendedor, marcados como estavam) e Preparar mensagem da v2
    await relogio('2026-10-19T19:30:00Z')
    const rascunho = await api.novaVersao(v1.id)
    expect(rascunho).toBeGreaterThan(v1.id)
    expect(await api.novaVersao(v1.id)).toBe(rascunho) // toque duplo: o mesmo rascunho
    const d2 = await api.congelarCotacao(rascunho)
    expect(d2).toMatchObject({ versao: 2, substitui_versao: 1, status: 'pronta', prazo: d1.prazo })
    expect(d2.itens.map((i) => [i.numero, i.produto_id])).toEqual(d1.itens.map((i) => [i.numero, i.produto_id])) // números iguais
    const msg = mensagemCotacao(d2)
    expect(msg).toContain('Cotação v2 — substitui a v1; números iguais, itens novos no fim · Obrigado!')
    // "Abrir o WhatsApp de novo" da v2, montado das leituras, com a versão que ela substituiu
    const c2 = (await api.cotacoesDaSemana(s)).find((c) => c.id === rascunho)!
    const v = (await api.listarVendedores()).find((x) => x.id === V_FULANO)!
    const codigos = await api.codigosDasCotacoes([rascunho])
    expect(mensagemCotacao(dadosEnvioDe(c2, await api.itensDasCotacoes([rascunho]), v, codigos[rascunho],
      { data_referencia: DATA_REF, substitui_versao: 1 }))).toBe(msg)

    // página: o link da v1 leva à v2; a v2 abre com a resposta copiada (rev 0, o número é o mesmo)
    expect(await pagina('cotacao_abrir', { p_codigo: d1.codigo, p_previa: false })).toMatchObject({
      ok: true, estado: 'substituida', texto: 'Esta cotação foi atualizada (v2)', nova: { versao: 2, codigo: d2.codigo }, itens: [] })
    const a2 = await pagina('cotacao_abrir', { p_codigo: d2.codigo, p_previa: false })
    expect(a2).toMatchObject({ ok: true, estado: 'aberta', versao: 2, substitui_versao: 1 })
    expect(a2.itens[0]).toMatchObject({ numero: 1, rev: 0, resposta: { estado: 'tem', preco_digitado: 31.5, marca_informada: 'Marca A' } })

    // robô: a v2 carrega o hash e o carimbo do aviso (D33) → nenhum e-mail repetido
    const cv2 = (await robo('cot_coleta', {})).cotacoes.find((x: Json) => x.id === rascunho)
    expect([cv2.notificado_hash, cv2.notificado_em, cv2.ultimo_envio_em]).toEqual([h, cv1.ultimo_envio_em, cv1.ultimo_envio_em])
    expect(cv2.itens.find((i: Json) => i.numero === 1)).toMatchObject({ origem: 'vendedor', copiada_da_versao: 1, marca_informada: 'Marca A' })

    // Trocar link: os códigos da v1 e da v2 morrem, o novo abre; os contadores do link zeram (D39)
    const d3 = await api.trocarCodigo(rascunho)
    expect(d3.codigo).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(d3.codigo).not.toBe(d2.codigo)
    for (const velho of [d1.codigo, d2.codigo]) {
      expect(await pagina('cotacao_abrir', { p_codigo: velho, p_previa: false })).toMatchObject({ ok: false, erro: 'codigo_invalido' })
    }
    const [cont] = (await db.query<Json>('select envios_aceitos, abrir_na_janela, tentativas_na_janela from cot_cotacoes where id = $1', [rascunho])).rows
    expect(cont).toEqual({ envios_aceitos: 0, abrir_na_janela: 0, tentativas_na_janela: 0 })

    // "Limpar respostas do link antigo" (LimparRespostas.tsx): o item que veio pelo link volta a "sem resposta"
    const doLink = (await api.itensDasCotacoes([rascunho])).filter((i) => i.incluido && i.numero != null && i.origem === 'vendedor')
    expect(doLink.map((i) => i.numero)).toEqual([1])
    const limpo = await api.responderComoAdmin(rascunho, randomUUID(),
      doLink.map((i) => ({ numero: i.numero as number, rev_lida: i.rev, estado: 'sem_resposta' as const })), null, 'ivan_digitou')
    expect(limpo.itens).toMatchObject([{ numero: 1, resultado: 'gravado', rev: 1, valor_atual: { estado: 'sem_resposta', marca_informada: null } }])
    const a3 = await pagina('cotacao_abrir', { p_codigo: d3.codigo, p_previa: false })
    expect(a3).toMatchObject({ ok: true, estado: 'aberta', versao: 2 })
    expect(a3.itens[0]).toMatchObject({ numero: 1, rev: 1, resposta: { estado: 'sem_resposta', preco_digitado: null } })
  })
})
