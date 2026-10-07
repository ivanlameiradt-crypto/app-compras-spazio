import { CONTAS_PIX, filtroReservavel, montarNotaJson, normalizarForma, normalizarParcelas, somaParcelas, tratar, type Deps, type NotaReservada } from './logica'

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
    expect(d.reservas).toEqual([[CHAVE, 'pix:bradesco|ij', '2026-10-06T12:00:00.000Z', '2026-10-06T11:30:00.000Z', null]])
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
