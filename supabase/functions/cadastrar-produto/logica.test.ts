import { vi } from 'vitest'
import { GRUPOS_DE_INSUMO as GRUPOS_DO_APP, chaveDoNome as chaveDoApp } from '../../../src/admin/produtoRegras'
import { GRUPOS_DE_INSUMO, chaveDoNome, tratar, type Concluido, type Corpo, type Deps, type PedidoNovo } from './logica'

const CORPO: Corpo = { descricao: ' MAIONESE  HELLMANNS 3KG - INSUMOS ', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', origem_item: 3 }
const CHAVE = 'maionese hellmanns 3kg insumos'
// os prazos são conferidos pelos NÚMEROS (20 e 3 minutos), nunca pelas constantes do código: um prazo trocado por engano tem de quebrar o teste
const AGORA = new Date('2026-10-14T15:00:00Z')
const haMinutos = (min: number, seg = 0) => new Date(AGORA.getTime() - min * 60_000 - seg * 1000).toISOString()

function fakeDeps(over: Partial<Deps> & { usuario?: { papel: string; ativo: boolean } | null; concluido?: Concluido | null } = {}) {
  const reg = { pedidos: [] as PedidoNovo[], disparos: [] as string[], revisar: [] as string[][], expirados: [] as [string, number][], ordem: [] as string[] }
  const deps: Deps = {
    buscarUsuario: async () => (over.usuario === undefined ? { papel: 'admin', ativo: true } : over.usuario),
    ultimoConcluido: async () => (over.concluido === undefined ? null : over.concluido),
    expirarPresos: async (chave, min) => { reg.ordem.push('expirar'); reg.expirados.push([chave, min]) },
    criarPedido: async (p) => { reg.ordem.push('criar'); reg.pedidos.push(p); return { id: 'prod-1' } },
    situacaoDoPedido: async () => null,
    reservarReenvio: async () => true,
    dispararCadastro: async (id) => { reg.disparos.push(id) },
    marcarRevisar: async (id, m) => { reg.revisar.push([id, m]) },
    ...over,
  }
  return { deps, reg }
}

describe('cadastrar-produto — chave e lista de grupos', () => {
  it('a chave do nome é a mesma no app e na função (sem acento, minúsculas, só letras e números)', () => {
    for (const n of ['MAIONESE  HELLMANNS 3KG - INSUMOS', 'Açúcar Cristal 1Kg (União) - INSUMOS', 'ÓLEO D\'ÁGUA / 900ml']) expect(chaveDoNome(n)).toBe(chaveDoApp(n))
    expect(chaveDoNome('MAIONESE HELLMANNS 3KG - INSUMOS')).toBe(CHAVE)
    expect(chaveDoNome('Açúcar Cristal 1Kg (União)')).toBe('acucar cristal 1kg uniao')
  })
  it('a lista de grupos da função é igual à do app', () => {
    expect(GRUPOS_DE_INSUMO).toEqual(GRUPOS_DO_APP)
    expect(GRUPOS_DE_INSUMO).toHaveLength(28)
  })
})

describe('cadastrar-produto — tratar', () => {
  it('caminho feliz: normaliza, grava o pedido (com origem e chave) e dispara o robô uma vez', async () => {
    const { deps, reg } = fakeDeps()
    const r = await tratar(CORPO, 'Ivan@Spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'prod-1', chave_nome: CHAVE })
    expect(reg.pedidos).toEqual([{ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', chave_nome: CHAVE, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', origem_item: 3, forcar: false, existente_id: null, criado_por: 'ivan@spazio.com' }])
    expect(reg.disparos).toEqual(['prod-1'])
  })
  it('pedido preso há mais de 20 minutos é dado como perdido ANTES de gravar o novo', async () => {
    const { deps, reg } = fakeDeps()
    await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(reg.expirados).toEqual([[CHAVE, 20]])
    expect(reg.ordem).toEqual(['expirar', 'criar'])
  })
  it('F-M4: o prazo de "preso" é de 20 minutos: parado há 21 min é dado como perdido e um novo é gravado e disparado; há 19 min segue em andamento', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AGORA)
    try {
      for (const [minutos, perdido] of [[21, true], [19, false]] as const) {
        // o pedido do mesmo nome, parado há `minutos`; o falso expira como o index.ts (atualizado_em < agora − minutos) e o índice de "um por vez" o vê
        const preso = { estado: 'PROCESSANDO', atualizado_em: haMinutos(minutos), ultimo_disparo_em: haMinutos(minutos) }
        const { deps, reg } = fakeDeps({
          expirarPresos: async (_chave, min) => { if (Date.parse(preso.atualizado_em) < Date.now() - min * 60_000) preso.estado = 'REVISAR' },
          criarPedido: async () => (preso.estado === 'PROCESSANDO' ? { id: 'velho-1', duplicado: true } : { id: 'novo-1' }),
          situacaoDoPedido: async () => preso,
        })
        const r = await tratar(CORPO, 'ivan@spazio.com', deps)
        expect([minutos, preso.estado, r.corpo.cadastro_id, reg.disparos]).toEqual(perdido ? [21, 'REVISAR', 'novo-1', ['novo-1']] : [19, 'PROCESSANDO', 'velho-1', []])
      }
    } finally {
      vi.useRealTimers()
    }
  })
  it('campos opcionais ausentes viram null (palavras, origem_id, origem_item)', async () => {
    const { deps, reg } = fakeDeps()
    await tratar({ descricao: 'X', grupo: 'ESTOQUE CONTROLADO', unidade: 'UN', origem: 'avulsa' }, 'ivan@spazio.com', deps)
    expect(reg.pedidos[0]).toMatchObject({ palavras: null, origem_id: null, origem_item: null, forcar: false, existente_id: null, unidade: 'UN', origem: 'avulsa' })
  })
  it('"Usar este" (existente_id) e "Criar mesmo assim" (forcar) vão no pedido', async () => {
    const a = fakeDeps(); await tratar({ ...CORPO, existente_id: 3469720 }, 'ivan@spazio.com', a.deps)
    expect(a.reg.pedidos[0]).toMatchObject({ existente_id: 3469720, forcar: false })
    const b = fakeDeps(); await tratar({ ...CORPO, forcar: true }, 'ivan@spazio.com', b.deps)
    expect(b.reg.pedidos[0]).toMatchObject({ forcar: true, existente_id: null })
  })
  it('só o admin cadastra (403) e nada é gravado nem disparado', async () => {
    for (const usuario of [{ papel: 'comprador', ativo: true }, { papel: 'admin', ativo: false }, null]) {
      const { deps, reg } = fakeDeps({ usuario })
      expect((await tratar(CORPO, 'joao@spazio.com', deps)).status).toBe(403)
      expect(reg.pedidos).toEqual([])
      expect(reg.disparos).toEqual([])
    }
  })
  it.each([
    ['nome vazio', { descricao: '   ' }],
    ['nome só com símbolos', { descricao: '- / -' }],
    ['nome gigante', { descricao: 'x'.repeat(201) }],
    ['grupo fora da lista', { grupo: 'BEBIDAS' }],
    ['grupo vazio', { grupo: '' }],
    ['unidade PCT (a lista do app só aceita KG ou UN)', { unidade: 'PCT' }],
    ['unidade em minúscula', { unidade: 'kg' }],
    ['palavras gigantes', { palavras: 'a'.repeat(501) }],
    ['origem desconhecida', { origem: 'outra' }],
    ['origem sem valor', { origem: undefined }],
    ['origem_id gigante', { origem_id: 'x'.repeat(81) }],
    ['item negativo', { origem_item: -1 }],
    ['item quebrado', { origem_item: 1.5 }],
    ['item acima do maior integer do banco (M8)', { origem_item: 2147483648 }],
    ['item acima de 2^53 (M8)', { origem_item: 2 ** 53 }],
    ['existente_id zero', { existente_id: 0 }],
    ['existente_id texto', { existente_id: '3469720' }],
    ['existente_id acima de 2^53, que o JavaScript não guarda exato (M8)', { existente_id: 2 ** 53 }],
    ['existente_id gigante (M8)', { existente_id: 1e20 }],
    ['forcar texto', { forcar: 'sim' }],
  ])('recusa %s (400) sem gravar nada', async (_n, mudanca) => {
    const { deps, reg } = fakeDeps()
    const r = await tratar({ ...CORPO, ...mudanca } as Corpo, 'ivan@spazio.com', deps)
    expect(r.status).toBe(400)
    expect(typeof r.corpo.erro).toBe('string')
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
    expect(reg.expirados).toEqual([])
  })
  it('M8: os maiores números aceitos passam: item 2147483647 (o maior integer do banco) e código 2^53 − 1', async () => {
    const { deps, reg } = fakeDeps()
    expect((await tratar({ ...CORPO, origem_item: 2147483647, existente_id: 2 ** 53 - 1 }, 'ivan@spazio.com', deps)).status).toBe(200)
    expect(reg.pedidos[0]).toMatchObject({ origem_item: 2147483647, existente_id: 9007199254740991 })
  })
  it('já cadastrado com este nome: devolve o pedido feito, sem gravar nem disparar; "forcar" ou "existente_id" ignoram isso', async () => {
    const concluido: Concluido = { id: 'velho-1', estado: 'CADASTRADO', produto_id: 3924999 }
    const a = fakeDeps({ concluido })
    const r = await tratar(CORPO, 'ivan@spazio.com', a.deps)
    expect(r).toEqual({ status: 200, corpo: expect.objectContaining({ cadastro_id: 'velho-1', ja_cadastrado: true, estado: 'CADASTRADO', produto_id: 3924999 }) })
    expect(a.reg.pedidos).toEqual([])
    expect(a.reg.disparos).toEqual([])
    const b = fakeDeps({ concluido }); await tratar({ ...CORPO, forcar: true }, 'ivan@spazio.com', b.deps)
    expect(b.reg.pedidos).toHaveLength(1)
    const c = fakeDeps({ concluido }); await tratar({ ...CORPO, existente_id: 5 }, 'ivan@spazio.com', c.deps)
    expect(c.reg.pedidos).toHaveLength(1)
  })
  it('pedido em andamento para o mesmo nome (o robô está nele): devolve o existente e NÃO dispara de novo', async () => {
    const { deps, reg } = fakeDeps({
      criarPedido: async () => ({ id: 'andando-1', duplicado: true }),
      situacaoDoPedido: async () => ({ estado: 'PROCESSANDO', atualizado_em: haMinutos(10), ultimo_disparo_em: haMinutos(10) }),
    })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false })
    expect(reg.disparos).toEqual([])
  })
  it('M8: corrida do índice de "um por vez" (o pedido em andamento terminou antes de ser lido): 409 com texto em português, nada disparado nem marcado', async () => {
    const { deps, reg } = fakeDeps({ criarPedido: async () => ({ corrida: true }) })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r).toEqual({ status: 409, corpo: { erro: 'outro pedido deste mesmo produto acabou de terminar: toque de novo para ver o resultado', chave_nome: CHAVE } })
    expect(reg.disparos).toEqual([])
    expect(reg.revisar).toEqual([])
  })
  it('se o disparo falhar, o pedido vira REVISAR com o aviso e a resposta é 502 (com o id, para a tela acompanhar)', async () => {
    const { deps, reg } = fakeDeps({ dispararCadastro: async () => { throw new Error('GitHub fora do ar') } })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(502)
    expect(r.corpo).toMatchObject({ cadastro_id: 'prod-1', chave_nome: CHAVE })
    expect(reg.revisar).toHaveLength(1)
    expect(reg.revisar[0][0]).toBe('prod-1')
  })
  it('se até o "marcar REVISAR" falhar, ainda responde 502 (não explode)', async () => {
    const { deps } = fakeDeps({ dispararCadastro: async () => { throw new Error('x') }, marcarRevisar: async () => { throw new Error('y') } })
    expect((await tratar(CORPO, 'ivan@spazio.com', deps)).status).toBe(502)
  })
})

describe('cadastrar-produto — pedido do mesmo nome parado na fila (C3: chamar o robô de novo; D3: no máximo 1 disparo a cada 3 min)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA) })
  afterEach(() => { vi.useRealTimers() })
  /**
   * Já há um pedido em andamento para o nome (o índice de "um por vez" devolve o existente), no `estado` e com as horas dadas (sem `ultimo`, o último
   * disparo é o da criação do pedido). A reserva do falso faz o que o index.ts faz num UPDATE só: ainda PENDENTE e último disparo há mais de `minutos`.
   * `passos` guarda a ordem: reservar, depois disparar.
   */
  function emAndamento(estado: string, atualizado_em: string, over: Partial<Deps> = {}, ultimo_disparo_em = atualizado_em) {
    const pedido = { estado, atualizado_em, ultimo_disparo_em }
    const passos: string[] = []
    const reservas: [string, number][] = []
    const { deps, reg } = fakeDeps({
      criarPedido: async () => ({ id: 'andando-1', duplicado: true }),
      situacaoDoPedido: async (id) => (id === 'andando-1' ? { ...pedido } : null),
      reservarReenvio: async (id, min) => {
        passos.push('reservar'); reservas.push([id, min])
        if (pedido.estado !== 'PENDENTE' || !(Date.parse(pedido.ultimo_disparo_em) < Date.now() - min * 60_000)) return false
        pedido.ultimo_disparo_em = new Date(Date.now()).toISOString()
        return true
      },
      dispararCadastro: async (id) => { passos.push(`disparar ${id}`) },
      ...over,
    })
    return { deps, reg, pedido, passos, reservas }
  }
  const disparos = (passos: string[]) => passos.filter((p) => p.startsWith('disparar'))

  it('PENDENTE e sem disparo há mais de 3 minutos (o run se perdeu na fila): reserva o intervalo e SÓ DEPOIS dispara de novo o MESMO pedido; reenviado:true', async () => {
    const { deps, reg, pedido, passos, reservas } = emAndamento('PENDENTE', haMinutos(3, 1))
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r).toEqual({ status: 200, corpo: expect.objectContaining({ cadastro_id: 'andando-1', chave_nome: CHAVE, em_andamento: true, reenviado: true }) })
    expect(passos).toEqual(['reservar', 'disparar andando-1'])
    expect(reservas).toEqual([['andando-1', 3]])
    expect(pedido).toEqual({ estado: 'PENDENTE', atualizado_em: haMinutos(3, 1), ultimo_disparo_em: AGORA.toISOString() })   // a hora do pedido não muda
    expect(reg.pedidos).toEqual([])
    expect(reg.revisar).toEqual([])
  })

  it('PENDENTE há 3 minutos ou menos, ou PROCESSANDO (o robô já está nele): nem reserva nem dispara; reenviado:false', async () => {
    for (const [estado, quando] of [['PENDENTE', haMinutos(2, 59)], ['PENDENTE', haMinutos(3)], ['PROCESSANDO', haMinutos(1)], ['PROCESSANDO', haMinutos(15)]]) {
      const { deps, passos } = emAndamento(estado, quando)
      const r = await tratar(CORPO, 'ivan@spazio.com', deps)
      expect([estado, quando, r.status, r.corpo.em_andamento, r.corpo.reenviado, passos]).toEqual([estado, quando, 200, true, false, []])
    }
  })

  it('D3: pedido PENDENTE há 5 min, mas o último disparo foi há 1 min (ou há 3 min exatos): NÃO reenvia; o último disparo há 4 min (ou 3 min e 1 s): reenvia', async () => {
    for (const [ultimo, reenvia] of [[haMinutos(1), false], [haMinutos(3), false], [haMinutos(4), true], [haMinutos(3, 1), true]] as const) {
      const { deps, passos } = emAndamento('PENDENTE', haMinutos(5), {}, ultimo)
      const r = await tratar(CORPO, 'ivan@spazio.com', deps)
      // disparo recente: nem a reserva é tentada (nada é escrito no banco a cada toque)
      expect([ultimo, r.corpo.reenviado, passos]).toEqual([ultimo, reenvia, reenvia ? ['reservar', 'disparar andando-1'] : []])
    }
  })

  it('D3: dois toques seguidos, ou dois ao mesmo tempo, num pedido parado há 10 min: o robô é chamado UMA vez só', async () => {
    const seguidos = emAndamento('PENDENTE', haMinutos(10))
    const primeiro = await tratar(CORPO, 'ivan@spazio.com', seguidos.deps)
    const segundo = await tratar(CORPO, 'ivan@spazio.com', seguidos.deps)
    expect([primeiro.corpo.reenviado, segundo.corpo.reenviado]).toEqual([true, false])
    expect(seguidos.passos).toEqual(['reservar', 'disparar andando-1'])   // o 2º toque já lê o disparo de agora: nem tenta reservar
    // ao mesmo tempo: os dois leem a mesma situação; só a reserva decide quem chama o robô
    const juntos = emAndamento('PENDENTE', haMinutos(10))
    const rs = await Promise.all([tratar(CORPO, 'ivan@spazio.com', juntos.deps), tratar(CORPO, 'ivan@spazio.com', juntos.deps)])
    expect(rs.map((r) => r.corpo.reenviado).sort()).toEqual([false, true])
    expect(disparos(juntos.passos)).toEqual(['disparar andando-1'])
  })

  it('o novo disparo falha DEPOIS da reserva: 200 com reenviado:false, nada de REVISAR, e o intervalo fica reservado (o toque seguinte não martela a fila)', async () => {
    const tentativas: string[] = []
    const { deps, reg, pedido } = emAndamento('PENDENTE', haMinutos(10), { dispararCadastro: async (id) => { tentativas.push(id); throw new Error('GitHub fora do ar') } })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r).toEqual({ status: 200, corpo: expect.objectContaining({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false }) })
    expect(pedido.ultimo_disparo_em).toBe(AGORA.toISOString())
    expect((await tratar(CORPO, 'ivan@spazio.com', deps)).corpo.reenviado).toBe(false)
    expect(tentativas).toEqual(['andando-1'])
    expect(reg.revisar).toEqual([])
  })

  it('a reserva não acontece (o robô acabou de pegar o pedido, ou outro toque reservou antes) ou falha; a situação não é lida; hora ilegível: não dispara; reenviado:false, sem REVISAR', async () => {
    const casos = [
      emAndamento('PENDENTE', haMinutos(10), { reservarReenvio: async () => false }),
      emAndamento('PENDENTE', haMinutos(10), { reservarReenvio: async () => { throw new Error('banco fora do ar') } }),
      emAndamento('PENDENTE', haMinutos(10), { situacaoDoPedido: async () => { throw new Error('banco fora do ar') } }),
      emAndamento('PENDENTE', haMinutos(10), { situacaoDoPedido: async () => null }),
      emAndamento('PENDENTE', 'não é uma data'),
      emAndamento('PENDENTE', haMinutos(10), {}, 'não é uma data'),
    ]
    for (const { deps, reg, passos } of casos) {
      const r = await tratar(CORPO, 'ivan@spazio.com', deps)
      expect(r).toEqual({ status: 200, corpo: expect.objectContaining({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false }) })
      expect(disparos(passos)).toEqual([])
      expect(reg.revisar).toEqual([])
      expect(reg.pedidos).toEqual([])
    }
  })
})
