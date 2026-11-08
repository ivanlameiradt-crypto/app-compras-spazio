import { ehMilharAmbiguo, lerDinheiro, lerPrecoUnitario } from '../../src/lib/dinheiro'

// Correção de 08/11/2026 (revisão independente dos itens 3 e 4): o frete e o preço perderam, em 07/11, duas proteções que tinham antes
// (separador na ponta e número gigante), e o preço unitário com ponto de milhar sem vírgula ("1.516") virava R$ 1.516,00 sem perguntar.
describe('lerDinheiro (frete e valores): regra de sempre, com separador na ponta e sem número gigante', () => {
  it('lê a regra de sempre: "300", "300,00", "1.250" = 1250, "1,5" = 1,5', () => {
    expect(lerDinheiro('300')).toBe(300)
    expect(lerDinheiro('300,00')).toBe(300)
    expect(lerDinheiro('1.250')).toBe(1250)
    expect(lerDinheiro('1,5')).toBe(1.5)
  })

  it('separador na ponta: ",50" = 0,50; "5," = 5; "300." = 300 (como antes de 07/11)', () => {
    expect(lerDinheiro(',50')).toBe(0.5)
    expect(lerDinheiro('5,')).toBe(5)
    expect(lerDinheiro('300.')).toBe(300)
  })

  it('número que o JavaScript lê como infinito não é dinheiro', () => {
    expect(lerDinheiro('9'.repeat(400))).toBeNull()
  })

  it('texto e mistura sem sentido continuam recusados', () => {
    for (const ruim of ['', '   ', 'abc', ',', '.', '1,2,3', '1.2.3']) expect(lerDinheiro(ruim), JSON.stringify(ruim)).toBeNull()
  })
})

describe('lerPrecoUnitario: "1.516" não é preço sem a vírgula (a tela pede a vírgula nos centavos)', () => {
  it('"1.516" (ponto de milhar sem vírgula) é ambíguo: null', () => {
    expect(lerPrecoUnitario('1.516')).toBeNull()
    expect(lerPrecoUnitario('10.125')).toBeNull()
    expect(ehMilharAmbiguo('1.516')).toBe(true)
  })

  it('com vírgula o ponto é milhar: "1.516,00" = 1516; "1,516" = 1,516', () => {
    expect(lerPrecoUnitario('1.516,00')).toBe(1516)
    expect(lerPrecoUnitario('1,516')).toBe(1.516)
    expect(ehMilharAmbiguo('1,516')).toBe(false)
  })

  it('zero à frente e decimal com ponto continuam valendo: "0.125" = 0,125; "12.50" = 12,5; "0.500" = 0,5', () => {
    expect(lerPrecoUnitario('0.125')).toBe(0.125)
    expect(lerPrecoUnitario('12.50')).toBe(12.5)
    expect(lerPrecoUnitario('0.500')).toBe(0.5)
    expect(ehMilharAmbiguo('0.500')).toBe(false)
  })
})
