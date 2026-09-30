import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { bancoRecebimento, semanaComPedido, como, chamar, ADMIN, fixarRelogio } from './fixture-recebimento'
import { JOAO } from './fixture'
import { erroDe, type Json } from './fixture-cotacao'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.10 e D.11): desempenho do vendedor. Cadeia até a D2.

const atual = bancoRecebimento()
const banco = async () => atual()

/** A linha de desempenho do vendedor 1 (FORNECEDOR A), pela função de admin. */
async function desemp(db: PGlite, quem = ADMIN): Promise<Json> {
  const linhas = await como(db, quem, 'select * from cot_desempenho_vendedores()')
  return (linhas as Json[]).find((l) => Number(l.vendedor_id) === 1)
}
function receber(db: PGlite, cotacao: number, itens: Json[], recebidoEm: string | null = null) {
  return chamar(db, JOAO, 'cot_registrar_recebimento($1, $2, $3, $4::jsonb, $5, $6)',
    [cotacao, randomUUID(), recebidoEm, JSON.stringify(itens), null, null])
}
async function nf(db: PGlite, cotacao: number, o: { chave: string; situacao: string; lancada?: string | null; saiu?: string | null }) {
  await db.query(`insert into cot_nfe (chave, cnpj_emitente, emitente, numero, emissao, valor_nf, xml_lido, itens,
    vendedor_id, cotacao_id, vinculo, situacao, primeiro_visto_em, visto_na_fila_em, lancada_em, saiu_da_fila_em, atualizado_em)
    values ($1, substr($1,7,14), 'FORNECEDOR A', '1', '2026-10-20', 100, true, '[]'::jsonb, 1, $2, 'ivan', $3, now(), now(), $4, $5, now())`,
    [o.chave, cotacao, o.situacao, o.lancada ?? null, o.saiu ?? null])
}
const CH = (n: number) => `1526101234567800019055001000123456100000001${n}`

describe('D — desempenho (D.10)', () => {
  it('no prazo (recebimento até a prevista); itens completos', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await chamar(db, ADMIN, 'cot_definir_entrega($1, $2)', [cotacao, '2026-10-22'])
    await fixarRelogio(db, '2026-10-22T18:00:00Z')
    await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }], '2026-10-22T12:00:00Z')
    const d = await desemp(db)
    expect([Number(d.pedidos), Number(d.com_prazo), Number(d.no_prazo), Number(d.atrasados)]).toEqual([1, 1, 1, 0])
    expect([Number(d.itens), Number(d.itens_completos), Number(d.itens_com_falta)]).toEqual([1, 1, 0])
  })

  it('atrasado (recebimento depois da prevista); atraso_medio_dias', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await chamar(db, ADMIN, 'cot_definir_entrega($1, $2)', [cotacao, '2026-10-22'])
    await fixarRelogio(db, '2026-10-26T12:00:00Z')
    await receber(db, cotacao, [{ numero: numeros[101], chegou: 108 }], '2026-10-25T12:00:00Z')
    const d = await desemp(db)
    expect([Number(d.no_prazo), Number(d.atrasados), Number(d.atraso_medio_dias)]).toEqual([0, 1, 3])
  })

  it('sem prazo (sem entrega prevista) fica fora da conta de prazo', async () => {
    const db = await banco()
    await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    const d = await desemp(db)
    expect([Number(d.com_prazo), Number(d.sem_prazo)]).toEqual([0, 1])
  })

  it('itens com falta e com avaria', async () => {
    const db = await banco()
    const { cotacao, numeros } = await semanaComPedido(db, [
      { produto: 101, qtd: 108, base: 'un', preco: 2 },
      { produto: 104, qtd: 20, base: 'kg', preco: 6 },
    ])
    await receber(db, cotacao, [{ numero: numeros[101], chegou: 100, avaria: 5, resto: 'nao_vem' }, { numero: numeros[104], chegou: 20 }])
    const d = await desemp(db)
    expect([Number(d.itens), Number(d.itens_completos), Number(d.itens_com_falta), Number(d.itens_com_avaria)]).toEqual([2, 1, 1, 1])
  })

  it('entregue pela NF: NF lançada até a prevista → no prazo e "entregue pela NF"; depois → sem_registro', async () => {
    const db = await banco()
    const a = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await chamar(db, ADMIN, 'cot_definir_entrega($1, $2)', [a.cotacao, '2026-10-22'])
    await nf(db, a.cotacao, { chave: CH(7), situacao: 'lancada', lancada: '2026-10-22T12:00:00Z' })
    const d = await desemp(db)
    expect([Number(d.no_prazo), Number(d.entregue_nf), Number(d.sem_registro)]).toEqual([1, 1, 0])
  })

  it('NF lançada depois da prevista → sem_registro (nem no prazo nem atrasado)', async () => {
    const db = await banco()
    const a = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await chamar(db, ADMIN, 'cot_definir_entrega($1, $2)', [a.cotacao, '2026-10-22'])
    await nf(db, a.cotacao, { chave: CH(7), situacao: 'lancada', lancada: '2026-10-25T12:00:00Z' })
    const d = await desemp(db)
    expect([Number(d.no_prazo), Number(d.atrasados), Number(d.sem_registro)]).toEqual([0, 0, 1])
  })

  it('sem NF lançada e com a data vencida → não chegou; NF só na_fila não prova entrega', async () => {
    const db = await banco()
    const a = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    await chamar(db, ADMIN, 'cot_definir_entrega($1, $2)', [a.cotacao, '2026-10-22'])
    await nf(db, a.cotacao, { chave: CH(7), situacao: 'na_fila' }) // só na fila
    await fixarRelogio(db, '2026-10-25T12:00:00Z') // depois da prevista
    const d = await desemp(db)
    expect([Number(d.nao_chegou), Number(d.no_prazo), Number(d.sem_registro)]).toEqual([1, 0, 0])
  })

  it('janela de 56 dias: pedido de 57 dias atrás não conta', async () => {
    const db = await banco()
    await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }]) // confirmado 2026-10-19
    await fixarRelogio(db, '2026-12-16T12:00:00Z') // 58 dias depois
    expect(await desemp(db)).toBeUndefined() // fora da janela → sem linha
  })

  it('preço igual e acima (itens conferidos por NF)', async () => {
    const db = await banco()
    const a = await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco: 42, respBase: 'un' }])
    // NF conferida via sincronização, com preço acima
    await chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      JSON.stringify({ lida_em: '2026-10-20T15:00:00Z', completa: false, origem: 'agendada',
        notas: [{ chave: CH(9), emitente: 'FORNECEDOR A LTDA', numero: '9', emissao: '2026-10-18', valor_nf: 400,
          totais: { v_prod: 400, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
          itens: [{ n: 1, cod_forn: 'X', descricao: 'REFRIG COLA', qtd_nf: 9, unidade_nf: 'FD', produto_id: 101,
            associacao: 'sischef', qtd: 108, unidade_sischef: 'UN', v_prod: 400, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }] }] }),
    ])
    void a
    const d = await desemp(db)
    expect([Number(d.itens_conferidos), Number(d.itens_acima), Number(d.itens_preco_igual)]).toEqual([1, 1, 0])
    expect(Number(d.valor_acima)).toBeGreaterThan(0)
  })

  it('pelo papel de quem lê: a função de admin devolve; a view direto só o service_role; comprador recusado', async () => {
    const db = await banco()
    await semanaComPedido(db, [{ produto: 101, qtd: 108, base: 'un', preco: 2 }])
    // admin pela função: ok (sem "permission denied for function cot_agora")
    expect(Array.isArray(await como(db, ADMIN, 'select * from cot_desempenho_vendedores()'))).toBe(true)
    // admin lendo a view direto: recusado (a view é só do service_role)
    await expect(como(db, ADMIN, 'select * from cot_desempenho')).rejects.toThrow(/permission denied/)
    // service_role lê a view
    expect(Array.isArray(await como(db, 'service', 'select * from cot_desempenho'))).toBe(true)
    // comprador pela função: exigir_admin
    expect(await erroDe(como(db, JOAO, 'select * from cot_desempenho_vendedores()'))).toBe('apenas o administrador pode fazer isso')
  })
})
