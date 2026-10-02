import { normalizar } from './normalizar'

describe('normalizar (mesma regra do _norm do robô)', () => {
  it('minúsculas, sem acento, só alfanumérico, 1 espaço', () => {
    expect(normalizar('AÇÚCAR  Cristal - 1kg')).toBe('acucar cristal 1kg')
    expect(normalizar('Coca-Cola®  350ML')).toBe('coca cola 350ml')
    expect(normalizar('  PÃO   de   FORMA ')).toBe('pao de forma')
  })
  it('nulo/vazio/só-símbolos → string vazia', () => {
    expect(normalizar(null)).toBe('')
    expect(normalizar(undefined)).toBe('')
    expect(normalizar('   ---   ')).toBe('')
  })
})
