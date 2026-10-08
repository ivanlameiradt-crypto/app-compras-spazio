import { casarItens, type Aprendizado } from './casamento'
import type { ItemLidoIA } from './esquema'

const item = (o: Partial<ItemLidoIA> & { descricao: string }): ItemLidoIA => ({
  quantidade: 1, unidade: 'UN', valor_unitario: 1, desconto: null, codigo_barras: null, ...o,
})
const apr = (o: Partial<Aprendizado> & { insumo_id: string }): Aprendizado => ({
  codigo_barras: null, emitente_cnpj: null, descricao_norm: null, insumo_nome: null,
  fator_conversao: 1, unidade_destino: null, confirmado: true, ...o,
})
const CNPJ = '12345678000190'

describe('casarItens — só o aprendizado confirmado', () => {
  it('EAN confirmado manda: casa e converte entrada_estoque = qtd × fator', () => {
    const itens = [item({ descricao: 'LEITE PO 80G', quantidade: 5, codigo_barras: '789', unidade: 'UN' })]
    const [r] = casarItens(itens, CNPJ, [apr({ insumo_id: '111', codigo_barras: '789', fator_conversao: 0.08, unidade_destino: 'kg' })])
    expect(r.sugestao_produto).toEqual({ id: '111' })
    expect(r.casado_por).toBe('ean')
    expect(r.entrada_estoque).toBeCloseTo(0.4, 3) // 5 × 0,08 kg
  })

  it('casa por (emitente_cnpj, descricao_norm) confirmado', () => {
    const itens = [item({ descricao: 'Açúcar  Cristal 1KG', quantidade: 3 })]
    const [r] = casarItens(itens, CNPJ, [apr({ insumo_id: '222', emitente_cnpj: CNPJ, descricao_norm: 'acucar cristal 1kg', fator_conversao: 1 })])
    expect(r.sugestao_produto).toEqual({ id: '222' })
    expect(r.casado_por).toBe('descricao')
    expect(r.entrada_estoque).toBe(3)
  })

  it('RF4: primeiro aparecimento (nenhum aprendizado) → incerto, NUNCA chuta; "AÇÚCAR" não vira "SAL"', () => {
    const itens = [item({ descricao: 'AÇÚCAR CRISTAL 1KG' })]
    const [r] = casarItens(itens, CNPJ, [])
    expect(r.sugestao_produto).toBeNull()
    expect(r.entrada_estoque).toBeNull()
    expect(r.casado_por).toBeNull()
    // proposta é só pré-preenchimento; nunca um id de produto diferente aplicado como casamento
    expect(r.proposta === null || typeof r.proposta.insumo_id === 'string').toBe(true)
  })

  it('aprendizado NÃO confirmado não auto-casa → incerto', () => {
    const itens = [item({ descricao: 'ARROZ 5KG', codigo_barras: '555' })]
    const [r] = casarItens(itens, CNPJ, [apr({ insumo_id: '333', codigo_barras: '555', confirmado: false })])
    expect(r.sugestao_produto).toBeNull()
  })

  it('EAN presente que diverge de um aprendizado por descrição → incerto (não confia na descrição contra o EAN)', () => {
    const itens = [item({ descricao: 'OLEO SOJA 900ML', codigo_barras: '999' })]
    const [r] = casarItens(itens, CNPJ, [apr({ insumo_id: '444', emitente_cnpj: CNPJ, descricao_norm: 'oleo soja 900ml', codigo_barras: '111', confirmado: true })])
    expect(r.sugestao_produto).toBeNull()
  })

  it('preserva descrição/unidade/EAN e desconto (0 quando null) no item casado e no incerto', () => {
    const [casado] = casarItens([item({ descricao: 'X', codigo_barras: '789', unidade: 'KG', desconto: 1.5, valor_unitario: 9 })], CNPJ,
      [apr({ insumo_id: '1', codigo_barras: '789' })])
    expect(casado).toMatchObject({ descricao_cupom: 'X', unidade_cupom: 'KG', codigo_barras: '789', desconto_item: 1.5, valor_unitario: 9 })
    const [incerto] = casarItens([item({ descricao: 'Y', desconto: null, valor_unitario: 2 })], null, [])
    expect(incerto).toMatchObject({ desconto_item: 0, valor_unitario: 2 })
  })

  // Endurecimento além do brief (nunca chutar conversão): um fator que não é número positivo NÃO vira 1 em silêncio.
  it('fator_conversao inválido (0, negativo, NaN) não é chutado para 1 → incerto (REVISAR)', () => {
    for (const fator of [0, -2, Number.NaN]) {
      const [r] = casarItens([item({ descricao: 'LEITE PO 80G', quantidade: 5, codigo_barras: '789' })], CNPJ,
        [apr({ insumo_id: '111', codigo_barras: '789', fator_conversao: fator })])
      expect(r.sugestao_produto).toBeNull()
      expect(r.entrada_estoque).toBeNull()
      expect(r.casado_por).toBeNull()
    }
  })

  it('numeric que o PostgREST entrega como texto ("0.08") é aceito como número', () => {
    const [r] = casarItens([item({ descricao: 'LEITE PO 80G', quantidade: 5, codigo_barras: '789' })], CNPJ,
      [apr({ insumo_id: '111', codigo_barras: '789', fator_conversao: '0.08' as unknown as number })])
    expect(r.sugestao_produto).toEqual({ id: '111' })
    expect(r.entrada_estoque).toBeCloseTo(0.4, 3)
  })

  it('vários itens: cada um casa (ou não) sozinho, na mesma ordem', () => {
    const itens = [
      item({ descricao: 'ARROZ 5KG', codigo_barras: '789' }),
      item({ descricao: 'ITEM NUNCA VISTO' }),
    ]
    const r = casarItens(itens, CNPJ, [apr({ insumo_id: '111', codigo_barras: '789' })])
    expect(r.map((x) => x.sugestao_produto)).toEqual([{ id: '111' }, null])
    expect(r.map((x) => x.descricao_cupom)).toEqual(['ARROZ 5KG', 'ITEM NUNCA VISTO'])
  })
})

// I-1: o robô calcula a linha como entrada_estoque × valor_unitario − desconto_item e a confere contra o valor_a_pagar
// (cupom_valores.py). Se a quantidade vira outra unidade (fator ≠ 1) e o preço continua o do cupom, 5 un × R$ 3 com fator
// 0,08 viraria 0,4 kg × R$ 3 = R$ 1,20 (em vez de R$ 15) e TODO item convertido cairia em REVISAR no robô. O preço por
// unidade do estoque é o valor da linha ÷ entrada_estoque (o spec: "preço por unidade recalculado, total ÷ kg").
describe('casarItens — a conversão de unidade preserva o valor da linha (I-1)', () => {
  const casar = (it: ItemLidoIA, fator: number, extra: Partial<Aprendizado> = {}) =>
    casarItens([it], CNPJ, [apr({ insumo_id: '111', codigo_barras: '789', fator_conversao: fator, ...extra })])[0]

  it('5 un × R$ 3 com fator 0,08 vira 0,4 kg a R$ 37,50/kg — não 0,4 kg a R$ 3 (R$ 1,20 no lugar de R$ 15)', () => {
    const r = casar(item({ descricao: 'LEITE PO 80G', quantidade: 5, valor_unitario: 3, codigo_barras: '789' }), 0.08)
    expect(r.entrada_estoque).toBeCloseTo(0.4, 6)
    expect(r.valor_unitario).toBeCloseTo(37.5, 9)
  })

  it('chocolate do teste ao vivo: R$ 39,95 ÷ 0,4 kg = R$ 99,875/kg (o preço NÃO é arredondado: o robô arredonda ao digitar)', () => {
    const r = casar(item({ descricao: 'CHOCOLATE 80G', quantidade: 5, valor_unitario: 7.99, codigo_barras: '789' }), 0.08)
    expect(r.entrada_estoque).toBeCloseTo(0.4, 6)
    expect(r.valor_unitario).toBeCloseTo(99.875, 9) // 99,88 (arredondado) falharia aqui
  })

  it('invariante: com fator ≠ 1, entrada_estoque × valor_unitario == quantidade × valor_unitario do cupom (±0,005)', () => {
    const casos = [
      { quantidade: 5, valor_unitario: 3, fator: 0.08 },
      { quantidade: 5, valor_unitario: 7.99, fator: 0.08 },
      { quantidade: 2, valor_unitario: 24, fator: 12 }, // caixa com 12
      { quantidade: 3, valor_unitario: 4.99, fator: 0.333 }, // entrada arredondada em 3 casas (0,999)
      { quantidade: 7, valor_unitario: 12.34, fator: 0.45 },
      { quantidade: 1.5, valor_unitario: 19.9, fator: 2.5 },
      { quantidade: 4, valor_unitario: 0, fator: 0.25 }, // item de preço zero continua zero
      { quantidade: 7.7, valor_unitario: 200, fator: 0.45671 }, // 3,51667 → entrada 3,517: o preço usa a entrada JÁ arredondada
    ]
    for (const c of casos) {
      const it = item({ descricao: 'X', quantidade: c.quantidade, valor_unitario: c.valor_unitario, codigo_barras: '789' })
      const r = casar(it, c.fator)
      expect(r.sugestao_produto).toEqual({ id: '111' })
      expect(Math.abs((r.entrada_estoque as number) * r.valor_unitario - it.quantidade * it.valor_unitario)).toBeLessThan(0.005)
    }
  })

  it('o desconto da linha fica como está e o valor LÍQUIDO da linha é preservado', () => {
    // cupom: 2 × R$ 10 − R$ 1,50 = R$ 18,50; convertido (fator 0,5): 1 × R$ 20 − R$ 1,50 = R$ 18,50
    const r = casar(item({ descricao: 'X', quantidade: 2, valor_unitario: 10, desconto: 1.5, codigo_barras: '789' }), 0.5)
    expect(r.desconto_item).toBe(1.5)
    expect((r.entrada_estoque as number) * r.valor_unitario - r.desconto_item).toBeCloseTo(18.5, 9)
  })

  it('vale também para o casamento por (emitente_cnpj, descricao_norm)', () => {
    const [r] = casarItens([item({ descricao: 'Açúcar Cristal 5KG', quantidade: 3, valor_unitario: 20 })], CNPJ,
      [apr({ insumo_id: '222', emitente_cnpj: CNPJ, descricao_norm: 'acucar cristal 5kg', fator_conversao: 5 })])
    expect(r.casado_por).toBe('descricao')
    expect(r.entrada_estoque).toBe(15) // 3 × 5 kg
    expect(r.valor_unitario).toBeCloseTo(4, 9) // R$ 60 ÷ 15 kg
  })

  it('fator 1 não mexe no preço (sem o ruído de ponto flutuante de refazer a conta)', () => {
    const r = casar(item({ descricao: 'X', quantidade: 3, valor_unitario: 4.5, codigo_barras: '789' }), 1)
    expect(r.entrada_estoque).toBe(3)
    expect(r.valor_unitario).toBe(4.5)
    // refazer a conta (3 × 7,99 ÷ 3) daria 7,989999999999999: com fator 1 o preço do cupom passa exatamente como veio
    expect(casar(item({ descricao: 'X', quantidade: 3, valor_unitario: 7.99, codigo_barras: '789' }), 1).valor_unitario).toBe(7.99)
  })

  it('entrada_estoque que arredonda para 0 (ou quantidade ≤ 0) com fator ≠ 1 → incerto, sem dividir por zero', () => {
    for (const quantidade of [1, 0, -2]) {
      const fator = quantidade === 1 ? 0.0001 : 0.5 // 1 × 0,0001 arredonda para 0,000
      const r = casar(item({ descricao: 'X', quantidade, valor_unitario: 3, codigo_barras: '789' }), fator)
      expect(r.sugestao_produto).toBeNull()
      expect(r.entrada_estoque).toBeNull()
      expect(r.casado_por).toBeNull()
      expect(Number.isFinite(r.valor_unitario)).toBe(true) // sem Infinity/NaN no contrato
      expect(r.valor_unitario).toBe(3) // o incerto guarda o preço do cupom
    }
  })
})

// Regra do Ivan (02/10): fornecedores diferentes descrevem o mesmo produto de jeitos diferentes (tomate italiano/salada/
// saladete; tomate cereja/grape/sweet grape) e todos casam com UM insumo. O aprendizado GLOBAL (emitente_cnpj = null) casa
// pela descrição normalizada independente do CNPJ do emitente — assim o sinônimo vale venha de qualquer fornecedor.
describe('casarItens — sinônimo global (emitente_cnpj null, qualquer fornecedor)', () => {
  const global = (descricao_norm: string, o: Partial<Aprendizado> & { insumo_id: string }) =>
    apr({ emitente_cnpj: null, descricao_norm, ...o })

  it('casa por descricao_norm vindo de um fornecedor QUALQUER (CNPJ nunca visto)', () => {
    const itens = [item({ descricao: 'TOMATE SALADETE', quantidade: 2, unidade: 'KG', valor_unitario: 9.99 })]
    const [r] = casarItens(itens, '99999999000199',
      [global('tomate saladete', { insumo_id: '3482196', insumo_nome: 'TOMATE ITALIANO - INSUMOS', unidade_destino: 'KG' })])
    expect(r.sugestao_produto).toEqual({ id: '3482196' })
    expect(r.casado_por).toBe('descricao')
    expect(r.entrada_estoque).toBe(2) // fator 1
  })

  it('o sinônimo global casa mesmo sem CNPJ na leitura', () => {
    const [r] = casarItens([item({ descricao: 'TOMATE GRAPE', unidade: 'KG' })], null,
      [global('tomate grape', { insumo_id: '3476544', insumo_nome: 'TOMATE CEREJA - INSUMOS' })])
    expect(r.sugestao_produto).toEqual({ id: '3476544' })
    expect(r.casado_por).toBe('descricao')
  })

  it('o aprendizado por fornecedor (cnpj+desc) tem PRECEDÊNCIA sobre o global', () => {
    const itens = [item({ descricao: 'TOMATE SALADA', unidade: 'KG' })]
    const [r] = casarItens(itens, CNPJ, [
      global('tomate salada', { insumo_id: 'GLOBAL' }),
      apr({ insumo_id: 'FORNECEDOR', emitente_cnpj: CNPJ, descricao_norm: 'tomate salada' }),
    ])
    expect(r.sugestao_produto).toEqual({ id: 'FORNECEDOR' })
  })

  it('sinônimo global NÃO confirmado não auto-casa → incerto', () => {
    const [r] = casarItens([item({ descricao: 'TOMATE GRAPE' })], CNPJ,
      [global('tomate grape', { insumo_id: 'X', confirmado: false })])
    expect(r.sugestao_produto).toBeNull()
  })

  it('aplica a conversão de unidade no sinônimo global (fator ≠ 1 preserva o valor da linha)', () => {
    const [r] = casarItens([item({ descricao: 'CHOCOLATE 80G', quantidade: 5, valor_unitario: 7.99 })], '99999999000199',
      [global('chocolate 80g', { insumo_id: '3476366', fator_conversao: 0.08, unidade_destino: 'KG' })])
    expect(r.entrada_estoque).toBeCloseTo(0.4, 6)
    expect(r.valor_unitario).toBeCloseTo(99.875, 9)
  })
})

describe('quantidade_cupom — a quantidade impressa no cupom fica em TODOS os itens (v2: a caixa de correção do app a pré-preenche)', () => {
  it('no casado (mesmo com conversão) e no incerto', () => {
    const [casado] = casarItens([item({ descricao: 'LEITE PO 80G', quantidade: 5, codigo_barras: '789' })], CNPJ,
      [apr({ insumo_id: '111', codigo_barras: '789', fator_conversao: 0.08 })])
    expect(casado.quantidade_cupom).toBe(5)
    expect(casado.entrada_estoque).toBeCloseTo(0.4, 6)
    const [incerto] = casarItens([item({ descricao: 'NUNCA VISTO', quantidade: 2.5 })], CNPJ, [])
    expect(incerto.sugestao_produto).toBeNull()
    expect(incerto.quantidade_cupom).toBe(2.5)   // antes (v1) o incerto perdia a quantidade e o Ivan tinha de ler o peso de novo na foto
  })
})

describe('casarItens — fornecedor que mudou a descrição (regra da palavra-chave, 08/10)', () => {
  const CNPJ = '12345678000190'
  const antigo = { codigo_barras: null, emitente_cnpj: CNPJ, descricao_norm: 'tomate italiano', insumo_id: '3482196', insumo_nome: 'TOMATE ITALIANO - INSUMOS (KG)', fator_conversao: 1, unidade_destino: 'kg', confirmado: true }
  const item = (descricao: string) => ({ descricao, quantidade: 3.2, unidade: 'KG', valor_unitario: 10, desconto: 0, codigo_barras: null })

  it('descrição nova com palavras em comum com o que o fornecedor já mandou: o item incerto leva o aviso "antes vinha como"', () => {
    const [r] = casarItens([item('TOMATE ITAL. GRAUDO KG')], CNPJ, [antigo])
    expect(r.sugestao_produto).toBeNull()
    expect(r.conhecidos_do_fornecedor).toEqual([{ insumo_id: '3482196', insumo_nome: 'TOMATE ITALIANO - INSUMOS (KG)', descricao_norm: 'tomate italiano' }])
  })
  it('não avisa quando nada se parece, quando é de outro fornecedor ou quando o aprendizado não está confirmado', () => {
    expect(casarItens([item('BANANA PRATA')], CNPJ, [antigo])[0].conhecidos_do_fornecedor).toBeUndefined()
    expect(casarItens([item('TOMATE ITAL. GRAUDO')], '99999999000199', [antigo])[0].conhecidos_do_fornecedor).toBeUndefined()
    expect(casarItens([item('TOMATE ITAL. GRAUDO')], CNPJ, [{ ...antigo, confirmado: false }])[0].conhecidos_do_fornecedor).toBeUndefined()
  })
  it('item que o aprendizado casa não leva o aviso (só o incerto)', () => {
    const [r] = casarItens([item('TOMATE ITALIANO')], CNPJ, [antigo])
    expect(r.sugestao_produto).toEqual({ id: '3482196' })
    expect(r.conhecidos_do_fornecedor).toBeUndefined()
  })
})
