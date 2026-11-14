import { semSinalDeLancamento } from '../../src/admin/motivoDoRobo'
import { planoConversaoSugerida, planoFormaLembrada } from '../../src/admin/notaSefazRegras'
import type { NotaSefazLista } from '../../src/lib/tipos'

// Revisão independente do PR 98 (14/11/2026, "com ajustes"): a conversão pelo nome aceitava casos que dão número ERRADO (vai para o estoque e vira de-para permanente no SisChef).
// Os dados abaixo são os casos do revisor. Só podem sugerir: o ketchup sachê (o robô valida o número pelo nome) e o peso "395G" com nota em UN e produto em KG.
const PRE = 'parou antes de gerar o pedido (nada lançado): '
const UD = (c: string) => `UN DIFERE sem conversão na tela: CÓD. FOR ${c} (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)`
const KET_A = 'ketchup sachê: o nome diz 168 un por caixa e o app tem 1 UN = 12: no app, toque em Editar neste item e informe 168 (ou acerte no SisChef) e lance de novo'
const nota = (itens: unknown[], motivo: string, extra: Record<string, unknown> = {}): NotaSefazLista => ({
  chave: '5'.repeat(44), cnpj_emitente: '1', emitente: 'F', numero: '1', emissao: '2026-11-13', valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  parcelas: [], itens, associacoes_app: null, forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: motivo, ...extra,
} as unknown as NotaSefazLista)
const mk = (o: Record<string, unknown>) => ({ n: 1, qtd_nota: o.qtd, produto_id: '77', produto_nome: 'PROD', associacao: 'sischef', ...o })
const um = (o: Record<string, unknown>, motivo = PRE + UD('5'), extra: Record<string, unknown> = {}) => planoConversaoSugerida(nota([mk({ n: 1, ...o })], motivo, extra))

describe('1: embalagem genérica do nome com UN DIFERE nunca sugere (numa caixa cabem vários pacotes)', () => {
  it.each([
    ['GUARDANAPO 30X30 PCT C/ 50, nota CX', { descricao: 'CÓD. FOR: 5 GUARDANAPO 30X30 PCT C/ 50', qtd: 3, unidade_sischef: 'UN', unidade_nota: 'CX' }],
    ['COPO 300ML 50UN, nota CX', { descricao: 'CÓD. FOR: 5 COPO DESCARTAVEL 300ML 50UN', qtd: 2, unidade_sischef: 'UN', unidade_nota: 'CX' }],
    ['REFRIG COCA LT SIX PACK 350ML, nota CX', { descricao: 'CÓD. FOR: 5 REFRIG COCA COLA LT SIX PACK 350ML', qtd: 4, unidade_sischef: 'UN', unidade_nota: 'CX' }],
    ['KETCHUP 168UN pelo UN DIFERE (só o aviso do próprio ketchup vale)', { descricao: 'CÓD. FOR: 5 KETCHUP SACHE 168UN', qtd: 10, unidade_sischef: 'UN', unidade_nota: 'CX' }],
    ['PCT C/ 100, nota PCT, produto UN', { descricao: 'CÓD. FOR: 5 COPO PCT C/ 100', qtd: 5, unidade_sischef: 'UN', unidade_nota: 'PCT' }],
  ])('%s', (_t, it) => { expect(um(it)).toBeNull() })
})

describe('2 e 3: a unidade da nota e a do produto são cada uma a sua', () => {
  it.each([
    ['ALGO 10UN, nota KG, produto UN (não pode sugerir 25)', { descricao: 'CÓD. FOR: 5 ALGO 10UN', qtd: 2.5, unidade_sischef: 'UN', unidade_nota: 'KG' }],
    ['CERVEJA LATA C/ 12, nota UN, produto CX', { descricao: 'CÓD. FOR: 5 CERVEJA LATA C/ 12', qtd: 10, unidade_sischef: 'CX', unidade_nota: 'UN' }],
    ['LUVA 100UN, nota UN, produto CX', { descricao: 'CÓD. FOR: 5 LUVA 100UN', qtd: 2, unidade_sischef: 'CX', unidade_nota: 'UN' }],
    ['SIX PACK, nota UN, produto FD', { descricao: 'CÓD. FOR: 5 REFRIG COCA SIX PACK 350ML', qtd: 10, unidade_sischef: 'FD', unidade_nota: 'UN' }],
  ])('%s', (_t, it) => { expect(um(it)).toBeNull() })
  const base = { descricao: 'CÓD. FOR: 5 QUEIJO MUSSARELA FATIADO C/ 12', qtd: 10, unidade_sischef: 'UN', unidade_nota: 'UN', produto_id: null, produto_nome: null, associacao: 'painel' }
  const app = (unidade: string) => ({ associacoes_app: { '1': { produto_id: 9, produto_nome: 'PRODUTO', unidade, conversao: null, origem: 'app' } } })
  it('item decidido no app: "C/ 12" com produto KG ou PCT não sugere', () => {
    expect(um(base, PRE + UD('5'), app('kg'))).toBeNull()
    expect(um(base, PRE + UD('5'), app('pct'))).toBeNull()
  })
  it('item decidido no app: o peso "395G" usa a unidade do PRODUTO (d.unidade), não a da nota', () => {
    const leite = { ...base, descricao: 'CÓD. FOR: 5 LEITE COND 395G' }
    expect(um(leite, PRE + UD('5'), app('kg'))?.sugestoes[0]).toEqual(expect.objectContaining({ numero: 0.395, conta: '10 × 0,395 = 3,95 KG', via: 'associar' }))
    expect(um(leite, PRE + UD('5'), app('un'))).toBeNull()
  })
  it('peso "395G", nota UN e produto KG: continua sugerindo, com a conta', () => {
    expect(um({ descricao: 'CÓD. FOR: 5 LEITE COND 395G', qtd: 24, unidade_sischef: 'KG', unidade_nota: 'UN' })?.sugestoes[0].conta).toBe('24 × 0,395 = 9,48 KG')
  })
  it.each([
    ['2,5KG com nota CX', { descricao: 'CÓD. FOR: 5 CARNE 2,5KG', qtd: 2, unidade_sischef: 'KG', unidade_nota: 'CX' }],
    ['500ML com produto em L', { descricao: 'CÓD. FOR: 5 SUCO 500ML', qtd: 12, unidade_sischef: 'L', unidade_nota: 'UN' }],
  ])('%s não sugere', (_t, it) => { expect(um(it)).toBeNull() })
})

describe('4: sem qtd_nota e unidade_nota, ou com a linha já convertida, nenhuma sugestão', () => {
  const ket = { descricao: 'CÓD. FOR: 5 KETCHUP SACHE 168UN', qtd: 10, qtd_nota: 10, unidade_sischef: 'UN', unidade_nota: 'CX' }
  it('o ketchup completo sugere 168 (10 × 168 = 1.680 UN)', () => { expect(um(ket, KET_A)?.sugestoes[0].conta).toBe('10 × 168 = 1.680 UN') })
  it.each([
    ['sem qtd_nota (nota lida antes de 31/10)', { qtd_nota: null }],
    ['sem unidade_nota', { unidade_nota: null }],
    ['linha já convertida pelo SisChef (120 no lugar de 10)', { qtd: 120, qtd_nota: 10 }],
    ['produto do ketchup em CX', { unidade_sischef: 'CX' }],
  ])('ketchup %s', (_t, troca) => { expect(um({ ...ket, ...troca }, KET_A)).toBeNull() })
  it('peso sem qtd_nota: não sugere', () => {
    expect(um({ descricao: 'CÓD. FOR: 5 LEITE COND 395G', qtd: 24, qtd_nota: null, unidade_sischef: 'KG', unidade_nota: 'UN' })).toBeNull()
  })
})

describe('5: a forma lembrada olha os boletos do XML', () => {
  const BOL = [{ numero: '1', vencimento: '2026-12-01', valor: 100 }]
  const FALTA = PRE + 'falta a forma de pagamento — escolha "como pagar" no app'
  it('dinheiro/tesouraria nunca quando o XML traz boletos', () => {
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: BOL }), { '1': 'dinheiro' })).toBeNull()
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: BOL }), { '1': 'tesouraria' })).toBeNull()
  })
  it('dinheiro sem boletos no XML: sugere', () => {
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: [] }), { '1': 'dinheiro' })?.forma).toBe('dinheiro')
  })
  it('boleto só quando as parcelas fecham com o valor da nota', () => {
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: BOL }), { '1': 'boleto' })?.forma).toBe('boleto')
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: [{ ...BOL[0], valor: 90 }] }), { '1': 'boleto' })).toBeNull()
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: [] }), { '1': 'boleto' })).toBeNull()
    expect(planoFormaLembrada(nota([], FALTA, { parcelas: null }), { '1': 'boleto' })).toBeNull()
  })
})

describe('6: texto longo do robô (o banco corta em 2.000 letras e pode perder o aviso)', () => {
  it('semSinalDeLancamento recusa texto com 1.500 letras ou mais', () => {
    expect(semSinalDeLancamento(PRE + UD('5'))).toBe(true)
    expect(semSinalDeLancamento(PRE + UD('5') + ' | ' + 'x'.repeat(1500))).toBe(false)
  })
})
