import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, codigoDe, cotacao, chamar, retrato, produtosDe, cotItemDe,
  itemDe, erroDe, abrir, responder, resp, encerrar, payloadDe, fixarRelogio, V_FULANO, V_BELTRANO, PAYLOAD_COTACAO, type Json,
} from './fixture-cotacao'

// Fase 1B — cot_preparar (7.3.2, contrato 4.1), vendedor do item (3.2), "Trocar vendedor", presos (3.3,
// D37) e a nota do Ivan (4.2a, D49). Semana inventada da fixture: Fulano fica com 101-104, Beltrano com
// 105-106; 107 é de fornecedor sem vendedor e 108 nunca foi comprado.
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

describe('cot_preparar: recusas', () => {
  it('semana inexistente, em rascunho ou encerrada; comprador não chama', async () => {
    const db = await banco()
    expect(await erroDe(preparar(db, 999))).toBe('semana não encontrada')
    const r = await como(db, 'service', 'select importar_semana($1::jsonb) as r', [JSON.stringify(PAYLOAD_COTACAO)])
    const semana = Number(r[0].r.semana_id)
    expect(await erroDe(preparar(db, semana))).toBe('a semana precisa estar em compra (aprovada e não encerrada) para montar as cotações')
    await como(db, ADMIN, 'select aprovar_semana($1)', [semana])
    expect(await erroDe(preparar(db, semana, JOAO))).toBe('apenas o administrador pode fazer isso')
    await encerrar(db, semana)
    expect(await erroDe(preparar(db, semana))).toBe('a semana precisa estar em compra (aprovada e não encerrada) para montar as cotações')
  })
})

describe('cot_preparar: rascunhos e o mapa da semana', () => {
  it('cria um rascunho por vendedor, com cartões, sem vendedor e listas vazias', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    const p = await preparar(db, semana)
    expect(p.semana_id).toBe(semana)
    expect(p.data_referencia).toBe('2026-10-19')
    expect(p.aprovada_em).toBe('2026-10-19T11:00:00.000000Z')
    expect(p.aguardando_ate).toBe('2026-10-20T15:00:00.000000Z')
    expect(p.agora).toBe('2026-10-19T18:00:00.000000Z')
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    // do maior estimado para o menor: Fulano 60×2,40 + 48×3 + 8×5 + 20×6 = 448; Beltrano 3×10 + 25×4 = 130
    expect(p.cartoes).toEqual([
      { vendedor_id: V_FULANO, itens: 4, estimado: 448, cotacoes: [f] },
      { vendedor_id: V_BELTRANO, itens: 2, estimado: 130, cotacoes: [b] },
    ])
    expect(await produtosDe(db, f)).toEqual([101, 102, 103, 104])
    expect(await produtosDe(db, b)).toEqual([105, 106])
    const cf = await cotacao(db, f)
    expect([cf.status, cf.versao, cf.complementar, cf.codigo_hash, cf.prazo]).toEqual(['rascunho', 1, false, null, null])
    expect(p.sem_vendedor).toEqual([
      { item_semana_id: await itemDe(db, semana, 108), produto_id: 108, produto: 'ALHO - INSUMOS (KG)', nome: 'ALHO',
        unidade: 'kg', qtd: 2, motivo: 'nunca_comprado', fornecedor: null, vendedor_id: null },
      { item_semana_id: await itemDe(db, semana, 107), produto_id: 107, produto: 'OVO - INSUMOS (UN)', nome: 'OVO',
        unidade: 'un', qtd: 30, motivo: 'fornecedor_sem_vendedor', fornecedor: 'FORNECEDOR C ME', vendedor_id: null },
    ])
    expect(p.fora_da_enviada).toEqual([])
    expect(p.depois_do_resultado).toEqual([])
    expect(p.presos).toEqual([])
    expect(p.atravessados).toEqual([])
    // itens: todos os da semana (incluídos e com quantidade), com o vendedor e a via; fora da lista não aparece
    expect(p.itens.map((i: { produto_id: number }) => i.produto_id).sort()).toEqual([101, 102, 103, 104, 105, 106, 107, 108])
    const i103 = p.itens.find((i: { produto_id: number }) => i.produto_id === 103)
    expect(i103).toEqual({ item_semana_id: await itemDe(db, semana, 103), produto_id: 103, vendedor_id: V_FULANO,
      via: 'ultima_compra', preso_com: null, ultima_com_outro: null })
    const i107 = p.itens.find((i: { produto_id: number }) => i.produto_id === 107)
    expect([i107.vendedor_id, i107.via]).toEqual([null, null])
  })

  it('retrato do item no rascunho: nome limpo, unidade, rótulo saco, qtd aprovada e referência', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const r = await db.query<Json>(`select produto_id, nome, unidade, rotulo, qtd, qtd_sugerida, numero, incluido, ref_preco, ref_situacao
                                from cot_itens order by produto_id`)
    expect(r.rows.map((x: any) => [x.produto_id, x.nome, x.unidade, x.rotulo, Number(x.qtd), x.numero, x.incluido, x.ref_situacao])).toEqual([
      [101, 'ÁGUA MINERAL 500ML', 'un', 'un', 60, null, true, 'ok'],
      [102, 'REFRIGERANTE LATA 350 ML', 'un', 'un', 48, null, true, 'ok'],
      [103, 'AÇÚCAR CRISTAL', 'kg', 'kg', 8, null, true, 'ok'],
      [104, 'LEITE INTEGRAL', 'kg', 'kg', 20, null, true, 'antiga'], // 171 dias antes da semana
      [105, 'GELO ESCAMA', 'un', 'saco', 3, null, true, 'ok'],
      [106, 'FARINHA DE TRIGO', 'kg', 'kg', 25, null, true, 'sem_referencia'], // último preço 4× o custo médio
    ])
  })

  it('duas chamadas seguidas dão o mesmo estado e o mesmo mapa; nunca escreve em itens_semana', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    const antesTudo = await retrato(db)
    const p1 = await preparar(db, semana)
    const r1 = await retrato(db)
    const p2 = await preparar(db, semana)
    const r2 = await retrato(db)
    expect(p2).toEqual(p1)
    expect(r2).toEqual(r1)
    expect(r1.itens_semana).toEqual(antesTudo.itens_semana)
  })

  it('não toca cotação pronta nem enviada (e o marcar/desmarcar do rascunho sobrevive à sincronização)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, b, 106)])
    await congelar(db, f)
    const antes = await retrato(db)
    await preparar(db, semana)
    expect(await retrato(db)).toEqual(antes)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    const antes2 = await retrato(db)
    await preparar(db, semana)
    expect(await retrato(db)).toEqual(antes2)
    const x = await db.query<Json>('select incluido from cot_itens where cotacao_id = $1 and produto_id = 106', [b])
    expect(x.rows[0].incluido).toBe(false)
  })

  it('cot_marcar_item: só em rascunho, com incluido informado', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const linha = await cotItemDe(db, f, 101)
    expect(await erroDe(chamar(db, ADMIN, 'cot_marcar_item(999999, true)'))).toBe('item da cotação não encontrado')
    expect(await erroDe(chamar(db, ADMIN, 'cot_marcar_item($1, null)', [linha]))).toBe('informe se o item vai na cotação')
    expect(await erroDe(chamar(db, JOAO, 'cot_marcar_item($1, false)', [linha]))).toBe('apenas o administrador pode fazer isso')
    await congelar(db, f)
    expect(await erroDe(chamar(db, ADMIN, 'cot_marcar_item($1, false)', [linha]))).toBe('só dá para marcar ou desmarcar item de cotação em rascunho')
  })
})

describe('vendedor do item (3.2) e "Pedir a:"', () => {
  it('item nunca comprado com vendedor escolhido entra no rascunho dele, pelo catálogo', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    await chamar(db, ADMIN, 'cot_definir_vendedor($1, $2)', [108, V_BELTRANO])
    const p = await preparar(db, semana)
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([105, 106, 108])
    expect(p.sem_vendedor.map((x: { produto_id: number }) => x.produto_id)).toEqual([107])
    const i108 = p.itens.find((i: { produto_id: number }) => i.produto_id === 108)
    expect([i108.vendedor_id, i108.via]).toEqual([V_BELTRANO, 'catalogo'])
    const k = await db.query<Json>('select vendedor_id, origem from cot_catalogo where produto_id = 108')
    expect(k.rows[0]).toEqual({ vendedor_id: V_BELTRANO, origem: 'ivan' })
  })

  it('vendedor inativo: pelo catálogo ou pela última compra, o item fica sem vendedor (D7)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem) values (105, ${V_FULANO}, 'seed')`)
    await db.exec(`update cot_vendedores set ativo = false where id = ${V_FULANO}`)
    const p = await preparar(db, semana)
    const sem = Object.fromEntries(p.sem_vendedor.map((x: any) => [x.produto_id, [x.motivo, x.vendedor_id]]))
    expect(sem).toEqual({
      101: ['vendedor_inativo', V_FULANO], 102: ['vendedor_inativo', V_FULANO], 103: ['vendedor_inativo', V_FULANO],
      104: ['vendedor_inativo', V_FULANO], 105: ['vendedor_inativo', V_FULANO],
      107: ['fornecedor_sem_vendedor', null], 108: ['nunca_comprado', null],
    })
    // o catálogo com vendedor inativo não cai para a última compra (Beltrano): 105 não vai a ninguém
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([106])
    expect(p.cartoes.map((c: { vendedor_id: number }) => c.vendedor_id)).toEqual([V_BELTRANO])
  })

  it('linha do catálogo sem vendedor (só propriedades) não decide: vale a última compra (D35)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, nome_para_vendedor) values (101, null, 'seed', 'ÁGUA S/ GÁS 500 ML')`)
    const p = await preparar(db, semana)
    const i101 = p.itens.find((i: { produto_id: number }) => i.produto_id === 101)
    expect([i101.vendedor_id, i101.via]).toEqual([V_FULANO, 'ultima_compra'])
    const r = await db.query<Json>('select nome from cot_itens where produto_id = 101')
    expect(r.rows[0].nome).toBe('ÁGUA S/ GÁS 500 ML')
  })

  it('"última compra foi com X": só quando o catálogo aponta outro vendedor e a compra é mais nova que a escolha', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    // 101 foi comprado por último do Fulano em 09/10; o catálogo diz Beltrano, escolhido em 01/10
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em) values (101, ${V_BELTRANO}, 'ivan', '2026-10-01T15:00:00Z')`)
    let p = await preparar(db, semana)
    let i101 = p.itens.find((i: { produto_id: number }) => i.produto_id === 101)
    expect(i101).toMatchObject({ vendedor_id: V_BELTRANO, via: 'catalogo',
      ultima_com_outro: { fornecedor: 'FORNECEDOR A LTDA', vendedor_id: V_FULANO, data: '2026-10-09' } })
    await db.exec(`update cot_catalogo set atualizado_em = '2026-10-09T15:00:00Z' where produto_id = 101`)
    p = await preparar(db, semana)
    i101 = p.itens.find((i: { produto_id: number }) => i.produto_id === 101)
    expect(i101.ultima_com_outro).toBeNull()
  })

  it('o congelamento fixa o vendedor da última compra no catálogo, sem tocar linha que já tem vendedor', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, vende_por_litro) values (104, null, 'seed', true);
                   insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em) values (102, ${V_FULANO}, 'seed', '2026-01-01T00:00:00Z')`)
    await preparar(db, semana)
    await congelar(db, await cotacaoDe(db, semana, V_FULANO))
    const k = await db.query<Json>(`select produto_id, vendedor_id, origem, vende_por_litro, atualizado_em from cot_catalogo order by produto_id`)
    expect(k.rows.map((x: any) => [x.produto_id, x.vendedor_id, x.origem, x.vende_por_litro])).toEqual([
      [101, V_FULANO, 'ultima_compra', false],
      [102, V_FULANO, 'seed', false], // linha com vendedor nunca é tocada
      [103, V_FULANO, 'ultima_compra', false],
      [104, V_FULANO, 'ultima_compra', true], // linha só com propriedades ganha o vendedor e mantém o resto
    ])
    expect(new Date(k.rows[1].atualizado_em).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(new Date(k.rows[0].atualizado_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
  })

  it('cot_definir_vendedor: recusas', async () => {
    const db = await banco()
    await aprovar(db)
    expect(await erroDe(chamar(db, ADMIN, 'cot_definir_vendedor(101, 99)'))).toBe('vendedor inativo ou inexistente')
    await db.exec(`update cot_vendedores set ativo = false where id = ${V_BELTRANO}`)
    expect(await erroDe(chamar(db, ADMIN, 'cot_definir_vendedor(101, $1)', [V_BELTRANO]))).toBe('vendedor inativo ou inexistente')
    expect(await erroDe(chamar(db, ADMIN, 'cot_definir_vendedor(555, $1)', [V_FULANO]))).toBe('produto desconhecido')
    expect(await erroDe(chamar(db, JOAO, 'cot_definir_vendedor(101, $1)', [V_FULANO]))).toBe('apenas o administrador pode fazer isso')
  })
})

describe('"Trocar vendedor"', () => {
  it('item da última compra passa a outro vendedor: sai do rascunho antigo, entra no novo; dados do fornecedor zerados, nota fica', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, embalagem, fator, fator_confirmado_em, descricao_fornecedor,
                     codigo_fornecedor, descricao_de_fornecedor, nome_para_vendedor, nota_vendedor, atualizado_em)
                   values (102, ${V_FULANO}, 'ultima_compra', 'fardo', 12, '2026-10-01T12:00:00Z', 'REFRIG LT 350', '7890002',
                     'FORNECEDOR A LTDA', 'REFRIGERANTE LATA', 'fardo c/12', '2026-10-01T12:00:00Z')`)
    await preparar(db, semana)
    await chamar(db, ADMIN, 'cot_definir_vendedor(102, $1)', [V_BELTRANO])
    const k = await db.query<Json>('select * from cot_catalogo where produto_id = 102')
    expect(k.rows[0]).toMatchObject({ vendedor_id: V_BELTRANO, origem: 'ivan', embalagem: 'fardo', fator: null,
      fator_confirmado_em: null, descricao_fornecedor: null, codigo_fornecedor: null, descricao_de_fornecedor: null,
      nome_para_vendedor: 'REFRIGERANTE LATA', nota_vendedor: 'fardo c/12' })
    expect(new Date(k.rows[0].atualizado_em).toISOString()).toBe('2026-10-19T18:00:00.000Z')
    await preparar(db, semana)
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_FULANO))).toEqual([101, 103, 104])
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([102, 105, 106])
    const x = await db.query<Json>(`select nome, nota_vendedor, embalagem, fator, fator_confirmado from cot_itens where produto_id = 102`)
    expect(x.rows[0]).toEqual({ nome: 'REFRIGERANTE LATA', nota_vendedor: 'fardo c/12', embalagem: 'fardo', fator: null, fator_confirmado: false })
  })

  it('item preso: numa versão enviada ao Fulano, a troca vale só na semana seguinte', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    await chamar(db, ADMIN, 'cot_definir_vendedor(102, $1)', [V_BELTRANO])
    const p = await preparar(db, semana)
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([105, 106])
    expect(p.presos).toEqual([{ item_semana_id: await itemDe(db, semana, 102), produto_id: 102, nome: 'REFRIGERANTE LATA 350 ML',
      vendedor_id: V_FULANO, cotacao_id: f, vendedor_novo_id: V_BELTRANO }])
    const i102 = p.itens.find((i: { produto_id: number }) => i.produto_id === 102)
    expect([i102.vendedor_id, i102.preso_com]).toEqual([V_BELTRANO, V_FULANO])
    expect(p.fora_da_enviada).toEqual([])
    const cart = Object.fromEntries(p.cartoes.map((c: any) => [c.vendedor_id, c.itens]))
    expect(cart).toEqual({ [V_FULANO]: 4, [V_BELTRANO]: 2 })

    // semana seguinte: vai ao Beltrano
    await encerrar(db, semana)
    const s2 = await aprovar(db, payloadDe('2026-10-26'), '2026-10-26T11:00:00Z', '2026-10-26T18:00:00Z')
    await preparar(db, s2)
    expect(await produtosDe(db, await cotacaoDe(db, s2, V_BELTRANO))).toEqual([102, 105, 106])
    expect(await produtosDe(db, await cotacaoDe(db, s2, V_FULANO))).toEqual([101, 103, 104])
  })

  it('preso + Nova versão do Fulano: o item continua na v2 dele (marcado, com a resposta copiada) e não vai ao Beltrano', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    const codigo = await codigoDe(db, (await congelar(db, f1)).cotacao_id)
    const r = await responder(db, codigo, [resp(2, 0, 'tem', { preco: 36, base: 'embalagem', emb_unidades: 12, marca: 'Marca A' })])
    expect(r.itens[0].resultado).toBe('gravado')
    await chamar(db, ADMIN, 'cot_definir_vendedor(102, $1)', [V_BELTRANO])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    expect(await produtosDe(db, f2, true)).toEqual([101, 102, 103, 104])
    await preparar(db, semana)
    expect(await produtosDe(db, f2, true)).toEqual([101, 102, 103, 104])
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([105, 106])
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    const d = await congelar(db, f2)
    expect(d.itens.map((i: { numero: number; produto_id: number }) => [i.numero, i.produto_id])).toEqual([[1, 101], [2, 102], [3, 103], [4, 104]])
    const x = await db.query<Json>('select estado, preco_digitado, marca_informada, copiada_da_versao from cot_itens where cotacao_id = $1 and produto_id = 102', [f2])
    expect(x.rows[0]).toEqual({ estado: 'tem', preco_digitado: '36.00', marca_informada: 'Marca A', copiada_da_versao: 1 })
    await preparar(db, semana)
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([105, 106])
  })

  it('preso + Nova versão, desmarcado antes do Preparar: depois do congelamento passa ao Beltrano na mesma semana', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f1)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f1])
    await chamar(db, ADMIN, 'cot_definir_vendedor(102, $1)', [V_BELTRANO])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f1])
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f2, 102)])
    // enquanto a v1 está viva, o item continua preso ao Fulano
    let p = await preparar(db, semana)
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([105, 106])
    expect(p.presos.map((x: { produto_id: number }) => x.produto_id)).toEqual([102])
    await congelar(db, f2)
    p = await preparar(db, semana)
    expect(p.presos).toEqual([])
    expect(await produtosDe(db, await cotacaoDe(db, semana, V_BELTRANO))).toEqual([102, 105, 106])
    expect(await produtosDe(db, f2, true)).toEqual([101, 103, 104])
    expect(p.fora_da_enviada).toEqual([])
  })
})

describe('fora da enviada, depois do resultado, cancelar e "Comprar na loja"', () => {
  it('fora_da_enviada: item que passou ao Fulano depois de a cotação dele sair', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_definir_vendedor(107, $1)', [V_FULANO])
    const p = await preparar(db, semana)
    expect(p.fora_da_enviada).toEqual([{ vendedor_id: V_FULANO, cotacao_id: f, item_semana_id: await itemDe(db, semana, 107),
      produto_id: 107, nome: 'OVO', unidade: 'un', qtd: 30 }])
    expect(p.cartoes.find((c: any) => c.vendedor_id === V_FULANO)).toMatchObject({ itens: 5, cotacoes: [f] })
    // "Gerar v2 incluindo": a Nova versão (depois de "Já enviei") leva todos
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f])
    expect(await produtosDe(db, f2)).toEqual([101, 102, 103, 104, 107])
    // com rascunho, o item não aparece de novo em fora_da_enviada (D9)
    expect((await preparar(db, semana)).fora_da_enviada).toEqual([])
  })

  it('depois_do_resultado: item novo do Fulano depois do pedido vai numa complementar', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const codigo = await codigoDe(db, (await congelar(db, f)).cotacao_id)
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    await chamar(db, ADMIN, 'cot_definir_vendedor(107, $1)', [V_FULANO])
    const p = await preparar(db, semana)
    expect(p.depois_do_resultado).toEqual([{ vendedor_id: V_FULANO, cotacao_id: f, item_semana_id: await itemDe(db, semana, 107),
      produto_id: 107, nome: 'OVO', unidade: 'un', qtd: 30 }])
    expect(p.fora_da_enviada).toEqual([])
    const c2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f])
    const r = await cotacao(db, c2)
    expect([r.versao, r.complementar, r.status]).toEqual([2, true, 'rascunho'])
    expect(await produtosDe(db, c2)).toEqual([107])
    const d = await congelar(db, c2)
    // numeração da semana continua: o 107 recebe 5; a v1 com pedido não é substituída
    expect(d.itens.map((i: { numero: number }) => i.numero)).toEqual([5])
    expect([d.complementar, d.substitui_versao]).toEqual([true, null])
    expect((await cotacao(db, f)).status).toBe('fechada')
  })

  it('cancelar → o próximo Preparar cria rascunho novo, que congela com os mesmos números e código novo', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f1 = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f1, 102)])
    await congelar(db, f1)
    const c1 = await codigoDe(db, f1)
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f1])
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f1]) // idempotente
    await preparar(db, semana)
    const f2 = await cotacaoDe(db, semana, V_FULANO)
    expect(f2).not.toBe(f1)
    expect((await cotacao(db, f2)).versao).toBe(2)
    const d = await congelar(db, f2)
    expect(d.itens.map((i: { numero: number; produto_id: number }) => [i.numero, i.produto_id])).toEqual([[1, 101], [2, 103], [3, 104], [4, 102]])
    expect(d.codigo).not.toBe(c1)
    expect((await abrir(db, c1)).erro).toBeUndefined()
    expect((await abrir(db, c1)).estado).toBe('cancelada')
  })

  it('"Comprar na loja nesta semana": o Preparar não recria rascunho; "Voltar a cotar" devolve o rascunho', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [b])
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [b]) // idempotente
    const p = await preparar(db, semana)
    expect((await cotacao(db, b)).status).toBe('liberada')
    expect(await db.query<Json>(`select id from cot_cotacoes where vendedor_id = ${V_BELTRANO}`).then((r) => r.rows.length)).toBe(1)
    expect(p.cartoes.find((c: any) => c.vendedor_id === V_BELTRANO)).toMatchObject({ itens: 2, cotacoes: [b] })
    expect(await erroDe(congelar(db, b))).toBe('este vendedor está em "Comprar na loja nesta semana"')
    expect(await erroDe(chamar(db, ADMIN, 'cot_nova_versao($1)', [b])))
      .toBe('este vendedor está em "Comprar na loja nesta semana"; toque em Voltar a cotar')
    await chamar(db, ADMIN, 'cot_voltar_a_cotar($1)', [b])
    await chamar(db, ADMIN, 'cot_voltar_a_cotar($1)', [b]) // idempotente
    expect((await cotacao(db, b)).status).toBe('rascunho')
    await preparar(db, semana)
    expect(await produtosDe(db, b)).toEqual([105, 106])
  })

  it('liberar e voltar: recusas', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f)
    expect(await erroDe(chamar(db, ADMIN, 'cot_liberar_loja($1)', [f]))).toBe('só dá para liberar um vendedor em rascunho')
    expect(await erroDe(chamar(db, ADMIN, 'cot_voltar_a_cotar($1)', [f]))).toBe('esta cotação não está em "Comprar na loja"')
    // rascunho (complementar ou Nova versão) ao lado de uma viva não pode ser liberado
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f])
    expect(await erroDe(chamar(db, ADMIN, 'cot_liberar_loja($1)', [f2]))).toBe('já há cotação enviada para este vendedor nesta semana')
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [b])
    await encerrar(db, semana)
    expect(await erroDe(chamar(db, ADMIN, 'cot_voltar_a_cotar($1)', [b]))).toBe('a semana desta cotação não está em compra')
    expect(await erroDe(chamar(db, ADMIN, 'cot_liberar_loja(999999)'))).toBe('cotação não encontrada')
  })
})

describe('nota do Ivan (cot_definir_nota, D49)', () => {
  it('grava, apaga com vazio, recusa 81 caracteres e caractere de controle; produto precisa existir', async () => {
    const db = await banco()
    await aprovar(db)
    await chamar(db, ADMIN, `cot_definir_nota(101, '  fardo c/12  ')`)
    const nota = async () => (await db.query<Json>('select nota_vendedor from cot_catalogo where produto_id = 101')).rows[0].nota_vendedor
    expect(await nota()).toBe('fardo c/12')
    await chamar(db, ADMIN, `cot_definir_nota(101, $1)`, ['x'.repeat(80)])
    expect(await nota()).toBe('x'.repeat(80))
    expect(await erroDe(chamar(db, ADMIN, `cot_definir_nota(101, $1)`, ['x'.repeat(81)]))).toBe('a nota pode ter no máximo 80 caracteres')
    expect(await erroDe(chamar(db, ADMIN, `cot_definir_nota(101, $1)`, ['marca\tA']))).toBe('a nota tem um caractere inválido')
    expect(await erroDe(chamar(db, ADMIN, `cot_definir_nota(101, $1)`, ['linha 1\nlinha 2']))).toBe('a nota tem um caractere inválido')
    expect(await erroDe(chamar(db, ADMIN, `cot_definir_nota(555, 'x')`))).toBe('produto desconhecido')
    expect(await erroDe(chamar(db, JOAO, `cot_definir_nota(101, 'x')`))).toBe('apenas o administrador pode fazer isso')
    await chamar(db, ADMIN, `cot_definir_nota(101, '   ')`)
    expect(await nota()).toBeNull()
    await chamar(db, ADMIN, `cot_definir_nota(101, 'R$ 2,50 o fardo')`) // quem avisa de "R$" é o App
    expect(await nota()).toBe('R$ 2,50 o fardo')
  })

  it('não muda vendedor, origem nem data da escolha; linha nova fica sem vendedor e não decide o vendedor', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await db.exec(`insert into cot_catalogo (produto_id, vendedor_id, origem, atualizado_em) values (105, ${V_FULANO}, 'seed', '2026-09-01T12:00:00Z')`)
    await chamar(db, ADMIN, `cot_definir_nota(105, 'saco de 5 kg')`)
    await chamar(db, ADMIN, `cot_definir_nota(101, 'sem gás')`)
    const k = await db.query<Json>('select produto_id, vendedor_id, origem, atualizado_em, nota_vendedor from cot_catalogo order by produto_id')
    expect(k.rows.map((x: any) => [x.produto_id, x.vendedor_id, x.origem, new Date(x.atualizado_em).toISOString(), x.nota_vendedor])).toEqual([
      [101, null, 'ivan', '2026-10-19T18:00:00.000Z', 'sem gás'],
      [105, V_FULANO, 'seed', '2026-09-01T12:00:00.000Z', 'saco de 5 kg'],
    ])
    const p = await preparar(db, semana)
    const i101 = p.itens.find((i: { produto_id: number }) => i.produto_id === 101)
    expect([i101.vendedor_id, i101.via]).toEqual([V_FULANO, 'ultima_compra'])
  })

  it('sobrevive ao "Trocar vendedor", chega ao rascunho no Preparar seguinte e fica fixa depois do congelamento', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, `cot_definir_nota(101, 'sem gás')`)
    const notaNo = async (id: number, prod: number) =>
      (await db.query<Json>('select nota_vendedor from cot_itens where cotacao_id = $1 and produto_id = $2', [id, prod])).rows[0]?.nota_vendedor
    expect(await notaNo(f, 101)).toBeNull() // só no Preparar seguinte
    await preparar(db, semana)
    expect(await notaNo(f, 101)).toBe('sem gás')
    await chamar(db, ADMIN, 'cot_definir_vendedor(101, $1)', [V_BELTRANO])
    await chamar(db, ADMIN, 'cot_definir_vendedor(101, $1)', [V_FULANO])
    expect((await db.query<Json>('select nota_vendedor from cot_catalogo where produto_id = 101')).rows[0].nota_vendedor).toBe('sem gás')
    await preparar(db, semana)
    const d = await congelar(db, f)
    expect(d.itens.find((i: { produto_id: number }) => i.produto_id === 101).nota).toBe('sem gás')
    expect(d.itens.find((i: { produto_id: number }) => i.produto_id === 102).nota).toBeNull()
    await chamar(db, ADMIN, `cot_definir_nota(101, 'com gás')`)
    await preparar(db, semana)
    expect(await notaNo(f, 101)).toBe('sem gás')
    const [r] = await como(db, ADMIN, 'select cot_dados_envio($1) as r', [f])
    expect(r.r.itens[0]).toMatchObject({ numero: 1, nota: 'sem gás' })
    const a = await abrir(db, await codigoDe(db, f))
    expect(a.itens[0]).toMatchObject({ numero: 1, nome: 'ÁGUA MINERAL 500ML', nota: 'sem gás' })
    // a versão seguinte leva a nota nova
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    const f2 = await chamar(db, ADMIN, 'cot_nova_versao($1)', [f])
    await fixarRelogio(db, '2026-10-19T19:00:00Z')
    const d2 = await congelar(db, f2)
    expect(d2.itens[0]).toMatchObject({ numero: 1, nota: 'com gás' })
    expect(await notaNo(f, 101)).toBe('sem gás')
  })
})
