// Bonificação sozinha, a parte das REGRAS (pedido do Ivan de 27/10/2026: "você tem que identificar isso nas notas que são feitas de bonificação: sempre só estoque").
// Nota de bonificação = TODOS os itens com CFOP 5910 (mesmo estado) ou 6910 (outro estado), etiquetados pelo robô em `cot_nfe.itens[i].cfop`. Só vira "só estoque"
// SOZINHA quando, além disso, o XML foi lido e NÃO traz boletos (`parcelas` = lista vazia): bonificação com boleto é estranha e não pode virar "sem financeiro" calada.
// Tudo INVENTADO (repositório público).
import {
  AVISO_BONIFICACAO_COM_BOLETO, AVISO_CONTA_ESPECIAL, AVISO_ITEM_SEM_PRODUTO, AVISO_SEM_ITENS, CFOPS_BONIFICACAO, FORMAS_PROVADAS, FORMA_SO_ESTOQUE, OPCAO_BONIFICACAO,
  TEXTO_BONIFICACAO_DEVOLVIDA, bloqueiosDaNota, bonificacaoComBoletos, bonificacaoSemCobranca, cfopsDaBonificacao, devolvidaPorFormaDeBonificacao, ehNotaDeBonificacao, formaInicial,
  formaNaoProvada, lembrarForma, precisaEscolherForma, prontidaoDaNota, rotuloForma,
} from '../../src/admin/notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

const CNPJ = '12345678000190'
/** Um item já associado no SisChef, com o CFOP que o robô etiquetou (`undefined` = sem a chave `cfop`, como nas notas que o robô ainda não re-etiquetou). */
const item = (cfop?: unknown, extra: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  ({ n: 1, descricao: 'CÓD. FOR: 100 PÃO TESTE PCT 15', qtd: 240, unidade_sischef: 'UN', produto_id: 7001, associacao: 'sischef', produto_nome: 'PÃO TESTE', ...(cfop === undefined ? {} : { cfop }), ...extra }) as ItemNotaSefaz
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '5'.repeat(44), cnpj_emitente: CNPJ, emitente: 'FORNECEDOR EXEMPLO LTDA', numero: '000777', emissao: '2026-10-27', valor_nf: 509.6,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, itens: [item('5910')], parcelas: [], ...extra,
})
const comCfops = (...cfops: unknown[]): NotaSefazLista => nota({ itens: cfops.map((c, i) => item(c, { n: i + 1 })) })
const boleto = [{ numero: '1', vencimento: '2026-11-20', valor: 509.6 }]

describe('CFOPS_BONIFICACAO e a forma "só estoque"', () => {
  it('são exatamente 5910 (mesmo estado) e 6910 (outro estado): amostra grátis (5911/6911) e o resto ficam de fora', () => {
    expect([...CFOPS_BONIFICACAO].sort()).toEqual(['5910', '6910'])
    expect(CFOPS_BONIFICACAO).toHaveLength(2)
  })

  it('a opção única da bonificação é a forma "cartao" (a que o robô e a Edge Function aceitam), com o nome "Só estoque (bonificação)"', () => {
    expect(FORMA_SO_ESTOQUE).toBe('cartao')
    expect(OPCAO_BONIFICACAO).toEqual({ valor: 'cartao', rotulo: 'Só estoque (bonificação)' })
    expect(rotuloForma('cartao')).toBe('Cartão (só estoque)') // a lista normal continua com o nome de sempre
  })

  it('"cartao" foi PROVADA ao vivo em 27/10/2026 (nota 113301 da De Marchi, run 40557196249): já não leva o aviso de forma não testada', () => {
    expect(FORMAS_PROVADAS).toEqual(['boleto', 'cartao', 'pix:pangbank|ij'])
    expect(formaNaoProvada('cartao')).toBe(false)
    expect(formaNaoProvada('boleto')).toBe(false)
    expect(formaNaoProvada('')).toBe(false)
    for (const f of ['dinheiro', 'tesouraria', 'pix:bradesco|ij']) expect(formaNaoProvada(f)).toBe(true)
  })

  it('"pix:pangbank|ij" (Pag Bank — Spazio) foi PROVADA ao vivo em 31/10/2026 (JAMES 128432, rodada 41172029712); as outras contas do Pix seguem com o aviso', () => {
    expect(formaNaoProvada('pix:pangbank|ij')).toBe(false)
    for (const f of ['pix:pangbank|sp', 'pix:bradesco|ij', 'pix:bradesco|sp', 'pix:caixa|ij', 'pix:caixa|sp']) expect(formaNaoProvada(f)).toBe(true)
  })
})

describe('ehNotaDeBonificacao: TODOS os itens com CFOP 5910/6910', () => {
  it.each([
    ['um item 5910', ['5910'], true],
    ['um item 6910', ['6910'], true],
    ['vários itens, todos 5910', ['5910', '5910', '5910'], true],
    ['vários itens, todos 6910', ['6910', '6910'], true],
    ['5910 e 6910 juntos (as duas são bonificação)', ['5910', '6910'], true],
    ['espaços nas pontas do texto não atrapalham', [' 5910 ', '6910\n'], true],
    ['NOTA MISTA: 5910 com um item de venda (5102) NÃO é bonificação', ['5910', '5102'], false],
    ['mista na outra ordem', ['5102', '5910'], false],
    ['só venda (5102)', ['5102'], false],
    ['amostra grátis (5911) fica de fora', ['5911'], false],
    ['amostra grátis de outro estado (6911) fica de fora', ['6911'], false],
    ['bonificação com um item de amostra', ['5910', '5911'], false],
    ['um item SEM a chave cfop', ['5910', undefined], false],
    ['um item com cfop null', ['5910', null], false],
    ['um item com cfop vazio', ['5910', ''], false],
    ['um item com cfop só de espaços', ['5910', '   '], false],
    ['nenhum item com cfop (nota que o robô ainda não etiquetou)', [undefined, undefined], false],
    ['lista de itens VAZIA', [], false],
    ['CFOP com menos dígitos', ['591'], false],
    ['CFOP com um dígito a mais', ['59100'], false],
    ['CFOP com pontuação', ['5.910'], false],
    ['CFOP com letra', ['5910a'], false],
    ['dois CFOPs no mesmo texto', ['5910 6910'], false],
    ['CFOP escrito como NÚMERO (o contrato é texto): na dúvida, não é bonificação', [5910], false],
    ['CFOP como lista', [['5910']], false],
  ])('%s', (_nome, cfops, esperado) => {
    expect(ehNotaDeBonificacao(comCfops(...(cfops as unknown[])))).toBe(esperado)
  })

  it('só os CFOPs decidem: a forma gravada, o estado do robô e os boletos não mudam o resultado', () => {
    for (const extra of [
      { parcelas: null }, { parcelas: [] }, { parcelas: boleto }, { parcelas: undefined },
      { forma_pagamento: 'boleto' }, { forma_pagamento: 'cartao' },
      { lancamento_estado: 'revisar' as const, lancamento_motivo: 'x' }, { lancamento_estado: 'erro' as const },
    ]) expect(ehNotaDeBonificacao(nota(extra))).toBe(true)
  })

  it('itens que não são lista (dado estragado): não é bonificação, e não quebra', () => {
    expect(ehNotaDeBonificacao(nota({ itens: undefined as unknown as ItemNotaSefaz[] }))).toBe(false)
    expect(ehNotaDeBonificacao(nota({ itens: null as unknown as ItemNotaSefaz[] }))).toBe(false)
    expect(ehNotaDeBonificacao(nota({ itens: [null as unknown as ItemNotaSefaz] }))).toBe(false)
  })
})

describe('os três estados de `parcelas` numa nota de bonificação', () => {
  it('XML lido e SEM boletos (lista vazia): é a única que vira "só estoque" sozinha', () => {
    const n = nota({ parcelas: [] })
    expect(bonificacaoSemCobranca(n)).toBe(true)
    expect(bonificacaoComBoletos(n)).toBe(false)
  })

  it('XML lido COM boleto (1 ou mais): não marca nada sozinho — é a bonificação "estranha", que pede conferência', () => {
    for (const parcelas of [boleto, [...boleto, { numero: '2', vencimento: '2026-12-20', valor: 10 }]]) {
      const n = nota({ parcelas })
      expect(bonificacaoSemCobranca(n)).toBe(false)
      expect(bonificacaoComBoletos(n)).toBe(true)
    }
  })

  it('XML ainda por ler (null ou ausente): trata como nota comum — nem automático nem aviso', () => {
    for (const parcelas of [null, undefined]) {
      const n = nota({ parcelas })
      expect(ehNotaDeBonificacao(n)).toBe(true)
      expect(bonificacaoSemCobranca(n)).toBe(false)
      expect(bonificacaoComBoletos(n)).toBe(false)
    }
  })

  it('nota que NÃO é de bonificação nunca cai em nenhum dos dois, qualquer que seja `parcelas`', () => {
    for (const itens of [[item('5102')], [item('5910'), item('5102', { n: 2 })], [item()], []]) {
      for (const parcelas of [[], boleto, null]) {
        const n = nota({ itens, parcelas })
        expect(bonificacaoSemCobranca(n)).toBe(false)
        expect(bonificacaoComBoletos(n)).toBe(false)
      }
    }
  })
})

describe('cfopsDaBonificacao: o CFOP que o texto da tela mostra', () => {
  it('um só CFOP, o outro, ou os dois (em ordem, sem repetir)', () => {
    expect(cfopsDaBonificacao(comCfops('5910', '5910'))).toBe('5910')
    expect(cfopsDaBonificacao(comCfops('6910'))).toBe('6910')
    expect(cfopsDaBonificacao(comCfops('6910', '5910', ' 6910 '))).toBe('5910/6910')
  })
  it('nota que não é de bonificação: nada', () => {
    expect(cfopsDaBonificacao(comCfops('5910', '5102'))).toBe('')
    expect(cfopsDaBonificacao(comCfops())).toBe('')
  })
})

describe('formaInicial: "cartao" só para bonificação sem cobrança, ANTES de qualquer outra regra', () => {
  it('abre em cartão, e a forma gravada de uma tentativa antiga (boleto, PIX…) não vence', () => {
    expect(formaInicial(nota())).toBe('cartao')
    expect(formaInicial(nota({ forma_pagamento: 'boleto' }))).toBe('cartao')
    expect(formaInicial(nota({ forma_pagamento: 'pix:itau|ij' }))).toBe('cartao')
    expect(formaInicial(nota({ forma_pagamento: 'dinheiro' }))).toBe('cartao')
  })

  it('a nota que voltou do robô por "sem boletos" (precisaEscolherForma) também abre em cartão, não em branco', () => {
    const n = nota({ forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' })
    expect(precisaEscolherForma(n)).toBe(true)
    expect(formaInicial(n)).toBe('cartao')
  })

  it('o padrão do fornecedor no banco e a forma lembrada neste celular também não vencem', () => {
    lembrarForma('FORNECEDOR EXEMPLO LTDA', 'tesouraria')
    expect(formaInicial(nota(), { [CNPJ]: 'dinheiro' })).toBe('cartao')
    expect(formaInicial(nota())).toBe('cartao')
  })

  it('bonificação COM boleto: a forma inicial é a de sempre (gravada > padrão > lembrada > Boleto)', () => {
    const b = { parcelas: boleto }
    expect(formaInicial(nota(b))).toBe('boleto')
    expect(formaInicial(nota({ ...b, forma_pagamento: 'tesouraria' }))).toBe('tesouraria')
    expect(formaInicial(nota(b), { [CNPJ]: 'dinheiro' })).toBe('dinheiro')
    lembrarForma('FORNECEDOR EXEMPLO LTDA', 'tesouraria')
    expect(formaInicial(nota(b))).toBe('tesouraria')
  })

  it('bonificação com o XML por ler (parcelas null): a forma inicial de sempre', () => {
    expect(formaInicial(nota({ parcelas: null }))).toBe('boleto')
    expect(formaInicial(nota({ parcelas: null, forma_pagamento: 'dinheiro' }))).toBe('dinheiro')
    const semBoleto = nota({ parcelas: null, lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' })
    expect(formaInicial(semBoleto)).toBe('') // o "sem boletos" do robô segue pedindo a escolha do Ivan
  })

  it('nota comum sem boletos (venda, mista, sem CFOP, sem itens) NUNCA abre em cartão', () => {
    expect(formaInicial(nota({ itens: [item('5102')] }))).toBe('boleto')
    expect(formaInicial(nota({ itens: [item('5910'), item('5102', { n: 2 })] }))).toBe('boleto')
    expect(formaInicial(nota({ itens: [item()] }))).toBe('boleto')
    expect(formaInicial(nota({ itens: [] }))).toBe('boleto')
  })
})

describe('devolvidaPorFormaDeBonificacao: o robô devolveu a bonificação por causa da forma de uma tentativa antiga', () => {
  // a mensagem da trava nova do robô (PR do robô, 29/10/2026), como ele a escreve
  const TRAVA_DO_ROBO = 'nota de bonificação (CFOP 5910/6910): é um brinde do fornecedor, entra só no estoque e não tem conta a pagar — a forma de pagamento escolhida (boleto) criaria um pagamento que não existe. '
    + 'Nada foi feito no SisChef. No app, escolha “só estoque” e lance de novo'
  const devolvida = (motivo: string | null, estado: NotaSefazLista['lancamento_estado'] = 'revisar') => nota({ lancamento_estado: estado, lancamento_motivo: motivo })

  it('pelo "sem boletos na nota" de sempre', () => {
    expect(devolvidaPorFormaDeBonificacao(devolvida('sem boletos na nota — pagamento manual'))).toBe(true)
  })

  it('pela trava nova do robô, com ou sem o começo "parou antes de gerar o pedido", em maiúsculas ou sem acento', () => {
    expect(devolvidaPorFormaDeBonificacao(devolvida(TRAVA_DO_ROBO))).toBe(true)
    expect(devolvidaPorFormaDeBonificacao(devolvida(`parou antes de gerar o pedido (nada lançado): ${TRAVA_DO_ROBO}`))).toBe(true)
    expect(devolvidaPorFormaDeBonificacao(devolvida(TRAVA_DO_ROBO.toUpperCase()))).toBe(true)
    expect(devolvidaPorFormaDeBonificacao(devolvida(TRAVA_DO_ROBO.replace('bonificação', 'bonificacao')))).toBe(true)
  })

  it('por qualquer outro motivo, sem motivo, ou fora do estado "revisar": não (o texto do robô fica como ele escreveu)', () => {
    for (const motivo of ['total diferente', 'UN DIFERE sem conversão na tela: CÓD. FOR 17253', '', null]) expect(devolvidaPorFormaDeBonificacao(devolvida(motivo))).toBe(false)
    for (const estado of ['erro', 'lancando', 'ensaio_ok', null] as const) {
      expect(devolvidaPorFormaDeBonificacao(devolvida(TRAVA_DO_ROBO, estado))).toBe(false)
      expect(devolvidaPorFormaDeBonificacao(devolvida('sem boletos na nota — pagamento manual', estado))).toBe(false)
    }
  })

  it('o texto que entra no lugar diz que nada foi lançado, que a forma certa já está marcada e que é só lançar', () => {
    expect(TEXTO_BONIFICACAO_DEVOLVIDA.split('\n')).toEqual([
      'Precisa de você — nada foi lançado.',
      'Por quê: a nota não tem conta a pagar, e a forma de pagamento da tentativa anterior (por exemplo Boleto) criaria uma.',
      'O que fazer: como é uma nota de bonificação, a forma certa já está marcada (só estoque, sem conta a pagar). Toque em Lançar.',
    ])
  })
})

describe('prontidaoDaNota: a bonificação sem cobrança está PRONTA sem boleto', () => {
  it('itens associados e nada de boleto a conferir: pronta, sem motivo e sem aviso de financeiro', () => {
    expect(prontidaoDaNota(nota())).toEqual({ pronta: true, motivos: [], financeiro: null })
  })

  it('a MESMA nota sem o CFOP de bonificação continua pedindo o boleto (nada mudou para nota comum)', () => {
    for (const itens of [[item('5102')], [item()], [item('5910'), item('5102', { n: 2 })]]) {
      expect(prontidaoDaNota(nota({ itens }))).toEqual({
        pronta: false, financeiro: 'O XML da nota não traz boletos: digite as parcelas ou escolha outra forma de pagamento',
        motivos: ['O XML da nota não traz boletos: digite as parcelas ou escolha outra forma de pagamento'],
      })
    }
  })

  it('o que mais a nota exige continua valendo: item sem produto, conta especial, robô parou, pela metade', () => {
    const semProduto = nota({ itens: [item('5910', { produto_id: null, associacao: null })] })
    expect(prontidaoDaNota(semProduto)).toMatchObject({ pronta: false, financeiro: null, motivos: ['1 item sem produto no SisChef'] })
    expect(prontidaoDaNota(nota({ emitente: 'KONDO COMERCIO' })).motivos).toEqual([AVISO_CONTA_ESPECIAL])
    expect(prontidaoDaNota(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' })).motivos).toEqual(['Precisa de você: total diferente'])
    expect(prontidaoDaNota(nota({ lancamento_estado: 'erro' })).motivos).toEqual(['Ficou pela metade: não lance de novo'])
  })

  it('bloqueiosDaNota não muda: bonificação com item sem produto segue travada; a regra de itens vale igual', () => {
    expect(bloqueiosDaNota(nota())).toEqual([])
    expect(bloqueiosDaNota(nota({ itens: [item('5910', { produto_id: null, associacao: null })] }))).toEqual([AVISO_ITEM_SEM_PRODUTO])
    expect(bloqueiosDaNota(nota({ itens: [] }))).toEqual([AVISO_SEM_ITENS]) // sem itens nem é bonificação
  })

  it('bonificação COM boleto NÃO fica pronta (nem com os boletos fechando): o motivo manda conferir com o fornecedor', () => {
    expect(AVISO_BONIFICACAO_COM_BOLETO).toBe('Esta nota tem CFOP de bonificação (5910/6910), mas traz boletos. Confira com o fornecedor se há algo a pagar antes de lançar.')
    expect(prontidaoDaNota(nota({ parcelas: boleto }))).toEqual({ pronta: false, motivos: [AVISO_BONIFICACAO_COM_BOLETO], financeiro: null })
    // boletos que não fecham: os dois motivos, o do financeiro continua sendo o mesmo de sempre
    expect(prontidaoDaNota(nota({ parcelas: [{ numero: '1', vencimento: '2026-11-20', valor: 10 }] }))).toMatchObject({
      pronta: false, financeiro: 'Os boletos não fecham com o valor da nota', motivos: ['Os boletos não fecham com o valor da nota', AVISO_BONIFICACAO_COM_BOLETO],
    })
  })

  it('nota COMUM com os mesmos boletos que fecham continua pronta (o aviso é só da bonificação)', () => {
    expect(prontidaoDaNota(nota({ itens: [item('5102')], parcelas: boleto }))).toEqual({ pronta: true, motivos: [], financeiro: null })
    expect(prontidaoDaNota(nota({ itens: [item()], parcelas: boleto })).pronta).toBe(true)
  })

  it('bonificação com o XML por ler: igual a nota comum (ainda não pronta, e o motivo é o de sempre)', () => {
    const p = prontidaoDaNota(nota({ parcelas: null }))
    expect(p.pronta).toBe(false)
    expect(p.financeiro).toMatch(/^Boletos ainda não lidos do XML/)
    expect(p.motivos).toEqual([p.financeiro])
  })
})
