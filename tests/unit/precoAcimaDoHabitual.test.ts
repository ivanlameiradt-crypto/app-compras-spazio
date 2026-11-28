import { precoAcimaDoHabitual, textoAcimaDoHabitual } from '../../src/admin/precoForaDoNormal'
import type { PrecoDeCompra } from '../../src/lib/tipos'

// Aviso LEVE de preço acima da média (28/11/2026). Tudo INVENTADO (repositório público).
const c = (preco: number, data: string): PrecoDeCompra => ({ preco, data, unidade: 'kg' })
const reais = (v: number): string => `R$ ${v.toFixed(2).replace('.', ',')}`
const historico = [c(5.8, '2026-11-20'), c(5.9, '2026-11-10'), c(5.85, '2026-11-01')] // mediana 5,85

describe('precoAcimaDoHabitual', () => {
  it('18% acima da média: avisa, com o percentual e a média', () => {
    const r = precoAcimaDoHabitual(6.9, 'kg', historico)
    expect(r).toMatchObject({ preco: 6.9, media: 5.85, percentual: 18, unidade: 'kg' })
    expect(textoAcimaDoHabitual(r!, reais)).toBe('R$ 6,90 por KG, 18% acima da média de R$ 5,85.')
  })
  it('até 9% acima não avisa; barato não avisa', () => {
    expect(precoAcimaDoHabitual(6.3, 'kg', historico)).toBeNull()
    expect(precoAcimaDoHabitual(4.5, 'kg', historico)).toBeNull()
  })
  it('o caso grave (3x ou mais) fica com o aviso grave, não com este', () => {
    expect(precoAcimaDoHabitual(21, 'kg', historico)).toBeNull()
  })
  it('menos de 3 compras: sem média, sem aviso', () => {
    expect(precoAcimaDoHabitual(6.9, 'kg', historico.slice(0, 2))).toBeNull()
  })
  it('se a última compra já foi cara, o "normal" mudou: sem aviso', () => {
    expect(precoAcimaDoHabitual(6.9, 'kg', [c(6.8, '2026-11-20'), c(5.9, '2026-11-10'), c(5.85, '2026-11-01')])).toBeNull()
  })
  it('unidade diferente da das compras: sem aviso', () => {
    expect(precoAcimaDoHabitual(6.9, 'un', historico)).toBeNull()
  })
})
