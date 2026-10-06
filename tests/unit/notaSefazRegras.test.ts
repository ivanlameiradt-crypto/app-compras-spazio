import {
  FORMA_PADRAO, bloqueiosDaNota, formaInicial, formaLembrada, formaValida, lembrarForma, precisaEscolherForma, rotuloForma, textoDoEstado,
  traduzirMotivo, formaNaoProvada, lancandoPresa, MINUTOS_PRESA,
} from '../../src/admin/notaSefazRegras'
import { CONTAS_PIX } from '../../src/cupom/formasPagamento'
import type { NotaSefazLista } from '../../src/lib/tipos'

const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '0'.repeat(44), emitente: 'ATACADAO S.A.', numero: '1', emissao: '2026-10-03', valor_nf: 10, situacao: 'na_fila',
  lancada_em: null, nf_sischef: null, itens: [{ descricao: 'X', qtd: 1, unidade_sischef: 'KG', produto_id: 7, associacao: 'sischef' }], ...extra,
})

describe('notaSefazRegras', () => {
  it('as formas do app são exatamente as que a Edge Function lancar-nfe aceita', () => {
    expect(formaValida('Boleto ')).toBe('boleto')
    for (const c of CONTAS_PIX) expect(formaValida(`pix:${c.banco}|${c.empresa}`)).toBe(`pix:${c.banco}|${c.empresa}`)
    for (const ruim of ['pix', 'pix:itau|sp', 'dinheiro à vista', '', null, undefined, 3]) expect(formaValida(ruim)).toBeNull()
  })

  it('rotuloForma: PIX leva o nome da conta; desconhecida volta como veio', () => {
    expect(rotuloForma('boleto')).toBe('Boleto')
    expect(rotuloForma('pix:caixa|sp')).toBe('PIX — Caixa — Kūkan (S P Delivery)')
    expect(rotuloForma('cartao')).toBe('Cartão (só estoque)')
    expect(rotuloForma('outra')).toBe('outra')
  })

  it('memória por fornecedor: ignora maiúsculas/espaços e valor estragado', () => {
    expect(formaLembrada('MATEUS')).toBeNull()
    lembrarForma('Mateus  Supermercados', 'dinheiro')
    expect(formaLembrada(' MATEUS SUPERMERCADOS ')).toBe('dinheiro')
    localStorage.setItem('spazio.notaSefaz.forma.MATEUS SUPERMERCADOS', 'lixo')
    expect(formaLembrada('Mateus Supermercados')).toBeNull()
  })

  it('formaInicial: gravada > lembrada > Boleto', () => {
    expect(formaInicial(nota())).toBe(FORMA_PADRAO)
    lembrarForma('ATACADAO S.A.', 'tesouraria')
    expect(formaInicial(nota())).toBe('tesouraria')
    expect(formaInicial(nota({ forma_pagamento: 'pix:itau|ij' }))).toBe('pix:itau|ij')
    expect(formaInicial(nota({ forma_pagamento: 'invalida' }))).toBe('tesouraria')
  })

  it('formaInicial: nota sem boleto não vem com Boleto marcado', () => {
    const n = nota({ forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' })
    expect(precisaEscolherForma(n)).toBe(true)
    expect(formaInicial(n)).toBe('')
  })

  it('traduzirMotivo', () => {
    expect(traduzirMotivo('sem boletos na nota — pagamento manual')).toBe('A nota não tem boleto: escolha como pagar')
    expect(traduzirMotivo('Sem boletos na nota - pagamento manual')).toBe('A nota não tem boleto: escolha como pagar')
    expect(traduzirMotivo('sem boleto')).toBe('A nota não tem boleto: escolha como pagar')
    expect(traduzirMotivo('  item   sem  unidade ')).toBe('item sem unidade')
    expect(traduzirMotivo(null)).toBe('')
  })

  it('bloqueiosDaNota', () => {
    expect(bloqueiosDaNota(nota())).toEqual([])
    expect(bloqueiosDaNota(nota({ emitente: 'kondo comercio' }))).toEqual(['Conta especial: essa nota não é lançada pelo app'])
    expect(bloqueiosDaNota(nota({ emitente: 'MERCADO   LIVRE' }))).toHaveLength(1)
    const semProduto = { descricao: 'Y', qtd: 1, unidade_sischef: 'KG', produto_id: null }
    expect(bloqueiosDaNota(nota({ itens: [semProduto] }))).toEqual(['Item sem produto no SisChef: associe lá antes de lançar'])
    expect(bloqueiosDaNota(nota({ itens: [{ ...semProduto, produto_id: 5, associacao: ' Painel ' }] }))).toHaveLength(1)
    expect(bloqueiosDaNota(nota({ emitente: 'KONDO', itens: [semProduto] }))).toHaveLength(2)
  })

  it('textoDoEstado', () => {
    expect(textoDoEstado(null, null)).toBeNull()
    expect(textoDoEstado('lancando', null)).toBe('Lançando… (o robô está trabalhando)')
    expect(textoDoEstado('revisar', 'x')).toBe('Precisa de você: x')
    expect(textoDoEstado('erro', 'x')).toContain('NÃO lance de novo')
    expect(textoDoEstado('ensaio_ok', null)).toBe('Ensaio ok (nada foi criado)')
  })

  it('formaNaoProvada: só o boleto foi provado ao vivo', () => {
    expect(formaNaoProvada('boleto')).toBe(false)
    expect(formaNaoProvada('')).toBe(false)
    for (const f of ['dinheiro', 'tesouraria', 'cartao', 'pix:bradesco|ij']) expect(formaNaoProvada(f)).toBe(true)
  })

  it('lancandoPresa: só "lancando" com carimbo mais velho que 30 min (o mesmo limite da Edge Function)', () => {
    const agora = Date.parse('2026-10-06T12:00:00Z')
    const em = (min: number) => new Date(agora - min * 60_000).toISOString()
    expect(MINUTOS_PRESA).toBe(30)
    expect(lancandoPresa(nota({ lancamento_estado: 'lancando', lancamento_estado_em: em(31) }), agora)).toBe(true)
    expect(lancandoPresa(nota({ lancamento_estado: 'lancando', lancamento_estado_em: em(29) }), agora)).toBe(false)
    expect(lancandoPresa(nota({ lancamento_estado: 'lancando', lancamento_estado_em: null }), agora)).toBe(false)
    expect(lancandoPresa(nota({ lancamento_estado: 'lancando', lancamento_estado_em: 'lixo' }), agora)).toBe(false)
    expect(lancandoPresa(nota({ lancamento_estado: 'erro', lancamento_estado_em: em(120) }), agora)).toBe(false)
  })
})
