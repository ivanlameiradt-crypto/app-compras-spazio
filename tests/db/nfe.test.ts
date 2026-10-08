import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, semanaComPedido, como, chamar, ADMIN, SEGREDO, fixarRelogio, pedido } from './fixture-recebimento'
import { JOAO } from './fixture'
import { erroDe, type Json, aprovar, preparar, cotacaoDe, V_FULANO, payloadDe, encerrar } from './fixture-cotacao'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.5.3, D.5.4 e D.11): espelho e conferência das NF-e. Cadeia até a D2.

const atual = bancoRecebimento()
const banco = async () => atual()

const CHAVE = '15261012345678000190550010001234561000000017' // cnpj emitente = substr(,7,14) = 12345678000190
const CHAVE2 = '15261099887766000155550010009999991000000012'

function nfeItem(over: Json = {}): Json {
  return { n: 1, cod_forn: '17253', descricao: 'REFRIG COLA', qtd_nf: 9, unidade_nf: 'FD',
    produto_id: null, associacao: null, qtd: null, unidade_sischef: 'UN',
    v_prod: 0, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0, ...over }
}
function nota(over: Json = {}): Json {
  return { chave: CHAVE, emitente: 'FORNECEDOR A LTDA', numero: '000123456', emissao: '2026-10-18', valor_nf: 378,
    totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 }, itens: [nfeItem()], ...over }
}
function leitura(notas: Json[], over: Json = {}): Json {
  return { lida_em: '2026-10-20T15:03:10Z', completa: true, origem: 'agendada', notas, ...over }
}
const sync = (db: PGlite, notas: Json[], over: Json = {}, quem = 'anon') =>
  chamar(db, quem, 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify(leitura(notas, over))])
const syncSegredo = (db: PGlite, seg: string, notas: Json[]) =>
  chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [seg, JSON.stringify(leitura(notas))])

async function confNfe(db: PGlite, chave = CHAVE): Promise<Json> {
  const [r] = await como(db, ADMIN, `select conferencia, conferencia_hash, notificado_hash, situacao, vendedor_id, cotacao_id, xml_lido,
    v_prod, v_ipi, saiu_da_fila_em from cot_nfe where chave = $1`, [chave])
  return r
}

/** Pedido do Fulano com o item 101 por fardo (fator 12), R$ 42,00 o fardo, 108 un; marca opcional. */
async function pedidoFardo(db: PGlite, marca?: string) {
  return semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco: 42, respBase: 'un', marca }])
}

describe('D — credencial do robô (cot_nfe_exigir_robo)', () => {
  it('sem segredo, vazio ou errado → "não autorizado" e não grava nada', async () => {
    const db = await banco()
    for (const seg of ['', 'errado', 'x'.repeat(64)]) {
      expect(await erroDe(syncSegredo(db, seg, [nota()]))).toBe('não autorizado')
    }
    expect(await erroDe(chamar(db, 'anon', 'cot_nfe_sincronizar(null, $1::jsonb)', [JSON.stringify(leitura([nota()]))]))).toBe('não autorizado')
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe_leituras')).toEqual([{ n: 0 }])
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe')).toEqual([{ n: 0 }])
  })

  it('sem o segredo cot_nfe_robo no Vault, tudo dá "não autorizado" (nunca aceita vazio = vazio)', async () => {
    const db = await banco()
    await db.exec('truncate vault.decrypted_secrets')
    expect(await erroDe(syncSegredo(db, '', [nota()]))).toBe('não autorizado')
    expect(await erroDe(syncSegredo(db, SEGREDO, [nota()]))).toBe('não autorizado')
  })

  it('com o segredo certo, anon executa as 3 do robô; authenticated não executa nenhuma', async () => {
    const db = await banco()
    await sync(db, [nota()]) // anon com segredo → ok
    // authenticated (ADMIN) não tem grant nas 3 do robô (a 4ª, da Fase 3, é conferida no bloco dela, cadeia inteira)
    await expect(como(db, ADMIN, `select cot_nfe_sincronizar($1, $2::jsonb)`, [SEGREDO, JSON.stringify(leitura([nota()]))]))
      .rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `select cot_nfe_marcar_lancadas($1, '[]'::jsonb)`, [SEGREDO])).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `select cot_nfe_marcar_notificado($1, 'x', null, 'y')`, [SEGREDO])).rejects.toThrow(/permission denied/)
  })

  it('as 6 internas ficam sem execute para anon, authenticated E service_role', async () => {
    const db = await banco()
    const internas = ['cot_nfe_exigir_robo(text)', 'cot_nfe_vendedor(text,text)', 'cot_nfe_casar(text)',
      'cot_nfe_conferir(text)', 'cot_nfe_cnpj_trocar(text,bigint)', 'cot_pedido_antes_de_apagar()']
    for (const f of internas) {
      for (const papel of ['anon', 'authenticated', 'service_role']) {
        const [r] = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [papel, `public.${f}`])).rows
        expect([f, papel, r.ok]).toEqual([f, papel, false])
      }
    }
  })
})

describe('D — sincronização (D.5.3)', () => {
  it('payload inválido não grava nada', async () => {
    const db = await banco()
    expect(await erroDe(sync(db, [nota({ chave: '123' })]))).toBe('leitura de notas inválida: chave')
    expect(await erroDe(sync(db, [nota(), nota()]))).toBe('leitura de notas inválida: chave') // repetida
    expect(await erroDe(sync(db, [nota({ emissao: 'xx' })]))).toBe('leitura de notas inválida: emissao')
    expect(await erroDe(sync(db, [nota()], { origem: 'outra' }))).toBe('leitura de notas inválida: origem')
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe_leituras')).toEqual([{ n: 0 }])
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe')).toEqual([{ n: 0 }])
  })

  it('CNPJ = substr(chave,7,14); vendedor pela grafia (e o CNPJ é aprendido); sem vendedor', async () => {
    const db = await banco()
    await sync(db, [nota()])
    const n = await confNfe(db)
    const [{ cnpj_emitente }] = await como(db, ADMIN, 'select cnpj_emitente from cot_nfe where chave = $1', [CHAVE])
    expect(cnpj_emitente).toBe('12345678000190')
    expect(Number(n.vendedor_id)).toBe(1) // FORNECEDOR A LTDA
    const [ap] = await como(db, ADMIN, `select vendedor_id, origem from cot_fornecedores_cnpj where cnpj = '12345678000190'`)
    expect([Number(ap.vendedor_id), ap.origem]).toEqual([1, 'nome'])
    // outra NF de emitente desconhecido → sem vendedor
    await sync(db, [nota({ chave: CHAVE2, emitente: 'DESCONHECIDA LTDA' })], { completa: false })
    const [n2] = await como(db, ADMIN, 'select vendedor_id from cot_nfe where chave = $1', [CHAVE2])
    expect(n2.vendedor_id).toBeNull()
  })

  it('vendedor pelo CNPJ já conhecido (passo 1 antes da grafia)', async () => {
    const db = await banco()
    await db.query(`insert into cot_fornecedores_cnpj (cnpj, vendedor_id, origem, nome_na_nf, criado_em)
                    values ('12345678000190', 2, 'ivan', 'OUTRA', now())`)
    await sync(db, [nota({ emitente: 'FORNECEDOR A LTDA' })]) // grafia apontaria para 1, mas o CNPJ manda: 2
    const n = await confNfe(db)
    expect(Number(n.vendedor_id)).toBe(2)
  })

  it('janela: NF 16 dias depois do pedido não casa; NF 1 dia antes casa', async () => {
    const db = await banco()
    await pedidoFardo(db)
    // pedido confirmado em 2026-10-19. NF emissao 2026-11-04 → janela [10-20, 11-05] não pega 10-19
    await sync(db, [nfeParaCasar('2026-11-04')], {})
    expect((await confNfe(db)).cotacao_id).toBeNull()
    // NF emissao 2026-10-18 → janela [10-03, 10-19] pega 10-19 (emissao+1)
    await sync(db, [nfeParaCasar('2026-10-18')])
    expect((await confNfe(db)).cotacao_id).not.toBeNull()
  })

  it('vínculo do Ivan nunca é trocado pela leitura', async () => {
    const db = await banco()
    const { cotacao } = await pedidoFardo(db)
    await sync(db, [nota()]) // casa auto
    await chamar(db, ADMIN, 'cot_nfe_vincular($1, null)', [CHAVE]) // "não é pedido" (vinculo ivan)
    await sync(db, [nota()]) // a leitura não pode recasar
    const n = await confNfe(db)
    expect(n.cotacao_id).toBeNull()
    void cotacao
  })

  it('leitura completa marca saída; incompleta não; nota que volta à fila; lancada é final', async () => {
    const db = await banco()
    await sync(db, [nota()]) // na_fila
    // leitura completa sem essa nota → saiu_da_fila
    await sync(db, [nota({ chave: CHAVE2, emitente: 'X LTDA' })], { completa: true })
    expect((await confNfe(db)).situacao).toBe('saiu_da_fila')
    // reaparece → volta a na_fila
    await sync(db, [nota()])
    expect((await confNfe(db)).situacao).toBe('na_fila')
    // marca lançada, depois uma completa sem ela não a tira de 'lancada'
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)', [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: 'NF 9', lancada_em: '2026-10-20T18:00:00Z' }])])
    await sync(db, [nota({ chave: CHAVE2, emitente: 'X LTDA' })], { completa: true })
    expect((await confNfe(db)).situacao).toBe('lancada')
  })

  it('leitura incompleta nunca marca saída', async () => {
    const db = await banco()
    await sync(db, [nota()])
    await sync(db, [nota({ chave: CHAVE2, emitente: 'X LTDA' })], { completa: false })
    expect((await confNfe(db)).situacao).toBe('na_fila')
  })

  it('retenção: NF sem vendedor e sem vínculo vista há mais de 30 dias é apagada', async () => {
    const db = await banco()
    // relógio em 01/08: a NF sem vendedor é criada e fica (não é velha ainda)
    await fixarRelogio(db, '2026-08-01T12:00:00Z')
    await sync(db, [nota({ chave: CHAVE2, emitente: 'DESCONHECIDA' })], { completa: false, lida_em: '2026-08-01T12:00:00Z' })
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe where chave = $1', [CHAVE2])).toEqual([{ n: 1 }])
    // 45 dias depois, uma nova leitura: a de 01/08 (>30 dias) some
    await fixarRelogio(db, '2026-09-15T12:00:00Z')
    await sync(db, [nota()], { completa: false, lida_em: '2026-09-15T12:00:00Z' })
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_nfe where chave = $1', [CHAVE2])).toEqual([{ n: 0 }])
  })
})

/** NF que casa com o pedido do fardo (produto 101, 108 un, R$ 378 bruto). */
function nfeParaCasar(emissao = '2026-10-18', over: Json = {}): Json {
  return nota({ emissao, itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, unidade_sischef: 'UN',
    descricao: 'REFRIG ITALAC COLA 350ML FD C/12', v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 })], ...over })
}

/** Nota que casa, com item 101 acima/abaixo por preço bruto/desconto. */
function nfePreco(v_prod: number, over: Json = {}): Json {
  return nfeParaCasar('2026-10-18', { totais: { v_prod, v_desc: over.v_desc ?? 0, v_ipi: over.v_ipi ?? 0, v_st: 0, v_frete: over.v_frete ?? 0, v_outro: 0 },
    itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: over.qtd ?? 108, unidade_sischef: over.unidade_sischef ?? 'UN',
      descricao: over.descricao ?? 'REFRIG COLA', v_prod, v_desc: over.v_desc ?? 0, v_ipi: over.v_ipi ?? 0, v_st: 0, v_outro: 0 })] })
}
const estadoItem = async (db: PGlite): Promise<Json> => ((await confNfe(db)).conferencia.itens as Json[])[0]

describe('D — conferência (D.5.3.3)', () => {
  it('igual: R$ 42,00 o fardo c/12 × 9 = R$ 378,00', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar()])
    const i = await estadoItem(db)
    expect(i.estado).toBe('igual'); expect(i.esperado).toBe(378); expect(i.combinado_unit).toBe(3.5)
  })
  it('+R$ 0,02 → acima', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfePreco(378.02)])
    expect((await estadoItem(db)).estado).toBe('acima')
  })
  it('+R$ 0,01 → igual', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfePreco(378.01)])
    expect((await estadoItem(db)).estado).toBe('igual')
  })
  it('fator 3 com 3.000 un → igual (sem falso alarme de arredondamento)', async () => {
    const db = await banco()
    await semanaComPedido(db, [{ produto: 101, qtd: 3000, base: 'embalagem', embalagens: 1000, fator: 3, preco: 10, respBase: 'un' }])
    await sync(db, [nfeParaCasar('2026-10-18', { totais: { v_prod: 10000, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 3000, v_prod: 10000 })] })])
    expect((await estadoItem(db)).estado).toBe('igual')
  })
  it('abaixo; desconto no item compara o líquido', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfePreco(390, { v_desc: 15 })])
    const i = await estadoItem(db)
    expect(i.estado).toBe('abaixo'); expect(i.cobrado).toBe(375)
  })
  it('IPI de 5% → igual, com aviso de imposto', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfePreco(378, { v_ipi: 18.9 })])
    const n = await confNfe(db)
    const i = (n.conferencia.itens as Json[])[0]
    expect(i.estado).toBe('igual'); expect(Number(i.imposto)).toBe(18.9)
    expect(Number(n.conferencia.resumo.imposto)).toBe(18.9)
    expect((n.conferencia.resumo.avisos as string[]).some((a) => /imposto na NF/.test(a))).toBe(true)
  })
  it('sem XML → "confira", nunca "acima"', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar('2026-10-18', { totais: null,
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 396, v_desc: null, v_ipi: null, v_st: null, v_outro: null })] })])
    const n = await confNfe(db)
    expect(n.xml_lido).toBe(false)
    expect((n.conferencia.itens as Json[])[0].estado).toBe('confira')
  })
  it('UN DIFERE (qtd null) → não conferível', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar('2026-10-18', { itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: null, v_prod: 378 })] })])
    expect((await estadoItem(db)).estado).toBe('nao_conferivel')
  })
  it('unidade da NF diferente da do pedido → não conferível', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar('2026-10-18', { itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, unidade_sischef: 'KG', v_prod: 378 })] })])
    expect((await estadoItem(db)).estado).toBe('nao_conferivel')
  })
  it('item não associado → não conferível (a NF casa por outro item)', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar('2026-10-18', { totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ n: 1, produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 378 }),
        nfeItem({ n: 2, produto_id: null, associacao: null, qtd: null, v_prod: 0 })] })])
    const itens = (await confNfe(db)).conferencia.itens as Json[]
    const naoAssoc = itens.find((x) => x.n === 2)
    expect(naoAssoc.estado).toBe('nao_conferivel')
    expect(naoAssoc.motivo).toMatch(/não associado no SisChef/)
  })
  it('litro sem kg_por_litro não é conferível', async () => {
    const db = await banco()
    const semana = await aprovar(db); await preparar(db, semana)
    const cot = await cotacaoDe(db, semana, V_FULANO)
    await pedido(db, cot, [{ produto: 104, qtd: 8, base: 'litro', preco: 48, respBase: 'kg' }]) // 104 é kg, sem kg_por_litro
    await sync(db, [nfeParaCasar('2026-10-18', { itens: [nfeItem({ produto_id: 104, associacao: 'sischef', qtd: 8, unidade_sischef: 'KG', v_prod: 384 })] })])
    expect((await confNfe(db)).conferencia.itens[0].estado).toBe('nao_conferivel')
  })
  it('litro com kg_por_litro 1 é conferido', async () => {
    const db = await banco()
    await db.query(`insert into cot_catalogo (produto_id, origem, kg_por_litro, kg_por_litro_confirmado_em) values (104, 'ivan', 1, now())`)
    const s = await aprovar(db); await preparar(db, s)
    const c = await cotacaoDe(db, s, V_FULANO)
    await pedido(db, c, [{ produto: 104, qtd: 8, base: 'litro', preco: 6, respBase: 'kg' }]) // 6/1 = 6/kg
    await sync(db, [nfeParaCasar('2026-10-18', { totais: { v_prod: 48, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ produto_id: 104, associacao: 'sischef', qtd: 8, unidade_sischef: 'KG', v_prod: 48 })] })]) // 8 × 6 = 48 → igual
    expect((await confNfe(db)).conferencia.itens[0].estado).toBe('igual')
  })
  it('marca ok', async () => {
    const db = await banco(); await pedidoFardo(db, 'Italac')
    await sync(db, [nfeParaCasar('2026-10-18', { itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 378, descricao: 'REFRIG ITALAC COLA' })] })])
    expect((await confNfe(db)).conferencia.itens[0].marca).toBe('ok')
  })
  it('marca confira', async () => {
    const db = await banco(); await pedidoFardo(db, 'Italac')
    await sync(db, [nfeParaCasar('2026-10-18', { itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 378, descricao: 'REFRIG OUTRA COLA' })] })])
    expect((await confNfe(db)).conferencia.itens[0].marca).toBe('confira')
  })
  it('marca sem_marca', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar()])
    expect((await confNfe(db)).conferencia.itens[0].marca).toBe('sem_marca')
  })
  it('frete acima; qtd_nf a mais', async () => {
    const db = await banco()
    const { cotacao } = await pedidoFardo(db)
    await db.query(`update cot_cotacoes set frete = 0 where id = $1`, [cotacao]) // frete combinado 0 (grátis)
    await sync(db, [nfeParaCasar('2026-10-18', { totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 30, v_outro: 0 },
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 120, v_prod: 378 })] })]) // veio 120 > 108 → a mais
    const n = await confNfe(db)
    expect(Number(n.conferencia.resumo.frete_acima)).toBe(30)
    const [cf] = await como(db, ADMIN, 'select qtd_nf from cot_conferencia where cotacao_id = $1', [cotacao])
    expect(cf.qtd_nf).toBe('a_mais')
  })
  it('frete acima pela SOMA das NFs do pedido, não por NF isolada (D.5.3.3)', async () => {
    const db = await banco()
    const { cotacao } = await pedidoFardo(db)
    await db.query(`update cot_cotacoes set frete = 30 where id = $1`, [cotacao]) // frete combinado R$ 30
    // O pedido chega em duas NFs (mesmo vendedor pela grafia), cada uma cobrando o frete de R$ 30 (em dobro).
    const nf1 = nfeParaCasar('2026-10-18', { totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 30, v_outro: 0 } })
    const nf2 = nfeParaCasar('2026-10-18', { chave: CHAVE2, totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 30, v_outro: 0 } })
    await sync(db, [nf1, nf2])
    // Cada NF isolada: 30 não passa de 30,01 (nada dispara). A soma 60 passa do combinado 30 → frete_acima = 30.
    expect(Number((await confNfe(db, CHAVE2)).conferencia.resumo.frete_acima)).toBe(30)
    // Uma releitura das duas juntas deixa as duas NFs refletindo o resumo do pedido (60 − 30).
    await sync(db, [nf1, nf2])
    expect(Number((await confNfe(db, CHAVE)).conferencia.resumo.frete_acima)).toBe(30)
    expect(Number((await confNfe(db, CHAVE2)).conferencia.resumo.frete_acima)).toBe(30)
  })
  it('veio a mais pela SOMA das NFs do pedido, não por NF isolada (D.5.3.3)', async () => {
    const db = await banco()
    const { cotacao } = await pedidoFardo(db) // 108 un, R$ 3,50/un
    // O pedido de 108 un chega em duas NFs de 60 un cada (120 no total): nenhuma sozinha passa de 108.
    const meia = (chave: string) => nfeParaCasar('2026-10-18', { chave,
      totais: { v_prod: 210, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 60, v_prod: 210 })] }) // 60 × 3,50 = 210 → igual
    const nf1 = meia(CHAVE), nf2 = meia(CHAVE2)
    const r = await sync(db, [nf1, nf2])
    // A soma 120 > 108 → a view marca a linha do pedido como "veio a mais" (o App pinta de vermelho).
    const [cf] = await como(db, ADMIN, 'select qtd_nf from cot_conferencia where cotacao_id = $1', [cotacao])
    expect(cf.qtd_nf).toBe('a_mais')
    // e a NF que fecha a soma já leva o gatilho de aviso (preço igual, então "veio a mais" é o único gatilho).
    expect((await confNfe(db, CHAVE2)).conferencia.resumo.qtd_a_mais).toBe(true)
    expect((r.avisar as Json[]).map((a) => a.chave)).toContain(CHAVE2)
    // uma releitura das duas juntas deixa as duas NFs refletindo o "veio a mais" do pedido.
    await sync(db, [nf1, nf2])
    expect((await confNfe(db, CHAVE)).conferencia.resumo.qtd_a_mais).toBe(true)
    expect((await confNfe(db, CHAVE2)).conferencia.resumo.qtd_a_mais).toBe(true)
  })
  it('o hash muda quando a conferência muda e não muda numa leitura igual', async () => {
    const db = await banco(); await pedidoFardo(db)
    await sync(db, [nfeParaCasar()])
    const h1 = (await confNfe(db)).conferencia_hash
    await sync(db, [nfeParaCasar()]) // leitura igual
    expect((await confNfe(db)).conferencia_hash).toBe(h1)
    await sync(db, [nfeParaCasar('2026-10-18', { totais: { v_prod: 400, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 400 })] })])
    expect((await confNfe(db)).conferencia_hash).not.toBe(h1)
  })
})

describe('D — dois candidatos e complementar (D.5.3.2)', () => {
  it('vence o de mais itens em comum; o item do outro pedido é conferido contra ele', async () => {
    const db = await banco()
    // semana 1 (Fulano): itens 101 e 102
    const s1 = await aprovar(db); await preparar(db, s1)
    const c1 = await cotacaoDe(db, s1, V_FULANO)
    await pedido(db, c1, [{ produto: 101, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco: 42, respBase: 'un' },
      { produto: 102, qtd: 48, base: 'un', preco: 3 }])
    await encerrar(db, s1)
    // semana 2 (Fulano): item 103
    const s2 = await aprovar(db, payloadDe('2026-10-26'))
    await preparar(db, s2)
    const c2 = await cotacaoDe(db, s2, V_FULANO)
    await pedido(db, c2, [{ produto: 103, qtd: 8, base: 'kg', preco: 5 }])
    // NF com 101, 102 (do pedido 1) e 103 (do pedido 2)
    await sync(db, [nota({ emissao: '2026-10-19', totais: { v_prod: 500, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [
        nfeItem({ n: 1, produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 378 }),
        nfeItem({ n: 2, produto_id: 102, associacao: 'sischef', qtd: 48, v_prod: 144 }),
        nfeItem({ n: 3, produto_id: 103, associacao: 'sischef', qtd: 8, unidade_sischef: 'KG', v_prod: 40 }),
      ] })])
    const n = await confNfe(db)
    expect(Number(n.cotacao_id)).toBe(c1) // c1 tem 2 pontos, c2 tem 1
    const itens = n.conferencia.itens as Json[]
    const i103 = itens.find((x) => Number(x.produto_id) === 103)
    expect(Number(i103.cotacao_id)).toBe(c2) // conferido contra a outra
    expect(i103.motivo).toMatch(/do pedido de/)
  })
})

describe('D — aviso (cot_nfe_marcar_notificado)', () => {
  it('compara-e-troca; três leituras iguais geram um aviso só', async () => {
    const db = await banco(); await pedidoFardo(db)
    // NF acima → entra em "avisar"
    const acima = nfeParaCasar('2026-10-18', { totais: { v_prod: 400, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
      itens: [nfeItem({ produto_id: 101, associacao: 'sischef', qtd: 108, v_prod: 400 })] })
    const r1 = await sync(db, [acima])
    expect(r1.avisar).toHaveLength(1)
    const av = r1.avisar[0]
    // o robô reserva com compara-e-troca
    const trocou = await chamar(db, 'anon', 'cot_nfe_marcar_notificado($1, $2, $3, $4)', [SEGREDO, CHAVE, av.hash_anterior, av.hash])
    expect(trocou).toBe(true)
    // segunda leitura igual: o hash não mudou → não avisa
    const r2 = await sync(db, [acima])
    expect(r2.avisar).toHaveLength(0)
    // uma segunda reserva com o hash antigo errado não troca
    const trocou2 = await chamar(db, 'anon', 'cot_nfe_marcar_notificado($1, $2, $3, $4)', [SEGREDO, CHAVE, null, 'zzz'])
    expect(trocou2).toBe(false)
  })
})

describe('D — CNPJ (2ª revisão n.º 12)', () => {
  it('cot_cnpj_mover leva as NF-e sem vínculo do Ivan; cot_cnpj_remover as deixa sem vendedor', async () => {
    const db = await banco()
    await sync(db, [nota()]) // aprende cnpj 12345678000190 → vendedor 1 (grafia)
    const mov = await chamar(db, ADMIN, 'cot_cnpj_mover($1, $2)', ['12345678000190', 2])
    expect(Number(mov.nfes_movidas)).toBe(1)
    expect(Number((await confNfe(db)).vendedor_id)).toBe(2)
    const [h] = await como(db, ADMIN, `select count(*)::int as n from historico_alteracoes where tabela = 'cot_nfe'`)
    expect(h.n).toBeGreaterThan(0)
    const rem = await chamar(db, ADMIN, 'cot_cnpj_remover($1)', ['12345678000190'])
    expect(Number(rem.nfes_sem_vendedor)).toBe(1)
    expect((await confNfe(db)).vendedor_id).toBeNull()
    // comprador é recusado
    expect(await erroDe(chamar(db, JOAO, 'cot_cnpj_mover($1, $2)', ['12345678000190', 1]))).toBe('apenas o administrador pode fazer isso')
    expect(await erroDe(chamar(db, ADMIN, 'cot_cnpj_mover($1, $2)', ['00000000000000', 1]))).toBe('CNPJ não encontrado')
  })
})

describe('Fase 3 — lançar pelo app: forma de pagamento e estado do disparo (cot_nfe_marcar_estado)', () => {
  const atualF3 = bancoRecebimento(null) // a cadeia INTEIRA: a Fase 3 vem depois da D2
  const bancoF3 = async () => atualF3()
  const estado = (db: PGlite, seg: string, p: Json) =>
    chamar(db, 'anon', 'cot_nfe_marcar_estado($1, $2::jsonb)', [seg, JSON.stringify(p)])
  async function lancamento(db: PGlite, chave = CHAVE): Promise<Json> {
    const [r] = await como(db, ADMIN, `select forma_pagamento, lancamento_estado, lancamento_motivo, lancamento_estado_em, situacao
      from cot_nfe where chave = $1`, [chave])
    return r
  }

  it('o robô grava revisar | erro | ensaio_ok com o motivo; chave desconhecida = 0', async () => {
    const db = await bancoF3()
    await sync(db, [nota()])
    expect(Number(await estado(db, SEGREDO, { chave: CHAVE, estado: 'revisar', motivo: 'falta a forma de pagamento' }))).toBe(1)
    let l = await lancamento(db)
    expect([l.lancamento_estado, l.lancamento_motivo]).toEqual(['revisar', 'falta a forma de pagamento'])
    expect(l.lancamento_estado_em).not.toBeNull()
    expect(Number(await estado(db, SEGREDO, { chave: CHAVE, estado: 'erro', motivo: 'pedido JÁ gerado 9' }))).toBe(1)
    expect((await lancamento(db)).lancamento_estado).toBe('erro')
    expect(Number(await estado(db, SEGREDO, { chave: CHAVE, estado: 'ensaio_ok', motivo: '' }))).toBe(1)
    l = await lancamento(db)
    expect([l.lancamento_estado, l.lancamento_motivo]).toEqual(['ensaio_ok', null])   // motivo vazio vira null
    expect(Number(await estado(db, SEGREDO, { chave: CHAVE2, estado: 'revisar' }))).toBe(0)
  })

  it('estado fora da lista do robô, segredo errado e nota já lançada (lançada é final)', async () => {
    const db = await bancoF3()
    await sync(db, [nota()])
    for (const e of ['lancando', 'lancada', '', 'qualquer']) {
      expect(await erroDe(estado(db, SEGREDO, { chave: CHAVE, estado: e }))).toBe('estado inválido')
    }
    expect(await erroDe(estado(db, 'errado', { chave: CHAVE, estado: 'revisar' }))).toBe('não autorizado')
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: 'NF 9', lancada_em: '2026-10-20T18:00:00Z' }])])
    expect(Number(await estado(db, SEGREDO, { chave: CHAVE, estado: 'erro' }))).toBe(0)
    expect((await lancamento(db)).situacao).toBe('lancada')
  })

  it('motivo longo é cortado em 2000; forma e estado fora do formato são recusados pelo banco', async () => {
    const db = await bancoF3()
    await sync(db, [nota()])
    await estado(db, SEGREDO, { chave: CHAVE, estado: 'revisar', motivo: 'x'.repeat(5000) })
    expect(String((await lancamento(db)).lancamento_motivo).length).toBe(2000)
    // a Edge Function grava a forma com a service_role: o banco ainda confere o formato
    for (const forma of ['boleto', 'dinheiro', 'tesouraria', 'cartao', 'pix:bradesco|ij', null]) {
      await db.query('update cot_nfe set forma_pagamento = $1 where chave = $2', [forma, CHAVE])
    }
    for (const forma of ['cheque', 'pix', 'pix:', 'PIX:bradesco|ij', 'dinheiro ', 'pix:bradesco|ij|x']) {
      await expect(db.query('update cot_nfe set forma_pagamento = $1 where chave = $2', [forma, CHAVE])).rejects.toThrow(/check/)
    }
    await expect(db.query(`update cot_nfe set lancamento_estado = 'lancada' where chave = $1`, [CHAVE])).rejects.toThrow(/check/)
  })

  it('a 4ª do robô (cot_nfe_marcar_estado) é só de anon com o segredo: authenticated não executa', async () => {
    const db = await bancoF3()
    await expect(como(db, ADMIN, `select cot_nfe_marcar_estado($1, '{}'::jsonb)`, [SEGREDO])).rejects.toThrow(/permission denied/)
  })
})

describe('Fase 3 — boletos do XML na cot_nfe (cot_nfe_anexar_parcelas)', () => {
  const atualF3C = bancoRecebimento(null)
  const bancoF3C = async () => atualF3C()
  const anexar = (db: PGlite, seg: string, p: Json) =>
    chamar(db, 'anon', 'cot_nfe_anexar_parcelas($1, $2::jsonb)', [seg, JSON.stringify(p)])
  async function parcelas(db: PGlite, chave = CHAVE): Promise<unknown> {
    const [r] = await como(db, ADMIN, 'select parcelas from cot_nfe where chave = $1', [chave])
    return r.parcelas
  }

  it('antes da leitura do XML as parcelas são NULL; o robô grava as duplicatas normalizadas e o admin lê', async () => {
    const db = await bancoF3C()
    await sync(db, [nota()])
    expect(await parcelas(db)).toBeNull()
    const n = await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [
      { numero: '001', vencimento: '2026-11-05', valor: 100.5, lixo: 'x' },
      { numero: '', vencimento: null, valor: 0 },
    ] }] })
    expect(Number(n)).toBe(1)
    expect(await parcelas(db)).toEqual([
      { numero: '001', vencimento: '2026-11-05', valor: 100.5 },
      { numero: null, vencimento: null, valor: 0 },
    ])
  })

  it('lista vazia = XML lido e sem duplicatas (à vista); é idempotente e a última gravação vale', async () => {
    const db = await bancoF3C()
    await sync(db, [nota()])
    await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [] }] })
    expect(await parcelas(db)).toEqual([])
    await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [{ numero: '1', vencimento: '2026-12-01', valor: 5 }] }] })
    await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [{ numero: '1', vencimento: '2026-12-01', valor: 5 }] }] })
    expect(await parcelas(db)).toEqual([{ numero: '1', vencimento: '2026-12-01', valor: 5 }])
  })

  it('chave desconhecida é ignorada (0) e nota já lançada nunca é mexida', async () => {
    const db = await bancoF3C()
    await sync(db, [nota()])
    expect(Number(await anexar(db, SEGREDO, { notas: [{ chave: CHAVE2, parcelas: [] }] }))).toBe(0)
    await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [{ numero: '1', vencimento: '2026-12-01', valor: 5 }] }] })
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: 'NF 9', lancada_em: '2026-10-20T18:00:00Z' }])])
    expect(Number(await anexar(db, SEGREDO, { notas: [{ chave: CHAVE, parcelas: [] }] }))).toBe(0)
    expect(await parcelas(db)).toEqual([{ numero: '1', vencimento: '2026-12-01', valor: 5 }])
  })

  it('formato inválido derruba o lote inteiro (nada é gravado) e o segredo errado é recusado', async () => {
    const db = await bancoF3C()
    await sync(db, [nota()])
    const boa = { chave: CHAVE, parcelas: [{ numero: '1', vencimento: '2026-12-01', valor: 5 }] }
    const ruins: Array<[string, Json]> = [
      ['parcelas inválidas: notas', { notas: 'x' }],
      ['parcelas inválidas: chave', { notas: [boa, { chave: '123', parcelas: [] }] }],
      ['parcelas inválidas: parcelas', { notas: [boa, { chave: CHAVE2, parcelas: 'x' }] }],
      ['parcelas inválidas: parcelas', { notas: [boa, { chave: CHAVE2, parcelas: Array.from({ length: 61 }, () => ({ valor: 1 })) }] }],
      ['parcelas inválidas: parcela', { notas: [boa, { chave: CHAVE2, parcelas: [5] }] }],
      ['parcelas inválidas: vencimento', { notas: [boa, { chave: CHAVE2, parcelas: [{ vencimento: 'amanhã', valor: 1 }] }] }],
      ['parcelas inválidas: valor', { notas: [boa, { chave: CHAVE2, parcelas: [{ vencimento: '2026-12-01', valor: -1 }] }] }],
      ['parcelas inválidas: valor', { notas: [boa, { chave: CHAVE2, parcelas: [{ vencimento: '2026-12-01' }] }] }],
      ['parcelas inválidas: valor', { notas: [boa, { chave: CHAVE2, parcelas: [{ vencimento: '2026-12-01', valor: 99999999 }] }] }],
    ]
    for (const [msg, p] of ruins) {
      expect([msg, await erroDe(anexar(db, SEGREDO, p))]).toEqual([msg, msg])
    }
    expect(await parcelas(db)).toBeNull() // a nota "boa" do mesmo lote também ficou de fora
    expect(await erroDe(anexar(db, 'errado', { notas: [boa] }))).toBe('não autorizado')
  })

  it('a 5ª do robô (cot_nfe_anexar_parcelas) é só de anon com o segredo: authenticated não executa', async () => {
    const db = await bancoF3C()
    await expect(como(db, ADMIN, `select cot_nfe_anexar_parcelas($1, '{}'::jsonb)`, [SEGREDO])).rejects.toThrow(/permission denied/)
  })
})

describe('Fase 3 — descartar a nota que não dá para lançar (cot_nfe_descartar / cot_nfe_restaurar)', () => {
  const atualF3E = bancoRecebimento(null)
  const bancoF3E = async () => atualF3E()
  const descartar = (db: PGlite, quem: string, chave = CHAVE, motivo: string | null = 'Sem itens (XML resumido)') =>
    chamar(db, quem, 'cot_nfe_descartar($1, $2)', [chave, motivo])
  async function situacao(db: PGlite, chave = CHAVE): Promise<Json> {
    const [r] = await como(db, ADMIN, `select situacao, descartada_em, descartada_por, descartada_motivo, lancamento_estado
      from cot_nfe where chave = $1`, [chave])
    return r
  }

  it('o admin descarta: a nota segue na_fila, com quem, quando e por quê; sem motivo vira NULL e o motivo longo é cortado em 300', async () => {
    const db = await bancoF3E()
    await sync(db, [nota()])
    expect((await situacao(db)).descartada_em).toBeNull()
    await descartar(db, ADMIN)
    let s = await situacao(db)
    expect(s.situacao).toBe('na_fila')
    expect(s.descartada_em).not.toBeNull()
    expect(String(s.descartada_por)).toContain('@')
    expect(s.descartada_motivo).toBe('Sem itens (XML resumido)')
    await descartar(db, ADMIN, CHAVE, '   ')
    expect((await situacao(db)).descartada_motivo).toBeNull()
    await descartar(db, ADMIN, CHAVE, 'x'.repeat(500))
    s = await situacao(db)
    expect(String(s.descartada_motivo).length).toBe(300)
    await expect(db.query('update cot_nfe set descartada_motivo = $1 where chave = $2', ['y'.repeat(301), CHAVE])).rejects.toThrow(/check/)
  })

  it('a leitura da SEFAZ NUNCA desfaz o descarte (nem com o XML lido depois); ao sair da fila vira saiu_da_fila e continua descartada', async () => {
    const db = await bancoF3E()
    await sync(db, [nota()])
    await descartar(db, ADMIN)
    const antes = (await situacao(db)).descartada_em
    await sync(db, [nota()])                                                  // nova leitura, mesma nota ainda na fila
    await sync(db, [nota({ itens: [nfeItem({ produto_id: 7, associacao: 'sischef', qtd: 9 })] })]) // e agora com itens
    let s = await situacao(db)
    expect([s.situacao, s.descartada_em]).toEqual(['na_fila', antes])
    await sync(db, [nota({ chave: CHAVE2, emitente: 'OUTRO LTDA', numero: '9' })])  // leitura completa sem a nossa nota
    s = await situacao(db)
    expect(s.situacao).toBe('saiu_da_fila')
    expect(s.descartada_em).toEqual(antes) // mesma data (objeto Date: compara pelo valor)
  })

  it('restaurar desfaz (e é idempotente); chave desconhecida é recusada', async () => {
    const db = await bancoF3E()
    await sync(db, [nota()])
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])                 // não estava descartada: não faz nada e não dá erro
    await descartar(db, ADMIN)
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
    const s = await situacao(db)
    expect([s.situacao, s.descartada_em, s.descartada_por, s.descartada_motivo]).toEqual(['na_fila', null, null, null])
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
    expect(await erroDe(chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE2]))).toBe('nota não encontrada')
    expect(await erroDe(descartar(db, ADMIN, CHAVE2))).toBe('nota não encontrada')
  })

  it('recusa nota lançada, nota pela metade (erro) e nota que o robô está lançando agora; aceita revisar, ensaio_ok e reserva presa (> 30 min)', async () => {
    const db = await bancoF3E()
    await fixarRelogio(db, '2026-10-20T15:00:00Z')
    await sync(db, [nota()])
    const marcar = (estado: string | null, minutosAtras: number | null) => db.query(
      `update cot_nfe set lancamento_estado = $1, lancamento_em = case when $2::int is null then null else cot_agora() - make_interval(mins => $2::int) end where chave = $3`,
      [estado, minutosAtras, CHAVE])
    await marcar('erro', null)
    expect(await erroDe(descartar(db, ADMIN))).toBe('esta nota ficou pela metade: confira no SisChef antes de descartar')
    await marcar('lancando', 5)
    expect(await erroDe(descartar(db, ADMIN))).toBe('o robô está lançando esta nota agora: aguarde terminar')
    await marcar('lancando', null)                                            // sem carimbo: na dúvida, recusa
    expect(await erroDe(descartar(db, ADMIN))).toBe('o robô está lançando esta nota agora: aguarde terminar')
    expect((await situacao(db)).descartada_em).toBeNull()
    for (const [estado, min] of [['revisar', null], ['ensaio_ok', null], ['lancando', 31]] as const) {
      await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
      await marcar(estado, min)
      await descartar(db, ADMIN)
      expect([estado, (await situacao(db)).descartada_em === null]).toEqual([estado, false])
    }
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
    await marcar(null, null)
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: 'NF 9', lancada_em: '2026-10-20T14:00:00Z' }])])
    expect(await erroDe(descartar(db, ADMIN))).toBe('esta nota não está mais na fila: não dá para descartar')
  })

  it('só o admin descarta e restaura (comprador é recusado) e a anon nem executa; cada mudança fica no histórico', async () => {
    const db = await bancoF3E()
    await sync(db, [nota()])
    expect(await erroDe(descartar(db, JOAO))).toBe('apenas o administrador pode fazer isso')
    expect(await erroDe(chamar(db, JOAO, 'cot_nfe_restaurar($1)', [CHAVE]))).toBe('apenas o administrador pode fazer isso')
    await expect(como(db, 'anon', `select cot_nfe_descartar($1, 'x')`, [CHAVE])).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', `select cot_nfe_restaurar($1)`, [CHAVE])).rejects.toThrow(/permission denied/)
    expect((await situacao(db)).descartada_em).toBeNull()
    await descartar(db, ADMIN)
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
    const h = await como(db, ADMIN, `select antes, depois from historico_alteracoes where tabela = 'cot_nfe' and registro = $1 order by id`, [CHAVE])
    expect(h.map((x) => (x.depois as Json).descartada)).toEqual([true, false])
    expect((h[0].depois as Json).motivo).toBe('Sem itens (XML resumido)')
  })
})

describe('Fase 3 — associar o produto de um item pelo app (cot_nfe_associar)', () => {
  const atualF3F = bancoRecebimento(null)
  const bancoF3F = async () => atualF3F()
  const OLEO = 3138573
  const LEITE = 3469626
  /** O catálogo do app (itens_semana): 2 semanas; o nome do óleo mudou na mais nova (a mais nova manda). */
  async function catalogo(db: PGlite) {
    await db.exec(`
      insert into semanas (data_referencia, status) values ('2026-10-05', 'encerrada'), ('2026-10-12', 'em_compra');
      insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, situacao, incluido)
        select s.id, ${OLEO}, case when s.data_referencia = '2026-10-05' then 'OLEO ANTIGO (UN)' else 'ÓLEO DE SOJA - INSUMOS (UN)' end, false, 'un', 1, 'Repor', true from semanas s;
      insert into itens_semana (semana_id, produto_id, produto, bebida, unidade, estoque, situacao, incluido)
        select s.id, ${LEITE}, 'LEITE CONDESSADO  - INSUMOS (KG)', false, 'kg', 1, 'Repor', true from semanas s where s.data_referencia = '2026-10-12';`)
  }
  const associar = (db: PGlite, quem: string, n: number | null, produto: number | null, chave = CHAVE) =>
    chamar(db, quem, 'cot_nfe_associar($1, $2, $3)', [chave, n, produto])
  async function decisoes(db: PGlite, chave = CHAVE): Promise<Json> {
    const [r] = await como(db, ADMIN, 'select associacoes_app, itens, situacao from cot_nfe where chave = $1', [chave])
    return r
  }
  const dois = () => nota({ itens: [nfeItem(), nfeItem({ n: 2, cod_forn: '99', descricao: 'LEITE COND TIROL' })] })

  it('o admin associa: o servidor grava o produto (nome e unidade da semana mais nova do catálogo), quem e quando; os itens e a situação não mudam', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [dois()])
    expect((await decisoes(db)).associacoes_app).toBeNull()
    await associar(db, ADMIN, 1, OLEO)
    const r = await decisoes(db)
    expect(Object.keys(r.associacoes_app)).toEqual(['1'])
    expect(r.associacoes_app['1']).toMatchObject({ produto_id: OLEO, produto_nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' })
    expect(String(r.associacoes_app['1'].por)).toContain('@')
    expect(Number.isNaN(Date.parse(r.associacoes_app['1'].em))).toBe(false)
    expect(r.situacao).toBe('na_fila')
    expect((r.itens as Json[]).map((i) => [i.n, i.produto_id])).toEqual([[1, null], [2, null]]) // o item da NF não foi tocado
    await associar(db, ADMIN, 2, LEITE)
    expect(Object.keys((await decisoes(db)).associacoes_app).sort()).toEqual(['1', '2'])
    expect((await decisoes(db)).associacoes_app['2']).toMatchObject({ produto_id: LEITE, unidade: 'kg' })
  })

  it('escolher de novo troca a decisão; produto nulo desfaz (e não dá erro se não havia); a decisão sozinha não deixa a coluna com {} ', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [dois()])
    await associar(db, ADMIN, 1, OLEO)
    await associar(db, ADMIN, 1, LEITE)
    expect((await decisoes(db)).associacoes_app['1'].produto_id).toBe(LEITE)
    await associar(db, ADMIN, 2, null)                                       // não havia decisão no item 2: nada acontece
    expect(Object.keys((await decisoes(db)).associacoes_app)).toEqual(['1'])
    await associar(db, ADMIN, 1, null)
    expect((await decisoes(db)).associacoes_app).toBeNull()                  // sem decisões: volta a NULL (não fica {})
    await associar(db, ADMIN, 1, null)                                       // de novo: continua sem erro
  })

  it('recusa nota desconhecida, item que não existe na nota, produto fora da lista de insumos e item que JÁ tem produto no SisChef', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [nota({ itens: [nfeItem(), nfeItem({ n: 2, produto_id: 7, associacao: 'sischef', qtd: 1 }), nfeItem({ n: 3, produto_id: 8, associacao: 'painel' })] })])
    expect(await erroDe(associar(db, ADMIN, 1, OLEO, CHAVE2))).toBe('nota não encontrada')
    expect(await erroDe(associar(db, ADMIN, 9, OLEO))).toBe('item não encontrado na nota')
    expect(await erroDe(associar(db, ADMIN, 1, 999999))).toBe('produto fora da lista de insumos')
    expect(await erroDe(associar(db, ADMIN, 2, OLEO))).toBe('este item já está associado no SisChef')
    await associar(db, ADMIN, 3, OLEO)                                      // "decidido só pelo painel" não é associação de verdade: pode ser refeito
    expect(Object.keys((await decisoes(db)).associacoes_app)).toEqual(['3'])
  })

  it('só nota na fila e sem robô mexendo: recusa lançada, descartada, pela metade (erro) e lançando agora; aceita revisar, ensaio_ok e reserva presa (> 30 min)', async () => {
    const db = await bancoF3F()
    await fixarRelogio(db, '2026-10-20T15:00:00Z')
    await catalogo(db)
    await sync(db, [nota()])
    const marcar = (estado: string | null, minutosAtras: number | null) => db.query(
      `update cot_nfe set lancamento_estado = $1, lancamento_em = case when $2::int is null then null else cot_agora() - make_interval(mins => $2::int) end where chave = $3`,
      [estado, minutosAtras, CHAVE])
    await marcar('erro', null)
    expect(await erroDe(associar(db, ADMIN, 1, OLEO))).toBe('esta nota ficou pela metade: confira no SisChef')
    await marcar('lancando', 5)
    expect(await erroDe(associar(db, ADMIN, 1, OLEO))).toBe('o robô está lançando esta nota agora: aguarde terminar')
    await marcar('lancando', null)                                          // sem carimbo: na dúvida, recusa
    expect(await erroDe(associar(db, ADMIN, 1, OLEO))).toBe('o robô está lançando esta nota agora: aguarde terminar')
    expect((await decisoes(db)).associacoes_app).toBeNull()
    for (const [estado, min] of [['revisar', null], ['ensaio_ok', null], ['lancando', 31]] as const) {
      await marcar(estado, min)
      await associar(db, ADMIN, 1, OLEO)
      expect([estado, (await decisoes(db)).associacoes_app['1'].produto_id]).toEqual([estado, OLEO])
      await associar(db, ADMIN, 1, null)
    }
    await marcar(null, null)
    await chamar(db, ADMIN, 'cot_nfe_descartar($1, $2)', [CHAVE, 'teste'])
    expect(await erroDe(associar(db, ADMIN, 1, OLEO))).toBe('esta nota foi descartada: volte-a para a fila antes de associar')
    await chamar(db, ADMIN, 'cot_nfe_restaurar($1)', [CHAVE])
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: 'NF 9', lancada_em: '2026-10-20T14:00:00Z' }])])
    expect(await erroDe(associar(db, ADMIN, 1, OLEO))).toBe('esta nota não está mais na fila: não dá para associar')
  })

  it('produto novo (criado no SisChef depois da lista semanal): vale o palpite do robô PARA ESSE ITEM; nome do palpite, unidade em branco; só o palpite daquele item autoriza', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    const BIS = 3476455
    await sync(db, [nota({ itens: [
      nfeItem({ sugestao: { id: String(BIS), nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS' } }),
      nfeItem({ n: 2, cod_forn: '99', descricao: 'OUTRO', sugestao: { id: '3469626', nome: 'LEITE CONDENSADO - INSUMOS' } }),
      nfeItem({ n: 3, cod_forn: '98', descricao: 'SEM PALPITE' }),
    ] })])
    expect((await como(db, ADMIN, 'select count(*)::int as n from itens_semana where produto_id = $1', [BIS]))[0].n).toBe(0) // não está na lista semanal
    expect(await erroDe(associar(db, ADMIN, 2, BIS))).toBe('produto fora da lista de insumos')   // o palpite do item 1 não vale para o item 2
    expect(await erroDe(associar(db, ADMIN, 3, BIS))).toBe('produto fora da lista de insumos')   // item sem palpite
    expect(await erroDe(associar(db, ADMIN, 1, 3476456))).toBe('produto fora da lista de insumos') // outro código que não é o palpite
    await associar(db, ADMIN, 1, BIS)
    const d = (await decisoes(db)).associacoes_app['1']
    expect(d).toMatchObject({ produto_id: BIS, produto_nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS', unidade: null, origem: 'sugestao' })
    await associar(db, ADMIN, 2, 3469626)                                                         // este está na lista semanal: vale a lista (com a unidade)
    expect((await decisoes(db)).associacoes_app['2']).toMatchObject({ produto_id: 3469626, unidade: 'kg', origem: 'lista' })
    expect((await decisoes(db)).associacoes_app['2'].produto_nome).toBe('LEITE CONDESSADO - INSUMOS (KG)')
  })

  it('a leitura da SEFAZ NUNCA apaga a decisão (ela reescreve os itens a cada rodada); se o item passa a ter produto no SisChef, a decisão fica guardada mas o item já vem associado', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [nota()])
    await associar(db, ADMIN, 1, OLEO)
    const antes = (await decisoes(db)).associacoes_app
    await sync(db, [nota()])                                                 // nova leitura, mesma nota
    await sync(db, [nota({ itens: [nfeItem({ produto_id: 3138573, associacao: 'sischef', qtd: 9 })] })]) // o Ivan associou no SisChef nesse meio tempo
    const r = await decisoes(db)
    expect(r.associacoes_app).toEqual(antes)
    expect((r.itens as Json[])[0].associacao).toBe('sischef')
    expect(await erroDe(associar(db, ADMIN, 1, LEITE))).toBe('este item já está associado no SisChef')
  })

  it('só o admin associa (comprador é recusado), a anon nem executa, a coluna só aceita objeto; cada mudança fica no histórico', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [nota()])
    expect(await erroDe(associar(db, JOAO, 1, OLEO))).toBe('apenas o administrador pode fazer isso')
    await expect(como(db, 'anon', `select cot_nfe_associar($1, 1, ${OLEO})`, [CHAVE])).rejects.toThrow(/permission denied/)
    expect((await decisoes(db)).associacoes_app).toBeNull()
    await expect(db.query(`update cot_nfe set associacoes_app = '[1]'::jsonb where chave = $1`, [CHAVE])).rejects.toThrow(/check/)
    await associar(db, ADMIN, 1, OLEO)
    await associar(db, ADMIN, 1, LEITE)
    await associar(db, ADMIN, 1, null)
    const h = await como(db, ADMIN, `select antes, depois from historico_alteracoes where tabela = 'cot_nfe' and registro = $1 order by id`, [CHAVE])
    expect(h).toHaveLength(3)
    expect((h[0].depois as Json).associacao_app.decisao.produto_id).toBe(OLEO)
    expect((h[1].antes as Json).associacao_app.decisao.produto_id).toBe(OLEO)
    expect((h[1].depois as Json).associacao_app.decisao.produto_id).toBe(LEITE)
    expect((h[2].depois as Json).associacao_app.decisao).toBeNull()
  })

  // ---------- ETAPA 2 (migração 20261212000001): a decisão ganha a conversão de unidade (1 unidade da nota = ? unidades do produto)
  const associarConv = (db: PGlite, n: number, produto: number | null, conversao: number | null) =>
    chamar(db, ADMIN, 'cot_nfe_associar($1, $2, $3, $4::numeric)', [CHAVE, n, produto, conversao])

  it('etapa 2: a assinatura antiga de 3 parâmetros não existe mais; só a de 4, com p_conversao opcional (default null)', async () => {
    const db = await bancoF3F()
    const r = await db.query<{ f: string; args: string }>(
      `select regexp_replace(p.oid::regprocedure::text, '\\s', '', 'g') as f, pg_get_function_arguments(p.oid) as args
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cot_nfe_associar'`)
    expect(r.rows.map((x) => x.f.replace(/^public\./, ''))).toEqual(['cot_nfe_associar(text,integer,bigint,numeric)']) // uma só: sem ambiguidade para o PostgREST
    expect(r.rows[0].args).toMatch(/p_conversao numeric DEFAULT NULL/i)
  })

  it('etapa 2: sem conversão (3 argumentos) a decisão sai com conversao null; com conversão grava o número; escolher de novo troca; o histórico leva a conversão', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [dois()])
    await associar(db, ADMIN, 1, OLEO)                                         // o app antigo / unidades iguais: sem conversão
    expect((await decisoes(db)).associacoes_app['1']).toMatchObject({ produto_id: OLEO, conversao: null })
    expect(Object.keys((await decisoes(db)).associacoes_app['1'])).toContain('conversao') // a chave existe mesmo nula: o robô lê sem adivinhar
    await associarConv(db, 2, LEITE, 0.395)                                    // lata de 395 g: NF em UN, produto em KG
    expect((await decisoes(db)).associacoes_app['2']).toMatchObject({ produto_id: LEITE, unidade: 'kg', conversao: 0.395 })
    await associarConv(db, 2, LEITE, 0.4)                                      // escolher de novo troca a conversão
    expect((await decisoes(db)).associacoes_app['2'].conversao).toBe(0.4)
    await associarConv(db, 2, LEITE, null)                                     // e pode voltar a ficar sem conversão
    expect((await decisoes(db)).associacoes_app['2'].conversao).toBeNull()
    const h = await como(db, ADMIN, `select depois from historico_alteracoes where tabela = 'cot_nfe' and registro = $1 order by id`, [CHAVE])
    expect(h.map((x) => (x.depois as Json).associacao_app.decisao.conversao)).toEqual([null, 0.395, 0.4, null])
  })

  it('etapa 2: a conversão recusada: zero, negativa, acima de 10000 e com mais de 4 casas (nada é gravado); aceita 0,0001, 1 e 10000', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [nota()])
    for (const [v, erro] of [
      [0, 'a conversão precisa ser maior que zero e até 10000'],
      [-1, 'a conversão precisa ser maior que zero e até 10000'],
      [10001, 'a conversão precisa ser maior que zero e até 10000'],
      [10000.0001, 'a conversão precisa ser maior que zero e até 10000'],
      [0.12345, 'a conversão aceita no máximo 4 casas decimais'],
      [0.00001, 'a conversão aceita no máximo 4 casas decimais'],
    ] as const) {
      expect(await erroDe(associarConv(db, 1, OLEO, v))).toBe(erro)
    }
    expect((await decisoes(db)).associacoes_app).toBeNull()                    // nenhuma recusa deixou rastro
    expect(await como(db, ADMIN, `select count(*)::int as n from historico_alteracoes where tabela = 'cot_nfe'`)).toEqual([{ n: 0 }])
    for (const v of [0.0001, 1, 10000]) {
      await associarConv(db, 1, OLEO, v)
      expect((await decisoes(db)).associacoes_app['1'].conversao).toBe(v)
    }
    // a conversão é conferida mesmo num desfazer: o número que chega aqui é o que o robô digita no SisChef, e lá fica para sempre
    expect(await erroDe(associarConv(db, 1, null, 0))).toBe('a conversão precisa ser maior que zero e até 10000')
    expect((await decisoes(db)).associacoes_app['1'].produto_id).toBe(OLEO)    // o desfazer recusado não desfez
  })

  it('planilha do Ivan: a unidade da decisão vem de produto_planilha (manda sobre itens_semana); produto fora da planilha segue com a de itens_semana', async () => {
    const db = await bancoF3F()
    await catalogo(db)                                                          // LEITE: itens_semana 'kg'; OLEO: 'un'
    await sync(db, [dois()])
    await db.exec(`insert into produto_planilha (produto_id, unidade) values (${LEITE}, 'UN')`)   // o Ivan diz que o leite é UN no SisChef
    await associarConv(db, 2, LEITE, null)
    expect((await decisoes(db)).associacoes_app['2']).toMatchObject({ produto_id: LEITE, unidade: 'un' })
    await associar(db, ADMIN, 1, OLEO)                                         // fora da planilha: continua a de itens_semana
    expect((await decisoes(db)).associacoes_app['1']).toMatchObject({ produto_id: OLEO, unidade: 'un' })
    await db.exec(`update produto_planilha set unidade = 'KG' where produto_id = ${LEITE}`)
    await associarConv(db, 2, LEITE, 0.395)
    expect((await decisoes(db)).associacoes_app['2']).toMatchObject({ unidade: 'kg', conversao: 0.395 })
  })

  it('produto acrescentado pela planilha (descrição + unidade), fora de itens_semana, pode ser escolhido: o nome e a unidade vêm da planilha; sem descrição segue "fora da lista"', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [dois()])
    const NOVO = 3476366
    expect(await erroDe(associar(db, ADMIN, 1, NOVO))).toBe('produto fora da lista de insumos')
    await db.exec(`insert into produto_planilha (produto_id, unidade) values (${NOVO}, 'KG')`)                 // só a unidade: ainda não é produto da lista
    expect(await erroDe(associar(db, ADMIN, 1, NOVO))).toBe('produto fora da lista de insumos')
    await db.exec(`update produto_planilha set descricao = 'CHOCOLATE BARRA LACTA LAKA OREO - INSUMOS' where produto_id = ${NOVO}`)
    await associarConv(db, 1, NOVO, 0.08)
    expect((await decisoes(db)).associacoes_app['1']).toMatchObject({ produto_id: NOVO, produto_nome: 'CHOCOLATE BARRA LACTA LAKA OREO - INSUMOS', unidade: 'kg', origem: 'planilha', conversao: 0.08 })
  })

  it('etapa 2: desfazer continua funcionando com a conversão gravada (com 3 e com 4 argumentos)', async () => {
    const db = await bancoF3F()
    await catalogo(db)
    await sync(db, [dois()])
    await associarConv(db, 1, LEITE, 0.395)
    await associarConv(db, 2, LEITE, 2)
    await associar(db, ADMIN, 1, null)                                         // 3 argumentos (default)
    expect(Object.keys((await decisoes(db)).associacoes_app)).toEqual(['2'])
    await associarConv(db, 2, null, null)                                      // 4 argumentos
    expect((await decisoes(db)).associacoes_app).toBeNull()
    const h = await como(db, ADMIN, `select antes, depois from historico_alteracoes where tabela = 'cot_nfe' and registro = $1 order by id`, [CHAVE])
    expect((h[2].antes as Json).associacao_app.decisao.conversao).toBe(0.395)  // o histórico guarda o que foi desfeito, conversão inclusive
    expect((h[2].depois as Json).associacao_app.decisao).toBeNull()
  })
})

describe('Fase 3 — conversão de item que JÁ vem associado no SisChef com UN DIFERE (cot_nfe_converter_item)', () => {
  const atual = bancoRecebimento(null)
  const banco = async () => atual()
  const CREME = 1855900
  const converter = (db: PGlite, quem: string, n: number, conversao: number | null, chave = CHAVE) =>
    chamar(db, quem, 'cot_nfe_converter_item($1, $2, $3::numeric)', [chave, n, conversao])
  async function decisoes(db: PGlite): Promise<Json> {
    const [r] = await como(db, ADMIN, 'select associacoes_app, itens from cot_nfe where chave = $1', [CHAVE])
    return r
  }
  // item 1 já associado no SisChef (creme de leite); item 2 sem produto
  const duas = () => nota({
    itens: [nfeItem({ produto_id: String(CREME), associacao: 'sischef', produto_nome: 'CREME DE LEITE - INSUMOS', descricao: 'CÓD. FOR: 376611 CREME DE LEITE - INSUMOS' }),
            nfeItem({ n: 2, cod_forn: '99', descricao: 'LEITE COND TIROL' })],
  })

  it('o admin informa a conversão: grava com origem "sischef", o produto que a leitura viu e quem/quando; os itens não mudam', async () => {
    const db = await banco()
    await sync(db, [duas()])
    await converter(db, ADMIN, 1, 1)
    const r = await decisoes(db)
    expect(Object.keys(r.associacoes_app)).toEqual(['1'])
    expect(r.associacoes_app['1']).toMatchObject({ produto_id: CREME, produto_nome: 'CREME DE LEITE - INSUMOS', unidade: null, origem: 'sischef', conversao: 1 })
    expect(String(r.associacoes_app['1'].por)).toContain('@')
    expect((r.itens as Json[]).map((i) => [i.n, i.produto_id])).toEqual([[1, String(CREME)], [2, null]])
    await converter(db, ADMIN, 1, 0.5)                                       // informar de novo troca
    expect((await decisoes(db)).associacoes_app['1'].conversao).toBe(0.5)
    const h = await como(db, ADMIN, `select depois from historico_alteracoes where tabela = 'cot_nfe' and registro = $1 order by id`, [CHAVE])
    expect(h.map((x) => (x.depois as Json).associacao_app.decisao.conversao)).toEqual([1, 0.5])
  })

  it('item sem produto no SisChef é recusado (quem escolhe o produto é a caixa de associação)', async () => {
    const db = await banco()
    await sync(db, [duas()])
    expect(await erroDe(converter(db, ADMIN, 2, 1))).toBe('este item ainda não está associado no SisChef: escolha o produto na caixa de associação')
    expect(await erroDe(converter(db, ADMIN, 9, 1))).toBe('item não encontrado na nota')
    expect((await decisoes(db)).associacoes_app).toBeNull()
  })

  it('a mesma régua da conversão: zero, negativa, acima de 10000 e com mais de 4 casas são recusadas sem deixar rastro', async () => {
    const db = await banco()
    await sync(db, [duas()])
    for (const [v, erro] of [[0, 'a conversão precisa ser maior que zero e até 10000'], [-1, 'a conversão precisa ser maior que zero e até 10000'],
      [10001, 'a conversão precisa ser maior que zero e até 10000'], [0.12345, 'a conversão aceita no máximo 4 casas decimais']] as const) {
      expect(await erroDe(converter(db, ADMIN, 1, v))).toBe(erro)
    }
    expect((await decisoes(db)).associacoes_app).toBeNull()
    expect(await como(db, ADMIN, `select count(*)::int as n from historico_alteracoes where tabela = 'cot_nfe'`)).toEqual([{ n: 0 }])
  })

  it('nula desfaz só a conversão de origem "sischef"; uma decisão de produto do app no mesmo número nunca é apagada por aqui', async () => {
    const db = await banco()
    await sync(db, [duas()])
    await converter(db, ADMIN, 1, 2)
    await converter(db, ADMIN, 1, null)
    expect((await decisoes(db)).associacoes_app).toBeNull()                  // voltou a NULL, não {}
    await converter(db, ADMIN, 2, null)                                      // não havia nada: não dá erro
    await db.query(`update cot_nfe set associacoes_app = '{"2": {"produto_id": 1, "origem": "lista"}}'::jsonb where chave = $1`, [CHAVE])
    await converter(db, ADMIN, 2, null)
    expect((await decisoes(db)).associacoes_app['2'].origem).toBe('lista')
  })

  it('as mesmas travas da associação: nota fora da fila, descartada, pela metade ou com o robô lançando; só o admin', async () => {
    const db = await banco()
    await sync(db, [duas()])
    await db.query(`update cot_nfe set lancamento_estado = 'lancando', lancamento_em = now() where chave = $1`, [CHAVE])
    expect(await erroDe(converter(db, ADMIN, 1, 1))).toBe('o robô está lançando esta nota agora: aguarde terminar')
    await db.query(`update cot_nfe set lancamento_estado = 'erro' where chave = $1`, [CHAVE])
    expect(await erroDe(converter(db, ADMIN, 1, 1))).toBe('esta nota ficou pela metade: confira no SisChef')
    await db.query(`update cot_nfe set lancamento_estado = 'revisar' where chave = $1`, [CHAVE])
    await converter(db, ADMIN, 1, 1)                                         // "revisar" é justamente quando o Ivan informa
    await db.query(`update cot_nfe set descartada_em = now() where chave = $1`, [CHAVE])
    expect(await erroDe(converter(db, ADMIN, 1, 1))).toMatch(/descartada/)
    await expect(como(db, 'anon', `select cot_nfe_converter_item($1, 1, 1)`, [CHAVE])).rejects.toThrow(/permission denied/)
  })
})

describe('Fase 3 — parcelas digitadas pelo Ivan (cot_nfe.parcelas_manuais)', () => {
  const atualF3D = bancoRecebimento(null)
  const bancoF3D = async () => atualF3D()

  it('só aceita lista de 1 a 60 parcelas ou NULL; a leitura da SEFAZ nunca a apaga', async () => {
    const db = await bancoF3D()
    await sync(db, [nota()])
    const [antes] = await como(db, ADMIN, 'select parcelas_manuais from cot_nfe where chave = $1', [CHAVE])
    expect(antes.parcelas_manuais).toBeNull()
    const boa = JSON.stringify([{ vencimento: '2026-11-05', valor: 100 }])
    await db.query('update cot_nfe set parcelas_manuais = $1::jsonb where chave = $2', [boa, CHAVE])
    await sync(db, [nota()]) // nova leitura: a coluna fica como estava
    const [depois] = await como(db, ADMIN, 'select parcelas_manuais from cot_nfe where chave = $1', [CHAVE])
    expect(depois.parcelas_manuais).toEqual([{ vencimento: '2026-11-05', valor: 100 }])
    for (const ruim of ['[]', '{}', '"x"', JSON.stringify(Array.from({ length: 61 }, () => ({ vencimento: '2026-11-05', valor: 1 })))]) {
      await expect(db.query('update cot_nfe set parcelas_manuais = $1::jsonb where chave = $2', [ruim, CHAVE])).rejects.toThrow(/check/)
    }
    await db.query('update cot_nfe set parcelas_manuais = null where chave = $1', [CHAVE])
  })
})
