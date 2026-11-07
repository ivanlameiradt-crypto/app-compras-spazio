import { lerNumeroBr, lerNumeroBrDigitando } from '../../src/lib/numeroBr'

// Como o Ivan e a equipe digitam número em português: vírgula separa os decimais e o ponto separa os milhares ("1.250" = mil duzentos e cinquenta,
// o mesmo jeito que o app MOSTRA os números). Decimal com ponto ("1.5", "12.50", "0.125") também vale, porque o teclado do celular às vezes só tem o ponto.
describe('lerNumeroBr', () => {
  it('lê inteiro, vírgula decimal e milhares com ponto', () => {
    expect(lerNumeroBr('3')).toBe(3)
    expect(lerNumeroBr('12,5')).toBe(12.5)
    expect(lerNumeroBr('300,00')).toBe(300)
    expect(lerNumeroBr('1.250,75')).toBe(1250.75)
    expect(lerNumeroBr('1.250.000,5')).toBe(1250000.5)
    expect(lerNumeroBr(' 12,345 ')).toBe(12.345)
    expect(lerNumeroBr('1 250')).toBe(1250)          // espaços são ignorados, como sempre foram
  })

  it('ponto com exatamente 3 dígitos depois é milhar: "1.250" = 1250 (e não 1,25), "2.500" = 2500, "1.250.000" = 1250000', () => {
    expect(lerNumeroBr('1.250')).toBe(1250)
    expect(lerNumeroBr('2.500')).toBe(2500)
    expect(lerNumeroBr('12.345')).toBe(12345)
    expect(lerNumeroBr('123.456')).toBe(123456)
    expect(lerNumeroBr('1.250.000')).toBe(1250000)
  })

  it('ponto que não é milhar é decimal: "1.5", "12.50", "0.125", "0.500", "1.2500"', () => {
    expect(lerNumeroBr('1.5')).toBe(1.5)
    expect(lerNumeroBr('12.50')).toBe(12.5)
    expect(lerNumeroBr('0.125')).toBe(0.125)
    expect(lerNumeroBr('0.500')).toBe(0.5)          // milhar não começa com zero
    expect(lerNumeroBr('1.2500')).toBe(1.25)
    expect(lerNumeroBr('0,5')).toBe(0.5)
  })

  it('recusa vazio, texto, mistura sem sentido e sinal', () => {
    for (const ruim of ['', '   ', 'abc', '1,2,3', '1.2.3', '1.25,5', '1,250.5', ',5', '.5', '5,', '5.', '--1', '-5', '+5', '1e3', 'R$ 10'])
      expect(lerNumeroBr(ruim), JSON.stringify(ruim)).toBeNull()
  })
})

// Enquanto a pessoa digita, "2," e "2." ainda não são números prontos, mas também não são erro: valem 2 até chegar o resto.
describe('lerNumeroBrDigitando', () => {
  it('"2," e "2." valem 2; vazio vale 0; o resto segue a regra normal', () => {
    expect(lerNumeroBrDigitando('2,')).toBe(2)
    expect(lerNumeroBrDigitando('2.')).toBe(2)
    expect(lerNumeroBrDigitando('')).toBe(0)
    expect(lerNumeroBrDigitando('   ')).toBe(0)
    expect(lerNumeroBrDigitando('2,5')).toBe(2.5)
    expect(lerNumeroBrDigitando('1.234,5')).toBe(1234.5)
  })

  it('texto que não é número devolve null (a tela mantém o último valor bom e marca o campo)', () => {
    for (const ruim of ['abc', '2,,', ',', '.', '1,2,3', '-1']) expect(lerNumeroBrDigitando(ruim), JSON.stringify(ruim)).toBeNull()
  })
})
