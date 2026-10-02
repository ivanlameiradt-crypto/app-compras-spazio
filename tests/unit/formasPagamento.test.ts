import { CONTAS_PIX, CONTA_DINHEIRO, CONTA_TESOURARIA, FORMAS } from '../../src/cupom/formasPagamento'

describe('formasPagamento — espelho do MAPA_PIX do robô', () => {
  it('as 4 formas na ordem da tela', () => {
    expect(FORMAS.map((f) => f.forma)).toEqual(['dinheiro', 'tesouraria', 'pix', 'sem_cartao'])
  })

  it('as 2 contas à vista batem com o cupom_formas_pagamento.py', () => {
    expect(CONTA_DINHEIRO).toBe('DINHEIRO - À Vista')
    expect(CONTA_TESOURARIA).toBe('TESOURARIA - À Vista')
  })

  it('as 7 contas PIX (banco|empresa → conta) batem exatamente com o MAPA_PIX', () => {
    const mapa = Object.fromEntries(CONTAS_PIX.map((c) => [`${c.banco}|${c.empresa}`, c.conta]))
    expect(mapa).toEqual({
      'pangbank|ij': 'CONTA BANCÁRIA - PANG BANK - I J LAMEIRA',
      'pangbank|sp': 'CONTA BANCÁRIA - PANG BANK - S P DELIVERY',
      'bradesco|ij': 'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA',
      'bradesco|sp': 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY',
      'itau|ij': 'CONTA BANCÁRIA - PANG ITAU - I J LAMEIRA',
      'caixa|ij': 'CONTA BANCÁRIA - CAIXA - I J LAMEIRA',
      'caixa|sp': 'CONTA BANCÁRIA - CAIXA - S P DELIVERY',
    })
    expect(CONTAS_PIX).toHaveLength(7)
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
