import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO, EX } from './fixture'
import {
  semearCotacao, aprovar, preparar, cotacaoDe, congelar, chamar, erroDe, abrir, responder, responderAdmin, resp,
  fixarRelogio, marcas, itemDe, cotItemDe, produtosDe, encerrar, payloadDe, PAYLOAD_COTACAO, V_FULANO, V_BELTRANO, type Json,
} from './fixture-cotacao'

// Fase 1B — etiquetas da tela Comprar e do Resumo (cot_marcas_semana, 8.3, contrato 4.15, D36) e a cotação
// da semana anterior que atravessa a semana nova (D43).
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()
type Db = Awaited<ReturnType<typeof banco>>

const ATE = '2026-10-20T15:00:00.000Z' // ter 20/10 12:00: primeiro dia útil depois da aprovação (seg 08:00)

/** Etiquetas por produto: [estado, vendedor, até] (sem etiqueta = ausente). */
async function porProduto(db: Db, semana: number, quem = ADMIN): Promise<Record<number, [string, string, string | null]>> {
  const m = await marcas(db, semana, quem)
  const r = await db.query<{ id: number; produto_id: number }>('select id, produto_id from itens_semana where semana_id = $1', [semana])
  const prod = Object.fromEntries(r.rows.map((x) => [Number(x.id), Number(x.produto_id)]))
  return Object.fromEntries(Object.values(m).map((l: any) =>
    [prod[Number(l.item_semana_id)], [l.estado, l.vendedor, l.ate === null ? null : new Date(l.ate).toISOString()]]))
}

const AG_F: [string, string, string] = ['aguardando_cotacao', 'FORNECEDOR A', ATE]
const AG_B: [string, string, string] = ['aguardando_cotacao', 'FORNECEDOR B', ATE]
const EC_F: [string, string, null] = ['em_cotacao', 'FORNECEDOR A', null]
const PE_F: [string, string, null] = ['pedido', 'FORNECEDOR A', null]

describe('etiquetas antes da cotação sair', () => {
  it('semana aprovada sem cotação: itens de vendedor ativo "aguardando"; sem vendedor, nada', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    expect(await porProduto(db, semana)).toEqual({ 101: AG_F, 102: AG_F, 103: AG_F, 104: AG_F, 105: AG_B, 106: AG_B })
    const l = (await marcas(db, semana))[await itemDe(db, semana, 101)]
    expect(l).toMatchObject({ estado: 'aguardando_cotacao', vendedor_id: V_FULANO, vendedor: 'FORNECEDOR A' })
    // o comprador vê o mesmo
    expect(await porProduto(db, semana, JOAO)).toEqual(await porProduto(db, semana))
  })

  it('rascunho aberto continua "aguardando" (nunca "em cotação"); desmarcado no rascunho fica sem etiqueta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f, 102)])
    expect(await porProduto(db, semana)).toEqual({ 101: AG_F, 103: AG_F, 104: AG_F, 105: AG_B, 106: AG_B })
  })

  it('pronta sem sinal continua "aguardando", com a mesma validade (às 12:00:01 de ter, sem etiqueta)', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await chamar(db, ADMIN, 'cot_marcar_item($1, false)', [await cotItemDe(db, f, 104)])
    await congelar(db, f)
    // desmarcado numa pronta sem sinal também fica sem etiqueta
    expect(await porProduto(db, semana)).toEqual({ 101: AG_F, 102: AG_F, 103: AG_F, 105: AG_B, 106: AG_B })
    await fixarRelogio(db, '2026-10-20T14:59:59Z')
    expect(Object.keys(await porProduto(db, semana))).toHaveLength(5)
    await fixarRelogio(db, '2026-10-20T15:00:01Z')
    expect(await porProduto(db, semana)).toEqual({})
  })

  it('aprovada sex 09/10: "aguardando" até ter 13/10 12:00 (seg 12/10 é feriado)', async () => {
    const db = await banco()
    const semana = await aprovar(db, PAYLOAD_COTACAO, '2026-10-09T12:00:00Z', '2026-10-13T14:59:59Z')
    expect((await porProduto(db, semana))[101]).toEqual(['aguardando_cotacao', 'FORNECEDOR A', '2026-10-13T15:00:00.000Z'])
    await fixarRelogio(db, '2026-10-13T15:00:00Z')
    expect(await porProduto(db, semana)).toEqual({})
  })

  it('"Comprar na loja nesta semana" e vendedor inativo: sem etiqueta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [await cotacaoDe(db, semana, V_BELTRANO)])
    await db.exec(`update cot_vendedores set ativo = false where id = ${V_FULANO}`)
    expect(await porProduto(db, semana)).toEqual({})
  })

  it('cancelada + rascunho novo → "aguardando"; cancelada + "Comprar na loja" → sem etiqueta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    expect((await porProduto(db, semana))[101]).toEqual(EC_F)
    await chamar(db, ADMIN, 'cot_cancelar($1)', [f])
    await preparar(db, semana)
    // cancelada não conta como saída (3.1): com o rascunho novo, volta a "aguardando" até a validade
    expect((await porProduto(db, semana))[101]).toEqual(AG_F)
    await chamar(db, ADMIN, 'cot_liberar_loja($1)', [await cotacaoDe(db, semana, V_FULANO)])
    expect((await porProduto(db, semana))[101]).toBeUndefined()
  })
})

describe('etiquetas depois do sinal de envio (D36)', () => {
  it('"Já enviei", link aberto ou resposta tornam a pronta "em cotação"; enviada e respondida também', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const cf = (await congelar(db, f)).codigo
    const cb = (await congelar(db, b)).codigo
    // resposta colada pelo Ivan na do Beltrano: vira respondida
    await responderAdmin(db, b, [resp(2, 0, 'tem', { preco: 9, base: 'un' })], null, 'ivan_colou')
    // prévia não é sinal
    await abrir(db, cf, true)
    expect((await porProduto(db, semana))[101]).toEqual(AG_F)
    // link aberto (depois do fechamento a pronta não vira enviada, mas tem sinal)
    await db.exec(`update cot_cotacoes set primeiro_acesso = now() where id = ${f}`)
    const m = await porProduto(db, semana)
    expect(m).toEqual({ 101: EC_F, 102: EC_F, 103: EC_F, 104: EC_F,
      105: ['em_cotacao', 'FORNECEDOR B', null], 106: ['em_cotacao', 'FORNECEDOR B', null] })
    expect(cb).toHaveLength(32)
  })

  it('item "não tem" fica sem etiqueta; depois do fechamento, só o item com preço segue "em cotação"', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const cf = (await congelar(db, f)).codigo
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' }), resp(2, 0, 'nao_tem')])
    expect(await porProduto(db, semana)).toMatchObject({ 101: EC_F, 103: EC_F, 104: EC_F })
    expect((await porProduto(db, semana))[102]).toBeUndefined()
    await fixarRelogio(db, '2026-10-20T20:00:00Z') // fechamento
    const m = await porProduto(db, semana)
    expect([m[101], m[102], m[103], m[104]]).toEqual([EC_F, undefined, undefined, undefined])
    await fixarRelogio(db, '2026-10-21T12:00:00Z')
    await como(db, 'service', 'select cot_fechar_vencidas()') // fechada sem resultado: até o pedido ou o Obrigado
    expect((await porProduto(db, semana))[101]).toEqual(EC_F)
  })

  it('item que ficou fora da versão enviada fica sem etiqueta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    await congelar(db, f)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [f])
    await chamar(db, ADMIN, 'cot_definir_vendedor(107, $1)', [V_FULANO])
    const m = await porProduto(db, semana)
    expect(m[107]).toBeUndefined()
    expect(m[101]).toEqual(EC_F)
  })

  it('dispensada → sem etiqueta; pedido → "pedido"; item deixado para a loja no mapa → sem etiqueta', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const b = await cotacaoDe(db, semana, V_BELTRANO)
    const cf = (await congelar(db, f)).codigo
    await congelar(db, b)
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [b])
    await chamar(db, ADMIN, 'cot_dispensar($1)', [b])
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' }), resp(2, 0, 'tem', { preco: 3.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    expect(await porProduto(db, semana)).toEqual({ 101: PE_F })
  })

  it('semana encerrada: o comprador não vê nada; o admin vê só "pedido" (D23); semana inexistente e usuário inativo', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const cf = (await congelar(db, f)).codigo
    await responder(db, cf, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' }), resp(2, 0, 'tem', { preco: 3.5, base: 'un' })])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    await encerrar(db, semana)
    expect(await porProduto(db, semana)).toEqual({ 101: PE_F })
    expect(await porProduto(db, semana, JOAO)).toEqual({})
    expect(await como(db, ADMIN, 'select * from cot_marcas_semana(999999)')).toEqual([])
    expect(await erroDe(como(db, EX, 'select * from cot_marcas_semana($1)', [semana]))).toBe('usuário sem acesso ao app')
    await expect(como(db, 'anon', 'select * from cot_marcas_semana($1)', [semana])).rejects.toThrow(/permission denied/)
  })
})

/** Quantidade coberta por produto (coluna `qtd` de cot_marcas_semana; D63). */
async function qtdPorProduto(db: Db, semana: number, quem = ADMIN): Promise<Record<number, number | null>> {
  const m = await marcas(db, semana, quem)
  const r = await db.query<{ id: number; produto_id: number }>('select id, produto_id from itens_semana where semana_id = $1', [semana])
  const prod = Object.fromEntries(r.rows.map((x) => [Number(x.id), Number(x.produto_id)]))
  return Object.fromEntries(Object.values(m).map((l: any) => [prod[Number(l.item_semana_id)], l.qtd === null ? null : Number(l.qtd)]))
}

/** Número do produto na mensagem da cotação. */
async function numeroDe(db: Db, cotacao: number, produto: number): Promise<number> {
  const r = await db.query<{ numero: number }>('select numero from cot_itens where cotacao_id = $1 and produto_id = $2', [cotacao, produto])
  return Number(r.rows[0].numero)
}

describe('quantidade coberta pela etiqueta (D63)', () => {
  it('"em cotação": o "só tenho" menor que a quantidade é o que fica coberto; o resto não; "aguardando" não tem quantidade', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const cf = (await congelar(db, f)).codigo
    // AÇÚCAR (8 kg): só tem 1 kg; LEITE (20 kg): "só tenho 25" não é parcial; ÁGUA (60 un): sem ressalva
    await responder(db, cf, [
      resp(await numeroDe(db, f, 103), 0, 'tem', { preco: 5, base: 'kg', tenho_so: 1 }),
      resp(await numeroDe(db, f, 104), 0, 'tem', { preco: 6, base: 'kg', tenho_so: 25 }),
      resp(await numeroDe(db, f, 101), 0, 'tem', { preco: 2.5, base: 'un' }),
    ])
    expect((await porProduto(db, semana))[103]).toEqual(EC_F)
    expect(await qtdPorProduto(db, semana)).toEqual({ 101: 60, 102: 48, 103: 1, 104: 20, 105: null, 106: null })
    // o comprador vê a mesma quantidade
    expect(await qtdPorProduto(db, semana, JOAO)).toEqual(await qtdPorProduto(db, semana))
    // depois do fechamento, o item com preço segue coberto só no que o vendedor tem
    await fixarRelogio(db, '2026-10-20T20:00:00Z')
    expect(await qtdPorProduto(db, semana)).toEqual({ 101: 60, 103: 1, 104: 20 })
  })

  it('"pedido": a quantidade é a do pedido para o produto, mesmo menor que a aprovada', async () => {
    const db = await banco()
    const semana = await aprovar(db)
    await preparar(db, semana)
    const f = await cotacaoDe(db, semana, V_FULANO)
    const cf = (await congelar(db, f)).codigo
    await responder(db, cf, [
      resp(await numeroDe(db, f, 103), 0, 'tem', { preco: 5, base: 'kg', tenho_so: 1 }),
      resp(await numeroDe(db, f, 101), 0, 'tem', { preco: 2.5, base: 'un' }),
    ])
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [f, JSON.stringify([
      { numero: await numeroDe(db, f, 103), qtd: 1, base: 'kg', embalagens: null, fator: null, preco_combinado: 5 },
      { numero: await numeroDe(db, f, 101), qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    expect(await porProduto(db, semana)).toEqual({ 101: PE_F, 103: PE_F, 105: AG_B, 106: AG_B })
    expect(await qtdPorProduto(db, semana)).toEqual({ 101: 60, 103: 1, 105: null, 106: null })
  })

  it('cotação que atravessa a semana: o pedido e o "só tenho" cobrem só a quantidade deles na semana nova', async () => {
    const db = await banco()
    const sN = await aprovar(db, payloadDe('2026-10-05'), '2026-10-05T11:00:00Z', '2026-10-09T18:00:00Z')
    await preparar(db, sN)
    const fN = await cotacaoDe(db, sN, V_FULANO)
    const codigo = (await congelar(db, fN)).codigo as string
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [fN])
    await fixarRelogio(db, '2026-10-12T12:00:00Z')
    await responder(db, codigo, [
      resp(await numeroDe(db, fN, 103), 0, 'tem', { preco: 5, base: 'kg', tenho_so: 3 }),
      resp(await numeroDe(db, fN, 101), 0, 'tem', { preco: 2.5, base: 'un' }),
    ])
    await encerrar(db, sN)
    const s1 = await aprovar(db, payloadDe('2026-10-12'), '2026-10-12T11:00:00Z', '2026-10-12T18:00:00Z')
    await preparar(db, s1)
    expect(await qtdPorProduto(db, s1)).toMatchObject({ 101: 60, 103: 3 })
    await fixarRelogio(db, '2026-10-13T12:00:00Z')
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [fN, JSON.stringify([
      { numero: await numeroDe(db, fN, 101), qtd: 24, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    expect((await porProduto(db, s1))[101]).toEqual(PE_F)
    expect((await qtdPorProduto(db, s1))[101]).toBe(24)
  })
})

describe('cotação que atravessa a semana (D43)', () => {
  // Semana N = 05/10, aprovada seg 05/10 08:00. Preparada na sex 09/10 15:00: prazo ter 13/10 12:00 (seg 12/10 é
  // feriado), fechamento 17:00. A semana N+1 (12/10) é aprovada na seg 12/10 08:00, com a cotação ainda com o vendedor.
  const N = '2026-10-05'
  const N1 = '2026-10-12'

  async function semanaN(db: Db, preparo = '2026-10-09T18:00:00Z') {
    const sN = await aprovar(db, payloadDe(N), '2026-10-05T11:00:00Z', preparo)
    await preparar(db, sN)
    const fN = await cotacaoDe(db, sN, V_FULANO)
    const codigo = (await congelar(db, fN)).codigo as string
    await chamar(db, ADMIN, 'cot_confirmar_envio($1)', [fN])
    return { sN, fN, codigo }
  }

  async function semanaN1(db: Db, sN: number, agora = '2026-10-12T18:00:00Z') {
    await encerrar(db, sN)
    return aprovar(db, payloadDe(N1), '2026-10-12T11:00:00Z', agora)
  }

  it('o item da semana nova fica "em cotação" com o vendedor da cotação antiga, fora do rascunho novo e em "atravessados"', async () => {
    const db = await banco()
    const { sN, fN, codigo } = await semanaN(db)
    await fixarRelogio(db, '2026-10-12T12:00:00Z')
    await responder(db, codigo, [resp(2, 0, 'nao_tem')])
    const s1 = await semanaN1(db, sN)
    const p = await preparar(db, s1)
    // o Fulano não tem rascunho em N+1 (tudo dele está atravessado); o Beltrano segue normal
    expect((await db.query<Json>('select count(*)::int as n from cot_cotacoes where semana_id = $1 and vendedor_id = $2', [s1, V_FULANO])).rows[0].n).toBe(0)
    expect(await produtosDe(db, await cotacaoDe(db, s1, V_BELTRANO))).toEqual([105, 106])
    expect(p.atravessados).toEqual(await Promise.all([101, 102, 103, 104].map(async (pr) => ({
      item_semana_id: await itemDe(db, s1, pr), produto_id: pr, nome: expect.any(String), vendedor_id: V_FULANO, cotacao_id: fN,
      semana_id: sN, estado: 'em_cotacao' }))))
    expect(p.sem_vendedor.map((x: { produto_id: number }) => x.produto_id)).toEqual([108, 107])
    expect(p.cartoes.map((c: { vendedor_id: number }) => c.vendedor_id)).toEqual([V_BELTRANO])
    // etiquetas: "em cotação" com o Fulano; o "não tenho" (102) volta para a loja, mas continua fora do rascunho novo
    const m = await porProduto(db, s1)
    expect(m).toEqual({ 101: EC_F, 103: EC_F, 104: EC_F, 105: ['aguardando_cotacao', 'FORNECEDOR B', '2026-10-13T15:00:00.000Z'],
      106: ['aguardando_cotacao', 'FORNECEDOR B', '2026-10-13T15:00:00.000Z'] })
  })

  it('pedido confirmado na cotação antiga depois da aprovação → "pedido" em N+1; os itens fora do pedido voltam às regras de N+1', async () => {
    const db = await banco()
    const { sN, fN, codigo } = await semanaN(db)
    await fixarRelogio(db, '2026-10-12T12:00:00Z')
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    const s1 = await semanaN1(db, sN, '2026-10-12T18:00:00Z')
    await preparar(db, s1)
    await fixarRelogio(db, '2026-10-13T12:00:00Z') // ter 09:00, ainda antes do "aguardando_ate" de N+1
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [fN, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    const p = await preparar(db, s1)
    expect(p.atravessados).toEqual([expect.objectContaining({ produto_id: 101, cotacao_id: fN, semana_id: sN, estado: 'pedido' })])
    const fN1 = await cotacaoDe(db, s1, V_FULANO)
    expect(await produtosDe(db, fN1)).toEqual([102, 103, 104])
    expect(await porProduto(db, s1)).toMatchObject({ 101: PE_F, 102: ['aguardando_cotacao', 'FORNECEDOR A', '2026-10-13T15:00:00.000Z'] })
  })

  it('cotação da semana N que fechou antes da aprovação de N+1 não atravessa; o pedido dela depois da aprovação, sim', async () => {
    const db = await banco()
    const { sN, fN, codigo } = await semanaN(db, '2026-10-05T18:00:00Z') // seg 15:00: fecha ter 06/10 17:00
    await fixarRelogio(db, '2026-10-06T12:00:00Z')
    await responder(db, codigo, [resp(1, 0, 'tem', { preco: 2.5, base: 'un' })])
    await fixarRelogio(db, '2026-10-06T21:00:00Z')
    await como(db, 'service', 'select cot_fechar_vencidas()')
    const s1 = await semanaN1(db, sN)
    let p = await preparar(db, s1)
    expect(p.atravessados).toEqual([])
    const fN1 = await cotacaoDe(db, s1, V_FULANO)
    expect(await produtosDe(db, fN1)).toEqual([101, 102, 103, 104])
    expect((await porProduto(db, s1))[101]).toEqual(['aguardando_cotacao', 'FORNECEDOR A', '2026-10-13T15:00:00.000Z'])
    // o Ivan confirma o pedido da cotação antiga (fechada sem resultado) depois de aprovar N+1: 101 sai do rascunho novo
    await fixarRelogio(db, '2026-10-12T19:00:00Z')
    await chamar(db, ADMIN, 'cot_gravar_pedido($1, $2::jsonb)', [fN, JSON.stringify([
      { numero: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2.5 }])])
    p = await preparar(db, s1)
    expect(p.atravessados.map((x: { produto_id: number; estado: string }) => [x.produto_id, x.estado])).toEqual([[101, 'pedido']])
    expect(await produtosDe(db, fN1)).toEqual([102, 103, 104])
    expect((await porProduto(db, s1))[101]).toEqual(PE_F)
  })

  it('dispensar a cotação antiga: o item deixa de ser atravessado e volta às regras normais (rascunho do vendedor em N+1)', async () => {
    const db = await banco()
    const { sN, fN } = await semanaN(db)
    const s1 = await semanaN1(db, sN)
    await preparar(db, s1)
    expect((await porProduto(db, s1))[101]).toEqual(EC_F)
    await chamar(db, ADMIN, 'cot_dispensar($1)', [fN])
    const p = await preparar(db, s1)
    expect(p.atravessados).toEqual([])
    expect(await produtosDe(db, await cotacaoDe(db, s1, V_FULANO))).toEqual([101, 102, 103, 104])
    expect((await porProduto(db, s1))[101]).toEqual(['aguardando_cotacao', 'FORNECEDOR A', '2026-10-13T15:00:00.000Z'])
  })

  it('pronta sem sinal da semana anterior não atravessa', async () => {
    const db = await banco()
    const sN = await aprovar(db, payloadDe(N), '2026-10-05T11:00:00Z', '2026-10-09T18:00:00Z')
    await preparar(db, sN)
    await congelar(db, await cotacaoDe(db, sN, V_FULANO))
    const s1 = await semanaN1(db, sN)
    const p = await preparar(db, s1)
    expect(p.atravessados).toEqual([])
    expect(await produtosDe(db, await cotacaoDe(db, s1, V_FULANO))).toEqual([101, 102, 103, 104])
  })
})
