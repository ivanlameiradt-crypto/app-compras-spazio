import {
  FORMA_PADRAO, bloqueiosDaNota, formaInicial, formaLembrada, formaValida, lembrarForma, precisaEscolherForma, rotuloForma, textoDoEstado,
  traduzirMotivo, formaNaoProvada, lancandoPresa, MINUTOS_PRESA, formaPadraoDoFornecedor, podeVirMarcada, parseValorBr, formatarValorBr, validarParcelasDigitadas, linhasIniciais, precisaDigitarParcelas, FORNECEDORES_XML_SEM_PAGAMENTO, prontidaoDaNota, resumoFinanceiro, fornecedorAprendido, NOTAS_PARA_APRENDER,
  podeDescartar, motivoDoDescarte, descartadaVoltouComItens, MOTIVO_SEM_ITENS,
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

  it('bloqueiosDaNota: nota que chegou sem itens (a leitura não abriu a nota) não pode ser lançada', () => {
    const b = bloqueiosDaNota(nota({ itens: [] }))
    expect(b).toHaveLength(1)
    expect(b[0]).toContain('chegou sem itens')
  })

  describe('descartar nota que não dá para lançar (regra 3)', () => {
    const semProduto = { descricao: 'Y', qtd: 1, unidade_sischef: 'KG', produto_id: null }

    it('pode descartar quando o app a trava (sem itens, item sem produto, conta especial) ou o robô parou nela (revisar)', () => {
      expect(podeDescartar(nota({ itens: [] }))).toBe(true)
      expect(podeDescartar(nota({ itens: [semProduto] }))).toBe(true)
      expect(podeDescartar(nota({ emitente: 'KONDO COMERCIO' }))).toBe(true)
      expect(podeDescartar(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' }))).toBe(true)
    })

    it('nota em ordem (pronta, com a forma de pagamento a escolher, ensaio ok) NÃO tem o descartar', () => {
      expect(podeDescartar(nota())).toBe(false)
      expect(podeDescartar(nota({ parcelas: [] }))).toBe(false)
      expect(podeDescartar(nota({ lancamento_estado: 'ensaio_ok' }))).toBe(false)
    })

    it('NUNCA a pela metade (erro) nem a que o robô está lançando agora; a reserva presa (> 30 min) pode', () => {
      expect(podeDescartar(nota({ itens: [], lancamento_estado: 'erro' }))).toBe(false)
      expect(podeDescartar(nota({ itens: [], lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() }))).toBe(false)
      const minAtras = (min: number) => new Date(Date.now() - min * 60_000).toISOString() // relógio real: podeDescartar usa Date.now()
      expect(podeDescartar(nota({ itens: [], lancamento_estado: 'lancando', lancamento_estado_em: minAtras(5) }))).toBe(false)
      expect(podeDescartar(nota({ itens: [], lancamento_estado: 'lancando', lancamento_estado_em: minAtras(31) }))).toBe(true) // reserva presa
    })

    it('motivoDoDescarte: diz o que impede de lançar (e cabe nos 300 do banco)', () => {
      expect(motivoDoDescarte(nota({ itens: [] }))).toBe(MOTIVO_SEM_ITENS)
      expect(motivoDoDescarte(nota({ itens: [semProduto] }))).toBe('Item sem produto no SisChef')
      expect(motivoDoDescarte(nota({ emitente: 'MERCADO LIVRE LTDA', itens: [semProduto] }))).toBe('Item sem produto no SisChef; Conta especial')
      expect(motivoDoDescarte(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' })))
        .toBe('O robô parou: A nota não tem boleto: escolha como pagar')
      expect(motivoDoDescarte(nota({ lancamento_estado: 'revisar', lancamento_motivo: null }))).toBe('O robô parou: confira a nota')
      expect(motivoDoDescarte(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'x'.repeat(900) })).length).toBe(300)
    })

    it('descartadaVoltouComItens: só a descartada por falta de itens que agora tem itens', () => {
      expect(descartadaVoltouComItens(nota({ descartada_motivo: MOTIVO_SEM_ITENS }))).toBe(true)
      expect(descartadaVoltouComItens(nota({ descartada_motivo: MOTIVO_SEM_ITENS, itens: [] }))).toBe(false)
      expect(descartadaVoltouComItens(nota({ descartada_motivo: 'Item sem produto no SisChef' }))).toBe(false)
      expect(descartadaVoltouComItens(nota({ descartada_motivo: null }))).toBe(false)
    })
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

  it('formaInicial: gravada na nota > padrão do banco > lembrada no celular > Boleto', () => {
    localStorage.clear()
    const n = nota({ cnpj_emitente: '111' })
    expect(formaInicial(n, { '111': 'tesouraria' })).toBe('tesouraria')
    lembrarForma(n.emitente, 'dinheiro')
    expect(formaInicial(n, { '111': 'tesouraria' })).toBe('tesouraria') // banco vale mais que o celular
    expect(formaInicial(n, {})).toBe('dinheiro')                         // sem padrão no banco: o do celular
    expect(formaInicial(nota({ cnpj_emitente: '111', forma_pagamento: 'boleto' }), { '111': 'tesouraria' })).toBe('boleto') // a da própria nota vence
    localStorage.clear()
    expect(formaInicial(n, undefined)).toBe('boleto')
  })

  it('PIX e cartão nunca vêm pré-marcados nem são memorizados', () => {
    localStorage.clear()
    expect(['boleto', 'dinheiro', 'tesouraria'].every(podeVirMarcada)).toBe(true)
    expect(['pix:bradesco|ij', 'cartao', '', null, undefined].some(podeVirMarcada)).toBe(false)
    lembrarForma('ATACADAO S.A.', 'pix:bradesco|ij')
    lembrarForma('ATACADAO S.A.', 'cartao')
    expect(formaLembrada('ATACADAO S.A.')).toBeNull()
    expect(formaPadraoDoFornecedor(nota({ cnpj_emitente: '222' }), { '222': 'cartao' })).toBeNull()
    expect(formaPadraoDoFornecedor(nota({ cnpj_emitente: null }), { '222': 'boleto' })).toBeNull()
  })

  describe('nota pronta (regra 2) e financeiro', () => {
    const boletos = (...v: number[]) => v.map((valor, i) => ({ numero: String(i + 1), vencimento: '2026-11-05', valor }))

    it('resumoFinanceiro: boletos que somam o valor da nota batem; sem leitura / sem boleto / diferença não batem', () => {
      expect(resumoFinanceiro(nota({ valor_nf: 100, parcelas: boletos(50, 50) }))).toMatchObject({ lido: true, soma: 100, diferenca: 0, bate: true })
      expect(resumoFinanceiro(nota({ valor_nf: 100.01, parcelas: boletos(33.34, 33.33, 33.33) })).bate).toBe(true)  // 1 centavo é ruído
      expect(resumoFinanceiro(nota({ valor_nf: 100, parcelas: boletos(50, 49) }))).toMatchObject({ bate: false, diferenca: -1 })
      expect(resumoFinanceiro(nota({ valor_nf: 100, parcelas: [] }))).toMatchObject({ lido: true, bate: false })
      expect(resumoFinanceiro(nota({ valor_nf: 100, parcelas: null }))).toMatchObject({ lido: false, bate: false, diferenca: null })
      expect(resumoFinanceiro(nota({ valor_nf: 0.1 + 0.2, parcelas: boletos(0.3) })).bate).toBe(true)                 // sem erro de ponto flutuante
    })

    it('prontidaoDaNota: pronta só com itens associados + boletos que fecham', () => {
      const ok = nota({ valor_nf: 100, parcelas: boletos(60, 40) })
      expect(prontidaoDaNota(ok)).toEqual({ pronta: true, motivos: [], financeiro: null })
      const semProduto = nota({ valor_nf: 100, parcelas: boletos(100), itens: [{ descricao: 'X', qtd: 1, unidade_sischef: 'KG', produto_id: null }] })
      expect(prontidaoDaNota(semProduto)).toMatchObject({ pronta: false, financeiro: null })
      expect(prontidaoDaNota(semProduto).motivos).toEqual(['1 item sem produto no SisChef'])
      const painel = nota({ valor_nf: 100, parcelas: boletos(100), itens: [{ descricao: 'X', qtd: 1, unidade_sischef: 'KG', produto_id: 7, associacao: 'painel' }] })
      expect(prontidaoDaNota(painel).pronta).toBe(false) // decidido no app mas ainda não associado no SisChef
    })

    it.each([
      ['XML ainda não lido', null, 'Boletos ainda não lidos do XML (próxima leitura)'],
      ['nota sem boleto (à vista)', [], 'O XML da nota não traz boletos: digite as parcelas ou escolha outra forma de pagamento'],
      ['boletos que não fecham', boletos(10), 'Os boletos não fecham com o valor da nota'],
    ])('prontidaoDaNota: %s não é pronta e explica', (_n, parcelas, motivo) => {
      const r = prontidaoDaNota(nota({ valor_nf: 100, parcelas }))
      expect(r).toMatchObject({ pronta: false, financeiro: motivo })
    })

    it('prontidaoDaNota: conta especial, nota pela metade e nota que voltou do robô nunca são prontas', () => {
      const b = { valor_nf: 100, parcelas: boletos(100) }
      expect(prontidaoDaNota(nota({ ...b, emitente: 'KONDO COMERCIO' })).pronta).toBe(false)
      expect(prontidaoDaNota(nota({ ...b, lancamento_estado: 'erro' })).pronta).toBe(false)
      expect(prontidaoDaNota(nota({ ...b, lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' })).motivos.join(' ')).toContain('total diferente')
      expect(prontidaoDaNota(nota({ ...b, itens: [] })).pronta).toBe(false)
    })

    it('fornecedorAprendido: só com 3 ou mais notas seguidas em boleto', () => {
      const n = nota({ cnpj_emitente: '111' })
      expect(NOTAS_PARA_APRENDER).toBe(3)
      expect(fornecedorAprendido(n, { '111': 2 })).toBe(0)
      expect(fornecedorAprendido(n, { '111': 3 })).toBe(3)
      expect(fornecedorAprendido(n, { '999': 9 })).toBe(0)
      expect(fornecedorAprendido(nota({ cnpj_emitente: null }), { '111': 9 })).toBe(0)
      expect(fornecedorAprendido(n, undefined)).toBe(0)
    })
  })

  describe('parcelas digitadas (boleto cujo XML não traz as duplicatas)', () => {
    it('parseValorBr: pt-BR com milhar e vírgula; o resto é recusado', () => {
      expect(parseValorBr('1.234,56')).toBe(1234.56)
      expect(parseValorBr('1234,5')).toBe(1234.5)
      expect(parseValorBr('R$ 100')).toBe(100)
      expect(parseValorBr(' 430,20 ')).toBe(430.2)
      for (const ruim of ['', 'abc', '0', '0,00', '-5', '1,234.56', '12,345', '1.2', '1.23', '10000000,01', '1..000,00']) expect([ruim, parseValorBr(ruim)]).toEqual([ruim, null])
    })

    it('formatarValorBr: duas casas, milhar com ponto', () => {
      expect(formatarValorBr(1234.5)).toBe('1.234,50')
      expect(formatarValorBr(430.2)).toBe('430,20')
    })

    it('a regra provisória cobre a MATEUS pelo CNPJ (e só ela)', () => {
      expect(FORNECEDORES_XML_SEM_PAGAMENTO).toEqual({ '03995515011363': 'MATEUS SUPERMERCADOS' })
    })

    it('precisaDigitarParcelas: só boleto com XML lido e sem duplicatas', () => {
      const n = (parcelas: NotaSefazLista['parcelas']) => nota({ parcelas })
      expect(precisaDigitarParcelas(n([]), 'boleto')).toBe(true)
      expect(precisaDigitarParcelas(n([]), 'dinheiro')).toBe(false)
      expect(precisaDigitarParcelas(n([]), 'cartao')).toBe(false)
      expect(precisaDigitarParcelas(n(null), 'boleto')).toBe(false)                      // XML ainda não lido
      expect(precisaDigitarParcelas(n([{ numero: '1', vencimento: '2026-11-05', valor: 1 }]), 'boleto')).toBe(false)
    })

    it('linhasIniciais: uma linha em branco, ou o que o Ivan já tinha digitado', () => {
      expect(linhasIniciais(nota({}))).toEqual([{ vencimento: '', valor: '' }])
      expect(linhasIniciais(nota({ parcelas_manuais: [{ vencimento: '2026-11-05', valor: 1234.5 }] }))).toEqual([{ vencimento: '2026-11-05', valor: '1.234,50' }])
    })

    describe('validarParcelasDigitadas', () => {
      const L = (vencimento: string, valor: string) => ({ vencimento, valor })
      it('fecha com o valor da nota: ok e devolve as parcelas no formato da função', () => {
        const r = validarParcelasDigitadas([L('2026-11-05', '60,00'), L('2026-11-12', '40')], 100, '2026-10-05')
        expect(r).toEqual({ ok: true, motivo: '', parcelas: [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40 }], soma: 100, falta: 0 })
      })
      it('1 centavo de diferença ainda fecha; 2 centavos não', () => {
        expect(validarParcelasDigitadas([L('2026-11-05', '100,01')], 100, '2026-10-05').ok).toBe(true)
        expect(validarParcelasDigitadas([L('2026-11-05', '100,02')], 100, '2026-10-05').ok).toBe(false)
      })
      it('diz o que falta ou o que passou', () => {
        expect(validarParcelasDigitadas([L('2026-11-05', '60,00')], 100, '2026-10-05')).toMatchObject({ ok: false, falta: 40, motivo: 'Faltam 40,00 para fechar com o valor da nota' })
        expect(validarParcelasDigitadas([L('2026-11-05', '130,50')], 100, '2026-10-05')).toMatchObject({ ok: false, falta: -30.5, motivo: 'Passou 30,50 do valor da nota' })
      })
      it('linha incompleta ou inválida trava com o motivo da 1ª linha ruim', () => {
        expect(validarParcelasDigitadas([L('', '100,00')], 100, '2026-10-05').motivo).toBe('Parcela 1: informe o vencimento')
        expect(validarParcelasDigitadas([L('2026-02-30', '100,00')], 100, '2026-10-05').motivo).toBe('Parcela 1: informe o vencimento')
        expect(validarParcelasDigitadas([L('2026-11-05', '')], 100, '2026-10-05').motivo).toBe('Parcela 1: informe o valor (ex.: 1.234,56)')
        expect(validarParcelasDigitadas([L('2026-11-05', '50'), L('2026-11-12', 'x')], 100, '2026-10-05').motivo).toBe('Parcela 2: informe o valor (ex.: 1.234,56)')
        expect(validarParcelasDigitadas([L('2026-11-05', '50'), L('2026-11-12', 'x')], 100, '2026-10-05').ok).toBe(false)
      })
      it('vencimento anterior à emissão é recusado (erro de digitação de data)', () => {
        expect(validarParcelasDigitadas([L('2025-11-05', '100,00')], 100, '2026-10-05').motivo).toBe('Parcela 1: o vencimento é anterior à emissão da nota')
        expect(validarParcelasDigitadas([L('2026-10-05', '100,00')], 100, '2026-10-05').ok).toBe(true) // no dia da emissão vale
      })
      it('sem linhas ou sem valor da nota não libera', () => {
        expect(validarParcelasDigitadas([], 100, '2026-10-05')).toMatchObject({ ok: false, motivo: 'Digite ao menos uma parcela' })
        expect(validarParcelasDigitadas([L('2026-11-05', '100,00')], null, '2026-10-05')).toMatchObject({ ok: false, falta: null })
      })
    })
  })
})
