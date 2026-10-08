import {
  TOLERANCIA, ehGtin, ehPeso, itemSempreManual, itensPendentes, lerQuantidade, linhaConfirmada, linhaJaConfirmada, podeLembrar, precisaConversao, somaDoCupom, unidadeNorm,
  type Confirmada,
} from '../../src/admin/cupomCorrigirRegras'
// A conta da tela tem de ser a do servidor: importa a lógica da Edge Function (pura, sem Deno) e compara. O vitest resolve a extensão .ts.
import {
  conferirSoma, ehGtin as ehGtinServidor, refazerItem, TOLERANCIA as TOLERANCIA_SERVIDOR, unidadeNorm as unidadeNormServidor,
} from '../../supabase/functions/confirmar-cupom/logica.ts'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// O cupom do ATACADAO de 06/10/2026 (R$ 35,27) como está no banco: 2 itens sem produto confirmado (só com proposta) e 1 já aprendido.
const LIMAO_SICILIANO: ItemCupomRecente = { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null,
  sugestao_produto: null, casado_por: null, proposta: { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS' } }
const PEPINO: ItemCupomRecente = { descricao_cupom: 'PEPINO JAPONES', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null,
  sugestao_produto: null, casado_por: null, proposta: { insumo_id: '3484991', insumo_nome: 'PEPINO JAPONÊS - INSUMOS' } }
const TAITI: ItemCupomRecente = { descricao_cupom: 'LIMAO TAITI TROPICAL', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884,
  sugestao_produto: { id: '3469643' }, casado_por: 'descricao', proposta: null }
/** Um item vendido por unidade (cupom em UN) cujo produto do SisChef é em KG: a conversão preserva o valor da linha. */
const CAIXA_UN: ItemCupomRecente = { descricao_cupom: 'TOMATE CX', unidade_cupom: 'UN', valor_unitario: 10, desconto_item: 1, entrada_estoque: null,
  sugestao_produto: null, casado_por: null, proposta: null }

const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 35.27, pedido_sischef: null,
  criado_em: '2026-10-06T13:07:38Z', motivo: '2 item(ns) sem casamento confirmado — confira no Code', teste: false,
  itens: [LIMAO_SICILIANO, PEPINO, TAITI], ...extra,
})
const conf = (quantidade: number, entrada: number | null = null): Confirmada => ({ quantidade, entrada })
const mapa = (pares: [number, Confirmada][]) => new Map<number, Confirmada>(pares)

describe('lerQuantidade (o que o Ivan digita como peso ou quantidade)', () => {
  it('aceita vírgula, ponto, milhar com vírgula e espaços em volta', () => {
    expect(lerQuantidade('0,5')).toBe(0.5)
    expect(lerQuantidade('0.5')).toBe(0.5)
    expect(lerQuantidade('1.234,5')).toBe(1234.5)
    expect(lerQuantidade(' 2 ')).toBe(2)
    expect(lerQuantidade('0,912')).toBe(0.912)
    // sem vírgula, o ponto é DECIMAL (teclado numérico do Android só tem ponto; peso nunca tem milhar): "1.234" é 1,234 kg, não 1.234 kg
    expect(lerQuantidade('1.234')).toBe(1.234)
    expect(lerQuantidade('2.500')).toBe(2.5)
    expect(lerQuantidade('.5')).toBe(0.5)
    expect(lerQuantidade('1.2.3')).toBeNull()
  })
  it('zero, negativo, vazio ou texto: null (o servidor só aceita maior que zero)', () => {
    expect(lerQuantidade('0')).toBeNull()
    expect(lerQuantidade('0,00')).toBeNull()
    expect(lerQuantidade('-1')).toBeNull()
    expect(lerQuantidade('')).toBeNull()
    expect(lerQuantidade('   ')).toBeNull()
    expect(lerQuantidade('meio quilo')).toBeNull()
    expect(lerQuantidade('1,5 kg')).toBeNull()
  })
})

describe('unidadeNorm / ehPeso / precisaConversao (a mesma régua da Edge Function)', () => {
  it('UN, UND, UNID, UNIDADE, PC e PÇ são a mesma unidade; o resto só perde espaço e maiúscula; vazio ou nulo fica vazio', () => {
    for (const u of ['UN', ' Und ', 'UNID', 'unidade', 'PC', 'pç']) expect(unidadeNorm(u)).toBe('un')
    expect(unidadeNorm(' KG ')).toBe('kg')
    expect(unidadeNorm('Cx')).toBe('cx')
    expect(unidadeNorm(null)).toBe('')
    expect(unidadeNorm(undefined)).toBe('')
  })
  it('normaliza exatamente como o servidor (se divergir, a tela pede conversão onde ele não pede, ou o contrário)', () => {
    const amostras = ['UN', 'und', ' Unid', 'unidade', 'PC', 'pç', 'KG', 'kg ', 'G', 'cx', 'L', '', null, undefined, 7]
    for (const u of amostras) expect(unidadeNorm(u)).toBe(unidadeNormServidor(u))
    expect(TOLERANCIA).toBe(TOLERANCIA_SERVIDOR)
  })
  it('peso/volume: kg, g, gr, l, lt, ml (qualquer caixa, com espaços); unidade, caixa e vazio não são', () => {
    for (const u of ['KG', 'kg', ' g ', 'GR', 'L', 'lt', 'ML']) expect(ehPeso(u)).toBe(true)
    for (const u of ['un', 'UN', 'cx', 'pc', '', null, undefined]) expect(ehPeso(u)).toBe(false)
  })
  it('precisa converter só quando as duas unidades existem e são diferentes depois de normalizadas', () => {
    expect(precisaConversao('UN', 'kg')).toBe(true)
    expect(precisaConversao('kg', 'UN')).toBe(true)
    expect(precisaConversao('KG', 'kg')).toBe(false)
    expect(precisaConversao('UN', 'pc')).toBe(false)   // as duas viram "un"
    expect(precisaConversao('', 'kg')).toBe(false)     // o servidor não cobra entrada quando um lado é vazio
    expect(precisaConversao('kg', null)).toBe(false)
    expect(precisaConversao(null, undefined)).toBe(false)
  })
})

describe('itensPendentes (os que o servidor exige confirmar)', () => {
  it('o caso real: LIMAO SICILIANO e PEPINO sem produto (posições 0 e 1); o LIMAO TAITI já tem', () => {
    expect(itensPendentes(cupom())).toEqual([0, 1])
  })
  it('id vazio, só espaço ou sugestao_produto nulo contam como pendente; itens que não são lista = nenhum', () => {
    expect(itensPendentes(cupom({ itens: [{ ...TAITI, sugestao_produto: { id: '' } }, { ...TAITI, sugestao_produto: { id: '  ' } }, TAITI] }))).toEqual([0, 1])
    expect(itensPendentes(cupom({ itens: [] }))).toEqual([])
    expect(itensPendentes(cupom({ itens: null as unknown as ItemCupomRecente[] }))).toEqual([])
  })
})

describe('linhaConfirmada / linhaJaConfirmada (a linha como o servidor a refaz)', () => {
  it('sem conversão: entrada = quantidade (3 casas), preço do cupom, valor a 2 casas', () => {
    expect(linhaConfirmada(LIMAO_SICILIANO, conf(0.5))).toEqual({ entrada: 0.5, valorUnitario: 13.9, valor: 6.95 })
    expect(linhaConfirmada(PEPINO, conf(0.912))).toEqual({ entrada: 0.912, valorUnitario: 5.79, valor: 5.28 })   // 5,28048 → 5,28
    expect(linhaConfirmada(PEPINO, conf(0.9124))).toEqual({ entrada: 0.912, valorUnitario: 5.79, valor: 5.28 })  // a 4ª casa some, como no servidor
    expect(linhaConfirmada(PEPINO, conf(2))).toEqual({ entrada: 2, valorUnitario: 5.79, valor: 11.58 })
  })
  it('entrada informada igual à quantidade: não converte (fator 1)', () => {
    expect(linhaConfirmada(LIMAO_SICILIANO, conf(0.5, 0.5))).toEqual({ entrada: 0.5, valorUnitario: 13.9, valor: 6.95 })
  })
  it('conversão UN→KG: 3 caixas a R$ 10,00 que entram como 1,5 kg viram R$ 20,00/kg e a linha continua valendo R$ 30,00 (menos o desconto)', () => {
    expect(linhaConfirmada(CAIXA_UN, conf(3, 1.5))).toEqual({ entrada: 1.5, valorUnitario: 20, valor: 29 })      // 3 × 10 − 1 = 29
    expect(linhaConfirmada({ ...CAIXA_UN, desconto_item: null }, conf(3, 1.5)).valor).toBe(30)               // desconto nulo = zero
    expect(linhaConfirmada(CAIXA_UN, conf(1, 0.333)).valor).toBe(9)                                           // 0,333 × (10 ÷ 0,333) − 1 = 9,00
  })
  it('preço nulo conta como zero (como o servidor lê) e entrada que arredonda a zero não vira NaN', () => {
    expect(linhaConfirmada({ ...PEPINO, valor_unitario: null }, conf(1))).toEqual({ entrada: 1, valorUnitario: 0, valor: 0 })
    const minima = linhaConfirmada(CAIXA_UN, conf(1, 0.0004))
    expect(minima.entrada).toBe(0)
    expect(Number.isFinite(minima.valor)).toBe(true)
  })
  it('item já confirmado: 2,884 kg × R$ 9,90 − R$ 5,51 = R$ 23,04; sem quantidade ou sem preço não há valor; desconto nulo é zero', () => {
    expect(linhaJaConfirmada(TAITI)).toBe(23.04)
    expect(linhaJaConfirmada({ ...TAITI, desconto_item: null })).toBe(28.55)
    expect(linhaJaConfirmada({ ...TAITI, entrada_estoque: null })).toBeNull()
    expect(linhaJaConfirmada({ ...TAITI, valor_unitario: null })).toBeNull()
  })
})

describe('somaDoCupom (a conferência que acende o botão "Reenviar para lançar")', () => {
  it('o caso real sem nada confirmado: só o LIMAO TAITI (R$ 23,04) entra; faltam os dois pendentes; o botão fica apagado', () => {
    const s = somaDoCupom(cupom(), mapa([]))
    expect(s).toMatchObject({ soma: 23.04, total: 35.27, diferenca: -12.23, bate: false, faltam: [0, 1] })
    expect(s.linhas).toEqual([{ indice: 0, valor: null }, { indice: 1, valor: null }, { indice: 2, valor: 23.04 }])
  })
  it('o caso real com 0,5 kg de limão siciliano e 0,912 kg de pepino: 23,04 + 6,95 + 5,28 = 35,27, bate', () => {
    const s = somaDoCupom(cupom(), mapa([[0, conf(0.5)], [1, conf(0.912)]]))
    expect(s).toMatchObject({ soma: 35.27, total: 35.27, diferenca: 0, bate: true, faltam: [] })
    expect(s.linhas).toEqual([{ indice: 0, valor: 6.95 }, { indice: 1, valor: 5.28 }, { indice: 2, valor: 23.04 }])
  })
  it('com 2 kg de pepino dá 41,57: diferença de R$ 6,30, não bate', () => {
    expect(somaDoCupom(cupom(), mapa([[0, conf(0.5)], [1, conf(2)]]))).toMatchObject({ soma: 41.57, diferenca: 6.3, bate: false, faltam: [] })
  })
  it('a soma fechando mas com um pendente ainda sem confirmação: não bate (o servidor recusaria "falta confirmar o item 2")', () => {
    // 0,88 kg × 13,90 = 12,232 → 12,23; 23,04 + 12,23 = 35,27, mas o pepino ficou de fora
    expect(somaDoCupom(cupom(), mapa([[0, conf(0.88)]]))).toMatchObject({ soma: 35.27, diferenca: 0, bate: false, faltam: [1] })
  })
  it('tolerância de 2 centavos, a mesma do robô: 35,25 bate com 35,27; 35,24 não', () => {
    expect(somaDoCupom(cupom(), mapa([[0, conf(0.5)], [1, conf(0.909)]]))).toMatchObject({ soma: 35.25, diferenca: -0.02, bate: true })   // 0,909 × 5,79 = 5,26
    expect(somaDoCupom(cupom(), mapa([[0, conf(0.5)], [1, conf(0.907)]]))).toMatchObject({ soma: 35.24, diferenca: -0.03, bate: false })  // 0,907 × 5,79 = 5,25
  })
  it('total não lido (nulo ou zero): total e diferença nulos e nunca bate, mesmo com tudo confirmado', () => {
    for (const valor_a_pagar of [null, 0]) {
      const s = somaDoCupom(cupom({ valor_a_pagar }), mapa([[0, conf(0.5)], [1, conf(0.912)]]))
      expect(s).toMatchObject({ soma: 35.27, total: null, diferenca: null, bate: false, faltam: [] })
    }
  })
  it('confirmação para um item que já tem produto é ignorada (o servidor a recusa); o valor gravado é o que vale', () => {
    const s = somaDoCupom(cupom(), mapa([[0, conf(0.5)], [1, conf(0.912)], [2, conf(100)]]))
    expect(s).toMatchObject({ soma: 35.27, bate: true })
    expect(s.linhas[2]).toEqual({ indice: 2, valor: 23.04 })
  })
  it('conversão UN→KG dentro da soma: a linha preserva o valor do cupom (3 × 10 − 1 = 29) e o total fecha', () => {
    const s = somaDoCupom(cupom({ valor_a_pagar: 52.04, itens: [CAIXA_UN, TAITI] }), mapa([[0, conf(3, 1.5)]]))
    expect(s).toMatchObject({ soma: 52.04, diferenca: 0, bate: true, linhas: [{ indice: 0, valor: 29 }, { indice: 1, valor: 23.04 }] })
  })
  it('item já confirmado sem quantidade (não devia existir): entra como o servidor conta (zero menos o desconto) e aparece sem valor', () => {
    const s = somaDoCupom(cupom({ valor_a_pagar: 6.95, itens: [LIMAO_SICILIANO, { ...TAITI, entrada_estoque: null, desconto_item: 0 }] }), mapa([[0, conf(0.5)]]))
    expect(s).toMatchObject({ soma: 6.95, bate: true, linhas: [{ indice: 0, valor: 6.95 }, { indice: 1, valor: null }] })
  })
  it('itens que não vêm como lista não derrubam a tela', () => {
    expect(somaDoCupom(cupom({ itens: null as unknown as ItemCupomRecente[] }), mapa([]))).toMatchObject({ soma: 0, faltam: [], linhas: [], bate: false })
  })
})

describe('podeLembrar (se o servidor tem como guardar o aprendizado)', () => {
  it('com código de barras VÁLIDO (GTIN com o dígito verificador certo) sempre dá, mesmo sem CNPJ e sem descrição', () => {
    expect(podeLembrar(cupom({ emitente_cnpj: null }), { ...PEPINO, codigo_barras: '7891234567895' })).toBe(true)
    expect(podeLembrar(cupom({ emitente_cnpj: null }), { ...PEPINO, codigo_barras: '96385074', descricao_cupom: '' })).toBe(true)
  })
  it('sem código de barras: precisa do CNPJ do emitente (14 dígitos, só dígitos) E de uma descrição com letra ou dígito', () => {
    expect(podeLembrar(cupom(), PEPINO)).toBe(true)
    expect(podeLembrar(cupom({ emitente_cnpj: null }), PEPINO)).toBe(false)
    expect(podeLembrar(cupom({ emitente_cnpj: '75.315.333/0001-09' }), PEPINO)).toBe(false)   // formatado: o servidor só reconhece dígitos
    expect(podeLembrar(cupom({ emitente_cnpj: '7531533300010' }), PEPINO)).toBe(false)        // 13 dígitos
    expect(podeLembrar(cupom(), { ...PEPINO, descricao_cupom: '' })).toBe(false)
    expect(podeLembrar(cupom(), { ...PEPINO, descricao_cupom: ' *** ' })).toBe(false)         // normalizada, não sobra nada
    expect(podeLembrar(cupom(), { ...PEPINO, descricao_cupom: null })).toBe(false)
  })
  it('código que não é GTIN válido (15 dígitos, letras, EAN cortado, só zeros, verificador errado) não é chave global; a descrição vale', () => {
    for (const codigo of ['123456789012345', 'ABC', '7891234', '1', '0000000000000', '7891234567890']) {
      expect(podeLembrar(cupom({ emitente_cnpj: null }), { ...PEPINO, codigo_barras: codigo })).toBe(false)
      expect(podeLembrar(cupom(), { ...PEPINO, codigo_barras: codigo })).toBe(true)
    }
  })
})

describe('a regra do código de barras da tela é a do servidor (ehGtin de confirmar-cupom/logica.ts)', () => {
  const codigos = ['7891234567895', '7891000100103', '96385074', '036000291452', '17891234567892', '7891234567890', '7891234', '0000000000000',
    '00000000', '1', '123456789012345', '789-ABC', '', null, undefined]
  it.each(codigos)('%s: o mesmo veredito dos dois lados', (codigo) => {
    expect(ehGtin(codigo)).toBe(ehGtinServidor(codigo))
  })
  it('os GTIN válidos passam e os outros não (para o teste acima não passar por acaso com dois "false")', () => {
    expect(codigos.filter(ehGtin)).toEqual(['7891234567895', '7891000100103', '96385074', '036000291452', '17891234567892'])
  })
})

describe('a conta da tela é a conta do servidor (confirmar-cupom/logica.ts)', () => {
  type Caso = { nome: string; itens: ItemCupomRecente[]; total: number; confirmadas: [number, Confirmada][] }
  const casos: Caso[] = [
    { nome: 'ATACADAO, pesos certos', itens: [LIMAO_SICILIANO, PEPINO, TAITI], total: 35.27, confirmadas: [[0, conf(0.5)], [1, conf(0.912)]] },
    { nome: 'ATACADAO, 2 kg de pepino', itens: [LIMAO_SICILIANO, PEPINO, TAITI], total: 35.27, confirmadas: [[0, conf(0.5)], [1, conf(2)]] },
    { nome: 'ATACADAO, no limite da tolerância', itens: [LIMAO_SICILIANO, PEPINO, TAITI], total: 35.27, confirmadas: [[0, conf(0.5)], [1, conf(0.909)]] },
    { nome: 'peso com 4 casas', itens: [LIMAO_SICILIANO, PEPINO, TAITI], total: 35.27, confirmadas: [[0, conf(0.5004)], [1, conf(0.9124)]] },
    { nome: 'conversão UN→KG com desconto', itens: [CAIXA_UN, TAITI], total: 52.04, confirmadas: [[0, conf(3, 1.5)]] },
    { nome: 'conversão com entrada "feia"', itens: [CAIXA_UN, PEPINO], total: 20, confirmadas: [[0, conf(1, 0.333)], [1, conf(1.777)]] },
    { nome: 'entrada igual à quantidade', itens: [CAIXA_UN], total: 29, confirmadas: [[0, conf(3, 3)]] },
  ]

  it.each(casos)('$nome: linha a linha e a soma iguais, com o mesmo veredito', ({ itens, total, confirmadas }) => {
    const c = cupom({ valor_a_pagar: total, itens })
    const refeitos: Record<string, unknown>[] = itens.map((it) => ({ ...it }))
    for (const [indice, cf] of confirmadas) {
      const r = refazerItem(refeitos[indice], { indice, insumo_id: '1', quantidade: cf.quantidade, entrada: cf.entrada, lembrar: false })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      refeitos[indice] = r.item
      const tela = linhaConfirmada(itens[indice], cf)
      expect(tela.entrada).toBe(r.item.entrada_estoque)
      expect(tela.valorUnitario).toBeCloseTo(r.item.valor_unitario as number, 12)
    }
    const servidor = conferirSoma(refeitos, total)
    const tela = somaDoCupom(c, new Map(confirmadas))
    expect(tela.soma).toBe(servidor.soma)
    expect(tela.diferenca).toBe(servidor.diferenca)
    expect(tela.bate).toBe(servidor.bate)
  })
})

describe('itens sempre manuais (regra do Ivan, 08/10/2026): molho de queijo cheddar e Coca-Cola em pacote', () => {
  it.each([
    ['MOLHO QJO CHEDDAR', 'UN', true],
    ['MOLHO CHEDDAR 1X1,5Kg', 'UN', true],
    ['MOLHO DE QUEIJO CHEDDAR', 'UN', true],
    ['COCA COLA BARCODE', 'PCT', true],
    ['COCA COLA 6X350ML', 'UN', true],
    ['COCA COLA PACK 6', 'UN', true],
    ['REF.COCA-COLA PET 1X2L', 'UND', false],   // avulsa: fluxo normal
    ['REF.COCA COLA ORIG.', 'UN', false],
    ['REQ.CHEDDAR CATUPIRY 1X1,010K', 'UN', false], // requeijão, não é molho
    ['CHEDDAR FATIADO', 'KG', false],
    ['MOLHO SHOYU', 'UN', false],
  ])('%s (%s) → sempre manual: %s', (descricao, un, esperado) => {
    expect(itemSempreManual({ descricao_cupom: descricao, unidade_cupom: un })).toBe(esperado)
  })
  it('item sempre manual nunca pode ser lembrado, mesmo com CNPJ e código de barras válidos', () => {
    const cupom = { emitente_cnpj: '75315333032655' } as CupomRecente
    const molho = { descricao_cupom: 'MOLHO QJO CHEDDAR', unidade_cupom: 'UN', codigo_barras: '7896629640559' } as ItemCupomRecente
    const alface = { descricao_cupom: 'ALFACE CRESPA HID.', unidade_cupom: 'UN', codigo_barras: null } as ItemCupomRecente
    expect(podeLembrar(cupom, molho)).toBe(false)
    expect(podeLembrar(cupom, alface)).toBe(true)
  })
})
