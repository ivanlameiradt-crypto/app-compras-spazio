import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO } from './fixture-recebimento'
import type { Json } from './fixture-cotacao'

// Nota lançada no SisChef não pode ficar com o estado do lançamento preso em 'lancando' (a aba mostrava
// "Lançando… (o robô está trabalhando)" e travava o botão). Caso real: NF 000090330 (Mateus MIX), 06/11/2026:
// o robô terminou LANCADA às 18:22:31 UTC, marcou situacao='lancada' e lancada_em, mas o estado ficou 'lancando'.

// todas as migrations: o estado do lançamento (lancamento_estado) é da migração 20261206 e vem depois da cadeia da D2
const atual = bancoRecebimento(null)
const banco = async () => atual()

const CHAVE = '15261103995515011363550020000903301105721510'

function nota(): Json {
  return {
    chave: CHAVE, emitente: 'MATEUS SUPERMERCADOS SA - MIX ABAETETUBA', numero: '000090330', emissao: '2026-11-04',
    valor_nf: 635.4, totais: { v_prod: 635.4, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
    itens: [{ n: 1, cod_forn: '473185', descricao: 'OLEO DE ALGODAO - INSUMOS', qtd_nf: 60, unidade_nf: 'UN', produto_id: null,
      associacao: null, qtd: null, unidade_sischef: 'UN', v_prod: 635.4, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }],
  }
}

const leitura = (notas: Json[]): Json => ({ lida_em: '2026-11-06T18:00:00Z', completa: true, origem: 'agendada', notas })

describe('lançada tira o estado do lançamento (cot_nfe_marcar_lancadas)', () => {
  it('nota que o robô lançou sai de "lancando": a aba não fica "Lançando…" para sempre', async () => {
    const db = await banco()
    await chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify(leitura([nota()]))])
    // a Edge Function reservou a nota e chamou o robô
    await db.query(`update cot_nfe set lancamento_estado = 'lancando', lancamento_em = now(), lancamento_estado_em = now(),
                    forma_pagamento = 'boleto' where chave = $1`, [CHAVE])
    // o robô terminou com sucesso e informa a lançada
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: '90330', lancada_em: '2026-11-06T18:22:30Z' }])])

    const [r] = await como(db, ADMIN, `select situacao, nf_sischef, lancamento_estado, lancamento_motivo
      from cot_nfe where chave = $1`, [CHAVE])
    expect(r).toMatchObject({ situacao: 'lancada', nf_sischef: '90330', lancamento_estado: null, lancamento_motivo: null })
  })

  it('o estado "erro" (pedido pela metade, ex.: frete com boleto a lançar no SisChef) NÃO é apagado pela lançada', async () => {
    const db = await banco()
    await chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify(leitura([nota()]))])
    await db.query(`update cot_nfe set lancamento_estado = 'erro', lancamento_motivo = 'pedido aberto', lancamento_estado_em = now()
                    where chave = $1`, [CHAVE])
    await chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)',
      [SEGREDO, JSON.stringify([{ chave: CHAVE, nf_sischef: '90330', lancada_em: '2026-11-06T18:22:30Z' }])])

    const [r] = await como(db, ADMIN, `select lancamento_estado, lancamento_motivo from cot_nfe where chave = $1`, [CHAVE])
    expect(r).toMatchObject({ lancamento_estado: 'erro', lancamento_motivo: 'pedido aberto' })
  })
})
