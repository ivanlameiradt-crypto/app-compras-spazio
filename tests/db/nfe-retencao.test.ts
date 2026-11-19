import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, como, chamar, ADMIN, SEGREDO, fixarRelogio } from './fixture-recebimento'
import type { Json } from './fixture-cotacao'

// Retenção da tabela cot_nfe (19/11/2026). O app guarda nela a história do que foi lançado, descartado ou trabalhado (lista "Últimos lançamentos",
// trava de compra repetida de 45 dias). A limpeza de 30 dias de cot_nfe_sincronizar só pode apagar a linha que nunca foi usada.
// Cadeia inteira de migrations (null): a correção vem na 20261231000003, depois das colunas de lançamento, descarte, associação, parcelas e frete.
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()

const CHAVE = '15261012345678000190550010001234561000000017'
const CHAVE2 = '15261099887766000155550010009999991000000012'

const nota = (chave: string, emitente: string): Json => ({
  chave, emitente, numero: '000123456', emissao: '2026-10-18', valor_nf: 378,
  totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 },
  itens: [{ n: 1, cod_forn: '17253', descricao: 'REFRIG COLA', qtd_nf: 9, unidade_nf: 'FD', produto_id: null, associacao: null, qtd: null,
    unidade_sischef: 'UN', v_prod: 0, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }],
})
const sync = (db: PGlite, notas: Json[], lidaEm: string) =>
  chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify({ lida_em: lidaEm, completa: false, origem: 'agendada', notas })])

/**
 * Cria a NF sem vendedor e sem vínculo (vista em 01/08), deixa `mexer` trabalhar nela e, em `noFim`, uma nova leitura roda a limpeza.
 * Devolve se a NF ainda existe.
 */
async function aindaExiste(mexer: (db: PGlite) => Promise<unknown>, noFim = '2026-09-15T12:00:00Z'): Promise<boolean> {
  const db = await banco()
  await fixarRelogio(db, '2026-08-01T12:00:00Z')
  await sync(db, [nota(CHAVE2, 'DESCONHECIDA')], '2026-08-01T12:00:00Z')
  await mexer(db)
  await fixarRelogio(db, noFim)
  await sync(db, [nota(CHAVE, 'FORNECEDOR A LTDA')], noFim)
  const [r] = await como(db, ADMIN, 'select count(*)::int as n from cot_nfe where chave = $1', [CHAVE2])
  return r.n === 1
}
const nada = async () => {}
const lancar = (db: PGlite) =>
  chamar(db, 'anon', 'cot_nfe_marcar_lancadas($1, $2::jsonb)', [SEGREDO, JSON.stringify([{ chave: CHAVE2, nf_sischef: 'NF 9', lancada_em: '2026-08-02T12:00:00Z' }])])
const gravar = (colunas: string) => async (db: PGlite) => { await db.exec(`update cot_nfe set ${colunas} where chave = '${CHAVE2}'`) }

describe('cot_nfe — retenção (só apaga o que nunca foi usado)', () => {
  it('NF nunca usada, sem vendedor e sem vínculo, vista há mais de 30 dias, é apagada (como antes)', async () => {
    expect(await aindaExiste(nada)).toBe(false)
  })

  it('NF ainda dentro dos 30 dias não é apagada', async () => {
    expect(await aindaExiste(nada, '2026-08-20T12:00:00Z')).toBe(true)
  })

  it('NF já lançada, sem vendedor, vista há mais de 30 dias, NÃO é apagada', async () => {
    expect(await aindaExiste(lancar)).toBe(true)
  })

  it.each([
    ['descartada pelo Ivan', "descartada_em = '2026-08-03T12:00:00Z'"],
    ['com associação de produto feita no app', `associacoes_app = '{"1": {"produto_id": 101}}'::jsonb`],
    ['com parcelas já preenchidas', "parcelas = '[]'::jsonb"],
    ['com frete informado', "frete_valor = 25, frete_tipo = '1'"],
    ['com estado do robô de lançamento', "lancamento_estado = 'erro'"],
  ])('NF %s, sem vendedor, vista há mais de 30 dias, NÃO é apagada', async (_nome, colunas) => {
    expect(await aindaExiste(gravar(colunas))).toBe(true)
  })

  it('NF lançada fica 1 ano: ainda existe aos 11 meses e some depois de 1 ano', async () => {
    expect(await aindaExiste(lancar, '2027-07-01T12:00:00Z')).toBe(true)
    expect(await aindaExiste(lancar, '2027-08-10T12:00:00Z')).toBe(false)
  })
})
