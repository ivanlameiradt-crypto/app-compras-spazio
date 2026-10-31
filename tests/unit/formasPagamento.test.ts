import { CONTAS_PIX, CONTA_DINHEIRO, CONTA_TESOURARIA, FORMAS } from '../../src/cupom/formasPagamento'

describe('formasPagamento — espelho do MAPA_PIX do robô', () => {
  it('as 4 formas na ordem da tela', () => {
    expect(FORMAS.map((f) => f.forma)).toEqual(['dinheiro', 'tesouraria', 'pix', 'sem_cartao'])
  })

  it('as 2 contas à vista batem com o cupom_formas_pagamento.py', () => {
    expect(CONTA_DINHEIRO).toBe('DINHEIRO - À Vista')
    expect(CONTA_TESOURARIA).toBe('TESOURARIA - À Vista')
  })

  it('as 6 contas PIX (banco|empresa → conta) batem exatamente com o MAPA_PIX (nomes do SisChef de 30/10/2026: PAG BANK, "- À Vista", sem Itaú)', () => {
    const mapa = Object.fromEntries(CONTAS_PIX.map((c) => [`${c.banco}|${c.empresa}`, c.conta]))
    expect(mapa).toEqual({
      'pangbank|ij': 'CONTA BANCÁRIA - PAG BANK - I J LAMEIRA - À Vista',
      'pangbank|sp': 'CONTA BANCÁRIA - PAG BANK - S P DELIVERY - À Vista',
      'bradesco|ij': 'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA - À Vista',
      'bradesco|sp': 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY - À Vista',
      'caixa|ij': 'CONTA BANCÁRIA - CAIXA - I J LAMEIRA - À Vista',
      'caixa|sp': 'CONTA BANCÁRIA - CAIXA - S P DELIVERY - À Vista',
    })
    expect(CONTAS_PIX).toHaveLength(6)
  })

  it('o nome antigo (PANG BANK) e o Itaú, que o SisChef não tem mais, não aparecem em nenhum rótulo nem conta', () => {
    for (const c of CONTAS_PIX) {
      expect(`${c.rotulo} ${c.conta}`).not.toMatch(/PANG|ITA[UÚ]/i)
      expect(c.conta.endsWith(' - À Vista')).toBe(true)
    }
  })
})

describe('formasPagamento — o rótulo da tela diz a mesma empresa da conta que ele manda', () => {
  // Um rótulo trocado levaria o Ivan a escolher a conta da empresa errada. I J LAMEIRA = Spazio; S P DELIVERY = Kūkan.
  it.each(CONTAS_PIX)('$banco|$empresa', (c) => {
    if (c.empresa === 'ij') {
      expect(c.rotulo).toContain('Spazio')
      expect(c.conta).toContain('I J LAMEIRA')
    } else {
      expect(c.rotulo).toContain('Kūkan')
      expect(c.conta).toContain('S P DELIVERY')
    }
  })
})
