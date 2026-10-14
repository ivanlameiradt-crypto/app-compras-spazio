// Roda o index.ts de verdade (handler HTTP + logica.ts) com tudo que é do Deno/rede trocado por falsos (molde: confirmar-cupom/index.test.ts): o global
// `Deno`, o cliente do Supabase e o `fetch` do GitHub. O banco falso repete a trava de produto_cadastro conferida em Postgres real
// (tests/db/produto-cadastro.test.ts): o índice único PARCIAL "um pedido em andamento por nome" dá 23505. Aqui se prova o que a lógica pura não alcança
// (revisão nº 2, 14/10/2026): os filtros de cada consulta (o "preso há 20 min", a situação do pedido, o "marcar REVISAR"), o novo disparo do pedido parado
// na fila (C3), a corrida do índice respondida em português e o "marcar REVISAR" que nunca escreve por cima do que o robô já pegou ou terminou (M8).
import { vi } from 'vitest'

const h = vi.hoisted(() => {
  type L = Record<string, unknown>
  type Filtro = [op: 'eq' | 'in' | 'lt', coluna: string, valor: unknown]
  type Erro = { code?: string; message: string }
  const EM_ANDAMENTO = ['PENDENTE', 'PROCESSANDO']
  const banco = {
    usuarios: [] as L[],
    /** produto_cadastro */
    pedidos: [] as L[],
    tokens: {} as Record<string, string>,
    /** toda operação pedida ao banco, na ordem, com as colunas lidas e os filtros: prova o SQL de cada dep */
    operacoes: [] as { tabela: string; tipo: 'select' | 'insert' | 'update'; colunas: string | null; filtros: Filtro[]; dados?: L }[],
    /** corrida: o insert bate no índice de "um por vez", mas o pedido em andamento termina antes de ser lido */
    terminarAntesDaLeitura: false,
    proximoId: 1,
  }

  class Consulta {
    private filtros: Filtro[] = []
    private colunas: string | null = null // null = todas
    private ordem: { coluna: string; ascending: boolean } | null = null
    private limite: number | null = null
    private linhaNova: L | null = null
    private mudancas: L | null = null
    constructor(private tabela: string) {}
    select(colunas?: string) { this.colunas = colunas && colunas.trim() !== '*' ? colunas : null; return this }
    eq(coluna: string, valor: unknown) { this.filtros.push(['eq', coluna, valor]); return this }
    in(coluna: string, valores: unknown[]) { this.filtros.push(['in', coluna, valores]); return this }
    lt(coluna: string, valor: unknown) { this.filtros.push(['lt', coluna, valor]); return this }
    order(coluna: string, o?: { ascending?: boolean }) { this.ordem = { coluna, ascending: o?.ascending ?? true }; return this }
    limit(n: number) { this.limite = n; return this }
    insert(linha: L) { this.linhaNova = linha; return this }
    update(mudancas: L) { this.mudancas = mudancas; return this }

    private lista(): L[] {
      if (this.tabela === 'usuarios') return banco.usuarios
      if (this.tabela === 'produto_cadastro') return banco.pedidos
      throw new Error(`tabela ${this.tabela} não prevista no banco falso`)
    }
    private passa(l: L): boolean {
      return this.filtros.every(([op, c, v]) => (op === 'eq' ? l[c] === v
        : op === 'in' ? (v as unknown[]).includes(l[c])
          : Date.parse(String(l[c])) < Date.parse(String(v)))) // lt: só carimbo de tempo (atualizado_em) neste falso
    }
    private executar(): { data: L[] | null; error: Erro | null } {
      if (this.linhaNova) return this.inserir(this.linhaNova)
      if (this.mudancas) {
        banco.operacoes.push({ tabela: this.tabela, tipo: 'update', colunas: null, filtros: this.filtros, dados: this.mudancas })
        const alvo = this.lista().filter((l) => this.passa(l))
        for (const l of alvo) Object.assign(l, this.mudancas)
        return { data: alvo, error: null }
      }
      banco.operacoes.push({ tabela: this.tabela, tipo: 'select', colunas: this.colunas, filtros: this.filtros })
      let linhas = this.lista().filter((l) => this.passa(l))
      if (this.ordem) {
        const { coluna, ascending } = this.ordem
        linhas = [...linhas].sort((a, b) => String(a[coluna]).localeCompare(String(b[coluna])) * (ascending ? 1 : -1))
      }
      if (this.limite !== null) linhas = linhas.slice(0, this.limite)
      return { data: linhas, error: null }
    }
    private inserir(l: L): { data: L[] | null; error: Erro | null } {
      banco.operacoes.push({ tabela: this.tabela, tipo: 'insert', colunas: this.colunas, filtros: [], dados: l })
      if (this.tabela !== 'produto_cadastro') return { data: null, error: { message: `insert em ${this.tabela} não previsto no banco falso` } }
      // o índice único PARCIAL produto_cadastro_em_andamento (chave_nome) where estado in ('PENDENTE', 'PROCESSANDO')
      const andando = banco.pedidos.filter((p) => p.chave_nome === l.chave_nome && EM_ANDAMENTO.includes(String(p.estado)))
      if (andando.length > 0) {
        if (banco.terminarAntesDaLeitura) {
          banco.terminarAntesDaLeitura = false
          for (const p of andando) Object.assign(p, { estado: 'CADASTRADO', produto_id: 3924999 })
        }
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "produto_cadastro_em_andamento"' } }
      }
      const agora = new Date().toISOString()   // os defaults now() da tabela (ultimo_disparo_em é a hora do 1º disparo, logo depois do insert)
      const nova = { id: `cad-${banco.proximoId++}`, estado: 'PENDENTE', motivo: null, produto_id: null, criado_em: agora, atualizado_em: agora, ultimo_disparo_em: agora, ...l }
      banco.pedidos.push(nova)
      return { data: [nova], error: null }
    }
    /** O PostgREST devolve SÓ as colunas do select(...). */
    private resultado(): { data: L[] | null; error: Erro | null } {
      const r = this.executar()
      if (r.error || r.data === null || this.colunas === null) return r
      const cols = this.colunas.split(',').map((c) => c.trim())
      return { data: r.data.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]]))), error: null }
    }
    async single() {
      const r = this.resultado()
      if (r.error) return { data: null, error: r.error }
      return r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
    }
    async maybeSingle() { const r = this.resultado(); return { data: r.data ? (r.data[0] ?? null) : null, error: r.error } }
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(this.resultado()).then(resolve, reject) }
  }

  const admin = {
    auth: {
      async getUser(token: string) {
        const email = banco.tokens[token]
        return email ? { data: { user: { email } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
    },
    from: (tabela: string) => new Consulta(tabela),
  }
  return { banco, admin }
})

vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: () => h.admin }))

const ORIGEM = 'https://ivanlameiradt-crypto.github.io'
const PAT = 'github_pat_SEGREDO_NAO_VAZAR'
const CHAVE_SERVICO = 'service-role-SEGREDO_NAO_VAZAR'
const URL_DISPARO = 'https://api.github.com/repos/ivanlameiradt-crypto/sischef-monitor-notas/actions/workflows/cadastrar-produto.yml/dispatches'
const CORPO = { descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', origem_item: 3 }
const CHAVE = 'maionese hellmanns 3kg insumos'
const AVISO_DISPARO = 'o pedido foi gravado, mas não consegui chamar o robô agora: tente de novo em instantes'
// os prazos são conferidos pelos NÚMEROS (20 e 3 minutos), nunca pelas constantes do código
const AGORA = new Date('2026-10-14T15:00:00Z')
const haMinutos = (min: number, seg = 0) => new Date(AGORA.getTime() - min * 60_000 - seg * 1000).toISOString()
/** Um pedido do mesmo nome que já está no banco (por padrão PENDENTE há 1 minuto; sem `ultimo_disparo_em`, o último disparo é o da hora do pedido). */
const pedidoNoBanco = (over: Record<string, unknown> = {}) => {
  const p = { id: 'andando-1', descricao: CORPO.descricao, chave_nome: CHAVE, grupo: CORPO.grupo, unidade: 'KG', estado: 'PENDENTE', motivo: null, produto_id: null,
    criado_em: haMinutos(30), atualizado_em: haMinutos(1), ...over }
  return { ultimo_disparo_em: p.atualizado_em, ...p }
}
/** Os UPDATEs que marcam REVISAR um pedido pelo código (o "marcar REVISAR" do disparo que falhou). */
const marcacoesRevisar = () => h.banco.operacoes.filter((op) => op.tipo === 'update' && op.dados?.estado === 'REVISAR' && op.filtros.some(([, c]) => c === 'id'))
/** Os UPDATEs que reservam um novo disparo (D3). */
const reservas = () => h.banco.operacoes.filter((op) => op.tipo === 'update' && op.dados !== undefined && 'ultimo_disparo_em' in op.dados)

const CAMINHO_DO_INDEX = './index.ts'
let handler: (req: Request) => Promise<Response>
let env: Record<string, string | undefined> = {}
type InitDoFetch = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
const fetchFalso = vi.fn<(url: string, init: InitDoFetch) => Promise<{ status: number; text(): Promise<string> }>>()
let errosNoLog: string[] = []

beforeAll(async () => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { handler = fn },
  }
  vi.stubGlobal('fetch', fetchFalso)
  // caminho em variável: o tsc do projeto EXCLUI index.ts de propósito (globais do Deno e npm:), e um import literal o traria de volta
  await import(/* @vite-ignore */ CAMINHO_DO_INDEX)
})
afterAll(() => {
  delete (globalThis as unknown as { Deno?: unknown }).Deno
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AGORA)
  env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO, GITHUB_PAT: PAT }
  h.banco.usuarios = [{ email: 'ivan@spazio.com', papel: 'admin', ativo: true }]
  h.banco.pedidos = []
  h.banco.tokens = { 'tok-ivan': 'ivan@spazio.com' }
  h.banco.operacoes = []
  h.banco.terminarAntesDaLeitura = false
  h.banco.proximoId = 1
  fetchFalso.mockReset()
  fetchFalso.mockResolvedValue({ status: 204, text: async () => '' })
  errosNoLog = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errosNoLog.push(args.map(String).join(' ')) })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function pedir(corpo: unknown): Request {
  return new Request('https://x.supabase.co/functions/v1/cadastrar-produto', {
    method: 'POST', headers: { origin: ORIGEM, 'content-type': 'application/json', authorization: 'Bearer tok-ivan' }, body: JSON.stringify(corpo),
  })
}
async function corpoDe(r: Response): Promise<Record<string, unknown>> { return (await r.json()) as Record<string, unknown> }
const corpoDoDisparo = (i: number) => JSON.parse(fetchFalso.mock.calls[i][1].body) as unknown
/** nada de segredo na resposta nem no log */
function semVazamento(texto: string) {
  for (const s of [PAT, CHAVE_SERVICO]) expect(texto).not.toContain(s)
  expect(errosNoLog.join('\n')).not.toMatch(/SEGREDO_NAO_VAZAR/)
}

describe('cadastrar-produto/index.ts — pedido novo', () => {
  it('grava o pedido PENDENTE e dispara o workflow do robô uma vez (URL, ref master, cadastro_id)', async () => {
    const r = await handler(pedir(CORPO))
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ cadastro_id: 'cad-1', chave_nome: CHAVE })
    expect(h.banco.pedidos).toHaveLength(1)
    expect(h.banco.pedidos[0]).toMatchObject({ id: 'cad-1', estado: 'PENDENTE', chave_nome: CHAVE, origem_item: 3, criado_por: 'ivan@spazio.com' })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    expect(fetchFalso.mock.calls[0][0]).toBe(URL_DISPARO)
    expect(corpoDoDisparo(0)).toEqual({ ref: 'master', inputs: { cadastro_id: 'cad-1' } })
  })

  it('M8: o disparo falha: o pedido vira REVISAR com o aviso — mas só o que o robô ainda não pegou: PROCESSANDO ou CADASTRADO ficam como o robô deixou', async () => {
    fetchFalso.mockResolvedValue({ status: 500, text: async () => 'erro' })
    const r = await handler(pedir(CORPO))
    expect(r.status).toBe(502)
    expect(h.banco.pedidos[0]).toMatchObject({ estado: 'REVISAR', motivo: AVISO_DISPARO })
    expect(marcacoesRevisar().map((op) => op.filtros)).toEqual([[['eq', 'id', 'cad-1'], ['eq', 'estado', 'PENDENTE']]])
    // o GitHub recebeu o disparo, mas a resposta não voltou a tempo: enquanto isso o robô pegou o pedido (ou até terminou)
    for (const doRobo of [{ estado: 'PROCESSANDO' }, { estado: 'CADASTRADO', produto_id: 3924999 }]) {
      h.banco.pedidos = []
      h.banco.proximoId = 1
      fetchFalso.mockImplementation(async () => {
        Object.assign(h.banco.pedidos[0], doRobo)
        throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
      })
      const r2 = await handler(pedir(CORPO))
      expect(r2.status).toBe(502)
      expect(h.banco.pedidos[0]).toMatchObject({ ...doRobo, motivo: null })
    }
  })

  it('M8: número de item acima do que o banco guarda ou código acima de 2^53: 400 em português, sem tocar em produto_cadastro', async () => {
    for (const over of [{ origem_item: 2147483648 }, { existente_id: 2 ** 53 }, { existente_id: 1e20 }]) {
      const r = await handler(pedir({ ...CORPO, ...over }))
      expect(r.status).toBe(400)
      expect(String((await corpoDe(r)).erro)).toMatch(/não está certo/)
    }
    expect(h.banco.operacoes.filter((op) => op.tabela === 'produto_cadastro')).toEqual([])
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})

describe('cadastrar-produto/index.ts — já há um pedido do mesmo nome em andamento', () => {
  it('C3: PENDENTE e sem disparo há mais de 3 min (o run se perdeu na fila): reserva o intervalo e SÓ DEPOIS dispara de novo o MESMO pedido; reenviado:true', async () => {
    h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(3, 1) })]
    let reservadoNoDisparo: unknown = null
    fetchFalso.mockImplementation(async () => { reservadoNoDisparo = h.banco.pedidos[0].ultimo_disparo_em; return { status: 204, text: async () => '' } })
    const r = await handler(pedir(CORPO))
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ cadastro_id: 'andando-1', chave_nome: CHAVE, em_andamento: true, reenviado: true })
    // só a hora do último disparo muda (e já estava reservada quando o GitHub foi chamado); a hora do pedido fica (ela conta os 20 min do preso)
    expect(h.banco.pedidos).toEqual([pedidoNoBanco({ atualizado_em: haMinutos(3, 1), ultimo_disparo_em: AGORA.toISOString() })])
    expect(reservadoNoDisparo).toBe(AGORA.toISOString())
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    expect(corpoDoDisparo(0)).toEqual({ ref: 'master', inputs: { cadastro_id: 'andando-1' } })
    // a situação é lida pelo código do pedido; a reserva é um UPDATE só: o pedido, ainda PENDENTE, com o último disparo antes de agora − 3 min
    const situacao = h.banco.operacoes.filter((op) => op.tipo === 'select' && op.colunas === 'estado, atualizado_em, ultimo_disparo_em')
    expect(situacao.map((op) => op.filtros)).toEqual([[['eq', 'id', 'andando-1']]])
    expect(reservas().map((op) => [op.filtros, Object.keys(op.dados ?? {})])).toEqual(
      [[[['eq', 'id', 'andando-1'], ['eq', 'estado', 'PENDENTE'], ['lt', 'ultimo_disparo_em', haMinutos(3)]], ['ultimo_disparo_em']]])
  })

  it('D3: PENDENTE há 5 min, mas o último disparo foi há 1 min: nada disparado e reenviado:false; com o último disparo há 4 min, reenvia', async () => {
    h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(5), ultimo_disparo_em: haMinutos(1) })]
    expect(await corpoDe(await handler(pedir(CORPO)))).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false })
    expect(h.banco.pedidos).toEqual([pedidoNoBanco({ atualizado_em: haMinutos(5), ultimo_disparo_em: haMinutos(1) })])
    expect(reservas()).toEqual([])   // nem tenta reservar
    expect(fetchFalso).not.toHaveBeenCalled()
    h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(5), ultimo_disparo_em: haMinutos(4) })]
    expect(await corpoDe(await handler(pedir(CORPO)))).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: true })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('D3: dois toques seguidos, ou dois ao mesmo tempo, num pedido parado há 10 min: o robô é chamado UMA vez só', async () => {
    h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(10) })]
    const um = await corpoDe(await handler(pedir(CORPO)))
    const dois = await corpoDe(await handler(pedir(CORPO)))
    expect([um.reenviado, dois.reenviado]).toEqual([true, false])
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    // ao mesmo tempo: os dois leem a mesma situação; a reserva (UPDATE condicionado) deixa só um chamar o robô
    h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(10) })]
    fetchFalso.mockClear()
    const juntos = await Promise.all([handler(pedir(CORPO)), handler(pedir(CORPO))])
    expect((await Promise.all(juntos.map(corpoDe))).map((c) => c.reenviado).sort()).toEqual([false, true])
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('C3: PENDENTE há 3 min ou menos, ou PROCESSANDO (o robô está nele): nada é disparado; reenviado:false', async () => {
    for (const over of [{ atualizado_em: haMinutos(2, 59) }, { atualizado_em: haMinutos(3) }, { estado: 'PROCESSANDO', atualizado_em: haMinutos(10) }]) {
      h.banco.pedidos = [pedidoNoBanco(over)]
      const r = await handler(pedir(CORPO))
      expect(r.status).toBe(200)
      expect(await corpoDe(r)).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false })
      expect(h.banco.pedidos).toEqual([pedidoNoBanco(over)])
    }
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('C3: o novo disparo falha (GitHub recusa ou não responde): 200 com reenviado:false; o pedido NÃO vira REVISAR e o intervalo fica reservado; nada de segredo no log', async () => {
    for (const falha of [() => fetchFalso.mockResolvedValue({ status: 422, text: async () => '{"message":"Unprocessable Entity"}' }),
      () => fetchFalso.mockRejectedValue(Object.assign(new Error(`error sending request for url (${URL_DISPARO}) com ${PAT}`), { name: 'TypeError' }))]) {
      falha()
      h.banco.pedidos = [pedidoNoBanco({ atualizado_em: haMinutos(10) })]
      h.banco.operacoes = []
      const r = await handler(pedir(CORPO))
      const corpo = await corpoDe(r)
      expect(r.status).toBe(200)
      expect(corpo).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false })
      expect(h.banco.pedidos).toEqual([pedidoNoBanco({ atualizado_em: haMinutos(10), ultimo_disparo_em: AGORA.toISOString() })])
      expect(marcacoesRevisar()).toEqual([])
      semVazamento(JSON.stringify(corpo))
    }
  })

  it('F-M4: o prazo de "preso" é 20 min: parado há 21 min vira REVISAR com o aviso e um pedido novo é gravado e disparado; parado há 19 min segue em andamento', async () => {
    h.banco.pedidos = [pedidoNoBanco({ estado: 'PROCESSANDO', atualizado_em: haMinutos(21) })]
    const r = await handler(pedir(CORPO))
    expect(await corpoDe(r)).toMatchObject({ cadastro_id: 'cad-1' })
    expect(h.banco.pedidos[0]).toMatchObject({ id: 'andando-1', estado: 'REVISAR', motivo: 'o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo' })
    expect(h.banco.pedidos[1]).toMatchObject({ id: 'cad-1', estado: 'PENDENTE' })
    expect(corpoDoDisparo(0)).toEqual({ ref: 'master', inputs: { cadastro_id: 'cad-1' } })
    // o filtro: este nome, em andamento, sem mudança desde agora − 20 min
    const expirar = h.banco.operacoes.find((op) => op.tipo === 'update' && op.filtros.some(([op2]) => op2 === 'lt'))
    expect(expirar?.filtros).toEqual([['eq', 'chave_nome', CHAVE], ['in', 'estado', ['PENDENTE', 'PROCESSANDO']], ['lt', 'atualizado_em', haMinutos(20)]])

    h.banco.pedidos = [pedidoNoBanco({ estado: 'PROCESSANDO', atualizado_em: haMinutos(19) })]
    fetchFalso.mockClear()
    const r2 = await handler(pedir(CORPO))
    expect(await corpoDe(r2)).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true, reenviado: false })
    expect(h.banco.pedidos).toEqual([pedidoNoBanco({ estado: 'PROCESSANDO', atualizado_em: haMinutos(19) })])
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('M8: corrida do índice "um por vez" (o pedido em andamento terminou entre o insert e a leitura): 409 em português, sem a mensagem crua do banco, nada disparado', async () => {
    h.banco.pedidos = [pedidoNoBanco({ estado: 'PROCESSANDO' })]
    h.banco.terminarAntesDaLeitura = true
    const r = await handler(pedir(CORPO))
    const corpo = await corpoDe(r)
    expect(r.status).toBe(409)
    expect(corpo).toEqual({ erro: 'outro pedido deste mesmo produto acabou de terminar: toque de novo para ver o resultado', chave_nome: CHAVE })
    expect(JSON.stringify(corpo)).not.toMatch(/duplicate key|produto_cadastro_em_andamento/)
    expect(h.banco.pedidos).toHaveLength(1)
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})
