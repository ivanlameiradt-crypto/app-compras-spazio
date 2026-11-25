import { describe, expect, it } from 'vitest'
import { lerBoleto } from '../../src/admin/boletoRegras'
import { barras, linha } from './boletoAjuda'

const hoje = new Date(2026, 10, 25)

describe('lerBoleto', () => {
  it('lê valor e vencimento do código de barras (fator depois da virada de 2025)', () => {
    // fator 1000 = 22/02/2025; 10/12/2026 fica 656 dias depois: fator 1656
    const b = barras('341', '1656', '23491')
    const r = lerBoleto(b, hoje)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.boleto.valor).toBe(234.91); expect(r.boleto.vencimento).toBe('2026-12-10'); expect(r.boleto.codigo).toBe(b) }
  })
  it('lê a linha digitável com pontos e espaços e dá o mesmo resultado', () => {
    const b = barras('001', '1656', '46974')
    const l = linha(b)
    const bonita = `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l.slice(32, 33)} ${l.slice(33)}`
    const r = lerBoleto(bonita, hoje)
    expect(r.ok && r.boleto.codigo).toBe(b)
    expect(r.ok && r.boleto.valor).toBe(469.74)
  })
  it('fator antigo (antes da virada) cai na data certa quando perto de hoje', () => {
    // 20/02/2025 = fator 9998 no ciclo antigo; referência em fev/2025
    const r = lerBoleto(barras('237', '9998', '10000'), new Date(2025, 1, 10))
    expect(r.ok && r.boleto.vencimento).toBe('2025-02-20')
  })
  it('fator 0000 = sem vencimento', () => {
    const r = lerBoleto(barras('104', '0000', '5000'), hoje)
    expect(r.ok && r.boleto.vencimento).toBeNull()
  })
  it('boleto sem valor volta com valor null', () => {
    expect(lerBoleto(barras('341', '1656', '0'), hoje)).toMatchObject({ ok: true, boleto: { valor: null } })
  })
  it('recusa dígito errado, tamanho errado e conta de consumo', () => {
    const b = barras('341', '1656', '23491')
    const errado = b.slice(0, 20) + (b[20] === '9' ? '8' : String(Number(b[20]) + 1)) + b.slice(21)
    expect(lerBoleto(errado, hoje).ok).toBe(false)
    const l = linha(b)
    const linhaErrada = l.slice(0, 3) + (l[3] === '9' ? '8' : String(Number(l[3]) + 1)) + l.slice(4)
    expect(lerBoleto(linhaErrada, hoje).ok).toBe(false)
    expect(lerBoleto('12345', hoje)).toMatchObject({ ok: false })
    expect(lerBoleto('8'.padEnd(44, '0'), hoje)).toMatchObject({ ok: false })
  })
})
