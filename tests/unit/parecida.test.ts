import {
  JANELA_DIAS, REPETIDA_PREFIXO, acharParecidas, acrescentarTrecho, fraseDaRepetida, impressaoDaCompra, ioDoSupabase, semTrechoDaRepetida, trechoDaRepetida,
  type IoParecidas, type LinhaCupom, type LinhaNota,
} from '../../supabase/functions/enviar-cupom/parecida.ts'

// E5 (compra repetida nos 3 tipos, pedido do Ivan de 04/11/2026): a "impressão digital" de uma compra (CNPJ + total em centavos), a procura de compras parecidas já lançadas (cupom, compra
// avulsa e nota fiscal) e a frase em português simples que o app mostra. Função pura: o banco entra por `io`. Cópia idêntica em enviar-cupom, confirmar-cupom e enviar-compra-avulsa.

const AGORA = new Date('2026-11-05T05:00:00Z')                    // 02h de 05/11 em Belém
const CNPJ = '75315333000109'
const cupomLinha = (o: Partial<LinhaCupom> = {}): LinhaCupom => ({
  id: 'c1', estado: 'LANCADO', origem: 'cupom', emitente_cnpj: CNPJ, valor_a_pagar: 119.9, pedido_sischef: '163377089', motivo: null, criado_em: '2026-10-03T18:04:00Z', teste: false, ...o,
})
const notaLinha = (o: Partial<LinhaNota> = {}): LinhaNota => ({
  chave: '3'.repeat(44), cnpj_emitente: CNPJ, numero: '000112786', emissao: '2026-10-16', valor_nf: 119.9, situacao: 'lancada', lancamento_estado: null, nf_sischef: '4410', descartada_em: null, ...o,
})
function falso(cupons: LinhaCupom[] = [], notas: LinhaNota[] = []) {
  const chamadas = { cupons: [] as unknown[][], notas: [] as unknown[][] }
  const io: IoParecidas = {
    async cupons(...a) { chamadas.cupons.push(a); return cupons },
    async notas(...a) { chamadas.notas.push(a); return notas },
  }
  return { io, chamadas }
}
const IMP = { cnpj: CNPJ, centavos: 11990 }

describe('impressaoDaCompra (CNPJ + total em centavos; sem um dos dois não há o que comparar)', () => {
  it('CNPJ de 14 dígitos e total em reais viram CNPJ + centavos INTEIROS (sem erro de ponto flutuante)', () => {
    expect(impressaoDaCompra('63540861000182', 472.82)).toEqual({ cnpj: '63540861000182', centavos: 47282 })
    expect(impressaoDaCompra(CNPJ, 4.58)).toEqual({ cnpj: CNPJ, centavos: 458 })           // 4,58 × 100 = 458,00000000000006
    expect(impressaoDaCompra(CNPJ, 1291.3)).toEqual({ cnpj: CNPJ, centavos: 129130 })
    expect(impressaoDaCompra(CNPJ, '119.90')).toEqual({ cnpj: CNPJ, centavos: 11990 })     // numeric do banco pode chegar como texto
  })
  it('o CNPJ com pontuação vale (só os dígitos); com menos ou mais de 14 dígitos, ou vazio, não há impressão digital', () => {
    expect(impressaoDaCompra('75.315.333/0001-09', 10)).toEqual({ cnpj: CNPJ, centavos: 1000 })
    for (const ruim of [null, undefined, '', '1234', '7531533300010', '753153330001090', 'abc']) expect(impressaoDaCompra(ruim, 10)).toBeNull()
  })
  it('total zero, negativo, vazio ou que não é número: sem impressão digital (o REVISAR sem total é gravado com 0 e não pode casar com outro 0)', () => {
    for (const ruim of [0, -5, null, undefined, '', 'abc', NaN, Infinity]) expect(impressaoDaCompra(CNPJ, ruim)).toBeNull()
  })
})

describe('acharParecidas (o que já existe do mesmo fornecedor, com o mesmo total, nos últimos 45 dias)', () => {
  it('a janela é de 45 dias e a procura leva o CNPJ e o começo da janela (cupom: instante; nota: dia de Belém)', async () => {
    expect(JANELA_DIAS).toBe(45)
    const { io, chamadas } = falso()
    await acharParecidas(io, IMP, { agora: AGORA })
    expect(chamadas.cupons).toEqual([[CNPJ, '2026-09-21T05:00:00.000Z']])      // 05/11 02h Belém − 45 dias (21/09)
    expect(chamadas.notas).toEqual([[CNPJ, '2026-09-21']])
  })
  it('cupom lançado do mesmo CNPJ e do mesmo total: achado, com o que a frase precisa', async () => {
    const { io } = falso([cupomLinha()])
    expect(await acharParecidas(io, IMP, { agora: AGORA })).toEqual([
      { tipo: 'cupom', id: 'c1', estado: 'LANCADO', quando: '2026-10-03T18:04:00Z', centavos: 11990, pedido: '163377089', numero: null, motivo: null },
    ])
  })
  it('compra avulsa também conta (origem avulsa) e o numeric que vem como texto vale', async () => {
    const { io } = falso([cupomLinha({ id: 'a1', origem: 'avulsa', estado: 'PENDENTE', valor_a_pagar: '119.90' as unknown as number, pedido_sischef: null })])
    const r = await acharParecidas(io, IMP, { agora: AGORA })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tipo: 'avulsa', id: 'a1', estado: 'PENDENTE', centavos: 11990 })
  })
  it('total diferente (até por 1 centavo) não é a mesma compra', async () => {
    const { io } = falso([cupomLinha({ valor_a_pagar: 119.91 }), cupomLinha({ id: 'c3', valor_a_pagar: 119.89 })])
    expect(await acharParecidas(io, IMP, { agora: AGORA })).toEqual([])
  })
  it('estados que contam: LANCADO, PENDENTE, PROCESSANDO e REVISAR que PODE já estar no SisChef (o cupomLinha de teste traz pedido); nunca EXCLUIDO nem TESTE', async () => {
    const linhas = ['LANCADO', 'PENDENTE', 'PROCESSANDO', 'REVISAR', 'EXCLUIDO', 'TESTE'].map((estado, i) => cupomLinha({ id: `c${i}`, estado }))
    const r = await acharParecidas(falso(linhas).io, IMP, { agora: AGORA })
    expect(r.map((x) => x.estado).sort()).toEqual(['LANCADO', 'PENDENTE', 'PROCESSANDO', 'REVISAR'])
  })
  it('REVISAR comum ("esperando você": sem pedido e sem "parou no meio") NÃO conta: duas cópias esperando o Ivan não se acusam; REVISAR com pedido ou parado no meio do SisChef conta', async () => {
    const linhas = [
      cupomLinha({ id: 'comum', estado: 'REVISAR', pedido_sischef: null, motivo: '3 item(ns) sem casamento confirmado — confira no Code' }),
      cupomLinha({ id: 'sem-motivo', estado: 'REVISAR', pedido_sischef: null, motivo: null }),
      cupomLinha({ id: 'aviso', estado: 'REVISAR', pedido_sischef: null, motivo: 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 1,00): x' }),
      cupomLinha({ id: 'pedido', estado: 'REVISAR', pedido_sischef: '99', motivo: null }),
      cupomLinha({ id: 'meio', estado: 'REVISAR', pedido_sischef: null, motivo: 'CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO' }),
      cupomLinha({ id: 'pagto', estado: 'REVISAR', pedido_sischef: null, motivo: 'falha ao preencher o pagamento no Sischef: x' }),
    ]
    const r = await acharParecidas(falso(linhas).io, IMP, { agora: AGORA })
    expect(r.map((x) => x.id).sort()).toEqual(['meio', 'pagto', 'pedido'])
  })
  it('cupom de teste (teste = true), a própria linha (ignorarId) e CNPJ diferente nunca contam', async () => {
    const linhas = [cupomLinha({ id: 'teste', teste: true }), cupomLinha({ id: 'eu' }), cupomLinha({ id: 'outro-cnpj', emitente_cnpj: '63540861000182' }), cupomLinha({ id: 'vale' })]
    const r = await acharParecidas(falso(linhas).io, IMP, { agora: AGORA, ignorarId: 'eu' })
    expect(r.map((x) => x.id)).toEqual(['vale'])
  })
  it('a borda da janela: 45 dias atrás ainda conta; 46 dias não', async () => {
    const dentro = cupomLinha({ id: 'dentro', criado_em: '2026-09-21T05:00:00.000Z' })
    const fora = cupomLinha({ id: 'fora', criado_em: '2026-09-21T04:59:59.000Z' })
    const r = await acharParecidas(falso([dentro, fora]).io, IMP, { agora: AGORA })
    expect(r.map((x) => x.id)).toEqual(['dentro'])
  })
  it('nota fiscal: lançada, que entrou por fora (saiu_da_fila), sendo lançada e com erro no meio contam; na fila, sem lançamento, não', async () => {
    const notas = [
      notaLinha({ chave: 'n1', situacao: 'lancada' }),
      notaLinha({ chave: 'n2', situacao: 'saiu_da_fila' }),
      notaLinha({ chave: 'n3', situacao: 'na_fila', lancamento_estado: 'lancando' }),
      notaLinha({ chave: 'n4', situacao: 'na_fila', lancamento_estado: 'erro' }),
      notaLinha({ chave: 'n5', situacao: 'na_fila', lancamento_estado: null }),
      notaLinha({ chave: 'n6', situacao: 'na_fila', lancamento_estado: 'revisar' }),
      notaLinha({ chave: 'n7', situacao: 'na_fila', lancamento_estado: 'ensaio_ok' }),
    ]
    const r = await acharParecidas(falso([], notas).io, IMP, { agora: AGORA })
    expect(r.map((x) => x.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(r.every((x) => x.tipo === 'nota')).toBe(true)
  })
  it('nota descartada, de outro valor, de outro CNPJ ou fora da janela não conta; a nota traz o número e o NF do SisChef', async () => {
    const notas = [
      notaLinha({ chave: 'descartada', descartada_em: '2026-10-20T10:00:00Z' }),
      notaLinha({ chave: 'valor', valor_nf: 119.91 }),
      notaLinha({ chave: 'cnpj', cnpj_emitente: '63540861000182' }),
      notaLinha({ chave: 'velha', emissao: '2026-09-20' }),
      notaLinha({ chave: 'vale', emissao: '2026-09-21' }),
    ]
    const r = await acharParecidas(falso([], notas).io, IMP, { agora: AGORA })
    expect(r).toEqual([{ tipo: 'nota', id: 'vale', estado: 'lancada', quando: '2026-09-21', centavos: 11990, pedido: '4410', numero: '000112786', motivo: null }])
  })
  it('sem notas (comNotas: false) a procura nem consulta as notas', async () => {
    const { io, chamadas } = falso([], [notaLinha()])
    expect(await acharParecidas(io, IMP, { agora: AGORA, comNotas: false })).toEqual([])
    expect(chamadas.notas).toEqual([])
  })
  it('vem o mais recente primeiro', async () => {
    const linhas = [cupomLinha({ id: 'velho', criado_em: '2026-10-03T18:04:00Z' }), cupomLinha({ id: 'novo', criado_em: '2026-10-20T10:00:00Z' })]
    const r = await acharParecidas(falso(linhas, [notaLinha({ chave: 'nota', emissao: '2026-10-10' })]).io, IMP, { agora: AGORA })
    expect(r.map((x) => x.id)).toEqual(['novo', 'nota', 'velho'])
  })
  it('a consulta que falha NÃO vira "não achei": o erro sobe (quem chama decide)', async () => {
    const io: IoParecidas = { async cupons() { throw new Error('banco fora') }, async notas() { return [] } }
    await expect(acharParecidas(io, IMP, { agora: AGORA })).rejects.toThrow('banco fora')
  })
})

describe('fraseDaRepetida (em português simples, sempre com o prefixo que o app reconhece)', () => {
  const frase = (linhas: LinhaCupom[], notas: LinhaNota[] = [], centavos = 11990) =>
    acharParecidas(falso(linhas, notas).io, { cnpj: CNPJ, centavos }, { agora: AGORA }).then((p) => fraseDaRepetida(p, centavos))

  it('o caso do Atacadão: cupom lançado, com o pedido do SisChef e a data no horário de Belém', async () => {
    expect(await frase([cupomLinha({ criado_em: '2026-10-04T02:30:00Z' })])).toBe(   // 02h30 UTC = 23h30 de 03/10 em Belém
      'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 163377089).')
  })
  it('compra avulsa na fila e cupom que parou no meio do SisChef (o REVISAR "esperando você" não entra mais: ver o teste de estados)', async () => {
    expect(await frase([cupomLinha({ origem: 'avulsa', estado: 'PENDENTE', pedido_sischef: null, criado_em: '2026-11-04T15:00:00Z' })])).toContain('compra avulsa de 04/11, na fila para lançar.')
    expect(await frase([cupomLinha({ estado: 'REVISAR', pedido_sischef: null, motivo: 'CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO' })])).toContain('parou no meio e pode já estar no SisChef.')
    expect(await frase([cupomLinha({ estado: 'REVISAR', pedido_sischef: '99', motivo: null })])).toContain('parou no meio e pode já estar no SisChef.')
  })
  it('nota fiscal: lançada, por fora, com erro no meio e sendo lançada', async () => {
    expect(await frase([], [notaLinha({ emissao: '2026-10-16' })])).toContain('nota fiscal nº 000112786 de 16/10, lançada no SisChef.')
    expect(await frase([], [notaLinha({ situacao: 'saiu_da_fila' })])).toContain('entrou no SisChef por fora.')
    expect(await frase([], [notaLinha({ situacao: 'na_fila', lancamento_estado: 'erro' })])).toContain('ficou com erro no meio e pode já estar no SisChef.')
    expect(await frase([], [notaLinha({ situacao: 'na_fila', lancamento_estado: 'lancando' })])).toContain('sendo lançada agora.')
  })
  it('mostra até 3 compras e conta o resto ("e mais N")', async () => {
    const quatro = ['a', 'b', 'c', 'd'].map((id, i) => cupomLinha({ id, criado_em: `2026-10-0${i + 1}T18:00:00Z`, pedido_sischef: `10${i}` }))
    const f = await frase(quatro)
    expect(f.match(/cupom de/g)).toHaveLength(3)
    expect(f).toMatch(/ e mais 1\.$/)
    expect(f).toContain('(R$ 119,90)')
  })
  it('o total aparece com vírgula e as centenas sem separador, como as outras mensagens do servidor', () => {
    expect(fraseDaRepetida([{ tipo: 'cupom', id: 'x', estado: 'LANCADO', quando: '2026-10-05T13:00:00Z', centavos: 129130, pedido: '1', numero: null, motivo: null }], 129130)).toContain('(R$ 1291,30)')
  })
  it('NUNCA traz "conferir no Sischef" (o e-mail do robô trata essas palavras como alerta grave) e sempre começa pelo prefixo', async () => {
    const f = await frase([cupomLinha({ estado: 'REVISAR', pedido_sischef: null, motivo: 'CONFERIR NO SISCHEF antes de repetir' })], [notaLinha({ situacao: 'na_fila', lancamento_estado: 'erro' })])
    expect(f.startsWith(REPETIDA_PREFIXO)).toBe(true)
    expect(f.toLowerCase()).not.toContain('conferir no sischef')
  })
})

describe('o trecho no motivo (trechoDaRepetida, semTrechoDaRepetida, acrescentarTrecho)', () => {
  const FRASE = 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 1).'
  it('o prefixo é o que o app e as funções reconhecem', () => {
    expect(REPETIDA_PREFIXO).toBe('POSSÍVEL REPETIDA: ')
  })
  it('acrescenta ao FIM do motivo (depois de "; "), sem mexer no começo; sem motivo, a frase é o motivo', () => {
    expect(acrescentarTrecho(null, FRASE)).toBe(FRASE)
    expect(acrescentarTrecho('', FRASE)).toBe(FRASE)
    expect(acrescentarTrecho('CONFIRMAR: 3 item(ns) já conhecido(s) — confira e confirme no app', FRASE)).toBe(`CONFIRMAR: 3 item(ns) já conhecido(s) — confira e confirme no app; ${FRASE}`)
  })
  it('acrescentar de novo não duplica o trecho', () => {
    const uma = acrescentarTrecho('16 item(ns) sem casamento confirmado — confira no Code', FRASE)
    expect(acrescentarTrecho(uma, FRASE)).toBe(uma)
  })
  it('acha o trecho (do prefixo até o fim) e devolve o motivo sem ele', () => {
    const motivo = `CONFIRMAR: 3 item(ns) já conhecido(s) — confira e confirme no app; ${FRASE}`
    expect(trechoDaRepetida(motivo)).toBe(FRASE)
    expect(semTrechoDaRepetida(motivo)).toBe('CONFIRMAR: 3 item(ns) já conhecido(s) — confira e confirme no app')
  })
  it('motivo que é só o trecho (o do robô): sobra nada; sem trecho: tudo igual', () => {
    expect(semTrechoDaRepetida(FRASE)).toBe('')
    expect(trechoDaRepetida('16 item(ns) sem casamento confirmado — confira no Code')).toBeNull()
    expect(semTrechoDaRepetida('16 item(ns) sem casamento confirmado — confira no Code')).toBe('16 item(ns) sem casamento confirmado — confira no Code')
    expect(trechoDaRepetida(null)).toBeNull()
    expect(semTrechoDaRepetida(null)).toBe('')
    expect(trechoDaRepetida('  ')).toBeNull()
  })
})

describe('ioDoSupabase (as duas consultas: tabela, colunas e filtros certos; erro sobe)', () => {
  /** Um cliente de mentira com a mesma cara do PostgREST: registra o que foi pedido e devolve as linhas dadas. */
  function cliente(linhas: unknown[], erro: string | null = null) {
    const feito: { tabela: string; passos: [string, ...unknown[]][] }[] = []
    return {
      feito,
      c: {
        from(tabela: string) {
          const registro = { tabela, passos: [] as [string, ...unknown[]][] }
          feito.push(registro)
          const b = {
            select(x: string) { registro.passos.push(['select', x]); return b },
            eq(c: string, v: unknown) { registro.passos.push(['eq', c, v]); return b },
            in(c: string, v: unknown[]) { registro.passos.push(['in', c, v]); return b },
            gte(c: string, v: string) { registro.passos.push(['gte', c, v]); return b },
            is(c: string, v: null) { registro.passos.push(['is', c, v]); return b },
            limit(n: number) { registro.passos.push(['limit', n]); return Promise.resolve({ data: erro ? null : linhas, error: erro ? { message: erro } : null }) },
          }
          return b
        },
      },
    }
  }
  it('cupons: tabela cupom, do CNPJ, sem teste, nos estados que contam, desde o começo da janela', async () => {
    const { c, feito } = cliente([cupomLinha()])
    expect(await ioDoSupabase(c).cupons(CNPJ, '2026-09-20T05:00:00.000Z')).toEqual([cupomLinha()])
    expect(feito).toHaveLength(1)
    expect(feito[0].tabela).toBe('cupom')
    expect(feito[0].passos).toEqual(expect.arrayContaining([
      ['eq', 'emitente_cnpj', CNPJ], ['eq', 'teste', false], ['in', 'estado', ['LANCADO', 'PENDENTE', 'PROCESSANDO', 'REVISAR']], ['gte', 'criado_em', '2026-09-20T05:00:00.000Z'],
    ]))
    const colunas = String(feito[0].passos.find((p) => p[0] === 'select')?.[1])
    for (const col of ['id', 'estado', 'origem', 'emitente_cnpj', 'valor_a_pagar', 'pedido_sischef', 'motivo', 'criado_em', 'teste']) expect(colunas).toContain(col)
  })
  it('notas: tabela cot_nfe, do CNPJ, sem as descartadas, desde o dia', async () => {
    const { c, feito } = cliente([notaLinha()])
    expect(await ioDoSupabase(c).notas(CNPJ, '2026-09-20')).toEqual([notaLinha()])
    expect(feito[0].tabela).toBe('cot_nfe')
    expect(feito[0].passos).toEqual(expect.arrayContaining([['eq', 'cnpj_emitente', CNPJ], ['is', 'descartada_em', null], ['gte', 'emissao', '2026-09-20']]))
    const colunas = String(feito[0].passos.find((p) => p[0] === 'select')?.[1])
    for (const col of ['chave', 'cnpj_emitente', 'numero', 'emissao', 'valor_nf', 'situacao', 'lancamento_estado', 'nf_sischef', 'descartada_em']) expect(colunas).toContain(col)
  })
  it('erro do banco sobe como erro (nunca como lista vazia); data nulo sem erro é lista vazia', async () => {
    await expect(ioDoSupabase(cliente([], 'permissão negada').c).cupons(CNPJ, 'x')).rejects.toThrow('permissão negada')
    await expect(ioDoSupabase(cliente([], 'falhou').c).notas(CNPJ, 'x')).rejects.toThrow('falhou')
    const vazio = { from: () => ({ select: () => ({ eq: function () { return this }, in: function () { return this }, gte: function () { return this }, is: function () { return this }, limit: () => Promise.resolve({ data: null, error: null }) }) }) }
    expect(await ioDoSupabase(vazio as never).cupons(CNPJ, 'x')).toEqual([])
  })
})
