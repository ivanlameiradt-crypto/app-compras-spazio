import { bancoPorArquivo, como } from './banco'
import { semear, importar, idItem, idSemana, ADMIN, ESTRANHO, EX, JOAO, MARIA } from './fixture'

const C1 = '11111111-1111-1111-1111-111111111111'
const C2 = '22222222-2222-2222-2222-222222222222'
const L1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const L2 = 'aaaaaaaa-0000-0000-0000-000000000002'

const banco = bancoPorArquivo(semear)

async function emCompra() {
  const db = banco()
  await importar(db)
  const s = await idSemana(db)
  await como(db, ADMIN, 'select aprovar_semana($1)', [s])
  return { db, s, coca: await idItem(db, 1), cebola: await idItem(db, 4) }
}

describe('comprar', () => {
  it('abre compra (idempotente), marca item e fecha', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, ' ATACADÃO '])
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'ATACADÃO']) // reenvio da fila
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 52, 2.79, $4)', [L1, C1, coca, 'comprado'])
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 50, 2.89, $4)', [L1, C1, coca, 'parcial']) // corrigiu
    await como(db, JOAO, 'select fechar_compra($1, true, 144.5, null)', [C1])
    await como(db, JOAO, 'select fechar_compra($1, true, 144.5, null)', [C1]) // reenvio da fila
    const [c] = await como(db, ADMIN, 'select loja, status, com_nota, total_pago from compras')
    expect([c.loja, c.status, c.com_nota, Number(c.total_pago)]).toEqual(['ATACADÃO', 'fechada', true, 144.5])
    const linhas = await como(db, ADMIN, 'select qtd, preco_unit, resultado from compras_itens')
    expect(linhas.map((l) => [Number(l.qtd), Number(l.preco_unit), l.resultado])).toEqual([[50, 2.89, 'parcial']])
  })

  it('não achei grava quantidade zero e sem preço', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 10, 5, $4)', [L1, C1, coca, 'nao_achei'])
    const [l] = await como(db, ADMIN, 'select qtd, preco_unit from compras_itens')
    expect([Number(l.qtd), l.preco_unit]).toEqual([0, null])
  })

  it('comprado exige quantidade maior que zero', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await expect(como(db, JOAO, 'select registrar_item($1, $2, $3, 0, 5, $4)', [L1, C1, coca, 'comprado'])).rejects.toThrow(/quantidade/)
  })

  it('dois compradores somam; ninguém mexe na compra do outro', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Atacadão'])
    await como(db, MARIA, 'select abrir_compra($1, $2, $3)', [C2, s, 'Mateus'])
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 30, 2.79, $4)', [L1, C1, coca, 'parcial'])
    await como(db, MARIA, 'select registrar_item($1, $2, $3, 22, 2.75, $4)', [L2, C2, coca, 'comprado'])
    await expect(como(db, MARIA, 'select registrar_item($1, $2, $3, 1, 1, $4)', [L2, C1, coca, 'comprado'])).rejects.toThrow(/outra pessoa/)
    await expect(como(db, MARIA, 'select desmarcar_item($1, $2)', [C1, coca])).rejects.toThrow(/outra pessoa/)
    const [t] = await como(db, JOAO, 'select sum(qtd) as total from compras_itens where item_semana_id = $1', [coca])
    expect(Number(t.total)).toBe(52) // João enxerga o que a Maria comprou
  })

  it('item fora da lista é recusado', async () => {
    const { db, s, cebola } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await expect(como(db, JOAO, 'select registrar_item($1, $2, $3, 1, 1, $4)', [L1, C1, cebola, 'comprado'])).rejects.toThrow(/fora da lista/)
  })

  it('não fecha compra vazia e não marca depois de fechada', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await expect(como(db, JOAO, 'select fechar_compra($1, false, 0, null)', [C1])).rejects.toThrow(/pelo menos um item/)
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 1, 1, $4)', [L1, C1, coca, 'comprado'])
    await como(db, JOAO, 'select fechar_compra($1, false, 1, null)', [C1])
    await expect(como(db, JOAO, 'select registrar_item($1, $2, $3, 2, 1, $4)', [L1, C1, coca, 'comprado'])).rejects.toThrow(/fechada/)
    await expect(como(db, JOAO, 'select desmarcar_item($1, $2)', [C1, coca])).rejects.toThrow(/fechada/)
  })

  it('não abre compra em semana que não está em compra', async () => {
    const db = banco()
    await importar(db)
    await expect(como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, await idSemana(db), 'Feira'])).rejects.toThrow(/liberada/)
  })
})

describe('fila de lançamento', () => {
  async function fechada() {
    const x = await emCompra()
    await como(x.db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, x.s, 'Atacadão'])
    await como(x.db, JOAO, 'select registrar_item($1, $2, $3, 52, 2.79, $4)', [L1, C1, x.coca, 'comprado'])
    await como(x.db, JOAO, 'select fechar_compra($1, true, 145.08, null)', [C1])
    return x
  }

  it('admin aprova e depois marca como lançada', async () => {
    const { db } = await fechada()
    await expect(como(db, ADMIN, 'select marcar_lancada($1)', [C1])).rejects.toThrow(/aprovada/)
    await como(db, ADMIN, 'select aprovar_compra($1)', [C1])
    await como(db, ADMIN, 'select marcar_lancada($1)', [C1])
    const [c] = await como(db, ADMIN, 'select status, aprovada_por, lancada_por from compras')
    expect([c.status, c.aprovada_por, c.lancada_por]).toEqual(['lancada', ADMIN, ADMIN])
  })

  it('comprador não aprova', async () => {
    const { db } = await fechada()
    await expect(como(db, JOAO, 'select aprovar_compra($1)', [C1])).rejects.toThrow(/administrador/)
  })

  it('correção do admin fica no histórico', async () => {
    const { db } = await fechada()
    await como(db, ADMIN, 'select corrigir_item_compra($1, 50, 2.9)', [L1])
    await como(db, ADMIN, 'select corrigir_compra($1, false, 145)', [C1])
    const h = await como(db, ADMIN, 'select quem, tabela, antes, depois from historico_alteracoes order by id')
    expect(h.map((x) => x.tabela)).toEqual(['compras_itens', 'compras'])
    expect(h[0].quem).toBe(ADMIN)
    expect(Number(h[0].antes.qtd)).toBe(52)
    expect(Number(h[0].depois.qtd)).toBe(50)
  })

  it('M3: reenviar fechar_compra depois de aprovada/lançada não dá erro (idempotente)', async () => {
    const { db } = await fechada()
    await como(db, ADMIN, 'select aprovar_compra($1)', [C1])
    await como(db, JOAO, 'select fechar_compra($1, true, 145.08, null)', [C1]) // reenvio: já aprovada
    await como(db, ADMIN, 'select marcar_lancada($1)', [C1])
    await como(db, JOAO, 'select fechar_compra($1, true, 145.08, null)', [C1]) // reenvio: já lançada
    const [c] = await como(db, ADMIN, 'select status from compras')
    expect(c.status).toBe('lancada') // não regrediu nem deu erro
  })
})

describe('cancelar_compra (I2)', () => {
  it('dono cancela a própria compra aberta e vazia', async () => {
    const { db, s } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, JOAO, 'select cancelar_compra($1)', [C1])
    expect(await como(db, ADMIN, 'select * from compras')).toHaveLength(0)
  })

  it('não cancela a compra de outra pessoa', async () => {
    const { db, s } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await expect(como(db, MARIA, 'select cancelar_compra($1)', [C1])).rejects.toThrow(/outra pessoa/)
    expect(await como(db, ADMIN, 'select * from compras')).toHaveLength(1)
  })

  it('não cancela compra com item marcado', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 1, 1, $4)', [L1, C1, coca, 'comprado'])
    await expect(como(db, JOAO, 'select cancelar_compra($1)', [C1])).rejects.toThrow(/já tem item marcado/)
  })

  it('não cancela compra já fechada', async () => {
    const { db, s, coca } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, JOAO, 'select registrar_item($1, $2, $3, 1, 1, $4)', [L1, C1, coca, 'comprado'])
    await como(db, JOAO, 'select fechar_compra($1, false, 1, null)', [C1])
    await expect(como(db, JOAO, 'select cancelar_compra($1)', [C1])).rejects.toThrow(/aberta/)
  })

  it('admin cancela uma compra vazia de qualquer um', async () => {
    const { db, s } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, ADMIN, 'select cancelar_compra($1)', [C1])
    expect(await como(db, ADMIN, 'select * from compras')).toHaveLength(0)
  })

  it('M-e: reenviar cancelar_compra de uma compra já cancelada não dá erro (idempotente)', async () => {
    const { db, s } = await emCompra()
    await como(db, JOAO, 'select abrir_compra($1, $2, $3)', [C1, s, 'Feira'])
    await como(db, JOAO, 'select cancelar_compra($1)', [C1])
    await como(db, JOAO, 'select cancelar_compra($1)', [C1]) // reenvio da fila: a resposta do 1º se perdeu
    expect(await como(db, ADMIN, 'select * from compras')).toHaveLength(0)
  })

  it('M-e: continua exigindo acesso ativo, e anon não executa', async () => {
    const { db } = await emCompra()
    await expect(como(db, EX, 'select cancelar_compra($1)', [C2])).rejects.toThrow(/sem acesso/)
    await expect(como(db, ESTRANHO, 'select cancelar_compra($1)', [C2])).rejects.toThrow(/sem acesso/)
    await expect(como(db, 'anon', 'select cancelar_compra($1)', [C2])).rejects.toThrow(/permission denied/)
  })

  it('M-e: search_path fixo e security definer mantidos', async () => {
    const db = banco()
    const [f] = await como(db, 'service', `select prosecdef, proconfig from pg_proc where proname = 'cancelar_compra'`)
    expect(f.prosecdef).toBe(true)
    expect(f.proconfig).toEqual(['search_path=public'])
  })
})

describe('nomes_equipe (M12)', () => {
  it('devolve e-mail e nome de quem está ativo', async () => {
    const { db } = await emCompra()
    const r = await como(db, JOAO, 'select * from nomes_equipe() order by email')
    expect(r).toEqual(expect.arrayContaining([
      { email: ADMIN, nome: 'Ivan' }, { email: JOAO, nome: 'João' }, { email: MARIA, nome: 'Maria' },
    ]))
    expect(r.find((x) => x.email === EX)).toBeUndefined() // desativado não aparece
  })

  it('só quem está ativo pode chamar', async () => {
    const { db } = await emCompra()
    await expect(como(db, EX, 'select * from nomes_equipe()')).rejects.toThrow(/acesso/)
    await expect(como(db, ESTRANHO, 'select * from nomes_equipe()')).rejects.toThrow(/acesso/)
  })
})
