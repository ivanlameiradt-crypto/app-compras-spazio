// Mapa do pedido (spec 8.2 item 7; contrato 8.3, D44, D45 e D67). Dados INVENTADOS.
import {
  faltaParaMinimo, montarPedido, quantidadeAlta, sugestaoLoja, totalPedido, unidadeSuspeita, valorLinha,
} from '../../src/cotacao/pedido'
import { itemCotacao } from '../fabricas'

const tem = (p: Parameters<typeof itemCotacao>[0]) => itemCotacao({ estado: 'tem', ...p })

describe('montarPedido', () => {
  it('só itens marcados com "tem", na ordem dos números; não tem e sem resposta ficam fora', () => {
    const l = montarPedido([
      tem({ id: 3, numero: 3, base: 'un', preco_digitado: 2 }),
      itemCotacao({ id: 1, numero: 1, estado: 'nao_tem' }),
      tem({ id: 2, numero: 2, base: 'un', preco_digitado: 3 }),
      itemCotacao({ id: 4, numero: 4 }),
      tem({ id: 5, numero: null, incluido: false, base: 'un', preco_digitado: 1 }),
    ])
    expect(l.map((x) => x.numero)).toEqual([2, 3])
  })

  it('fardo c/12 para 104 un → 9 fardos (108 un), com o preço da resposta', () => {
    expect(montarPedido([tem({ qtd: 104, base: 'embalagem', emb_unidades: 12, preco_digitado: 42 })])).toEqual([
      { numero: 1, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco_combinado: 42 },
    ])
  })

  it('item em kg cotado em pacote de 400 g → fator 0,4 kg e embalagens inteiras', () => {
    expect(montarPedido([tem({ unidade: 'kg', rotulo: 'kg', qtd: 1.2, base: 'embalagem', emb_gramas: 400, preco_digitado: 12.4 })])).toEqual([
      { numero: 1, qtd: 1.2, base: 'embalagem', embalagens: 3, fator: 0.4, preco_combinado: 12.4 },
    ])
  })

  it('caixa em ml de item em kg COM kg por litro → fator em kg por caixa (D44)', () => {
    expect(montarPedido([tem({ unidade: 'kg', rotulo: 'kg', vende_por_litro: true, kg_por_litro: 1, qtd: 19.9, base: 'embalagem', emb_ml: 1000, preco_digitado: 6 })])).toEqual([
      { numero: 1, qtd: 20, base: 'embalagem', embalagens: 20, fator: 1, preco_combinado: 6 },
    ])
  })

  it('caixa em ml SEM kg por litro → fator e embalagens null, qtd a aprovada (o Ivan digita as caixas)', () => {
    expect(montarPedido([tem({ unidade: 'kg', rotulo: 'kg', vende_por_litro: true, qtd: 19.9, base: 'embalagem', emb_ml: 1000, preco_digitado: 6 })])).toEqual([
      { numero: 1, qtd: 19.9, base: 'embalagem', embalagens: null, fator: null, preco_combinado: 6 },
    ])
  })

  it('bases un, kg e litro: a quantidade aprovada, sem embalagem', () => {
    expect(montarPedido([
      tem({ numero: 1, qtd: 60, base: 'un', preco_digitado: 2 }),
      tem({ id: 2, numero: 2, unidade: 'kg', rotulo: 'kg', qtd: 0.5, base: 'kg', preco_digitado: 40 }),
      tem({ id: 3, numero: 3, unidade: 'kg', rotulo: 'kg', qtd: 19.9, base: 'litro', preco_digitado: 6 }),
    ]).map((l) => [l.numero, l.qtd, l.base, l.embalagens, l.fator])).toEqual([[1, 60, 'un', null, null], [2, 0.5, 'kg', null, null], [3, 19.9, 'litro', null, null]])
  })
})

describe('montarPedido: item parcial ("tenho só")', () => {
  it('kg, un e litro: começa no que o vendedor tem, nunca na aprovada', () => {
    expect(montarPedido([
      tem({ numero: 1, unidade: 'kg', rotulo: 'kg', qtd: 2, tenho_so: 0.5, base: 'kg', preco_digitado: 9.9 }),
      tem({ id: 2, numero: 2, qtd: 60, tenho_so: 24, base: 'un', preco_digitado: 2 }),
      // "tenho só" igual ou acima da aprovada não é parcial
      tem({ id: 3, numero: 3, unidade: 'kg', rotulo: 'kg', qtd: 1.2, tenho_so: 1.2, base: 'kg', preco_digitado: 18.5 }),
    ]).map((l) => [l.numero, l.qtd])).toEqual([[1, 0.5], [2, 24], [3, 1.2]])
  })

  it('embalagem: as embalagens inteiras que cabem no que ele tem (nunca pedir mais do que ele disse que tem)', () => {
    // 30 un em fardos c/12 → 2 fardos (24 un), não 3 (36 un)
    expect(montarPedido([tem({ qtd: 104, tenho_so: 30, base: 'embalagem', emb_unidades: 12, preco_digitado: 42 })])).toEqual([
      { numero: 1, qtd: 24, base: 'embalagem', embalagens: 2, fator: 12, preco_combinado: 42 },
    ])
    // 1,2 kg em pacotes de 400 g → 3 pacotes (o ruído do ponto flutuante não tira um)
    expect(montarPedido([tem({ unidade: 'kg', rotulo: 'kg', qtd: 2, tenho_so: 1.2, base: 'embalagem', emb_gramas: 400, preco_digitado: 12.4 })])[0])
      .toMatchObject({ embalagens: 3, fator: 0.4, qtd: 1.2 })
    // nem uma embalagem inteira: embalagens null (o Ivan digita), com o fator para a conta
    expect(montarPedido([tem({ qtd: 104, tenho_so: 5, base: 'embalagem', emb_unidades: 12, preco_digitado: 42 })])).toEqual([
      { numero: 1, qtd: 5, base: 'embalagem', embalagens: null, fator: 12, preco_combinado: 42 },
    ])
    // caixa em ml sem kg por litro: embalagens null e qtd = o que ele tem
    expect(montarPedido([tem({ unidade: 'kg', rotulo: 'kg', vende_por_litro: true, qtd: 19.9, tenho_so: 6, base: 'embalagem', emb_ml: 1000, preco_digitado: 6 })])[0])
      .toMatchObject({ qtd: 6, embalagens: null, fator: null })
  })
})

describe('unidadeSuspeita', () => {
  it('só itens "tem" com o aviso unidade_suspeita (para baixo ou para cima)', () => {
    expect(unidadeSuspeita([
      tem({ numero: 1, avisos_ivan: ['unidade_suspeita'], delta: -0.92 }),
      tem({ id: 2, numero: 2, avisos_ivan: ['fator_nao_confirmado'], delta: -0.3 }),
      tem({ id: 3, numero: 3, avisos_ivan: ['unidade_suspeita', 'fator_nao_confirmado'], delta: 0.7 }),
      itemCotacao({ id: 4, numero: 4, estado: 'nao_tem', avisos_ivan: ['similar'] }),
      tem({ id: 5, numero: null, incluido: false, avisos_ivan: ['unidade_suspeita'] }),
    ])).toEqual([1, 3])
  })
})

describe('sugestaoLoja (D45)', () => {
  it('só "tem" com referência ok e Δ acima de +10%', () => {
    expect(sugestaoLoja([
      tem({ numero: 1, ref_situacao: 'ok', delta: 0.18 }),
      tem({ id: 2, numero: 2, ref_situacao: 'ok', delta: 0.1 }), // exatamente +10%: não
      tem({ id: 3, numero: 3, ref_situacao: 'antiga', delta: 0.5 }), // referência antiga: não
      tem({ id: 4, numero: 4, ref_situacao: 'sem_referencia', delta: null }),
      itemCotacao({ id: 5, numero: 5, estado: 'nao_tem' }), // "não tem" nunca entra na sugestão
      tem({ id: 6, numero: 6, ref_situacao: 'ok', delta: 0.25 }),
      tem({ id: 7, numero: 7, ref_situacao: 'ok', delta: -0.2 }),
    ])).toEqual([1, 6])
  })
})

describe('valorLinha e totalPedido', () => {
  it('embalagem × preço; un e kg × preço; litro × convertido; sem conversão → null', () => {
    expect(valorLinha({ base: 'embalagem', qtd: 108, embalagens: 9, preco_combinado: 42, preco_convertido: 3.5 })).toBe(378)
    expect(valorLinha({ base: 'embalagem', qtd: 19.9, embalagens: null, preco_combinado: 6, preco_convertido: null })).toBeNull()
    expect(valorLinha({ base: 'kg', qtd: 1.2, embalagens: null, preco_combinado: 18.33, preco_convertido: 18.33 })).toBe(22)
    expect(valorLinha({ base: 'litro', qtd: 19.9, embalagens: null, preco_combinado: 6, preco_convertido: 6 })).toBe(119.4)
    expect(valorLinha({ base: 'litro', qtd: 19.9, embalagens: null, preco_combinado: 6, preco_convertido: null })).toBeNull()
  })

  it('itens + frete; linhas sem valor em semTotal', () => {
    const linhas = [
      { numero: 2, base: 'embalagem' as const, qtd: 108, embalagens: 9, preco_combinado: 42, preco_convertido: 3.5 },
      { numero: 11, base: 'litro' as const, qtd: 19.9, embalagens: null, preco_combinado: 6, preco_convertido: null },
      { numero: 4, base: 'kg' as const, qtd: 0.5, embalagens: null, preco_combinado: 40, preco_convertido: 40 },
    ]
    expect(totalPedido(linhas, 30)).toEqual({ itens: 398, frete: 30, total: 428, semTotal: [11] })
    expect(totalPedido(linhas, null)).toEqual({ itens: 398, frete: 0, total: 398, semTotal: [11] })
  })
})

describe('faltaParaMinimo (sobre a mercadoria, sem o frete)', () => {
  it('abaixo do mínimo → quanto falta; atingido, sem mínimo ou mínimo 0 → null', () => {
    expect(faltaParaMinimo(255, 300)).toBe(45)
    expect(faltaParaMinimo(300, 300)).toBeNull()
    expect(faltaParaMinimo(100, null)).toBeNull()
    expect(faltaParaMinimo(100, 0)).toBeNull()
    // o frete nunca "cobre" o mínimo: quem chama passa só os itens
    expect(faltaParaMinimo(totalPedido([{ numero: 1, base: 'un', qtd: 10, embalagens: null, preco_combinado: 27, preco_convertido: 27 }], 30).itens, 300)).toBe(30)
  })
})

describe('quantidadeAlta (D67: 90 fardos no lugar de 9)', () => {
  it('passa de 1,5 × a esperada: a maior entre a aprovada (arredondada para cima), a proposta pelo mapa e o "a partir de"', () => {
    const refri = itemCotacao({ qtd: 104 })
    // 9 fardos c/12 (108 un) é a proposta; 10 fardos (120) não é engano; 90 fardos (1.080) é
    expect(quantidadeAlta(108, refri, 108)).toBe(false)
    expect(quantidadeAlta(120, refri, 108)).toBe(false)
    expect(quantidadeAlta(162, refri, 108)).toBe(false)
    expect(quantidadeAlta(168, refri, 108)).toBe(true)
    expect(quantidadeAlta(1080, refri, 108)).toBe(true)
    // 1 fardo c/12 para 2 un aprovadas é o mínimo possível, não engano; 2 fardos já pedem conferência
    expect(quantidadeAlta(12, itemCotacao({ qtd: 2 }), 12)).toBe(false)
    expect(quantidadeAlta(24, itemCotacao({ qtd: 2 }), 12)).toBe(true)
    // kg: 1,2 aprovado → 2 kg (ou 3) é arredondar; 12 kg não
    const mostarda = itemCotacao({ unidade: 'kg', qtd: 1.2 })
    expect(quantidadeAlta(3, mostarda, 1.2)).toBe(false)
    expect(quantidadeAlta(12, mostarda, 1.2)).toBe(true)
    // item parcial: a proposta é o que o vendedor tem, mas a esperada continua a aprovada
    expect(quantidadeAlta(8, itemCotacao({ unidade: 'kg', qtd: 8, tenho_so: 1 }), 1)).toBe(false)
    // "preço só a partir de 20 kg": subir até 20 é de propósito; 200 não
    const cebola = itemCotacao({ unidade: 'kg', qtd: 5, a_partir_de: 20 })
    expect(quantidadeAlta(20, cebola, 5)).toBe(false)
    expect(quantidadeAlta(200, cebola, 5)).toBe(true)
  })
})
