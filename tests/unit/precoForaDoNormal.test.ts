import {
  COMPRAS_NA_REFERENCIA, LIMITE_FORA_DO_NORMAL, comprasDaReferencia, diaCurto, precoForaDoNormal, textoDoPrecoForaDoNormal, vezesPorExtenso,
} from '../../src/admin/precoForaDoNormal'
import type { PrecoDeCompra } from '../../src/lib/tipos'

// Aviso de preço fora do normal (29/10/2026): o preço por unidade de ESTOQUE não se parece com NENHUMA das últimas compras (3× ou mais, para cima ou para baixo). Tudo INVENTADO (repositório público).
const compra = (preco: number, data: string | null = '2026-10-21', unidade: string | null = 'un'): PrecoDeCompra => ({ preco, data, unidade })
const reais = (v: number): string => `R$ ${v.toFixed(2).replace('.', ',')}`

describe('precoForaDoNormal — o caso da Coca Zero (fardo de 6 lançado como unidade)', () => {
  it('R$ 21,25 por UN contra R$ 3,55 na última compra: fora do normal, mais caro, quase 6 vezes', () => {
    const r = precoForaDoNormal(21.25, 'un', [compra(3.55)])
    expect(r).not.toBeNull()
    expect(r).toMatchObject({ preco: 21.25, sentido: 'alto', usual: 3.55, data: '2026-10-21', unidade: 'un' })
    expect(r!.vezes).toBeCloseTo(5.986, 2)
  })

  it('com o fardo convertido (R$ 3,54 por UN) o aviso some', () => {
    expect(precoForaDoNormal(3.54, 'un', [compra(3.55)])).toBeNull()
  })

  it('o preço MUITO mais barato também avisa (a embalagem contada ao contrário)', () => {
    const r = precoForaDoNormal(0.17, 'un', [compra(28.69)])
    expect(r).toMatchObject({ sentido: 'baixo', usual: 28.69 })
    expect(r!.vezes).toBeCloseTo(168.76, 1)
  })
})

describe('precoForaDoNormal — o limite de 3 vezes', () => {
  it('o limite é 3 e a referência são 5 compras', () => {
    expect(LIMITE_FORA_DO_NORMAL).toBe(3)
    expect(COMPRAS_NA_REFERENCIA).toBe(5)
  })

  it('exatamente 3 vezes mais caro avisa; um pouco menos não', () => {
    expect(precoForaDoNormal(30, 'kg', [compra(10, '2026-10-21', 'kg')])).not.toBeNull()
    expect(precoForaDoNormal(29.9, 'kg', [compra(10, '2026-10-21', 'kg')])).toBeNull()
  })

  it('um terço do preço avisa; um pouco mais que um terço não', () => {
    expect(precoForaDoNormal(9.9, 'kg', [compra(30, '2026-10-21', 'kg')])).not.toBeNull()
    expect(precoForaDoNormal(10.1, 'kg', [compra(30, '2026-10-21', 'kg')])).toBeNull()
  })

  it('o dobro, a metade e o mesmo preço não avisam', () => {
    for (const p of [5, 10, 20]) expect(precoForaDoNormal(p, 'kg', [compra(10, '2026-10-21', 'kg')])).toBeNull()
  })
})

describe('precoForaDoNormal — longe da ÚLTIMA compra e do preço MAIS COMUM (o histórico tem erros de embalagem gravados)', () => {
  // o ketchup sachê: R$ 0,17 por sachê e, no meio, uma compra gravada pelo preço da CAIXA (R$ 28,69)
  const historico = [compra(0.17, '2026-10-23'), compra(28.69, '2026-09-24'), compra(0.17, '2026-10-03')]

  it('o preço certo (R$ 0,17) não é acusado só porque uma compra antiga está suja', () => {
    expect(precoForaDoNormal(0.18, 'un', historico)).toBeNull()
  })

  it('o preço da compra SUJA antiga (R$ 28,60, o da caixa) AVISA: a última e a mais comum são R$ 0,17; a compra suja não o desculpa', () => {
    const r = precoForaDoNormal(28.6, 'un', historico)
    expect(r).toMatchObject({ sentido: 'alto', usual: 0.17, data: '2026-10-23' })
    expect(r!.vezes).toBeCloseTo(168.2, 0)
  })

  it('a ÚLTIMA compra suja não acusa o preço certo: o preço mais comum o desculpa (e o preço igual ao da última suja passa, é o que ela já tinha gravado)', () => {
    const suja = [compra(28.69, '2026-10-23'), compra(0.17, '2026-10-10'), compra(0.17, '2026-10-03'), compra(0.17, '2026-09-24')]
    expect(precoForaDoNormal(0.17, 'un', suja)).toBeNull()      // longe da última (28,69), mas igual à mediana (0,17)
    expect(precoForaDoNormal(28.6, 'un', suja)).toBeNull()      // igual à última: nada
  })

  it('com só 2 compras vale a última (2 não dão um "mais comum"): R$ 0,17 contra a última de R$ 28,69 avisa, e o contrário também', () => {
    expect(precoForaDoNormal(0.17, 'un', [compra(28.69, '2026-10-23'), compra(0.17, '2026-10-03')])).toMatchObject({ sentido: 'baixo', usual: 28.69 })
    expect(precoForaDoNormal(28.69, 'un', [compra(28.69, '2026-10-23'), compra(0.17, '2026-10-03')])).toBeNull()
  })

  it('com só 2 compras não há "mais comum": R$ 40 contra a última de R$ 10 avisa mesmo estando perto da média dos dois (R$ 55)', () => {
    expect(precoForaDoNormal(40, 'un', [compra(10, '2026-10-23'), compra(100, '2026-10-03')])).toMatchObject({ sentido: 'alto', usual: 10 })
  })

  it('com 4 compras o "mais comum" é a média das duas do meio', () => {
    // 1, 2, 6, 7 → mediana 4: R$ 12 está a 3× de 4 e de 1 (a última): avisa; R$ 11 fica a menos de 3× de 4: não
    const quatro = [compra(1, '2026-10-24'), compra(2, '2026-10-23'), compra(6, '2026-10-22'), compra(7, '2026-10-21')]
    expect(precoForaDoNormal(12, 'un', quatro)).not.toBeNull()
    expect(precoForaDoNormal(11, 'un', quatro)).toBeNull()
  })

  it('um preço que não se parece com a última nem com a mais comum avisa, comparando com a MAIS NOVA', () => {
    const r = precoForaDoNormal(2.86, 'un', historico)
    expect(r).toMatchObject({ sentido: 'alto', usual: 0.17, data: '2026-10-23' })
    expect(r!.vezes).toBeCloseTo(16.8, 1)
  })

  it('só as 5 compras mais novas contam: a 6ª (mais velha) não salva o preço', () => {
    const seis = [
      compra(100, '2026-10-20'), compra(100, '2026-10-19'), compra(100, '2026-10-18'), compra(100, '2026-10-17'), compra(100, '2026-10-16'),
      compra(10, '2026-09-01'),
    ]
    expect(precoForaDoNormal(10, 'un', seis)).not.toBeNull()
    expect(precoForaDoNormal(10, 'un', seis.slice(0, 5))).not.toBeNull()
    expect(precoForaDoNormal(10, 'un', [compra(10, '2026-10-21'), ...seis.slice(0, 4)])).toBeNull()   // a de R$ 10 é a MAIS NOVA: o preço se parece com ela
    // a 5ª compra mais nova ainda entra na conta do "mais comum": 5 × R$ 100 → mediana 100; trocando as 3 do meio por R$ 10, a mediana vira 10 e o preço de R$ 10 deixa de avisar
    expect(precoForaDoNormal(10, 'un', [compra(100, '2026-10-20'), compra(10, '2026-10-19'), compra(10, '2026-10-18'), compra(10, '2026-10-17'), compra(100, '2026-10-16')])).toBeNull()
  })

  it('a lista fora de ordem dá o mesmo aviso (a mais nova é a de maior data)', () => {
    const r = precoForaDoNormal(21.25, 'un', [compra(3, '2026-09-01'), compra(3.55, '2026-10-21'), compra(3.4, '2026-10-01')])
    expect(r).toMatchObject({ usual: 3.55, data: '2026-10-21' })
  })

  it('compra sem data fica por último e só serve de referência se for a única', () => {
    expect(precoForaDoNormal(21.25, 'un', [compra(3.55, null), compra(3.6, '2026-10-21')])).toMatchObject({ usual: 3.6, data: '2026-10-21' })
    expect(precoForaDoNormal(21.25, 'un', [compra(3.55, null)])).toMatchObject({ usual: 3.55, data: null })
  })
})

describe('precoForaDoNormal — na dúvida, a tela fica calada', () => {
  it('sem compras (produto novo, lista vazia, ausente): nada', () => {
    expect(precoForaDoNormal(21.25, 'un', [])).toBeNull()
    expect(precoForaDoNormal(21.25, 'un', undefined)).toBeNull()
    expect(precoForaDoNormal(21.25, 'un', null)).toBeNull()
  })

  it('unidade do estoque diferente da do preço da lista: nada (não dá para comparar kg com un)', () => {
    expect(precoForaDoNormal(21.25, 'un', [compra(3.55, '2026-10-21', 'kg')])).toBeNull()
    expect(precoForaDoNormal(21.25, 'ct', [compra(3.55, '2026-10-21', 'un')])).toBeNull()
  })

  it('unidade desconhecida, de um lado ou do outro: nada', () => {
    expect(precoForaDoNormal(21.25, null, [compra(3.55)])).toBeNull()
    expect(precoForaDoNormal(21.25, '  ', [compra(3.55)])).toBeNull()
    expect(precoForaDoNormal(21.25, 'un', [compra(3.55, '2026-10-21', null)])).toBeNull()
    expect(precoForaDoNormal(21.25, null, [compra(3.55, '2026-10-21', null)])).toBeNull()     // as duas desconhecidas NÃO são "a mesma unidade"
    expect(precoForaDoNormal(21.25, '', [compra(3.55, '2026-10-21', '')])).toBeNull()
  })

  it('a unidade vale sem diferença de maiúscula ou espaço', () => {
    expect(precoForaDoNormal(21.25, ' UN ', [compra(3.55, '2026-10-21', 'un')])).not.toBeNull()
    expect(precoForaDoNormal(21.25, 'un', [compra(3.55, '2026-10-21', ' UN')])).not.toBeNull()
  })

  it('preço ilegível: nada', () => {
    for (const p of [null, undefined, 0, -3, NaN, Infinity, -Infinity]) expect(precoForaDoNormal(p as number, 'un', [compra(3.55)])).toBeNull()
  })

  it('compras com preço inválido não valem (e se sobrar só lixo, nada)', () => {
    const lixo = [compra(0), compra(-1), compra(NaN), { preco: null as unknown as number, data: '2026-10-21', unidade: 'un' }]
    expect(precoForaDoNormal(21.25, 'un', lixo)).toBeNull()
    expect(precoForaDoNormal(21.25, 'un', [...lixo, compra(3.55, '2026-10-01')])).toMatchObject({ usual: 3.55 })
  })

  it('a lista que não é lista não derruba', () => {
    expect(precoForaDoNormal(21.25, 'un', 'x' as unknown as PrecoDeCompra[])).toBeNull()
  })
})

describe('comprasDaReferencia', () => {
  it('só a mesma unidade, a mais nova primeiro, no máximo 5', () => {
    const lista = [
      compra(1, '2026-10-01'), compra(2, '2026-10-07'), compra(3, '2026-10-03', 'kg'), compra(4, '2026-10-05'), compra(5, '2026-10-09'), compra(6, '2026-10-02'),
      compra(7, '2026-10-08'), compra(8, '2026-10-04'),
    ]
    expect(comprasDaReferencia(lista, 'un').map((c) => c.preco)).toEqual([5, 7, 2, 4, 8])
  })

  it('não muda a lista que recebeu', () => {
    const lista = Object.freeze([compra(1, '2026-10-01'), compra(2, '2026-10-07')])
    expect(() => comprasDaReferencia(lista, 'un')).not.toThrow()
    expect(lista.map((c) => c.preco)).toEqual([1, 2])
  })
})

describe('vezesPorExtenso e diaCurto', () => {
  it.each([[5.986, '6'], [3.46, '3,5'], [3, '3'], [9.96, '10'], [10.4, '10'], [252.03, '252'], [16.8, '17']])('%s vezes = "%s"', (v, texto) => {
    expect(vezesPorExtenso(v)).toBe(texto)
  })

  it('o dia curto sai de aaaa-mm-dd; o que não é data vira nada', () => {
    expect(diaCurto('2026-10-21')).toBe('21/10')
    expect(diaCurto('2026-10-21T03:00:00Z')).toBe('21/10')
    for (const x of [null, undefined, '', 'ontem', '21/10/2026']) expect(diaCurto(x)).toBeNull()
  })
})

describe('textoDoPrecoForaDoNormal', () => {
  it('mais caro, com o dia da última compra', () => {
    const a = precoForaDoNormal(21.25, 'un', [compra(3.55)])!
    expect(textoDoPrecoForaDoNormal(a, reais)).toBe(
      'Preço fora do normal: R$ 21,25 por UN. Na última compra custou R$ 3,55 (21/10): 6 vezes mais caro. Confira a embalagem (fardo, caixa, pacote) e a conversão.',
    )
  })

  it('mais barato, sem data', () => {
    const a = precoForaDoNormal(0.17, 'kg', [compra(28.69, null, 'kg')])!
    expect(textoDoPrecoForaDoNormal(a, reais)).toBe(
      'Preço fora do normal: R$ 0,17 por KG. Na última compra custou R$ 28,69: 169 vezes mais barato. Confira a embalagem (fardo, caixa, pacote) e a conversão.',
    )
  })
})
