import { describe, it, expect } from 'vitest'
import { entregaPrevista, seloPedidoAnterior, type ContextoSelo } from '../../src/cotacao/conferencia'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.7.3 e D.7.4 / D.11).

describe('entregaPrevista', () => {
  it('texto com dd/mm vira essa data (ano de hoje; se passou, ano seguinte)', () => {
    expect(entregaPrevista('entrega dia 22/10', '2026-10-19')).toBe('2026-10-22')
    expect(entregaPrevista('05/01', '2026-10-19')).toBe('2027-01-05') // já passou neste ano
  })
  it('"hoje" → hoje; "amanhã" e "1 dia" → o dia seguinte que não seja domingo', () => {
    expect(entregaPrevista('pode ser hoje', '2026-10-19')).toBe('2026-10-19')
    expect(entregaPrevista('amanhã de manhã', '2026-10-19')).toBe('2026-10-20')
    // 2026-10-17 é sábado → "1 dia" cai no domingo 18 → pula para segunda 19
    expect(entregaPrevista('1 dia', '2026-10-17')).toBe('2026-10-19')
  })
  it('texto livre → vazio', () => {
    expect(entregaPrevista('quando der', '2026-10-19')).toBe('')
    expect(entregaPrevista('', '2026-10-19')).toBe('')
  })
})

describe('seloPedidoAnterior — as 6 regras (gerada_em antes, depois e no meio)', () => {
  const base: ContextoSelo = { vendedor: 'MATEUS', pedido_data: '2026-10-21', gerada_em: '2026-10-19T10:00:00Z' }

  it('1: NF lançada antes da leitura do estoque → cinza, já no estoque', () => {
    const s = seloPedidoAnterior({ ...base, nf: { numero: '123456', situacao: 'lancada', lancada_em: '2026-10-18T12:00:00Z', visto_na_fila_em: '2026-10-18T12:00:00Z', saiu_da_fila_em: null } })
    expect(s.cor).toBe('cinza')
    expect(s.texto).toContain('Pedido com MATEUS em qua 21/10:')
    expect(s.texto).toContain('já está no estoque que o robô leu')
  })
  it('2: NF ainda na fila → amarelo, ainda não foi lançada', () => {
    const s = seloPedidoAnterior({ ...base, nf: { numero: '123456', situacao: 'na_fila', lancada_em: null, visto_na_fila_em: '2026-10-22T12:00:00Z', saiu_da_fila_em: null } })
    expect(s.cor).toBe('amarelo')
    expect(s.texto).toContain('ainda não foi lançada')
  })
  it('3: NF entrou depois da leitura → amarelo, não conta este pedido', () => {
    const s = seloPedidoAnterior({ ...base, nf: { numero: '123456', situacao: 'lancada', lancada_em: '2026-10-22T12:00:00Z', visto_na_fila_em: '2026-10-22T12:00:00Z', saiu_da_fila_em: null } })
    expect(s.cor).toBe('amarelo')
    expect(s.texto).toContain('depois da leitura do estoque')
  })
  it('4: gerada_em cai dentro do intervalo (saiu da fila) → amarelo, perto da leitura', () => {
    const s = seloPedidoAnterior({ ...base, nf: { numero: '123456', situacao: 'saiu_da_fila', lancada_em: null, visto_na_fila_em: '2026-10-18T20:00:00Z', saiu_da_fila_em: '2026-10-20T10:00:00Z' } })
    expect(s.cor).toBe('amarelo')
    expect(s.texto).toContain('perto da leitura do estoque')
  })
  it('5: sem NF, mas com recebimento → amarelo', () => {
    const s = seloPedidoAnterior({ ...base, recebido: true, recebido_em: '2026-10-22T12:00:00Z' })
    expect(s.cor).toBe('amarelo')
    expect(s.texto).toContain('recebido em 22/10, sem NF-e')
  })
  it('6: sem NF e sem recebimento → amarelo', () => {
    const s = seloPedidoAnterior({ ...base })
    expect(s.texto).toContain('ainda não recebido e sem NF-e')
  })
  it('sufixo da falta definitiva', () => {
    const s = seloPedidoAnterior({ ...base, recebido: true, recebido_em: '2026-10-22T12:00:00Z', falta_definitiva: 24, unidade: 'un' })
    expect(s.texto).toContain('faltaram 24 un (não vêm mais)')
  })
  it('entrada manual antes da leitura → cinza', () => {
    const s = seloPedidoAnterior({ ...base, entrada_manual_em: '2026-10-18T12:00:00Z' })
    expect(s.cor).toBe('cinza')
    expect(s.texto).toContain('entrada no estoque informada por você')
  })
})
