import {
  CONTAS_PIX, PASSO_QUE_LANCA, filtroReservavel, montarNotaJson, normalizarForma, normalizarFrete, normalizarParcelas, somaParcelas, tratar, verificar,
  type Deps, type DepsVerificar, type Execucao, type NotaEstado, type NotaReservada, type PassoExecucao,
} from './logica'

const CHAVE = '15261002164629000100550010014159761121141360'
const AGORA = new Date('2026-10-06T12:00:00.000Z')
const NOTA: NotaReservada = {
  chave: CHAVE, emitente: 'OLINDA DISTRI E COM DE ALIMENTOS LTDA', numero: '001415976', emissao: '2026-10-03',
  valor_nf: '1516.05', forma_pagamento: 'boleto',
  itens: [{ n: 1, descricao: 'CÓD. FOR: 563731 REQ. CREAM CHEESE - INSUMOS', produto_id: '3469783', associacao: 'sischef',
            qtd: 30, unidade_sischef: 'KG' }],
}
/** Decisão do Ivan no app (cot_nfe.associacoes_app) como o banco a grava: lata de 395 g, NF em UN e produto em KG → conversão 0,395. */
const DECISAO_LATA = { produto_id: 3138573, produto_nome: 'LEITE CONDENSADO - INSUMOS', unidade: 'kg', conversao: 0.395, origem: 'lista',
                       por: 'ivan@spazio.com', em: '2026-10-06T11:00:00+00:00' }

function fakeDeps(over: Partial<Deps> = {}): Deps & { reservas: unknown[][]; disparos: string[]; soltas: string[] } {
  const reservas: unknown[][] = []
  const disparos: string[] = []
  const soltas: string[] = []
  return {
    reservas, disparos, soltas,
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async reservar(...a) { reservas.push(a); return { ...NOTA, forma_pagamento: a[1] as string } },
    async outraLancando() { return false },
    async notaParaParcelas() { return { valor_nf: 100, parcelas: [] } },
    async soltar(chave) { soltas.push(chave) },
    async disparar(notaJson) { disparos.push(notaJson) },
    agora: () => AGORA,
    ...over,
  }
}

describe('normalizarForma ("como pagar" do app -> forma do robô)', () => {
  it.each([['boleto', 'boleto'], [' DINHEIRO ', 'dinheiro'], ['tesouraria', 'tesouraria'], ['cartao', 'cartao'],
    ['PIX:Bradesco|IJ', 'pix:bradesco|ij'], ['pix:caixa|sp', 'pix:caixa|sp']])('%s -> %s', (entrada, saida) => {
    expect(normalizarForma(entrada)).toBe(saida)
  })
  it.each([[null], [''], ['cheque'], ['pix'], ['pix:'], ['pix:itau|sp'], ['pix:bradesco|ij|x'], [42]])('%s é recusada', (f) => {
    expect(normalizarForma(f)).toBeNull()
  })
  it('as contas PIX são as 7 do MAPA_PIX do robô', () => {
    expect(CONTAS_PIX).toHaveLength(7)
  })
})

describe('filtroReservavel (compara-e-troca da reserva)', () => {
  it('livre, revisar, ensaio_ok ou lancando preso; nunca erro; carimbo entre aspas', () => {
    const f = filtroReservavel('2026-10-06T11:30:00.000Z')
    expect(f).toBe('lancamento_estado.is.null,lancamento_estado.in.(revisar,ensaio_ok),' +
      'and(lancamento_estado.eq.lancando,lancamento_em.lt."2026-10-06T11:30:00.000Z")')
    expect(f).not.toContain('erro')
  })
})

describe('montarNotaJson (a nota que o robô recebe)', () => {
  it('leva a forma escolhida e os itens com n e produto/associação; sem decisão do app, associacoes_app vai null (= hoje)', () => {
    const n = JSON.parse(montarNotaJson(NOTA))
    expect(n).toMatchObject({ chave: CHAVE, numero: '001415976', emissao: '2026-10-03', forma_pagamento: 'boleto' })
    expect(n.itens[0]).toEqual({ n: 1, descricao: NOTA.itens![0].descricao, produto_id: '3469783', associacao: 'sischef',
                                 qtd: 30, unidade_sischef: 'KG' })
    expect(n).toHaveProperty('associacoes_app', null) // a chave existe sempre: o robô não precisa adivinhar se a coluna veio
  })

  it('etapa 2: a decisão do app vai inteira, como veio do banco (com a conversão); cada item leva o seu n (null se a cot_nfe não o traz)', () => {
    const decisoes = { '2': DECISAO_LATA, '3': { ...DECISAO_LATA, produto_id: 3469783, produto_nome: 'REQ. CREAM CHEESE - INSUMOS', conversao: null } }
    const nota: NotaReservada = {
      ...NOTA,
      associacoes_app: decisoes,
      itens: [
        NOTA.itens![0],
        { n: 2, descricao: 'CÓD. FOR: 11 LEITE CONDENSADO LATA 395G', qtd: 24, unidade_sischef: 'UN' }, // sem produto: a decisão "2" é dele
        { descricao: 'CÓD. FOR: 12 ITEM DE COT_NFE ANTIGA', qtd: 1, unidade_sischef: 'UN' }, // sem n: o robô não acha decisão para ele
      ],
    }
    const n = JSON.parse(montarNotaJson(nota))
    expect(n.associacoes_app).toEqual(decisoes)
    expect(n.itens.map((it: { n: number | null }) => it.n)).toEqual([1, 2, null])
    expect(n.itens[1]).toEqual({ n: 2, descricao: 'CÓD. FOR: 11 LEITE CONDENSADO LATA 395G', produto_id: null, associacao: null,
                                 qtd: 24, unidade_sischef: 'UN' })
  })

  it('associacoes_app null no banco (decisão desfeita) vai null, não {}', () => {
    expect(JSON.parse(montarNotaJson({ ...NOTA, associacoes_app: null })).associacoes_app).toBeNull()
  })

  it('a decisão de item que JÁ tem produto no SisChef também é repassada: quem a ignora é o robô (as travas ficam num lugar só)', () => {
    const decisoes = { '1': { ...DECISAO_LATA, produto_id: 999 } } // o item 1 da NOTA já tem produto_id 3469783 no SisChef
    expect(JSON.parse(montarNotaJson({ ...NOTA, associacoes_app: decisoes })).associacoes_app).toEqual(decisoes)
  })
})

describe('tratar (o "Lançar" de uma nota)', () => {
  it('admin + forma válida: reserva com a trava de 30 min, dispara e devolve 202', async () => {
    const d = fakeDeps()
    const r = await tratar({ chave: CHAVE, forma: 'PIX:Bradesco|IJ' }, 'Ivan@Spazio.com ', d)
    expect(r).toEqual({ status: 202, corpo: { ok: true, chave: CHAVE, forma: 'pix:bradesco|ij' } })
    expect(d.reservas).toEqual([[CHAVE, 'pix:bradesco|ij', '2026-10-06T12:00:00.000Z', '2026-10-06T11:30:00.000Z', null, null]])
    expect(JSON.parse(d.disparos[0]).forma_pagamento).toBe('pix:bradesco|ij')
  })

  it('etapa 2: a decisão do app lida na reserva (coluna associacoes_app) vai no nota_json do disparo', async () => {
    const decisoes = { '1': DECISAO_LATA }
    const d = fakeDeps({ async reservar(...a) { return { ...NOTA, forma_pagamento: a[1] as string, associacoes_app: decisoes } } })
    expect((await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d)).status).toBe(202)
    expect(JSON.parse(d.disparos[0]).associacoes_app).toEqual(decisoes)
  })

  it('quem não é admin ativo é recusado antes de qualquer reserva', async () => {
    for (const u of [null, { papel: 'comprador', ativo: true }, { papel: 'admin', ativo: false }]) {
      const d = fakeDeps({ async buscarUsuario() { return u } })
      expect((await tratar({ chave: CHAVE, forma: 'boleto' }, 'x@y', d)).status).toBe(403)
      expect(d.reservas).toEqual([])
    }
  })

  it('chave ou forma inválida: 400 sem reservar', async () => {
    const d = fakeDeps()
    expect((await tratar({ chave: '123', forma: 'boleto' }, 'a@b', d)).status).toBe(400)
    expect((await tratar({ chave: CHAVE, forma: 'cheque' }, 'a@b', d)).status).toBe(400)
    expect((await tratar({ chave: CHAVE }, 'a@b', d)).status).toBe(400)
    expect(d.reservas).toEqual([])
  })

  it('outra nota lançando: 409, NÃO reserva e NÃO dispara (um robô por vez); o limite é o mesmo de 30 min', async () => {
    const chamadas: unknown[][] = []
    const d = fakeDeps({ async outraLancando(...a) { chamadas.push(a); return true } })
    const r = await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d)
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.corpo)).toContain('outra nota')
    expect(d.reservas).toEqual([])
    expect(d.disparos).toEqual([])
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0][0]).toBe(CHAVE)
    expect(new Date(chamadas[0][1] as string).getTime()).toBe(AGORA.getTime() - 30 * 60_000)
  })

  it('nota indisponível (lançada, lançando ou pela metade): 409 e NÃO dispara', async () => {
    const d = fakeDeps({ async reservar() { return null } })
    const r = await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d)
    expect(r.status).toBe(409)
    expect(d.disparos).toEqual([])
  })

  it('disparo que falha solta a reserva e devolve 502 (mesmo se soltar falhar)', async () => {
    const d = fakeDeps({ async disparar() { throw new Error('workflow_dispatch falhou (HTTP 401)') } })
    expect((await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d)).status).toBe(502)
    expect(d.soltas).toEqual([CHAVE])
    const d2 = fakeDeps({
      async disparar() { throw new Error('x') },
      async soltar() { throw new Error('banco fora') },
    })
    expect((await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d2)).status).toBe(502)
  })
})

describe('normalizarParcelas / somaParcelas (parcelas digitadas pelo Ivan)', () => {
  it('aceita 1 a 60 parcelas válidas e normaliza o valor em centavos', () => {
    expect(normalizarParcelas([{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40.5 }]))
      .toEqual([{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40.5 }])
    expect(normalizarParcelas(Array.from({ length: 60 }, () => ({ vencimento: '2026-11-05', valor: 1 })))).toHaveLength(60)
  })
  it.each([
    [null], [undefined], ['x'], [[]], [[1]], [[null]],
    [[{ vencimento: '2026-02-30', valor: 10 }]], [[{ vencimento: '05/11/2026', valor: 10 }]], [[{ valor: 10 }]],
    [[{ vencimento: '2026-11-05', valor: 0 }]], [[{ vencimento: '2026-11-05', valor: -1 }]], [[{ vencimento: '2026-11-05', valor: '10' }]],
    [[{ vencimento: '2026-11-05', valor: NaN }]], [[{ vencimento: '2026-11-05', valor: Infinity }]],
    [[{ vencimento: '2026-11-05', valor: 10.005 }]], [[{ vencimento: '2026-11-05', valor: 10_000_001 }]],
    [Array.from({ length: 61 }, () => ({ vencimento: '2026-11-05', valor: 1 }))],
  ])('recusa %j', (x) => { expect(normalizarParcelas(x)).toBeNull() })
  it('soma em centavos, sem erro de ponto flutuante', () => {
    expect(somaParcelas([{ vencimento: '2026-11-05', valor: 0.1 }, { vencimento: '2026-11-05', valor: 0.2 }])).toBe(0.3)
  })
})

describe('tratar com parcelas digitadas (boleto sem duplicatas no XML, ou XML ainda não lido — regra do Ivan de 07/10)', () => {
  const P = [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40 }]
  const nota = (over: Partial<NotaReservada> = {}) => ({ ...NOTA, valor_nf: 100, ...over })

  it('parcelas que fecham com o valor da nota e o XML sem boletos: reserva gravando as parcelas e as manda ao robô', async () => {
    const d = fakeDeps({ async reservar(...a) { return nota({ forma_pagamento: a[1] as string, parcelas_manuais: a[4] as never }) } })
    const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
    expect(r.status).toBe(202)
    expect(JSON.parse(d.disparos[0]).parcelas_manuais).toEqual(P)
  })

  it('o 5º argumento da reserva leva as parcelas normalizadas (e null quando nada foi digitado)', async () => {
    const d = fakeDeps()
    await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
    expect(d.reservas[0][4]).toEqual(P)
    const d2 = fakeDeps()
    await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d2)
    expect(d2.reservas[0][4]).toBeNull()
    expect(JSON.parse(d2.disparos[0])).not.toHaveProperty('parcelas_manuais')
  })

  it.each([['dinheiro'], ['tesouraria'], ['cartao'], ['pix:bradesco|ij']])('parcelas com a forma %s: 400, sem reservar', async (forma) => {
    const d = fakeDeps()
    const r = await tratar({ chave: CHAVE, forma, parcelas: P }, 'a@b', d)
    expect([r.status, JSON.stringify(r.corpo)]).toEqual([400, expect.stringContaining('só valem para boleto')])
    expect(d.reservas).toEqual([])
  })

  it('parcelas fora do formato: 400, sem reservar nem disparar', async () => {
    const d = fakeDeps()
    for (const parcelas of ['x', [], [{ vencimento: 'amanhã', valor: 100 }], [{ vencimento: '2026-11-05', valor: -1 }]]) {
      expect((await tratar({ chave: CHAVE, forma: 'boleto', parcelas }, 'a@b', d)).status).toBe(400)
    }
    expect(d.reservas).toEqual([])
    expect(d.disparos).toEqual([])
  })

  it('soma diferente do valor da nota: 400 e NÃO reserva', async () => {
    const d = fakeDeps()
    const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: [{ vencimento: '2026-11-05', valor: 99 }] }, 'a@b', d)
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.corpo)).toContain('não fecham com o valor da nota')
    expect(d.reservas).toEqual([])
  })

  it('XML que JÁ traz boletos: as digitadas não se aplicam (os boletos do XML prevalecem), 400 sem reservar', async () => {
    for (const parcelas of [[{ numero: '1', vencimento: '2026-12-01', valor: 100 }],
                            [{ numero: '1', vencimento: '2026-12-01', valor: 60 }, { numero: '2', vencimento: '2026-12-15', valor: 40 }]]) {
      const d = fakeDeps({ async notaParaParcelas() { return { valor_nf: 100, parcelas } } })
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
      expect([r.status, JSON.stringify(r.corpo)]).toEqual([400, expect.stringContaining('já tem boletos no XML')])
      expect(JSON.stringify(r.corpo)).toContain('os boletos do XML prevalecem')
      expect(d.reservas).toEqual([])
      expect(d.disparos).toEqual([])
    }
  })

  // Pedido do Ivan (07/10): a MAUES (pagamento semanal na quarta) mostra a quarta no app e a DATA pode ser editada, mesmo com boleto no
  // XML. Só para esse fornecedor, e só a data: quantidade e valores seguem os boletos do XML.
  describe('MAUES com boleto no XML: só a data pode mudar', () => {
    const MAUES = '37638932000174'
    const xml = [{ numero: '001', vencimento: '2026-10-08', valor: 791.2 }]
    const dMaues = (parcelasXml: unknown, cnpj: string | null = MAUES) =>
      fakeDeps({ async notaParaParcelas() { return { valor_nf: '791.20', parcelas: parcelasXml, cnpj_emitente: cnpj } } })

    it('data editada (mesma quantidade e mesmo valor do XML): aceita, reserva e manda ao robô como foi digitado', async () => {
      const d = dMaues(xml)
      const editada = [{ vencimento: '2026-10-16', valor: 791.2 }]
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: editada }, 'a@b', d)
      expect(r.status).toBe(202)
      expect(d.reservas[0][4]).toEqual(editada) // a reserva grava exatamente a data que o Ivan escolheu (e o disparo leva o que a reserva devolve)
      expect(d.disparos).toHaveLength(1)
    })

    it('aceita também a data da própria quarta, e os valores do XML em outra ordem', async () => {
      const d1 = dMaues(xml)
      expect((await tratar({ chave: CHAVE, forma: 'boleto', parcelas: [{ vencimento: '2026-10-14', valor: 791.2 }] }, 'a@b', d1)).status).toBe(202)
      const d2 = dMaues([{ numero: '1', vencimento: '2026-10-08', valor: 60 }, { numero: '2', vencimento: '2026-10-15', valor: 40 }])
      d2.notaParaParcelas = async () => ({ valor_nf: 100, parcelas: [{ vencimento: '2026-10-08', valor: 60 }, { vencimento: '2026-10-15', valor: 40 }], cnpj_emitente: MAUES })
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: [{ vencimento: '2026-10-21', valor: 40 }, { vencimento: '2026-10-14', valor: 60 }] }, 'a@b', d2)
      expect(r.status).toBe(202)
    })

    it('outra quantidade ou outro valor (mesmo somando a nota): 400 e NÃO reserva', async () => {
      for (const parcelas of [[{ vencimento: '2026-10-14', valor: 400 }, { vencimento: '2026-10-21', valor: 391.2 }],
                              [{ vencimento: '2026-10-14', valor: 791.19 }]]) {
        const d = dMaues(xml)
        const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas }, 'a@b', d)
        expect(r.status).toBe(400)
        expect(JSON.stringify(r.corpo)).toContain('só a data pode mudar')
        expect(d.reservas).toEqual([])
        expect(d.disparos).toEqual([])
      }
    })

    it('outro fornecedor (ou CNPJ desconhecido) com boleto no XML: continua recusando as digitadas', async () => {
      for (const cnpj of ['03995515011363', null]) {
        const d = dMaues(xml, cnpj)
        const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: [{ vencimento: '2026-10-16', valor: 791.2 }] }, 'a@b', d)
        expect([r.status, JSON.stringify(r.corpo)]).toEqual([400, expect.stringContaining('já tem boletos no XML')])
        expect(d.reservas).toEqual([])
      }
    })

    it('MAUES com o XML sem boletos ou por ler: vale o que foi digitado, como para qualquer fornecedor', async () => {
      for (const parcelasXml of [[], null]) {
        const d = dMaues(parcelasXml)
        expect((await tratar({ chave: CHAVE, forma: 'boleto', parcelas: [{ vencimento: '2026-10-16', valor: 791.2 }] }, 'a@b', d)).status).toBe(202)
      }
    })
  })

  // Regra do Ivan de 07/10: "quando não vier informando nada na nota, prevalece o que eu determinar no app". XML ainda não lido
  // (cot_nfe.parcelas = null) é "nada informado": as digitadas valem, desde que a soma feche com o valor da nota.
  it('regra 07/10: XML ainda NÃO lido (parcelas null) e soma que fecha: aceita, reserva com as parcelas digitadas e as manda ao robô', async () => {
    for (const parcelas of [null, undefined]) {
      const reservas: unknown[][] = []
      const d = fakeDeps({
        async notaParaParcelas() { return { valor_nf: 100, parcelas } },
        async reservar(...a) { reservas.push(a); return nota({ forma_pagamento: a[1] as string, parcelas_manuais: a[4] as never }) },
      })
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
      expect(r.status).toBe(202)
      expect(reservas).toHaveLength(1)
      expect(reservas[0][4]).toEqual(P) // o 5º argumento da reserva grava exatamente o que o Ivan digitou
      expect(JSON.parse(d.disparos[0]).parcelas_manuais).toEqual(P)
    }
  })

  it('regra 07/10: XML ainda NÃO lido (parcelas null) com soma errada: 400 sem reservar (a conferência ao centavo continua)', async () => {
    for (const valor_nf of [99, '100.01', '99.99']) {
      const d = fakeDeps({ async notaParaParcelas() { return { valor_nf, parcelas: null } } })
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
      expect([valor_nf, r.status, JSON.stringify(r.corpo)]).toEqual([valor_nf, 400, expect.stringContaining('não fecham com o valor da nota')])
      expect(d.reservas).toEqual([])
      expect(d.disparos).toEqual([])
    }
  })

  it('nota que não existe: segue para a reserva, que devolve 409', async () => {
    const d = fakeDeps({ async notaParaParcelas() { return null }, async reservar() { return null } })
    expect((await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)).status).toBe(409)
  })

  it('regra 4: 1 centavo de diferença para mais ou para menos NÃO fecha (400, sem reservar) — o robô também recusa', async () => {
    for (const valor_nf of ['100.01', '99.99']) {
      const d = fakeDeps({ async notaParaParcelas() { return { valor_nf, parcelas: [] } } })
      const r = await tratar({ chave: CHAVE, forma: 'boleto', parcelas: P }, 'a@b', d)
      expect([valor_nf, r.status, JSON.stringify(r.corpo)]).toEqual([valor_nf, 400, expect.stringContaining('não fecham com o valor da nota')])
      expect(d.reservas).toEqual([])
    }
  })

  it('regra 4: parcelas de valores diferentes que somam o valor da nota passam e vão ao robô como foram digitadas', async () => {
    const d = fakeDeps({ async notaParaParcelas() { return { valor_nf: '100.00', parcelas: [] } } })
    const parcelas = [{ vencimento: '2026-11-05', valor: 70 }, { vencimento: '2026-11-15', valor: 20.5 }, { vencimento: '2026-11-25', valor: 9.5 }]
    expect((await tratar({ chave: CHAVE, forma: 'boleto', parcelas }, 'a@b', d)).status).toBe(202)
    expect(d.reservas[0][4]).toEqual(parcelas) // o que a reserva grava (e o robô recebe) é exatamente o que o Ivan digitou, cada valor no seu lugar
  })
})

// Ação "verificar" (07/10/2026): a execução da MERCURIO travou instalando o navegador e a nota ficou "lançando" por 30 min sem explicação.
describe('verificar: o que houve com o robô de uma nota "lançando"', () => {
  const RESERVA = '2026-10-07T17:50:12.674Z'
  const AGORA_V = new Date('2026-10-07T17:58:00.000Z') // 8 min depois
  const nota = (extra: Partial<NotaEstado> = {}): NotaEstado => ({
    chave: CHAVE, numero: '002270833', situacao: 'na_fila', lancamento_estado: 'lancando', lancamento_em: RESERVA, lancada_em: null, descartada_em: null, ...extra,
  })
  const exec = (extra: Partial<Execucao> = {}): Execucao => ({
    id: 77, titulo: 'Lançar NF 002270833 (real)', status: 'completed', conclusao: 'cancelled', criada_em: '2026-10-07T17:50:14Z', ...extra,
  })
  const passos = (lancaConclusion: string | null): PassoExecucao[] => [
    { name: 'Instalar dependências e o navegador', status: 'completed', conclusion: 'cancelled' },
    { name: PASSO_QUE_LANCA, status: 'completed', conclusion: lancaConclusion },
    { name: 'Aviso de falha por e-mail', status: 'completed', conclusion: 'success' },
  ]
  function deps(over: Partial<DepsVerificar> = {}): DepsVerificar & { marcas: unknown[][] } {
    const marcas: unknown[][] = []
    return {
      marcas,
      async buscarUsuario() { return { papel: 'admin', ativo: true } },
      async estadoDaNota() { return nota() },
      async execucoesDoRobo() { return [exec()] },
      async passosDaExecucao() { return passos('skipped') },
      async marcarEstado(...a) { marcas.push(a); return true },
      agora: () => AGORA_V,
      ...over,
    }
  }
  const chamar = (d: DepsVerificar) => verificar({ chave: CHAVE, acao: 'verificar' }, 'a@b', d)
  const sit = (r: { corpo: Record<string, unknown> }) => r.corpo.situacao

  it('só o administrador verifica, e a chave tem de ser válida', async () => {
    const d = deps({ async buscarUsuario() { return { papel: 'comprador', ativo: true } } })
    expect((await chamar(d)).status).toBe(403)
    expect((await verificar({ chave: 'x' }, 'a@b', deps())).status).toBe(400)
    expect((await chamar(deps({ async estadoDaNota() { return null } }))).status).toBe(404)
  })

  it('nota que não está "lançando" (ou já lançada/descartada): nada a verificar, nada muda', async () => {
    for (const extra of [{ lancamento_estado: 'revisar' }, { lancamento_estado: null }, { lancada_em: '2026-10-07T18:00:00Z' }, { situacao: 'lancada' }, { descartada_em: '2026-10-07T18:00:00Z' }]) {
      const d = deps({ async estadoDaNota() { return nota(extra) } })
      const r = await chamar(d)
      expect([r.status, sit(r)]).toEqual([200, 'nada_a_verificar'])
      expect(d.marcas).toEqual([])
    }
  })

  it('execução cancelada com o passo que LANÇA nunca iniciado (skipped): libera a nota com a explicação (revisar)', async () => {
    const d = deps()
    const r = await chamar(d)
    const c = r.corpo as { situacao: string; mensagem: string; mudou: boolean }
    expect(c.situacao).toBe('liberada')
    expect(c.mudou).toBe(true)
    expect(c.mensagem).toContain('não chegou a começar')
    expect(c.mensagem).toContain('Nada foi criado no SisChef')
    expect(c.mensagem).toContain('foi cancelada')
    expect(d.marcas).toHaveLength(1)
    expect(d.marcas[0].slice(0, 3)).toEqual([CHAVE, 'revisar', c.mensagem])
  })

  it('execução que falhou ou estourou o tempo antes de lançar: também libera, dizendo como terminou', async () => {
    for (const [conclusao, trecho] of [['failure', 'falhou'], ['timed_out', 'estourou o tempo']] as const) {
      const r = await chamar(deps({ async execucoesDoRobo() { return [exec({ conclusao })] } }))
      expect(sit(r)).toBe('liberada')
      expect(r.corpo.mensagem as string).toContain(trecho)
    }
  })

  it('o passo que lança JÁ começou (cancelado/falhou no meio): vira "erro" — pode estar pela metade, nunca libera', async () => {
    for (const conclusao of ['cancelled', 'failure', 'success']) {
      const d = deps({ async passosDaExecucao() { return passos(conclusao) } })
      const r = await chamar(d)
      expect(sit(r)).toBe('pela_metade')
      expect(d.marcas[0].slice(0, 2)).toEqual([CHAVE, 'erro'])
      expect(r.corpo.mensagem as string).toContain('Não lance de novo')
    }
  })

  it('não achou o passo que lança (formato desconhecido): trata como "pode ter começado" (erro), nunca libera', async () => {
    const d = deps({ async passosDaExecucao() { return [{ name: 'outro passo', status: 'completed', conclusion: 'skipped' }] } })
    expect(sit(await chamar(d))).toBe('pela_metade')
    expect(d.marcas[0][1]).toBe('erro')
  })

  it('execução ainda rodando: só diz que está rodando, não muda nada', async () => {
    const d = deps({ async execucoesDoRobo() { return [exec({ status: 'in_progress', conclusao: null })] } })
    expect(sit(await chamar(d))).toBe('rodando')
    expect(d.marcas).toEqual([])
  })

  it('execução terminou bem mas a nota ainda está "lançando": avisa para conferir no SisChef, não muda nada', async () => {
    const d = deps({ async execucoesDoRobo() { return [exec({ conclusao: 'success' })] } })
    const r = await chamar(d)
    expect(sit(r)).toBe('concluida')
    expect(r.corpo.mensagem as string).toContain('Confira no SisChef')
    expect(d.marcas).toEqual([])
  })

  it('sem execução: antes de 3 min aguarda; depois diz que não achou (e não mexe na nota)', async () => {
    const semExec = { async execucoesDoRobo() { return [] as Execucao[] } }
    const cedo = deps({ ...semExec, agora: () => new Date('2026-10-07T17:51:00.000Z') })
    expect(sit(await chamar(cedo))).toBe('aguardando')
    const tarde = deps(semExec)
    expect(sit(await chamar(tarde))).toBe('sem_execucao')
    expect(tarde.marcas).toEqual([])
  })

  it('ignora a execução de OUTRA nota e a de antes da reserva (execução velha da mesma nota)', async () => {
    const outras = [
      exec({ id: 1, titulo: 'Lançar NF 000055100 (real)' }),                                  // outra nota
      exec({ id: 2, criada_em: '2026-10-07T16:00:00Z' }),                                      // mesma nota, mas de antes desta reserva
      exec({ id: 3, titulo: 'Lançar NF-e de compra (nuvem)' }),                                // execução antiga, sem número no nome
    ]
    const d = deps({ async execucoesDoRobo() { return outras } })
    expect(sit(await chamar(d))).toBe('sem_execucao')
    expect(d.marcas).toEqual([])
  })

  it('com duas execuções da mesma nota vale a mais recente', async () => {
    const d = deps({ async execucoesDoRobo() {
      return [exec({ id: 9, status: 'in_progress', conclusao: null, criada_em: '2026-10-07T17:55:00Z' }), exec({ id: 8 })]
    } })
    expect(sit(await chamar(d))).toBe('rodando')
  })

  it('o GitHub não responde: 502 e nada muda', async () => {
    const d = deps({ async execucoesDoRobo() { throw new Error('HTTP 403') } })
    expect((await chamar(d)).status).toBe(502)
    expect(d.marcas).toEqual([])
    const d2 = deps({ async passosDaExecucao() { throw new Error('HTTP 500') } })
    expect((await chamar(d2)).status).toBe(502)
    expect(d2.marcas).toEqual([])
  })

  it('o robô avisou o resultado no meio da conferência (compara-e-troca falhou): não sobrescreve', async () => {
    const d = deps({ async marcarEstado() { return false } })
    const r = await chamar(d)
    const c = r.corpo as { situacao: string; mudou: boolean; mensagem: string }
    expect([c.situacao, c.mudou]).toEqual(['liberada', false])
    expect(c.mensagem).toContain('já mudou de estado')
  })
})

describe('frete da nota (pedido do Ivan, 09/10): só forma o preço do produto, nunca o financeiro', () => {
  it('normalizarFrete: ausente/null = sem frete; valor > 0 com 2 casas e tipo do SisChef; o resto é inválido', () => {
    expect(normalizarFrete(undefined)).toBeNull()
    expect(normalizarFrete(null)).toBeNull()
    expect(normalizarFrete({ valor: 300, tipo: '1' })).toEqual({ valor: 300, tipo: '1' })
    expect(normalizarFrete({ valor: 12.5, tipo: '2' })).toEqual({ valor: 12.5, tipo: '2' })
    for (const ruim of [{ valor: 0, tipo: '1' }, { valor: -5, tipo: '1' }, { valor: 10.123, tipo: '1' }, { valor: '300', tipo: '1' }, { valor: 300, tipo: '7' }, { valor: 300 }, { valor: 2_000_000, tipo: '1' }, 'frete', 5]) {
      expect(normalizarFrete(ruim)).toBe('invalido')
    }
  })
  it('o frete confirmado vai ao 6º argumento da reserva e ao nota_json do robô; sem frete = null e o json não tem a chave', async () => {
    const d = fakeDeps({ async reservar(...a) { d.reservas.push(a); return { ...NOTA, forma_pagamento: a[1] as string, frete_valor: (a[5] as { valor: number } | null)?.valor ?? null, frete_tipo: (a[5] as { tipo: string } | null)?.tipo ?? null } } })
    const r = await tratar({ chave: CHAVE, forma: 'boleto', frete: { valor: 300, tipo: '1' } }, 'a@b', d)
    expect(r.status).toBe(202)
    expect(d.reservas[0][5]).toEqual({ valor: 300, tipo: '1' })
    expect(JSON.parse(d.disparos[0]).frete).toEqual({ valor: 300, tipo: '1' })
    const d2 = fakeDeps()
    await tratar({ chave: CHAVE, forma: 'boleto' }, 'a@b', d2)
    expect(d2.reservas[0][5]).toBeNull()
    expect(JSON.parse(d2.disparos[0])).not.toHaveProperty('frete')
  })
  it('frete inválido: 400 sem reservar nem disparar', async () => {
    const d = fakeDeps()
    const r = await tratar({ chave: CHAVE, forma: 'boleto', frete: { valor: 0, tipo: '1' } }, 'a@b', d)
    expect(r.status).toBe(400)
    expect(String(r.corpo.erro)).toMatch(/frete/)
    expect(d.reservas).toEqual([])
    expect(d.disparos).toEqual([])
  })
  it('o frete não muda o valor da nota nem as parcelas que o robô recebe (financeiro intacto)', () => {
    const json = JSON.parse(montarNotaJson({ ...NOTA, frete_valor: 300, frete_tipo: '1' }))
    expect(json.valor_nf).toBe(NOTA.valor_nf)
    expect(json.frete).toEqual({ valor: 300, tipo: '1' })
  })
})
