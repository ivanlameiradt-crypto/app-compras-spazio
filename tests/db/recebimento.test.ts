import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { bancoRecebimento, semanaComPedido, como, chamar, ADMIN, fixarRelogio } from './fixture-recebimento'
import { JOAO, EX } from './fixture'
import { erroDe, type Json } from './fixture-cotacao'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.5.4 e D.11): recebimento do pedido, gatilho de proteção do pedido e a
// lista branca de cot_pedidos_a_receber. Cadeia até a D2 (fixture-recebimento).

const atual = bancoRecebimento()
const banco = async () => atual()

/** cot_registrar_recebimento como `quem` (JOAO por padrão). */
function receber(db: PGlite, cotacao: number, itens: Json[], extra: { envioId?: string; recebidoEm?: string | null; resto?: string | null; obs?: string | null; quem?: string } = {}) {
  return chamar(db, extra.quem ?? JOAO, 'cot_registrar_recebimento($1, $2, $3, $4::jsonb, $5, $6)',
    [cotacao, extra.envioId ?? randomUUID(), extra.recebidoEm ?? null, JSON.stringify(itens), extra.resto ?? null, extra.obs ?? null])
}

/** Uma linha da cot_conferencia por produto (numéricos já como número). */
async function conf(db: PGlite, cotacao: number): Promise<Record<number, Json>> {
  const linhas = await como(db, ADMIN, `select produto_id, numero, chegou, avaria, falta, falta_definitiva, resto, recebimento
     from cot_conferencia where cotacao_id = $1 order by numero`, [cotacao])
  const n = (v: unknown) => (v == null ? null : Number(v))
  return Object.fromEntries(linhas.map((l) => [Number(l.produto_id),
    { ...l, chegou: n(l.chegou), avaria: n(l.avaria), falta: n(l.falta), falta_definitiva: n(l.falta_definitiva) }]))
}

describe('D — cot_registrar_recebimento', () => {
  it('comprador ativo registra; anon e usuário desativado são recusados', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    const r = await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }])
    expect(r.recebimento).toBe('completo')
    await expect(como(db, 'anon', 'select cot_registrar_recebimento($1, $2, null, $3::jsonb, null, null)',
      [cotacao, randomUUID(), JSON.stringify([{ numero: numeros[101], chegou: 1 }])])).rejects.toThrow(/permission denied|não autorizado|acesso/i)
    expect(await erroDe(receber(db, cotacao, [{ numero: numeros[101], chegou: 1 }], { quem: EX }))).toBe('usuário sem acesso ao app')
  })

  it('cada mensagem de erro de D.5.4 aparece no caso certo', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [
      { produto: 101, qtd: 108, base: 'un', preco: 2 },
      { produto: 104, qtd: 20, base: 'kg', preco: 6 },
    ])
    const n = numeros[101]
    expect(await erroDe(chamar(db, JOAO, 'cot_registrar_recebimento($1, null, null, $2::jsonb, null, null)',
      [cotacao, JSON.stringify([{ numero: n, chegou: 1 }])]))).toBe('envio sem identificador')
    expect(await erroDe(receber(db, 999999, [{ numero: n, chegou: 1 }]))).toBe('pedido não encontrado')
    expect(await erroDe(receber(db, cotacao, [{ numero: 777, chegou: 1 }]))).toBe('item 777 não está neste pedido')
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 1 }, { numero: n, chegou: 1 }]))).toBe(`item ${n} repetido`)
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: -1 }]))).toBe(`quantidade inválida no item ${n}`)
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 10, avaria: 11 }]))).toBe(`avaria maior que o que chegou no item ${n}`)
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 10, obs: 'x'.repeat(81) }]))).toBe(`observação inválida no item ${n}`)
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 10, resto: 'talvez' }]))).toBe(`resto inválido no item ${n}`)
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 10 }], { resto: 'talvez' }))).toBe('resto inválido')
    // todos chegou 0 e nenhum "não vem" → precisa dizer o que chegou
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 0 }, { numero: numeros[104], chegou: 0 }])))
      .toBe('informe o que chegou (ou marque que não veio nada)')
    // falta sem resto → pergunta pelo item
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 100 }, { numero: numeros[104], chegou: 20 }])))
      .toBe(`diga se o que faltou do item ${n} ainda vem ou não vem mais`)
    // observação do recebimento inválida
    expect(await erroDe(receber(db, cotacao, [{ numero: n, chegou: 108 }, { numero: numeros[104], chegou: 20 }], { obs: 'x'.repeat(201) })))
      .toBe('observação inválida')
  })

  it('envio_id repetido devolve o mesmo resultado e grava uma linha só', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    const envioId = randomUUID()
    const a = await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }], { envioId })
    const b = await receber(db, cotacao, [{ numero: numeros[101], chegou: 50 }], { envioId })
    expect(b.recebimento_id).toBe(a.recebimento_id)
    expect(b.reenvio).toBe(true)
    const [{ n }] = await como(db, ADMIN, 'select count(*)::int as n from cot_recebimentos where cotacao_id = $1', [cotacao])
    expect(n).toBe(1)
  })

  it('duas entregas somam; em kg 2% de diferença não é falta', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [
      { produto: 101, qtd: 108, base: 'un', preco: 2 },
      { produto: 104, qtd: 20, base: 'kg', preco: 6 },
    ])
    await receber(db, cotacao, [{ numero: numeros[101], chegou: 60, resto: 'vem_depois' }, { numero: numeros[104], chegou: 19.7 }])
    const r = await receber(db, cotacao, [{ numero: numeros[101], chegou: 48 }])
    expect(r.recebimento).toBe('completo') // 60+48 = 108; 19,7 de 20 kg está dentro de 2%
    const c = await conf(db, cotacao)
    expect(c[101].chegou).toBe(108)
    expect(c[101].falta).toBe(0)
    expect(c[104].falta).toBe(0) // 0,3 kg (1,5%) conta como 0
  })

  it('resto por item: um ainda vem e outro não vem mais na mesma entrega (2ª revisão n.º 10)', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [
      { produto: 101, qtd: 108, base: 'un', preco: 2 },  // "COCA": faltam 24, ainda vem
      { produto: 104, qtd: 20, base: 'kg', preco: 6 },   // "QUEIJO": faltam 5, não vem mais
    ])
    const r = await receber(db, cotacao, [
      { numero: numeros[101], chegou: 84, resto: 'vem_depois' },
      { numero: numeros[104], chegou: 15, resto: 'nao_vem' },
    ])
    expect(r.recebimento).toBe('parcial')
    const c = await conf(db, cotacao)
    expect(c[101].falta_definitiva).toBe(0) // ainda vem
    expect(c[104].falta_definitiva).toBe(5) // não vem mais
    // a próxima entrega com a COCA completa deixa o pedido com_falta (só o queijo, que não vem mais)
    const r2 = await receber(db, cotacao, [{ numero: numeros[101], chegou: 24 }, { numero: numeros[104], chegou: 0, resto: 'nao_vem' }])
    expect(r2.recebimento).toBe('com_falta')
  })

  it('o atalho p_resto ("todos") preenche os itens sem resto próprio', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [
      { produto: 101, qtd: 108, base: 'un', preco: 2 },
      { produto: 104, qtd: 20, base: 'kg', preco: 6 },
    ])
    const r = await receber(db, cotacao, [{ numero: numeros[101], chegou: 80 }, { numero: numeros[104], chegou: 10 }], { resto: 'nao_vem' })
    expect(r.recebimento).toBe('com_falta')
    const c = await conf(db, cotacao)
    expect(c[101].falta_definitiva).toBe(28)
    expect(c[104].falta_definitiva).toBe(10)
  })

  it('pedido de semana encerrada é aceito; pedido de 31 dias atrás é recusado', async () => {
    const db = await banco()
    const { semana, cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await como(db, ADMIN, 'select encerrar_semana($1)', [semana])
    const r = await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }])
    expect(r.recebimento).toBe('completo')
    // 31 dias depois da confirmação (PREPARO = 2026-10-19T18:00Z)
    await fixarRelogio(db, '2026-11-20T18:00:00Z')
    expect(await erroDe(receber(db, cotacao, [{ numero: numeros[101], chegou: 1 }], { envioId: randomUUID() })))
      .toBe('pedido antigo demais para registrar recebimento (mais de 30 dias)')
  })

  it('data do recebimento fora do período do pedido é recusada', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    expect(await erroDe(receber(db, cotacao, [{ numero: numeros[101], chegou: 1 }], { recebidoEm: '2026-10-01T12:00:00Z' })))
      .toBe('data do recebimento fora do período do pedido')
  })

  it('cot_pedidos_a_receber não traz preço, referência nem telefone (lista branca)', async () => {
    const db = await banco()
    const { numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    void numeros
    const p = await chamar(db, JOAO, 'cot_pedidos_a_receber()')
    expect(Array.isArray(p)).toBe(true)
    const texto = JSON.stringify(p)
    for (const proibido of ['preco', 'ref_', 'whatsapp', 'telefone', 'similar', 'a_partir']) {
      expect(texto).not.toContain(proibido)
    }
    // as chaves de cada item são só a lista branca
    const chavesItem = Object.keys(p[0].itens[0]).sort()
    expect(chavesItem).toEqual(['avaria', 'chegou', 'embalagem', 'embalagens', 'fator', 'marca', 'nome', 'numero', 'qtd', 'resto', 'unidade'])
  })
})

describe('D — gatilho e desfazer recebimento (D.5.5)', () => {
  it('desfazer pedido com recebimento dá a mensagem de D.5.5', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }])
    expect(await erroDe(chamar(db, ADMIN, 'cot_desfazer_pedido($1)', [cotacao])))
      .toMatch(/este pedido já tem recebimento registrado.*desfaça o recebimento/)
  })

  it('sem recebimento e com NF casada, o pedido é desfeito e a NF fica sem pedido', async () => {
    const db = await banco()
    const { cotacao } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    // liga uma NF ao pedido (o Ivan)
    const chave = '15261012345678000190550010001234561000000017'
    await db.query(`insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido,
      itens, vendedor_id, situacao, primeiro_visto_em, visto_na_fila_em, atualizado_em)
      values ($1, substr($1,7,14), 'FORNECEDOR A', '1', '2026-10-19', 100, true, '[]'::jsonb, 1, 'na_fila', now(), now(), now())`, [chave])
    await chamar(db, ADMIN, 'cot_nfe_vincular($1, $2)', [chave, cotacao])
    await chamar(db, ADMIN, 'cot_desfazer_pedido($1)', [cotacao])
    const [nf] = await como(db, ADMIN, 'select cotacao_id, vinculo from cot_nfe where chave = $1', [chave])
    expect(nf.cotacao_id).toBeNull()
    expect(nf.vinculo).toBeNull()
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_pedidos where cotacao_id = $1', [cotacao])).toEqual([{ n: 0 }])
  })

  it('cot_desfazer_recebimento apaga a entrega e grava o histórico', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    const r = await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }])
    await chamar(db, ADMIN, 'cot_desfazer_recebimento($1)', [r.recebimento_id])
    expect(await como(db, ADMIN, 'select count(*)::int as n from cot_recebimentos')).toEqual([{ n: 0 }])
    const [h] = await como(db, ADMIN, `select tabela, depois from historico_alteracoes where tabela = 'cot_recebimentos'`)
    expect(h.tabela).toBe('cot_recebimentos')
    expect(h.depois).toBeNull()
    // recebimento inexistente
    expect(await erroDe(chamar(db, ADMIN, 'cot_desfazer_recebimento($1)', [999999]))).toBe('recebimento não encontrado')
    // comprador não desfaz
    expect(await erroDe(chamar(db, JOAO, 'cot_desfazer_recebimento($1)', [1]))).toBe('apenas o administrador pode fazer isso')
  })
})
