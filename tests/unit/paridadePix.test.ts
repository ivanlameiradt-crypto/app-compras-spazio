// Paridade das contas do Pix (revisão independente do PR 63, 31/10/2026): as listas do app, das três funções (compra avulsa, cupom por foto e nota fiscal) e o MAPA_PIX do robô
// (sischef-monitor-notas, cupom_formas_pagamento.MAPA_PIX, repositório privado) têm de ser a MESMA lista — o SisChef renomeou as contas em 30/10/2026 ('PANG BANK' virou 'PAG BANK',
// todas ganharam o sufixo '- À Vista' e o Itaú saiu) e um texto que o robô não acha só aparece DEPOIS de o pedido estar gravado no SisChef (cupom/compra pela metade).
import { CONTAS_PIX } from '../../src/cupom/formasPagamento'
import { CONTAS_PERMITIDAS as CONTAS_AVULSA, validarPagamento as validarAvulsa } from '../../supabase/functions/enviar-compra-avulsa/logica'
import { CONTAS_PERMITIDAS as CONTAS_CUPOM, validarPagamento as validarCupom } from '../../supabase/functions/enviar-cupom/logica'
import { CONTAS_PIX as CHAVES_NFE } from '../../supabase/functions/lancar-nfe/logica'

// cupom_formas_pagamento.MAPA_PIX do robô (commit 381736b, PR 79, de 30/10/2026), copiado à mão: se o SisChef renomear de novo, o robô muda primeiro e este teste manda mudar o resto
const MAPA_PIX_DO_ROBO: Record<string, string> = {
  'pangbank|ij': 'CONTA BANCÁRIA - PAG BANK - I J LAMEIRA - À Vista',
  'pangbank|sp': 'CONTA BANCÁRIA - PAG BANK - S P DELIVERY - À Vista',
  'bradesco|ij': 'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA - À Vista',
  'bradesco|sp': 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY - À Vista',
  'caixa|ij': 'CONTA BANCÁRIA - CAIXA - I J LAMEIRA - À Vista',
  'caixa|sp': 'CONTA BANCÁRIA - CAIXA - S P DELIVERY - À Vista',
}
const VELHOS = ['CONTA BANCÁRIA - PANG BANK - I J LAMEIRA', 'CONTA BANCÁRIA - PANG BANK - S P DELIVERY', 'CONTA BANCÁRIA - PANG ITAU - I J LAMEIRA']

describe('Pix — paridade entre as listas do app, das funções e do robô', () => {
  it('app (CONTAS_PIX) = MAPA_PIX do robô, chave por chave', () => {
    expect(Object.fromEntries(CONTAS_PIX.map((c) => [`${c.banco}|${c.empresa}`, c.conta]))).toEqual(MAPA_PIX_DO_ROBO)
  })

  it('função da compra avulsa aceita EXATAMENTE os 6 textos do app (nem um a mais, nem um a menos)', () => {
    expect([...CONTAS_AVULSA.pix].sort()).toEqual(CONTAS_PIX.map((c) => c.conta).sort())
    for (const c of CONTAS_PIX) expect(validarAvulsa({ forma: 'pix', conta: c.conta }).ok).toBe(true)
  })

  it('função do cupom por foto aceita EXATAMENTE os mesmos 6 textos e as mesmas contas de dinheiro e tesouraria da compra avulsa', () => {
    expect([...CONTAS_CUPOM.pix].sort()).toEqual(CONTAS_PIX.map((c) => c.conta).sort())
    expect(CONTAS_CUPOM.dinheiro).toEqual(CONTAS_AVULSA.dinheiro)
    expect(CONTAS_CUPOM.tesouraria).toEqual(CONTAS_AVULSA.tesouraria)
    for (const c of CONTAS_PIX) expect(validarCupom({ forma: 'pix', conta: c.conta }).ok).toBe(true)
  })

  it('função da NF-e aceita EXATAMENTE as 6 chaves do app', () => {
    expect([...CHAVES_NFE].sort()).toEqual(CONTAS_PIX.map((c) => `${c.banco}|${c.empresa}`).sort())
  })

  it('os textos estão na mesma forma Unicode (NFC) do Python do robô: "Á" e "À" de um caractere só', () => {
    for (const c of CONTAS_PIX) expect(c.conta).toBe(c.conta.normalize('NFC'))
  })

  it.each(VELHOS)('o nome VELHO "%s" é recusado pelo cupom por foto E pela compra avulsa (nada chega ao robô com um texto que ele não acha)', (velho) => {
    expect(validarCupom({ forma: 'pix', conta: velho }).ok).toBe(false)
    expect(validarAvulsa({ forma: 'pix', conta: velho }).ok).toBe(false)
  })
})
