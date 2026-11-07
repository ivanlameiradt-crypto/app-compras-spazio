import { lerQuantidadeBr, lerQuantidadeBrDigitando } from '../../src/lib/quantidade'

// QUANTIDADE (kg, L, un, fardos) é diferente de DINHEIRO (lib/regras.lerNumero, testado em regras.test.ts): a balança mostra "2.500" para
// 2,5 kg e o teclado do celular às vezes só tem o ponto. Então, sem vírgula, o ponto é SEMPRE decimal. Milhar só existe junto com a vírgula.
describe('lerQuantidadeBr', () => {
  it('sem vírgula o ponto é decimal: "2.500" da balança é 2,5 kg (nunca 2.500 kg), "1.000" é 1', () => {
    expect(lerQuantidadeBr('2.500')).toBe(2.5)
    expect(lerQuantidadeBr('1.000')).toBe(1)
    expect(lerQuantidadeBr('0.750')).toBe(0.75)
    expect(lerQuantidadeBr('2.5')).toBe(2.5)
    expect(lerQuantidadeBr('3')).toBe(3)
    expect(lerQuantidadeBr('12,5')).toBe(12.5)
    expect(lerQuantidadeBr('0,5')).toBe(0.5)
    expect(lerQuantidadeBr(' 1 250 ')).toBe(1250)          // espaços são ignorados
  })

  it('separador na ponta vale como as pessoas digitam: ",5" e ".5" são 0,5; "5," e "5." são 5', () => {
    expect(lerQuantidadeBr(',5')).toBe(0.5)
    expect(lerQuantidadeBr('.5')).toBe(0.5)
    expect(lerQuantidadeBr('5,')).toBe(5)
    expect(lerQuantidadeBr('5.')).toBe(5)
  })

  it('com vírgula, os pontos são milhar: "1.234,5" = 1234,5', () => {
    expect(lerQuantidadeBr('1.234,5')).toBe(1234.5)
    expect(lerQuantidadeBr('1.250.000,5')).toBe(1250000.5)
  })

  it('recusa vazio, texto, sinal e mistura sem sentido (inclusive "1.250.000" sem vírgula: dois pontos e nenhuma vírgula)', () => {
    for (const ruim of ['', '  ', 'abc', '-1', '+1', '1.250.000', '1.2.3', '1,2,3', '1.25,5', '1,250.5', ',', '.', '1e3', '2,,', 'R$ 10'])
      expect(lerQuantidadeBr(ruim), JSON.stringify(ruim)).toBeNull()
  })

  it('número absurdamente grande (400 dígitos, que o JavaScript lê como infinito) é recusado', () => {
    expect(lerQuantidadeBr('9'.repeat(400))).toBeNull()
  })
})

describe('lerQuantidadeBrDigitando', () => {
  it('vazio vale 0; "2," e "2." valem 2; "2.50" e "2.500" valem 2,5 enquanto a pessoa digita', () => {
    expect(lerQuantidadeBrDigitando('')).toBe(0)
    expect(lerQuantidadeBrDigitando('   ')).toBe(0)
    expect(lerQuantidadeBrDigitando('2,')).toBe(2)
    expect(lerQuantidadeBrDigitando('2.')).toBe(2)
    expect(lerQuantidadeBrDigitando('2.50')).toBe(2.5)
    expect(lerQuantidadeBrDigitando('2.500')).toBe(2.5)
    expect(lerQuantidadeBrDigitando('1.234,5')).toBe(1234.5)
  })

  it('texto que não é número devolve null (a tela mantém o último valor bom e marca o campo)', () => {
    for (const ruim of ['abc', '2,,', ',', '.', '1,2,3', '-1', '20x']) expect(lerQuantidadeBrDigitando(ruim), JSON.stringify(ruim)).toBeNull()
  })
})
