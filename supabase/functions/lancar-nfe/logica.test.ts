import { CONTAS_PIX, filtroReservavel, montarNotaJson, normalizarForma, tratar, type Deps, type NotaReservada } from './logica'

const CHAVE = '15261002164629000100550010014159761121141360'
const AGORA = new Date('2026-10-06T12:00:00.000Z')
const NOTA: NotaReservada = {
  chave: CHAVE, emitente: 'OLINDA DISTRI E COM DE ALIMENTOS LTDA', numero: '001415976', emissao: '2026-10-03',
  valor_nf: '1516.05', forma_pagamento: 'boleto',
  itens: [{ descricao: 'CÓD. FOR: 563731 REQ. CREAM CHEESE - INSUMOS', produto_id: '3469783', associacao: 'sischef',
            qtd: 30, unidade_sischef: 'KG' }],
}

function fakeDeps(over: Partial<Deps> = {}): Deps & { reservas: unknown[][]; disparos: string[]; soltas: string[] } {
  const reservas: unknown[][] = []
  const disparos: string[] = []
  const soltas: string[] = []
  return {
    reservas, disparos, soltas,
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async reservar(...a) { reservas.push(a); return { ...NOTA, forma_pagamento: a[1] as string } },
    async outraLancando() { return false },
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
  it('leva a forma escolhida e os itens com produto/associação', () => {
    const n = JSON.parse(montarNotaJson(NOTA))
    expect(n).toMatchObject({ chave: CHAVE, numero: '001415976', emissao: '2026-10-03', forma_pagamento: 'boleto' })
    expect(n.itens[0]).toEqual({ descricao: NOTA.itens![0].descricao, produto_id: '3469783', associacao: 'sischef',
                                 qtd: 30, unidade_sischef: 'KG' })
  })
})

describe('tratar (o "Lançar" de uma nota)', () => {
  it('admin + forma válida: reserva com a trava de 30 min, dispara e devolve 202', async () => {
    const d = fakeDeps()
    const r = await tratar({ chave: CHAVE, forma: 'PIX:Bradesco|IJ' }, 'Ivan@Spazio.com ', d)
    expect(r).toEqual({ status: 202, corpo: { ok: true, chave: CHAVE, forma: 'pix:bradesco|ij' } })
    expect(d.reservas).toEqual([[CHAVE, 'pix:bradesco|ij', '2026-10-06T12:00:00.000Z', '2026-10-06T11:30:00.000Z']])
    expect(JSON.parse(d.disparos[0]).forma_pagamento).toBe('pix:bradesco|ij')
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
