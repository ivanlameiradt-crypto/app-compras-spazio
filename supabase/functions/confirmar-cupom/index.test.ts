// Roda o index.ts de verdade (handler HTTP + logica.ts + aprendizado.ts) com tudo que é do Deno/rede trocado por falsos: o global `Deno`,
// o cliente do Supabase e o `fetch` do GitHub (molde: enviar-cupom/index.test.ts). O banco falso repete as travas conferidas em Postgres
// real: o UPDATE do cupom é condicionado (estado REVISAR e sem pedido) e os índices únicos PARCIAIS de cupom_aprendizado dão 23505.
// Aqui se prova o que a lógica pura não alcança: status/CORS, autorização, o SQL de cada dep (filtros do UPDATE, a linha mais recente de
// itens_semana), o disparo (URL, cabeçalhos, corpo), a falha de disparo não derrubar a correção, e que NENHUM segredo vai à resposta nem ao log.
import { vi } from 'vitest'

type Linha = Record<string, unknown>

const h = vi.hoisted(() => {
  type L = Record<string, unknown>
  type Filtro = [op: 'eq' | 'is', coluna: string, valor: unknown]
  type Erro = { code?: string; message: string }
  const banco = {
    usuarios: [] as L[],
    cupons: [] as L[],
    itensSemana: [] as L[],
    aprendizado: [] as L[],
    tokens: {} as Record<string, string>,
    /** toda operação pedida ao banco, na ordem: prova o que foi filtrado e que o UPDATE do cupom vem antes do aprendizado */
    operacoes: [] as { tabela: string; tipo: 'select' | 'insert' | 'update'; filtros: Filtro[]; dados?: L }[],
    /** simula a corrida: entre o SELECT e o UPDATE outro processo lançou o cupom (o UPDATE condicionado não pode achar a linha) */
    lancarAntesDoUpdate: false,
    /** leitura que falha (rede/permissão): o select devolve erro em vez de dados */
    falharLeitura: { cupom: false },
    proximoId: 1,
  }
  const clientes = { criacoes: [] as unknown[][] }

  class Consulta {
    private filtros: Filtro[] = []
    private linhaNova: L | null = null
    private mudancas: L | null = null
    private colunas: string[] | null = null // null = todas (select('*') ou sem argumento)
    private ordem: { coluna: string; ascending: boolean } | null = null
    private limite: number | null = null
    constructor(private tabela: string) {}
    select(colunas?: string) {
      this.colunas = colunas && colunas.trim() !== '*' ? colunas.split(',').map((c) => c.trim()) : null
      return this
    }
    eq(coluna: string, valor: unknown) { this.filtros.push(['eq', coluna, valor]); return this }
    is(coluna: string, valor: unknown) { this.filtros.push(['is', coluna, valor]); return this }
    order(coluna: string, o?: { ascending?: boolean }) { this.ordem = { coluna, ascending: o?.ascending ?? true }; return this }
    limit(n: number) { this.limite = n; return this }
    insert(linha: L) { this.linhaNova = linha; return this }
    update(mudancas: L) { this.mudancas = mudancas; return this }

    private lista(): L[] {
      if (this.tabela === 'usuarios') return banco.usuarios
      if (this.tabela === 'cupom') return banco.cupons
      if (this.tabela === 'itens_semana') return banco.itensSemana
      if (this.tabela === 'cupom_aprendizado') return banco.aprendizado
      throw new Error(`tabela ${this.tabela} não prevista no banco falso`)
    }
    private filtrar(linhas: L[]): L[] {
      let r = linhas
      for (const [op, c, v] of this.filtros) r = r.filter((l) => (op === 'is' && v === null ? l[c] == null : l[c] === v))
      return r
    }
    private executar(): { data: L[] | null; error: Erro | null } {
      if (this.linhaNova) return this.inserir(this.linhaNova)
      if (this.mudancas) return this.atualizar(this.mudancas)
      banco.operacoes.push({ tabela: this.tabela, tipo: 'select', filtros: this.filtros })
      if (this.tabela === 'cupom' && banco.falharLeitura.cupom) return { data: null, error: { message: 'connection reset' } }
      let linhas = this.filtrar(this.lista())
      if (this.ordem) {
        const { coluna, ascending } = this.ordem
        linhas = [...linhas].sort((a, b) => (Number(a[coluna]) - Number(b[coluna])) * (ascending ? 1 : -1))
      }
      if (this.limite !== null) linhas = linhas.slice(0, this.limite)
      return { data: linhas, error: null }
    }
    private inserir(l: L): { data: L[] | null; error: Erro | null } {
      banco.operacoes.push({ tabela: this.tabela, tipo: 'insert', filtros: [], dados: l })
      if (this.tabela !== 'cupom_aprendizado') return { data: null, error: { message: `insert em ${this.tabela} não previsto no banco falso` } }
      // os índices únicos PARCIAIS da tabela: por EAN (where codigo_barras is not null) e por emitente + descrição (where ambos not null)
      if (l.codigo_barras != null && banco.aprendizado.some((a) => a.codigo_barras === l.codigo_barras)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_aprendizado_ean_uniq"' } }
      }
      if (l.descricao_norm != null && l.emitente_cnpj != null
        && banco.aprendizado.some((a) => a.descricao_norm === l.descricao_norm && a.emitente_cnpj === l.emitente_cnpj)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_aprendizado_desc_uniq"' } }
      }
      const nova = { id: `apr-${banco.proximoId++}`, ...l }
      banco.aprendizado.push(nova)
      return { data: [nova], error: null }
    }
    private atualizar(mudancas: L): { data: L[] | null; error: Erro | null } {
      banco.operacoes.push({ tabela: this.tabela, tipo: 'update', filtros: this.filtros, dados: mudancas })
      if (this.tabela === 'cupom' && banco.lancarAntesDoUpdate) {
        banco.lancarAntesDoUpdate = false
        for (const c of banco.cupons) { c.estado = 'LANCADO'; c.pedido_sischef = '163377325' }
      }
      const alvo = this.filtrar(this.lista())
      for (const l of alvo) Object.assign(l, mudancas)
      return { data: alvo, error: null }
    }
    /** O PostgREST devolve SÓ as colunas do select(...): quem lê uma coluna que não pediu recebe undefined (nunca o valor). */
    private projetar(linha: L): L {
      return this.colunas === null ? linha : Object.fromEntries(this.colunas.map((c) => [c, linha[c]]))
    }
    private resultado(): { data: L[] | null; error: Erro | null } {
      const r = this.executar()
      if (r.error || r.data === null) return r
      return { data: r.data.map((l) => this.projetar(l)), error: null }
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
  return { banco, admin, clientes }
})

vi.mock('npm:@supabase/supabase-js@2', () => ({
  createClient: (...args: unknown[]) => { h.clientes.criacoes.push(args); return h.admin },
}))

const ORIGEM = 'https://ivanlameiradt-crypto.github.io'
const PAT = 'github_pat_SEGREDO_NAO_VAZAR'
const CHAVE_SERVICO = 'service-role-SEGREDO_NAO_VAZAR'
const SEGREDOS = [PAT, CHAVE_SERVICO]
const CUPOM_ID = 'aaf54e6f-0b1c-4d2e-9f3a-4b5c6d7e8f90'
const CNPJ_ATACADAO = '75315333000109'
const EAN = '7891234567895'

/** O cupom do ATACADAO de 06/10 (R$ 35,27) como o enviar-cupom o gravou: 2 itens sem produto e o LIMAO TAITI já aprendido. */
const ITENS_ATACADAO: Linha[] = [
  { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
    codigo_barras: null, casado_por: null, proposta: { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS' }, quantidade_cupom: 0.5 },
  { descricao_cupom: 'PEPINO JAPONES', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
    codigo_barras: null, casado_por: null, proposta: { insumo_id: '3484991', insumo_nome: 'PEPINO JAPONÊS - INSUMOS' }, quantidade_cupom: 0.912 },
  { descricao_cupom: 'LIMAO TAITI TROPICAL', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884,
    sugestao_produto: { id: '3469643' }, codigo_barras: null, casado_por: 'descricao', proposta: null, quantidade_cupom: 2.884 },
]
function cupomAtacadao(over: Linha = {}): Linha {
  return {
    id: CUPOM_ID, estado: 'REVISAR', pedido_sischef: null, motivo: '2 item(ns) sem casamento confirmado — confira no Code',
    itens: structuredClone(ITENS_ATACADAO), valor_a_pagar: '35.27', // numeric do PostgREST chega como texto
    emitente_cnpj: CNPJ_ATACADAO, emitente_nome: 'ATACADAO S.A.', teste: false, foto_path: 'cupom/a.jpg',
    pagamento: { forma: 'pix', conta: 'PIX ITAU IJ' }, criado_em: '2026-10-06T18:00:00Z', atualizado_em: '2026-10-06T18:00:00Z', ...over,
  }
}
const CONFIRMACOES = [
  { indice: 0, insumo_id: '3484974', quantidade: 0.5, lembrar: true },
  { indice: 1, insumo_id: '3484991', quantidade: 0.912, lembrar: true },
]
const URL_DISPARO = 'https://api.github.com/repos/ivanlameiradt-crypto/sischef-monitor-notas/actions/workflows/lancar-cupom.yml/dispatches'

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
  env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO, GITHUB_PAT: PAT }
  h.banco.usuarios = [
    { email: 'ivan@spazio.com', papel: 'admin', ativo: true },
    { email: 'joao@spazio.com', papel: 'comprador', ativo: true },
  ]
  h.banco.cupons = [cupomAtacadao()]
  // a lista de insumos do app: a MESMA linha pode aparecer em várias semanas; a mais recente (id maior) é a que vale
  h.banco.itensSemana = [
    { id: 1, produto_id: 3484974, produto: 'LIMAO SICILIANO - INSUMOS', unidade: 'UN' }, // semana velha, unidade errada
    { id: 2, produto_id: 3484974, produto: 'LIMÃO SICILIANO - INSUMOS', unidade: 'KG' },
    { id: 3, produto_id: 3484991, produto: 'PEPINO JAPONÊS - INSUMOS', unidade: 'KG' },
    { id: 4, produto_id: 3487562, produto: 'OVO - INSUMOS', unidade: 'KG' },
  ]
  h.banco.aprendizado = []
  h.banco.tokens = { 'tok-ivan': 'ivan@spazio.com', 'tok-joao': 'joao@spazio.com' }
  h.banco.operacoes = []
  h.banco.lancarAntesDoUpdate = false
  h.banco.falharLeitura = { cupom: false }
  h.banco.proximoId = 1
  h.clientes.criacoes = []
  fetchFalso.mockReset()
  fetchFalso.mockResolvedValue({ status: 204, text: async () => '' })
  errosNoLog = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errosNoLog.push(args.map(String).join(' ')) })
})
afterEach(() => { vi.restoreAllMocks() })

function pedido(corpo: unknown, o: { token?: string | null; metodo?: string; origem?: string } = {}): Request {
  const headers: Record<string, string> = { origin: o.origem ?? ORIGEM, 'content-type': 'application/json' }
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? 'tok-ivan'}`
  const metodo = o.metodo ?? 'POST'
  return new Request('https://x.supabase.co/functions/v1/confirmar-cupom', {
    method: metodo, headers, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
  })
}
const confirmacao = (itens: unknown = CONFIRMACOES, o: Parameters<typeof pedido>[1] = {}) => pedido({ cupom_id: CUPOM_ID, itens }, o)
async function corpoDe(r: Response): Promise<Record<string, unknown>> { return (await r.json()) as Record<string, unknown> }
const cupomNoBanco = () => h.banco.cupons[0]
const escritas = () => h.banco.operacoes.filter((op) => op.tipo !== 'select')
/** nada de segredo na resposta nem no log */
function semVazamento(texto: string) {
  for (const s of SEGREDOS) expect(texto).not.toContain(s)
  expect(errosNoLog.join('\n')).not.toMatch(/SEGREDO_NAO_VAZAR/)
}
/** o cupom continua como estava: REVISAR, com o motivo, itens sem produto */
function cupomIntocado() {
  expect(cupomNoBanco()).toMatchObject({ estado: 'REVISAR', motivo: '2 item(ns) sem casamento confirmado — confira no Code' })
  expect((cupomNoBanco().itens as Linha[])[0].sugestao_produto).toBeNull()
  expect(h.banco.aprendizado).toHaveLength(0)
}

describe('confirmar-cupom/index.ts — HTTP, CORS e autorização', () => {
  it('OPTIONS: preflight com CORS só para a origem permitida', async () => {
    const ok = await handler(pedido(null, { metodo: 'OPTIONS' }))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(ok.headers.get('access-control-allow-methods')).toMatch(/POST/)
    expect(ok.headers.get('access-control-allow-headers')).toMatch(/authorization/)
    const deFora = await handler(pedido(null, { metodo: 'OPTIONS', origem: 'https://malicioso.example' }))
    expect(deFora.headers.get('access-control-allow-origin')).toBe('')
    const localhost = await handler(pedido(null, { metodo: 'OPTIONS', origem: 'http://localhost:5173' }))
    expect(localhost.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  it('só POST: GET dá 405', async () => {
    const r = await handler(pedido(null, { metodo: 'GET' }))
    expect(r.status).toBe(405)
    expect(await corpoDe(r)).toEqual({ erro: 'método não permitido' })
  })

  it('sem Authorization: 401, nada lido, gravado nem disparado', async () => {
    const r = await handler(confirmacao(CONFIRMACOES, { token: null }))
    expect(r.status).toBe(401)
    expect(await corpoDe(r)).toEqual({ erro: 'sem autenticação' })
    expect(h.banco.operacoes).toHaveLength(0)
    expect(fetchFalso).not.toHaveBeenCalled()
    cupomIntocado()
  })

  it('token inválido: 401 "sessão inválida"', async () => {
    const r = await handler(confirmacao(CONFIRMACOES, { token: 'tok-falso' }))
    expect(r.status).toBe(401)
    expect(await corpoDe(r)).toEqual({ erro: 'sessão inválida' })
    expect(h.banco.operacoes).toHaveLength(0)
    cupomIntocado()
  })

  it('sem SUPABASE_URL ou sem a chave de serviço: 500 claro, antes de tocar no banco', async () => {
    for (const faltando of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) {
      env[faltando] = undefined
      const r = await handler(confirmacao())
      expect(r.status).toBe(500)
      expect(await corpoDe(r)).toEqual({ erro: 'função sem configuração' })
      expect(h.clientes.criacoes).toHaveLength(0)
      expect(h.banco.operacoes).toHaveLength(0)
      env[faltando] = { SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO, SUPABASE_URL: 'https://x.supabase.co' }[faltando]
    }
    cupomIntocado()
  })

  it('não-admin (comprador): 403; nada gravado nem disparado', async () => {
    const r = await handler(confirmacao(CONFIRMACOES, { token: 'tok-joao' }))
    expect(r.status).toBe(403)
    expect(await corpoDe(r)).toEqual({ erro: 'apenas o administrador pode fazer isso' })
    expect(escritas()).toHaveLength(0)
    expect(fetchFalso).not.toHaveBeenCalled()
    cupomIntocado()
  })

  it('o cliente de serviço é criado com a chave só do servidor, sem persistir sessão nem renovar token', async () => {
    await handler(confirmacao())
    expect(h.clientes.criacoes[0]).toEqual(['https://x.supabase.co', CHAVE_SERVICO, { auth: { persistSession: false, autoRefreshToken: false } }])
  })
})

describe('confirmar-cupom/index.ts — caminho feliz (o cupom do ATACADAO de 06/10) e o disparo', () => {
  it('corrige → UPDATE condicionado do cupom (PENDENTE, motivo null, itens refeitos) → aprendizado → dispara o workflow uma vez', async () => {
    const r = await handler(confirmacao())
    const corpo = await corpoDe(r)
    expect(r.status).toBe(200)
    expect(corpo).toEqual({
      cupom_id: CUPOM_ID, estado: 'PENDENTE', resumo: 'corrigido e reenviado para lançar', disparo_ok: true, lembrados: 2, nao_lembrados: 0,
    })

    // a linha no banco: de volta à fila, sem motivo, com atualizado_em novo e os itens refeitos no formato do robô
    const cupom = cupomNoBanco()
    expect(cupom).toMatchObject({ estado: 'PENDENTE', motivo: null, pedido_sischef: null, valor_a_pagar: '35.27' })
    expect(cupom.atualizado_em).not.toBe('2026-10-06T18:00:00Z')
    expect(new Date(String(cupom.atualizado_em)).toISOString()).toBe(cupom.atualizado_em)
    const itens = cupom.itens as Linha[]
    expect(itens).toHaveLength(3)
    expect(itens[0]).toMatchObject({
      sugestao_produto: { id: '3484974' }, entrada_estoque: 0.5, valor_unitario: 13.9, casado_por: 'app', proposta: null, quantidade_cupom: 0.5,
    })
    expect(itens[1]).toMatchObject({ sugestao_produto: { id: '3484991' }, entrada_estoque: 0.912, valor_unitario: 5.79, casado_por: 'app', proposta: null })
    expect(itens[2]).toEqual(ITENS_ATACADAO[2])

    // o UPDATE é compara-e-troca: filtra por id, estado REVISAR e pedido_sischef nulo — e só muda o que a correção muda
    const update = h.banco.operacoes.find((op) => op.tabela === 'cupom' && op.tipo === 'update')
    expect(update?.filtros).toEqual([['eq', 'id', CUPOM_ID], ['eq', 'estado', 'REVISAR'], ['is', 'pedido_sischef', null]])
    expect(Object.keys(update?.dados ?? {}).sort()).toEqual(['atualizado_em', 'estado', 'itens', 'motivo'])

    // o aprendizado confirmado: por (emitente, descrição normalizada), unidade do produto da lista do app
    expect(h.banco.aprendizado).toEqual([
      { id: 'apr-1', codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', insumo_id: '3484974',
        insumo_nome: 'LIMÃO SICILIANO - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true },
      { id: 'apr-2', codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'pepino japones', insumo_id: '3484991',
        insumo_nome: 'PEPINO JAPONÊS - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true },
    ])
    // na ordem: o cupom volta à fila antes de qualquer aprendizado
    expect(escritas().map((op) => `${op.tipo}:${op.tabela}`)).toEqual(['update:cupom', 'insert:cupom_aprendizado', 'insert:cupom_aprendizado'])

    // disparo: POST no workflow certo, ref master, cupom_id, PAT no cabeçalho (e só lá), com timeout
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFalso.mock.calls[0]
    expect(url).toBe(URL_DISPARO)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${PAT}`)
    expect(init.headers.Accept).toBe('application/vnd.github+json')
    expect(JSON.parse(init.body)).toEqual({ ref: 'master', inputs: { cupom_id: CUPOM_ID } })
    expect(init.signal).toBeInstanceOf(AbortSignal)

    semVazamento(JSON.stringify(corpo))
  })

  it('o produto vem da linha MAIS RECENTE de itens_semana (order id desc, limit 1): a semana velha dizia UN e faria a confirmação falhar', async () => {
    const r = await handler(confirmacao())
    expect(r.status).toBe(200)
    const buscas = h.banco.operacoes.filter((op) => op.tabela === 'itens_semana')
    expect(buscas.map((op) => op.filtros)).toEqual([[['eq', 'produto_id', 3484974]], [['eq', 'produto_id', 3484991]]]) // Number(id): a coluna é inteira
    expect(h.banco.aprendizado[0]).toMatchObject({ insumo_nome: 'LIMÃO SICILIANO - INSUMOS', unidade_destino: 'KG' })
    // sem a linha nova, a velha (UN) manda e o cupom em KG exige a entrada
    h.banco.cupons = [cupomAtacadao()]
    h.banco.aprendizado = []
    h.banco.itensSemana = h.banco.itensSemana.filter((l) => l.id !== 2)
    const r2 = await handler(confirmacao())
    expect(r2.status).toBe(400)
    expect(await corpoDe(r2)).toEqual({ erro: 'item 1: o cupom está em KG e o produto é em UN: informe quanto entra no estoque em UN' })
    cupomIntocado()
  })

  it('produto que não está na lista do app: 400 com o código, cupom intocado', async () => {
    const r = await handler(confirmacao([{ ...CONFIRMACOES[0], insumo_id: '9999999' }, CONFIRMACOES[1]]))
    expect(r.status).toBe(400)
    expect(await corpoDe(r)).toEqual({ erro: 'item 1: o produto cód. 9999999 não está na lista de insumos do app' })
    cupomIntocado()
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('cupom LANCADO (ou REVISAR com pedido_sischef) ⇒ 409 "atualize a tela": nada muda, nada é disparado', async () => {
    for (const over of [{ estado: 'LANCADO', pedido_sischef: '163377325' }, { estado: 'REVISAR', pedido_sischef: '163377325' }, { estado: 'PENDENTE' }]) {
      h.banco.cupons = [cupomAtacadao(over)]
      h.banco.operacoes = []
      const r = await handler(confirmacao())
      expect(r.status).toBe(409)
      expect(await corpoDe(r)).toEqual({ erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' })
      expect(cupomNoBanco()).toMatchObject(over)
      expect((cupomNoBanco().itens as Linha[])[0].sugestao_produto).toBeNull()
      expect(escritas()).toHaveLength(0)
    }
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(h.banco.aprendizado).toHaveLength(0)
  })

  it('corrida: o SELECT viu REVISAR, mas o robô lançou antes do UPDATE ⇒ o UPDATE condicionado não acha a linha ⇒ 409, sem aprendizado nem disparo',
    async () => {
    h.banco.lancarAntesDoUpdate = true
    const r = await handler(confirmacao())
    expect(r.status).toBe(409)
    expect(await corpoDe(r)).toEqual({ erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' })
    expect(cupomNoBanco()).toMatchObject({ estado: 'LANCADO', pedido_sischef: '163377325', motivo: '2 item(ns) sem casamento confirmado — confira no Code' })
    expect((cupomNoBanco().itens as Linha[])[0].sugestao_produto).toBeNull() // o UPDATE não escreveu por cima do lançado
    expect(h.banco.aprendizado).toHaveLength(0)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('cupom inexistente: 404', async () => {
    const r = await handler(pedido({ cupom_id: '00000000-0000-4000-8000-000000000000', itens: CONFIRMACOES }))
    expect(r.status).toBe(404)
    expect(await corpoDe(r)).toEqual({ erro: 'cupom não encontrado' })
    cupomIntocado()
  })

  it('soma que não bate (peso errado): 400 com as somas em R$, cupom intocado, nada disparado', async () => {
    const r = await handler(confirmacao([{ ...CONFIRMACOES[0], quantidade: 0.6 }, CONFIRMACOES[1]]))
    expect(r.status).toBe(400)
    expect(await corpoDe(r)).toEqual({
      erro: 'a soma dos itens (R$ 36,66) não bate com o total do cupom (R$ 35,27): diferença de R$ 1,39. Confira os pesos.', soma: 36.66, total: 35.27,
    })
    cupomIntocado()
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('RF5: o GitHub recusa (422 ref/inputs, 401…) ⇒ 200 com disparo_ok:false; o cupom CONTINUA PENDENTE; o log leva o status, nunca o PAT', async () => {
    const recusas = [[422, '{"message":"Unprocessable Entity"}'], [401, '{"message":"Bad credentials"}'], [404, '{"message":"Not Found"}']] as const
    for (const [status, mensagem] of recusas) {
      h.banco.cupons = [cupomAtacadao()]; h.banco.aprendizado = []; h.banco.proximoId = 1; errosNoLog = []
      fetchFalso.mockResolvedValue({ status, text: async () => mensagem })
      const r = await handler(confirmacao())
      const corpo = await corpoDe(r)
      expect(r.status).toBe(200)
      expect(corpo).toMatchObject({ cupom_id: CUPOM_ID, estado: 'PENDENTE', disparo_ok: false, lembrados: 2 })
      expect(String(corpo.resumo)).toMatch(/disparo automático falhou/)
      expect(cupomNoBanco()).toMatchObject({ estado: 'PENDENTE', motivo: null })
      expect(h.banco.aprendizado).toHaveLength(2)
      expect(errosNoLog.join('\n')).toMatch(new RegExp(`workflow_dispatch falhou \\(HTTP ${status}\\)`))
      expect(errosNoLog.join('\n')).not.toContain(PAT)
      semVazamento(JSON.stringify(corpo))
    }
  })

  it('RF5: sem GITHUB_PAT a correção não quebra (PENDENTE + disparo_ok:false), o fetch nem acontece e o log diz o motivo SEM o valor', async () => {
    env.GITHUB_PAT = undefined
    const r = await handler(confirmacao())
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ estado: 'PENDENTE', disparo_ok: false, lembrados: 2 })
    expect(cupomNoBanco()).toMatchObject({ estado: 'PENDENTE' })
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(errosNoLog.join('\n')).toMatch(/confirmar-cupom: workflow_dispatch sem GITHUB_PAT/)
    semVazamento(errosNoLog.join('\n'))
  })

  it('timeout ou erro de rede do fetch: o log leva só o NOME do erro (a mensagem pode trazer a URL e até o PAT) e a correção segue 200 PENDENTE', async () => {
    for (const nome of ['TimeoutError', 'TypeError']) {
      h.banco.cupons = [cupomAtacadao()]; h.banco.aprendizado = []; errosNoLog = []
      fetchFalso.mockRejectedValue(Object.assign(new Error(`error sending request for url (${URL_DISPARO}) com ${PAT}`), { name: nome }))
      const r = await handler(confirmacao())
      expect(r.status).toBe(200)
      expect(await corpoDe(r)).toMatchObject({ cupom_id: CUPOM_ID, estado: 'PENDENTE', disparo_ok: false })
      const log = errosNoLog.join('\n')
      expect(log).toMatch(new RegExp(`workflow_dispatch sem resposta ${nome}`))
      expect(log).not.toContain('api.github.com')
      expect(log).not.toContain(PAT)
    }
  })
})

describe('confirmar-cupom/index.ts — aprendizado: insert simples e o 23505 dos índices parciais', () => {
  it('a linha já existe por (emitente, descrição) ⇒ 23505 ⇒ UPDATE pela chave: produto trocado, confirmado true, sem linha duplicada', async () => {
    // o aprendizado antigo apontava para o LIMÃO comum e não estava confirmado: o Ivan confirmou agora o siciliano
    h.banco.aprendizado = [{
      id: 'apr-velho', codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', insumo_id: '3469643',
      insumo_nome: 'LIMÃO - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: false, atualizado_em: '2026-10-01T00:00:00Z',
    }]
    const r = await handler(confirmacao())
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ lembrados: 2, nao_lembrados: 0 })
    expect(h.banco.aprendizado).toHaveLength(2) // a velha atualizada + a nova do pepino
    expect(h.banco.aprendizado[0]).toMatchObject({
      id: 'apr-velho', emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS',
      fator_conversao: 1, unidade_destino: 'KG', confirmado: true,
    })
    expect(h.banco.aprendizado[0].atualizado_em).not.toBe('2026-10-01T00:00:00Z')
    const update = h.banco.operacoes.find((op) => op.tabela === 'cupom_aprendizado' && op.tipo === 'update')
    expect(update?.filtros).toEqual([['eq', 'emitente_cnpj', CNPJ_ATACADAO], ['eq', 'descricao_norm', 'limao siciliano']])
    expect(Object.keys(update?.dados ?? {}).sort()).toEqual(['atualizado_em', 'confirmado', 'fator_conversao', 'insumo_id', 'insumo_nome', 'unidade_destino'])
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('cupom com código de barras: aprendizado global por EAN; se já existe ⇒ UPDATE por codigo_barras', async () => {
    h.banco.aprendizado = [{
      id: 'apr-ean', codigo_barras: EAN, emitente_cnpj: null, descricao_norm: null, insumo_id: '3469643', insumo_nome: 'LIMÃO - INSUMOS',
      fator_conversao: 1, unidade_destino: 'KG', confirmado: true,
    }]
    const itens = structuredClone(ITENS_ATACADAO)
    itens[0].codigo_barras = EAN
    h.banco.cupons = [cupomAtacadao({ itens })]
    const r = await handler(confirmacao())
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ lembrados: 2 })
    expect(h.banco.aprendizado.filter((a) => a.codigo_barras === EAN)).toHaveLength(1)
    expect(h.banco.aprendizado[0]).toMatchObject({ id: 'apr-ean', insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS', confirmado: true })
    const update = h.banco.operacoes.find((op) => op.tabela === 'cupom_aprendizado' && op.tipo === 'update')
    expect(update?.filtros).toEqual([['eq', 'codigo_barras', EAN]])
    // o pepino, sem EAN, entrou por descrição
    expect(h.banco.aprendizado[1]).toMatchObject({ codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'pepino japones' })
  })

  it('cupom sem CNPJ do emitente e sem EAN: nao_lembrados 2, nada gravado em cupom_aprendizado, correção e disparo seguem', async () => {
    h.banco.cupons = [cupomAtacadao({ emitente_cnpj: null })]
    const r = await handler(confirmacao())
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ estado: 'PENDENTE', disparo_ok: true, lembrados: 0, nao_lembrados: 2 })
    expect(h.banco.aprendizado).toHaveLength(0)
    expect(cupomNoBanco()).toMatchObject({ estado: 'PENDENTE' })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('lembrar:false: o cupom é corrigido e disparado sem tocar em cupom_aprendizado', async () => {
    const r = await handler(confirmacao(CONFIRMACOES.map((c) => ({ ...c, lembrar: false }))))
    expect(await corpoDe(r)).toMatchObject({ estado: 'PENDENTE', lembrados: 0, nao_lembrados: 0 })
    expect(h.banco.operacoes.filter((op) => op.tabela === 'cupom_aprendizado')).toHaveLength(0)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('conversão UN → KG passa inteira pelo index: 5 un de OVO a R$ 7,99 viram 0,4 kg a R$ 99,875 e o aprendizado guarda fator 0,08', async () => {
    const ovo: Linha = {
      descricao_cupom: 'OVO BRANCO DZ', unidade_cupom: 'UN', valor_unitario: 7.99, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
      codigo_barras: null, casado_por: null, proposta: null, quantidade_cupom: 5,
    }
    h.banco.cupons = [cupomAtacadao({ itens: [ovo], valor_a_pagar: '39.95' })]
    const r = await handler(pedido({ cupom_id: CUPOM_ID, itens: [{ indice: 0, insumo_id: '3487562', quantidade: 5, entrada: 0.4, lembrar: true }] }))
    expect(r.status).toBe(200)
    expect((cupomNoBanco().itens as Linha[])[0])
      .toMatchObject({ sugestao_produto: { id: '3487562' }, entrada_estoque: 0.4, valor_unitario: 99.875, quantidade_cupom: 5 })
    expect(h.banco.aprendizado[0]).toMatchObject({ insumo_id: '3487562', unidade_destino: 'KG', confirmado: true })
    expect(Number(h.banco.aprendizado[0].fator_conversao)).toBeCloseTo(0.08, 12)
  })
})

describe('confirmar-cupom/index.ts — falhas de infraestrutura e entrada ruim', () => {
  it('erro ao ler o cupom: 500 com a mensagem do banco, nada gravado nem disparado, sem segredo', async () => {
    h.banco.falharLeitura.cupom = true
    const r = await handler(confirmacao())
    expect(r.status).toBe(500)
    const corpo = await corpoDe(r)
    expect(corpo).toEqual({ erro: 'connection reset' })
    expect(escritas()).toHaveLength(0)
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(errosNoLog.join('\n')).toMatch(/confirmar-cupom: erro connection reset/)
    semVazamento(JSON.stringify(corpo))
  })

  it('corpo que não é JSON: 400 "sem o cupom" (depois de autorizar), nada gravado', async () => {
    const req = new Request('https://x.supabase.co/functions/v1/confirmar-cupom', {
      method: 'POST', headers: { origin: ORIGEM, authorization: 'Bearer tok-ivan' }, body: 'isto não é json',
    })
    const r = await handler(req)
    expect(r.status).toBe(400)
    expect(await corpoDe(r)).toEqual({ erro: 'sem o cupom' })
    expect(escritas()).toHaveLength(0)
    cupomIntocado()
  })

  it('itens inválidos (quantidade zero): 400 com o texto do item, antes de ler o cupom', async () => {
    const r = await handler(confirmacao([CONFIRMACOES[0], { ...CONFIRMACOES[1], quantidade: 0 }]))
    expect(r.status).toBe(400)
    expect(await corpoDe(r)).toEqual({ erro: 'item 2: quantidade inválida (precisa ser maior que zero)' })
    expect(h.banco.operacoes.filter((op) => op.tabela === 'cupom')).toHaveLength(0)
    cupomIntocado()
  })

  it('toda resposta leva os cabeçalhos de CORS da origem (o app lê o erro, não um bloqueio do navegador)', async () => {
    const r = await handler(confirmacao([{ ...CONFIRMACOES[0], quantidade: 0.6 }, CONFIRMACOES[1]]))
    expect(r.status).toBe(400)
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(r.headers.get('content-type')).toBe('application/json')
  })
})
