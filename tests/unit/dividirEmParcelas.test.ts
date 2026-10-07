import { dividirEmParcelas, parseValorBr } from '../../src/admin/notaSefazRegras'

const soma = (v: string[]) => v.reduce((t, x) => t + Math.round((parseValorBr(x) ?? 0) * 100), 0)

describe('dividirEmParcelas: o valor da nota prevalece — a soma fecha ao centavo, com o centavo que sobra na última', () => {
  it('R$ 1.794,49 em 3: 598,16 + 598,16 + 598,17 (3 valores iguais somariam 1.794,48)', () => {
    expect(dividirEmParcelas(1794.49, 3)).toEqual(['598,16', '598,16', '598,17'])
  })

  it('divide certinho quando dá: R$ 100 em 4 = 25,00 cada; 1 parcela = o valor todo', () => {
    expect(dividirEmParcelas(100, 4)).toEqual(['25,00', '25,00', '25,00', '25,00'])
    expect(dividirEmParcelas(1794.49, 1)).toEqual(['1.794,49'])
  })

  it('a soma é SEMPRE o valor da nota ao centavo, para vários valores e quantidades', () => {
    for (const valor of [0.07, 1, 99.99, 223.3, 791.2, 1484.28, 1794.49, 5417.31, 123456.78]) {
      for (const n of [1, 2, 3, 4, 5, 6, 7, 12]) {
        const v = dividirEmParcelas(valor, n)
        if (v == null) { expect(Math.floor(Math.round(valor * 100) / n)).toBeLessThanOrEqual(0); continue }
        expect(v).toHaveLength(n)
        expect(soma(v)).toBe(Math.round(valor * 100))
      }
    }
  })

  it('o resto (até n-1 centavos) vai todo na última', () => {
    expect(dividirEmParcelas(0.1, 3)).toEqual(['0,03', '0,03', '0,04'])
    expect(dividirEmParcelas(10.01, 4)).toEqual(['2,50', '2,50', '2,50', '2,51'])
  })

  it('não divide sem valor, sem parcelas ou quando cada parcela daria menos de 1 centavo', () => {
    expect(dividirEmParcelas(null, 3)).toBeNull()
    expect(dividirEmParcelas(0, 3)).toBeNull()
    expect(dividirEmParcelas(-5, 3)).toBeNull()
    expect(dividirEmParcelas(100, 0)).toBeNull()
    expect(dividirEmParcelas(100, 61)).toBeNull()
    expect(dividirEmParcelas(100, 2.5)).toBeNull()
    expect(dividirEmParcelas(0.02, 3)).toBeNull()
  })
})
