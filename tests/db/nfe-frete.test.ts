import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO } from './fixture-recebimento'
import { erroDe, type Json } from './fixture-cotacao'

// Frete da nota fiscal (pedido do Ivan, 09/10/2026): cot_nfe.frete_valor / frete_tipo, os dois juntos ou nenhum; só a função (service_role) grava.
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()
const CHAVE = '35261008637193000106550010001207101371230333'

const nota = (): Json => ({ chave: CHAVE, emitente: 'TAMAROZZI COMERCIO DE EMBALAGENS LTDA', numero: '000120710', emissao: '2026-10-08', valor_nf: 1516,
  totais: { v_prod: 1516, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
  itens: [{ n: 1, cod_forn: '2350LG', descricao: 'EMBALAGEM P/ PIZZA N. 35', qtd_nf: 40, unidade_nf: 'PCT', produto_id: null, associacao: null, qtd: null, unidade_sischef: 'PCT', v_prod: 1516, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }] })
const sincronizar = (db: PGlite) => chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify({ lida_em: '2026-10-09T15:00:00Z', completa: true, origem: 'agendada', notas: [nota()] })])

describe('cot_nfe — frete', () => {
  it('sem frete por padrão (os dois nulos); com frete, valor e tipo juntos', async () => {
    const db = await banco()
    await sincronizar(db)
    expect(await como(db, ADMIN, 'select frete_valor, frete_tipo from cot_nfe where chave = $1', [CHAVE])).toEqual([{ frete_valor: null, frete_tipo: null }])
    await db.exec(`update cot_nfe set frete_valor = 300, frete_tipo = '1' where chave = '${CHAVE}'`)
    expect(await como(db, ADMIN, 'select frete_valor::text, frete_tipo from cot_nfe where chave = $1', [CHAVE])).toEqual([{ frete_valor: '300.00', frete_tipo: '1' }])
  })

  it('recusa valor ou tipo sozinho, valor zero/negativo/enorme e tipo desconhecido', async () => {
    const db = await banco()
    await sincronizar(db)
    for (const set of ["frete_valor = 300", "frete_tipo = '1'", "frete_valor = 0, frete_tipo = '1'", "frete_valor = -1, frete_tipo = '1'", "frete_valor = 2000000, frete_tipo = '1'", "frete_valor = 300, frete_tipo = '7'"]) {
      await expect(db.exec(`update cot_nfe set ${set} where chave = '${CHAVE}'`)).rejects.toThrow()
    }
  })

  it('o app (authenticated) não grava o frete direto: só a função', async () => {
    const db = await banco()
    await sincronizar(db)
    expect(await erroDe(como(db, ADMIN, `update cot_nfe set frete_valor = 300, frete_tipo = '1' where chave = $1`, [CHAVE]))).toMatch(/permission denied|nenhuma/i)
  })
})
