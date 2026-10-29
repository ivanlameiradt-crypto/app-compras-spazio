// Roda o index.ts de verdade (handler HTTP + logica.ts + gravacao.ts) com tudo que é do Deno/rede trocado por falsos:
// o global `Deno`, o cliente do Supabase, o SDK da Anthropic e o `fetch` do GitHub. O banco falso repete as travas do
// Plano 1 conferidas em Postgres real (not null em valor_a_pagar; índices únicos PARCIAIS de foto_path e chave → 23505).
// Aqui se prova o que a lógica pura não alcança: status/CORS, autorização, o disparo (URL, cabeçalhos, corpo), a falha
// de disparo não derrubar o envio, e que NENHUM segredo vai à resposta nem ao log.
import { vi } from 'vitest'

type Linha = Record<string, unknown>

const h = vi.hoisted(() => {
  type L = Record<string, unknown>
  const banco = {
    usuarios: [] as L[],
    cupons: [] as L[],
    aprendizado: [] as L[],
    fornecedoresApp: [] as L[],
    fornecedoresCadastro: [] as L[],
    notasNfe: [] as L[],
    tokens: {} as Record<string, string>,
    arquivos: {} as Record<string, Uint8Array<ArrayBuffer>>,
    consultasAprendizado: [] as string[],
    /** cada select(...) pedido: tabela e lista de colunas */
    selects: [] as { tabela: string; colunas: string }[],
    /** simula a corrida: o PRIMEIRO SELECT por foto_path (o do dedup) "não vê" a linha que outro pedido gravou logo depois */
    cegarPrimeiroSelectPorFoto: false,
    /** leitura que falha (rede/permissão): o select devolve erro em vez de dados. `cupom_conhecidos` = só a leitura dos CNPJs conhecidos (29/10), não a do dedup */
    falharLeitura: { cupom: false, aprendizado: false, cupom_conhecidos: false, fornecedor_app: false, fornecedor_cadastro: false, cot_nfe: false } as Record<string, boolean>,
    /** cada leitura de CNPJs conhecidos (29/10): a tabela, as colunas, a ordem, o limite, as colunas exigidas não nulas e se levou um tempo máximo */
    consultasConhecidos: [] as { tabela: string; colunas: string; ordem: string | null; limite: number | null; naoNulos: string[]; comTempoMaximo: boolean }[],
    proximoId: 1,
  }
  const ia = {
    chamadas: [] as unknown[],
    construcoes: [] as unknown[],
    resposta: (): Promise<unknown> => Promise.resolve(null),
  }
  const clientes = { criacoes: [] as unknown[][] }

  class Consulta {
    private filtros: [string, unknown][] = []
    private orFiltro: string | null = null
    private naoNulos: string[] = []
    private ordem: { coluna: string; crescente: boolean } | null = null
    private maximo: number | null = null
    private comTempoMaximo = false
    private colunasBrutas = '*'
    private linhaNova: L | null = null
    private colunas: string[] | null = null // null = todas (select('*') ou sem argumento)
    constructor(private tabela: string) {}
    select(colunas?: string) {
      banco.selects.push({ tabela: this.tabela, colunas: colunas ?? '*' })
      this.colunasBrutas = colunas ?? '*'
      this.colunas = colunas && colunas.trim() !== '*' ? colunas.split(',').map((c) => c.trim()) : null
      return this
    }
    eq(coluna: string, valor: unknown) { this.filtros.push([coluna, valor]); return this }
    or(filtro: string) { this.orFiltro = filtro; return this }
    not(coluna: string, operador: string, valor: unknown) { if (operador === 'is' && valor === null) this.naoNulos.push(coluna); return this }
    order(coluna: string, opcoes?: { ascending?: boolean }) { this.ordem = { coluna, crescente: opcoes?.ascending !== false }; return this }
    limit(n: number) { this.maximo = n; return this }
    abortSignal(sinal: AbortSignal) { this.comTempoMaximo = sinal instanceof AbortSignal; return this }
    insert(linha: L) { this.linhaNova = linha; return this }

    private lista(): L[] {
      if (this.tabela === 'usuarios') return banco.usuarios
      if (this.tabela === 'cupom') return banco.cupons
      if (this.tabela === 'fornecedor_app') return banco.fornecedoresApp
      if (this.tabela === 'fornecedor_cadastro') return banco.fornecedoresCadastro
      if (this.tabela === 'cot_nfe') return banco.notasNfe
      return banco.aprendizado
    }
    private executar(): { data: L[] | L | null; error: { code?: string; message: string } | null } {
      if (this.linhaNova) return this.gravar(this.linhaNova)
      if (this.tabela === 'cupom' && banco.falharLeitura.cupom) return { data: null, error: { message: 'connection reset' } }
      // 29/10: a leitura dos CNPJs conhecidos (para corrigir um CNPJ mal lido) — registra como foi pedida e falha sozinha, por fonte
      const leituraDeConhecidos = this.tabela === 'cupom' ? this.colunasBrutas.includes('emitente_cnpj') : ['fornecedor_app', 'fornecedor_cadastro', 'cot_nfe'].includes(this.tabela)
      if (leituraDeConhecidos) {
        banco.consultasConhecidos.push({
          tabela: this.tabela, colunas: this.colunasBrutas, ordem: this.ordem ? `${this.ordem.coluna} ${this.ordem.crescente ? 'asc' : 'desc'}` : null,
          limite: this.maximo, naoNulos: [...this.naoNulos], comTempoMaximo: this.comTempoMaximo,
        })
        if (banco.falharLeitura[this.tabela === 'cupom' ? 'cupom_conhecidos' : this.tabela]) return { data: null, error: { message: 'connection reset' } }
      }
      if (this.tabela === 'cupom_aprendizado') {
        // registra TODA consulta ao aprendizado (com ou sem filtro): sem filtro seria a tabela inteira
        banco.consultasAprendizado.push(this.orFiltro ?? '(sem filtro)')
        if (banco.falharLeitura.aprendizado) return { data: null, error: { message: 'connection reset' } }
      }
      let linhas = this.lista()
      if (this.tabela === 'cupom' && banco.cegarPrimeiroSelectPorFoto && this.filtros.some(([c]) => c === 'foto_path')) {
        banco.cegarPrimeiroSelectPorFoto = false
        linhas = []
      }
      for (const [c, v] of this.filtros) linhas = linhas.filter((l) => l[c] === v)
      if (this.orFiltro !== null) {
        const listas = [...this.orFiltro.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map((m) => ({
          coluna: m[1], valores: m[2].split(',').map((s) => s.replace(/"/g, '')),
        }))
        const nulos = [...this.orFiltro.matchAll(/(\w+)\.is\.null/g)].map((m) => m[1])
        linhas = linhas.filter((l) =>
          listas.some((x) => x.valores.includes(String(l[x.coluna]))) || nulos.some((c) => l[c] == null))
      }
      for (const c of this.naoNulos) linhas = linhas.filter((l) => l[c] != null)
      if (this.ordem) {
        const { coluna, crescente } = this.ordem
        linhas = [...linhas].sort((x, y) => (String(x[coluna]) < String(y[coluna]) ? -1 : String(x[coluna]) > String(y[coluna]) ? 1 : 0) * (crescente ? 1 : -1))
      }
      if (this.maximo !== null) linhas = linhas.slice(0, this.maximo)
      return { data: linhas, error: null }
    }
    private gravar(l: L): { data: L | null; error: { code?: string; message: string } | null } {
      const faltando = ['estado', 'pagamento', 'itens', 'valor_a_pagar'].find((k) => l[k] === null || l[k] === undefined)
      if (faltando) return { data: null, error: { code: '23502', message: `null value in column "${faltando}" of relation "cupom" violates not-null constraint` } }
      if (l.foto_path != null && banco.cupons.some((c) => c.foto_path === l.foto_path)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_foto_path_uniq"' } }
      }
      if (l.chave != null && banco.cupons.some((c) => c.chave === l.chave)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_chave_uniq"' } }
      }
      const nova = { id: `cupom-${banco.proximoId++}`, ...l }
      banco.cupons.push(nova)
      return { data: nova, error: null }
    }
    /** O PostgREST devolve SÓ as colunas do select(...): quem lê uma coluna que não pediu recebe undefined (nunca o valor). */
    private projetar(linha: L): L {
      return this.colunas === null ? linha : Object.fromEntries(this.colunas.map((c) => [c, linha[c]]))
    }
    private resultado(): { data: L[] | L | null; error: { code?: string; message: string } | null } {
      const r = this.executar()
      if (r.error || r.data === null) return r
      return { data: Array.isArray(r.data) ? r.data.map((l) => this.projetar(l)) : this.projetar(r.data), error: null }
    }
    async maybeSingle() { const r = this.resultado(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error } }
    async single() { const r = this.resultado(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error } }
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(this.resultado()).then(resolve, reject) }
  }

  const admin = {
    auth: {
      async getUser(token: string) {
        const email = banco.tokens[token]
        return email ? { data: { user: { email } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
    },
    storage: {
      from: (_bucket: string) => ({
        async download(caminho: string) {
          const bytes = banco.arquivos[caminho]
          return bytes ? { data: new Blob([bytes], { type: 'image/jpeg' }), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
    from: (tabela: string) => new Consulta(tabela),
  }
  return { banco, ia, admin, clientes }
})

vi.mock('npm:@supabase/supabase-js@2', () => ({
  createClient: (...args: unknown[]) => { h.clientes.criacoes.push(args); return h.admin },
}))
vi.mock('npm:@anthropic-ai/sdk@0.70.0', () => ({
  default: class {
    messages = { create: (pedido: unknown) => { h.ia.chamadas.push(pedido); return h.ia.resposta() } }
    constructor(opcoes: unknown) { h.ia.construcoes.push(opcoes) }
  },
}))

const ORIGEM = 'https://ivanlameiradt-crypto.github.io'
const PAT = 'github_pat_SEGREDO_NAO_VAZAR'
const CHAVE_IA = 'sk-ant-SEGREDO_NAO_VAZAR'
const CHAVE_SERVICO = 'service-role-SEGREDO_NAO_VAZAR'
const SEGREDOS = [PAT, CHAVE_IA, CHAVE_SERVICO]
const CHAVE_FISCAL = '12345678901234567890123456789012345678901234'
const EAN = '7891234567895'

const LEITURA = {
  legivel: true, chave: null, emitente_cnpj: '12.345.678/0001-95', emitente_nome: 'ATACADAO', valor_total: 9, // 29/10: …-95 fecha as contas (o …-90 de antes não fechava)
  itens: [{ descricao: 'ARROZ 5KG', quantidade: 4, unidade: 'UN', valor_unitario: 2.25, desconto: null, codigo_barras: EAN }],
}
const APRENDIZADO = {
  codigo_barras: EAN, emitente_cnpj: '12345678000195', descricao_norm: 'arroz 5kg', insumo_id: '333', insumo_nome: 'ARROZ',
  fator_conversao: '0.5', // numeric chega como texto
  unidade_destino: 'un', confirmado: true,
}
const iaResponde = (leitura: unknown) => () =>
  Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(leitura) }], stop_reason: 'end_turn' })

const CAMINHO_DO_INDEX = './index.ts'
let handler: (req: Request) => Promise<Response>
let env: Record<string, string | undefined> = {}
const fetchFalso = vi.fn<(url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>>()
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
  env = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO, ANTHROPIC_API_KEY: CHAVE_IA, GITHUB_PAT: PAT,
    CUPOM_CONFIRMAR_ANTES: 'OFF', // os testes antigos cobrem o lançamento automático; o novo (confirmar antes) liga abaixo
  }
  h.banco.usuarios = [
    { email: 'ivan@spazio.com', papel: 'admin', ativo: true },
    { email: 'joao@spazio.com', papel: 'comprador', ativo: true },
  ]
  h.banco.cupons = []
  h.banco.aprendizado = [{ ...APRENDIZADO }]
  h.banco.tokens = { 'tok-ivan': 'ivan@spazio.com', 'tok-joao': 'joao@spazio.com' }
  h.banco.arquivos = { 'cupom/a.jpg': new Uint8Array([1, 2, 3, 4]), 'cupom/b.jpg': new Uint8Array([5, 6, 7, 8]) }
  h.banco.consultasAprendizado = []
  h.banco.selects = []
  h.banco.cegarPrimeiroSelectPorFoto = false
  h.banco.falharLeitura = { cupom: false, aprendizado: false, cupom_conhecidos: false, fornecedor_app: false, fornecedor_cadastro: false, cot_nfe: false }
  h.banco.fornecedoresApp = []; h.banco.fornecedoresCadastro = []; h.banco.notasNfe = []; h.banco.consultasConhecidos = []
  h.banco.proximoId = 1
  h.ia.chamadas = []; h.ia.construcoes = []; h.clientes.criacoes = []
  h.ia.resposta = iaResponde(LEITURA)
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
  return new Request('https://x.supabase.co/functions/v1/enviar-cupom', {
    method: metodo, headers, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
  })
}
const PG = { forma: 'pix', conta: 'PIX ITAU IJ' }
const envio = (fotoPath = 'cupom/a.jpg', extra: Linha = {}) => pedido({ foto_path: fotoPath, pagamento: PG, ...extra })
async function corpoDe(r: Response): Promise<Record<string, unknown>> { return (await r.json()) as Record<string, unknown> }
/** nada de segredo na resposta nem no log */
function semVazamento(texto: string) {
  for (const s of SEGREDOS) expect(texto).not.toContain(s)
  expect(errosNoLog.join('\n')).not.toMatch(/SEGREDO_NAO_VAZAR/)
}

describe('enviar-cupom/index.ts — HTTP, CORS e autorização', () => {
  it('OPTIONS: preflight com CORS só para a origem permitida', async () => {
    const ok = await handler(pedido(null, { metodo: 'OPTIONS' }))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(ok.headers.get('access-control-allow-methods')).toMatch(/POST/)
    const de_fora = await handler(pedido(null, { metodo: 'OPTIONS', origem: 'https://malicioso.example' }))
    expect(de_fora.headers.get('access-control-allow-origin')).toBe('')
  })

  it('só POST: GET dá 405', async () => {
    const r = await handler(pedido(null, { metodo: 'GET' }))
    expect(r.status).toBe(405)
  })

  it('sem Authorization: 401, nada lido nem gravado', async () => {
    const r = await handler(pedido({ foto_path: 'cupom/a.jpg', pagamento: PG }, { token: null }))
    expect(r.status).toBe(401)
    expect(h.banco.cupons).toHaveLength(0); expect(h.ia.chamadas).toHaveLength(0); expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('token inválido: 401', async () => {
    const r = await handler(pedido({ foto_path: 'cupom/a.jpg', pagamento: PG }, { token: 'tok-falso' }))
    expect(r.status).toBe(401)
    expect(h.banco.cupons).toHaveLength(0); expect(h.ia.chamadas).toHaveLength(0)
  })

  it('sem a chave da IA (ou sem URL/chave de serviço): 500 claro, SEM gravar linha REVISAR (o dedup travaria o reenvio)', async () => {
    for (const faltando of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) {
      env[faltando] = undefined
      const r = await handler(envio())
      expect(r.status).toBe(500)
      expect(await corpoDe(r)).toEqual({ erro: 'função sem configuração' })
      expect(h.banco.cupons).toHaveLength(0); expect(h.ia.chamadas).toHaveLength(0)
      env[faltando] = { ANTHROPIC_API_KEY: CHAVE_IA, SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO, SUPABASE_URL: 'https://x.supabase.co' }[faltando]
    }
  })

  it('não-admin (comprador): 403; nada baixado, lido, gravado nem disparado', async () => {
    const r = await handler(pedido({ foto_path: 'cupom/a.jpg', pagamento: PG }, { token: 'tok-joao' }))
    expect(r.status).toBe(403)
    expect(h.banco.cupons).toHaveLength(0); expect(h.ia.chamadas).toHaveLength(0); expect(fetchFalso).not.toHaveBeenCalled()
  })
})

describe('enviar-cupom/index.ts — caminho feliz e disparo', () => {
  it('foto → IA → casa (aprendizado confirmado, fator em texto) → grava PENDENTE → dispara o workflow uma vez', async () => {
    const r = await handler(envio('cupom/a.jpg'))
    const corpo = await corpoDe(r)
    expect(r.status).toBe(200)
    expect(corpo).toMatchObject({ cupom_id: 'cupom-1', estado: 'PENDENTE', disparo_ok: true, resumo: 'enviado para lançar' })

    // cliente de serviço de servidor: sem persistir sessão nem renovar token
    expect(h.clientes.criacoes[0]).toEqual(['https://x.supabase.co', CHAVE_SERVICO, { auth: { persistSession: false, autoRefreshToken: false } }])

    // a IA recebeu a foto em base64 (AQIDBA== = bytes 1,2,3,4) com o prompt e o esquema, usando a chave só do servidor
    expect(h.ia.construcoes).toEqual([{ apiKey: CHAVE_IA, timeout: 110_000, maxRetries: 0 }])
    const pedidoIA = h.ia.chamadas[0] as { model: string; messages: { content: { type: string; source?: { data: string; media_type: string } }[] }[] }
    expect(pedidoIA.model).toBe('claude-sonnet-5')
    expect(pedidoIA.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: 'AQIDBA==' } })

    // linha gravada no formato do contrato: casada pelo aprendizado, entrada = 4 × 0,5, CNPJ só dígitos; o preço acompanha a
    // conversão (4 un × R$ 2,25 = R$ 9 → 2 kg a R$ 4,50/kg), então a linha que o robô confere (2 × 4,50) fecha com o total (9)
    expect(h.banco.cupons).toHaveLength(1)
    expect(h.banco.cupons[0]).toMatchObject({
      estado: 'PENDENTE', foto_path: 'cupom/a.jpg', teste: false, emitente_cnpj: '12345678000195', valor_a_pagar: 9,
      pagamento: PG, motivo: null,
    })
    expect((h.banco.cupons[0].itens as Linha[])[0]).toMatchObject({
      sugestao_produto: { id: '333' }, entrada_estoque: 2, valor_unitario: 4.5, desconto_item: 0, casado_por: 'ean',
    })

    // o aprendizado foi buscado pelos sinônimos globais (emitente_cnpj null) + o que a leitura trouxe (EAN e CNPJ, só dígitos)
    expect(h.banco.consultasAprendizado).toEqual([`and(emitente_cnpj.is.null,codigo_barras.is.null),codigo_barras.in.("${EAN}"),emitente_cnpj.in.("12345678000195")`])

    // disparo: POST no workflow certo, ref master, cupom_id, PAT no cabeçalho (e só lá)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFalso.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/ivanlameiradt-crypto/sischef-monitor-notas/actions/workflows/lancar-cupom.yml/dispatches')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${PAT}`)
    expect(JSON.parse(init.body)).toEqual({ ref: 'master', inputs: { cupom_id: 'cupom-1' } })
    expect(init.signal).toBeInstanceOf(AbortSignal) // um GitHub que não responde não pode travar o envio

    semVazamento(JSON.stringify(corpo))
  })

  it('confirmar antes (padrão em produção): tudo casado ⇒ REVISAR "CONFIRMAR:" e o GitHub NÃO é chamado; CUPOM_CONFIRMAR_ANTES=OFF volta ao automático', async () => {
    env.CUPOM_CONFIRMAR_ANTES = undefined
    const r = await handler(envio('cupom/a.jpg'))
    expect(await corpoDe(r)).toMatchObject({ estado: 'REVISAR', disparo_ok: false, resumo: 'todos os itens já conhecidos — confira e confirme no app' })
    expect(h.banco.cupons[0]).toMatchObject({ estado: 'REVISAR' })
    expect(String(h.banco.cupons[0].motivo)).toMatch(/^CONFIRMAR:/)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('teste=true vai para a linha (o robô só ensaia) e o disparo acontece igual', async () => {
    await handler(envio('cupom/a.jpg', { teste: true }))
    expect(h.banco.cupons[0]).toMatchObject({ teste: true, estado: 'PENDENTE' })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('item sem aprendizado confirmado: grava REVISAR e NÃO dispara', async () => {
    h.banco.aprendizado = [{ ...APRENDIZADO, confirmado: false }]
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo).toMatchObject({ estado: 'REVISAR', disparo_ok: false })
    expect(h.banco.cupons[0]).toMatchObject({ estado: 'REVISAR' })
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('RF5: o GitHub recusa (404, 401…) ou não responde ⇒ 200 com disparo_ok:false; a linha fica PENDENTE; sem vazar o PAT', async () => {
    for (const falha of [
      () => fetchFalso.mockResolvedValue({ status: 404, text: async () => '{"message":"Not Found"}' }),
      () => fetchFalso.mockResolvedValue({ status: 401, text: async () => '{"message":"Bad credentials"}' }),
      () => fetchFalso.mockRejectedValue(new Error('network down')),
    ]) {
      h.banco.cupons = []; errosNoLog = []
      falha()
      const r = await handler(envio())
      const corpo = await corpoDe(r)
      expect(r.status).toBe(200)
      expect(corpo).toMatchObject({ cupom_id: 'cupom-1', estado: 'PENDENTE', disparo_ok: false })
      expect(h.banco.cupons[0]).toMatchObject({ estado: 'PENDENTE' })
      semVazamento(JSON.stringify(corpo))
      h.banco.proximoId = 1
    }
  })

  it('RF5: sem GITHUB_PAT o envio não quebra (PENDENTE + disparo_ok:false) e o fetch nem acontece', async () => {
    env.GITHUB_PAT = undefined
    const r = await handler(envio())
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ estado: 'PENDENTE', disparo_ok: false })
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('sem GITHUB_PAT o motivo fica no log do servidor (senão um PAT esquecido gera PENDENTE em silêncio), sem segredo nenhum', async () => {
    env.GITHUB_PAT = undefined
    await handler(envio())
    expect(errosNoLog.join('\n')).toMatch(/workflow_dispatch sem GITHUB_PAT/)
    semVazamento(errosNoLog.join('\n')) // nem o PAT (aqui ausente), nem a chave da IA, nem a de serviço
  })

  it('a falha de disparo é registrada no log SEM o PAT (status e mensagem do GitHub bastam para diagnosticar)', async () => {
    fetchFalso.mockResolvedValue({ status: 401, text: async () => '{"message":"Bad credentials"}' })
    await handler(envio())
    expect(errosNoLog.join('\n')).toMatch(/workflow_dispatch falhou \(HTTP 401\)/)
    expect(errosNoLog.join('\n')).toMatch(/Bad credentials/)
    expect(errosNoLog.join('\n')).not.toContain(PAT)
  })

  it('timeout ou erro de rede do fetch NÃO some: o log leva só o NOME do erro (sem URL, sem PAT) e o envio segue 200 PENDENTE', async () => {
    for (const nome of ['TimeoutError', 'TypeError']) {
      h.banco.cupons = []; h.banco.proximoId = 1; errosNoLog = []
      // a mensagem do fetch pode trazer a URL (e aqui, de propósito, até o PAT): nada disso pode ir ao log
      fetchFalso.mockRejectedValue(Object.assign(new Error(`error sending request for url (https://api.github.com/repos/x) com ${PAT}`), { name: nome }))
      const r = await handler(envio())
      expect(r.status).toBe(200)
      expect(await corpoDe(r)).toMatchObject({ cupom_id: 'cupom-1', estado: 'PENDENTE', disparo_ok: false })
      const log = errosNoLog.join('\n')
      expect(log).toMatch(new RegExp(`workflow_dispatch sem resposta ${nome}`))
      expect(log).not.toContain('api.github.com')
      expect(log).not.toContain(PAT)
    }
  })
})

describe('enviar-cupom/index.ts — o SELECT do aprendizado traz tudo que o casamento lê', () => {
  // O PostgREST devolve só as colunas pedidas. Sem `confirmado` o índice do casamento descarta tudo; sem `fator_conversao` todo
  // item vira incerto (NaN): largar qualquer uma das duas mandaria TODO cupom a REVISAR, em silêncio, em produção.
  it('a lista de colunas cobre a interface Aprendizado (confirmado e fator_conversao inclusive)', async () => {
    await handler(envio())
    const selects = h.banco.selects.filter((s) => s.tabela === 'cupom_aprendizado')
    expect(selects).toHaveLength(1)
    const colunas = selects[0].colunas.split(',').map((c) => c.trim())
    expect(colunas).toEqual(expect.arrayContaining([
      'codigo_barras', 'emitente_cnpj', 'descricao_norm', 'insumo_id', 'insumo_nome', 'fator_conversao', 'unidade_destino', 'confirmado',
    ]))
  })

  it('o banco falso só devolve as colunas pedidas (é isso que faz uma coluna esquecida aparecer nos testes do caminho feliz)', async () => {
    const { data } = (await h.admin.from('cupom_aprendizado').select('insumo_id').eq('confirmado', true)) as unknown as { data: Linha[] }
    expect(data).toEqual([{ insumo_id: '333' }])
  })
})

describe('enviar-cupom/index.ts — idempotência (correções A e B)', () => {
  it('RF1: reenviar a mesma foto ⇒ duplicado:true, sem 2ª linha, sem 2ª leitura por IA, sem 2º disparo', async () => {
    await handler(envio('cupom/a.jpg'))
    const r2 = await handler(envio('cupom/a.jpg'))
    expect(await corpoDe(r2)).toMatchObject({ cupom_id: 'cupom-1', duplicado: true })
    expect(h.banco.cupons).toHaveLength(1)
    expect(h.ia.chamadas).toHaveLength(1)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('A/B corrida: o SELECT não vê a linha, o insert bate no 23505 do foto_path ⇒ devolve a existente, duplicado:true, NÃO dispara', async () => {
    await handler(envio('cupom/a.jpg'))
    fetchFalso.mockClear()
    h.banco.cegarPrimeiroSelectPorFoto = true // outro pedido gravou entre o SELECT do dedup e o INSERT
    const r = await handler(envio('cupom/a.jpg'))
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ cupom_id: 'cupom-1', duplicado: true })
    expect(h.banco.cupons).toHaveLength(1)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('B: 2ª foto do MESMO cupom (foto_path novo, mesma chave) ⇒ 23505 em cupom_chave_uniq ⇒ devolve a 1ª, duplicado:true, NÃO dispara', async () => {
    h.ia.resposta = iaResponde({ ...LEITURA, chave: CHAVE_FISCAL.replace(/(\d{4})(?=\d)/g, '$1 ') }) // chave lida em grupos de 4
    await handler(envio('cupom/a.jpg'))
    expect(h.banco.cupons[0]).toMatchObject({ chave: CHAVE_FISCAL }) // normalizada (C): só os 44 dígitos
    fetchFalso.mockClear()
    const r = await handler(envio('cupom/b.jpg'))
    expect(await corpoDe(r)).toMatchObject({ cupom_id: 'cupom-1', duplicado: true })
    expect(h.banco.cupons).toHaveLength(1)
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})

describe('enviar-cupom/index.ts — falhas', () => {
  it('RF2: a IA falha (429/timeout/chave) ⇒ grava REVISAR com valor_a_pagar 0 (NOT NULL), não dispara, não vaza segredo', async () => {
    h.ia.resposta = () => Promise.reject(Object.assign(new Error(`rate limit for ${CHAVE_IA}`), { name: 'RateLimitError', status: 429 }))
    const r = await handler(envio())
    const corpo = await corpoDe(r)
    expect(r.status).toBe(200)
    expect(corpo).toMatchObject({ estado: 'REVISAR', disparo_ok: false })
    expect(h.banco.cupons[0]).toMatchObject({ estado: 'REVISAR', valor_a_pagar: 0, itens: [], foto_path: 'cupom/a.jpg' })
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(errosNoLog.join('\n')).toMatch(/RateLimitError 429/) // só o tipo e o status vão ao log
    semVazamento(JSON.stringify(corpo))
  })

  it('total ilegível (valor_total null): REVISAR, não dispara — a coluna NOT NULL aceita o 0', async () => {
    h.ia.resposta = iaResponde({ ...LEITURA, valor_total: null })
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo).toMatchObject({ estado: 'REVISAR' })
    expect(h.banco.cupons[0]).toMatchObject({ estado: 'REVISAR', valor_a_pagar: 0 })
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('a foto não está no bucket: 500 com a mensagem do storage; nada gravado nem lido por IA', async () => {
    const r = await handler(envio('cupom/inexistente.jpg'))
    expect(r.status).toBe(500)
    expect(await corpoDe(r)).toEqual({ erro: 'Object not found' })
    expect(h.banco.cupons).toHaveLength(0); expect(h.ia.chamadas).toHaveLength(0)
  })

  it('erro ao procurar o cupom pela foto: 500, sem gastar a IA nem gravar por cima de uma falha de infraestrutura', async () => {
    h.banco.falharLeitura.cupom = true
    const r = await handler(envio())
    expect(r.status).toBe(500)
    expect(await corpoDe(r)).toEqual({ erro: 'connection reset' })
    expect(h.ia.chamadas).toHaveLength(0); expect(h.banco.cupons).toHaveLength(0); expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('erro ao ler o aprendizado: 500 — não vira uma linha REVISAR com motivo errado (o dedup travaria o reenvio)', async () => {
    h.banco.falharLeitura.aprendizado = true
    const r = await handler(envio())
    expect(r.status).toBe(500)
    expect(h.banco.cupons).toHaveLength(0); expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('corpo que não é JSON: 400 (depois de autorizar), nada gravado', async () => {
    const req = new Request('https://x.supabase.co/functions/v1/enviar-cupom', {
      method: 'POST', headers: { origin: ORIGEM, authorization: 'Bearer tok-ivan' }, body: 'isto não é json',
    })
    const r = await handler(req)
    expect(r.status).toBe(400)
    expect(h.banco.cupons).toHaveLength(0)
  })
})

describe('enviar-cupom/index.ts — o que a IA devolve é dado não confiável', () => {
  it('EAN/CNPJ com aspas, vírgulas ou parênteses NUNCA entram no filtro do PostgREST', async () => {
    const sujo = 'x"),confirmado.eq.false,codigo_barras.in.("'
    h.ia.resposta = iaResponde({
      ...LEITURA,
      itens: [
        { ...LEITURA.itens[0], codigo_barras: sujo },
        { ...LEITURA.itens[0], descricao: 'OUTRO', codigo_barras: EAN },
      ],
    })
    await handler(envio())
    expect(h.banco.consultasAprendizado).toHaveLength(1)
    expect(h.banco.consultasAprendizado[0]).toBe(`and(emitente_cnpj.is.null,codigo_barras.is.null),codigo_barras.in.("${EAN}"),emitente_cnpj.in.("12345678000195")`)
    expect(h.banco.consultasAprendizado[0]).not.toContain('confirmado')
  })

  it('sem EAN válido nem CNPJ: consulta SÓ os sinônimos globais (não a tabela inteira) e, sem match global, vai a REVISAR', async () => {
    h.ia.resposta = iaResponde({
      ...LEITURA, emitente_cnpj: '123', itens: [{ ...LEITURA.itens[0], codigo_barras: null }],
    })
    const corpo = await corpoDe(await handler(envio()))
    // ainda consulta, mas recortada nos globais (emitente_cnpj null) — nunca a tabela inteira
    expect(h.banco.consultasAprendizado).toEqual(['and(emitente_cnpj.is.null,codigo_barras.is.null)'])
    expect(corpo).toMatchObject({ estado: 'REVISAR' }) // o único aprendizado do banco é por fornecedor, não global
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('sinônimo GLOBAL (emitente_cnpj null) casa item de um fornecedor NOVO → PENDENTE e dispara', async () => {
    // fornecedor nunca visto e sem EAN: só um sinônimo global pela descrição faz casar
    h.banco.aprendizado = [{
      codigo_barras: null, emitente_cnpj: null, descricao_norm: 'arroz 5kg', insumo_id: '777', insumo_nome: 'ARROZ',
      fator_conversao: '1', unidade_destino: 'un', confirmado: true,
    }]
    h.ia.resposta = iaResponde({
      ...LEITURA, emitente_cnpj: '11.222.333/0001-81', itens: [{ ...LEITURA.itens[0], codigo_barras: null }],
    })
    const corpo = await corpoDe(await handler(envio()))
    expect(h.banco.consultasAprendizado).toEqual([`and(emitente_cnpj.is.null,codigo_barras.is.null),emitente_cnpj.in.("11222333000181")`])
    expect(corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true })
    expect(h.banco.cupons[0]).toMatchObject({ itens: [{ sugestao_produto: { id: '777' }, casado_por: 'descricao', entrada_estoque: 4 }] })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })
})

// ---- CNPJ lido errado na foto (pedido do Ivan, 29/10/2026). Os CNPJs que o app já conhece vêm de 4 tabelas (cupom, fornecedor_app, fornecedor_cadastro, cot_nfe), lidas com a
// chave de serviço, UMA fonte por vez e sem que a falha de uma impeça as outras; só são lidas quando o CNPJ lido NÃO fecha as contas (cupom comum não paga essa leitura).
describe('enviar-cupom/index.ts — CNPJ lido errado na foto', () => {
  const SILVA_CERTO = '63540861000182'
  const SILVA_ERRADO = '63540861000102' // o caso real de 22/10: o "8" virou "0"
  const NOME_SILVA = 'A. N. DA SILVA DESCARTAVEIS LTDA'
  const FRASE = `corrigi o CNPJ lido na foto: era 63.540.861/0001-02, agora 63.540.861/0001-82, o da ${NOME_SILVA}`
  const AVISO = 'o CNPJ lido na foto (63.540.861/0001-02) não fecha as contas dos números: confira na foto'
  const FONTES = ['cupom', 'fornecedor_app', 'fornecedor_cadastro', 'cot_nfe'] as const
  type Fonte = (typeof FONTES)[number]
  const chaveDaFalha = (f: Fonte) => (f === 'cupom' ? 'cupom_conhecidos' : f)

  /** Põe um CNPJ conhecido numa fonte (por padrão o CERTO da A. N. da Silva): cada fonte tem as suas colunas. */
  function semear(fonte: Fonte, cnpj = SILVA_CERTO, nome: string | null = NOME_SILVA) {
    const n = h.banco.cupons.length + h.banco.fornecedoresApp.length + h.banco.fornecedoresCadastro.length + h.banco.notasNfe.length
    if (fonte === 'cupom') h.banco.cupons.push({ id: `velho-${n}`, estado: 'LANCADO', foto_path: `cupom/velha-${n}.jpg`, chave: null, emitente_cnpj: cnpj, emitente_nome: nome, criado_em: '2026-10-08T20:54:49Z' })
    if (fonte === 'fornecedor_app') h.banco.fornecedoresApp.push({ cnpj, razao_social: nome, atualizado_em: '2026-10-08T20:00:00Z' })
    if (fonte === 'fornecedor_cadastro') h.banco.fornecedoresCadastro.push({ cnpj, razao_social: nome, criado_em: '2026-10-08T20:00:00Z' })
    if (fonte === 'cot_nfe') h.banco.notasNfe.push({ chave: String(n).padStart(44, '0'), cnpj_emitente: cnpj, emitente: nome, emissao: '2026-10-20' })
  }
  const ultimoGravado = () => h.banco.cupons[h.banco.cupons.length - 1]

  beforeEach(() => {
    // a IA leu o CNPJ da A. N. da Silva com um dígito errado, sem EAN no item; só o CNPJ CERTO tem o produto aprendido
    h.ia.resposta = iaResponde({
      ...LEITURA, emitente_cnpj: '63.540.861/0001-02', emitente_nome: 'A. N. DA SILVA DESCARTAVEIS',
      itens: [{ ...LEITURA.itens[0], codigo_barras: null }],
    })
    h.banco.aprendizado = [{ ...APRENDIZADO, codigo_barras: null, emitente_cnpj: SILVA_CERTO }]
  })

  it.each(FONTES)('a fonte %s, SOZINHA, basta: o CNPJ lido errado vira o certo, o item casa e o cupom sai para lançar', async (fonte) => {
    semear(fonte)
    const r = await handler(envio())
    const corpo = await corpoDe(r)
    expect(r.status).toBe(200)
    expect(corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true, resumo: `enviado para lançar; ${FRASE}` })
    expect(ultimoGravado()).toMatchObject({ estado: 'PENDENTE', emitente_cnpj: SILVA_CERTO, emitente_nome: 'A. N. DA SILVA DESCARTAVEIS' }) // o nome lido fica como veio
    // o aprendizado foi buscado pelo CNPJ CERTO (e só por ele)
    expect(h.banco.consultasAprendizado).toEqual([`and(emitente_cnpj.is.null,codigo_barras.is.null),emitente_cnpj.in.("${SILVA_CERTO}")`])
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    semVazamento(JSON.stringify(corpo))
  })

  it('o mesmo CNPJ nas quatro fontes conta UMA vez (não vira "dois candidatos")', async () => {
    for (const f of FONTES) semear(f)
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo).toMatchObject({ estado: 'PENDENTE', resumo: `enviado para lançar; ${FRASE}` })
    expect(ultimoGravado()).toMatchObject({ emitente_cnpj: SILVA_CERTO })
  })

  it('o nome que o Ivan lê no resumo é o do cadastro (razão social), não o que a IA leu num cupom antigo', async () => {
    semear('cupom', SILVA_CERTO, 'A. N. DA SILVA DESC') // como a IA leu no cupom antigo
    semear('fornecedor_cadastro', SILVA_CERTO, NOME_SILVA)
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo.resumo).toBe(`enviado para lançar; ${FRASE}`)
  })

  it('nenhuma fonte tem o CNPJ certo (só outros fornecedores): nada é corrigido, o cupom segue com o número lido e o resumo avisa', async () => {
    semear('cupom', '03995515011363', 'MATEUS SUPERMERCADOS SA')
    semear('fornecedor_app', '75315333032655', 'ATACADAO S.A.')
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo).toMatchObject({ estado: 'REVISAR', disparo_ok: false, resumo: `1 item(ns) para você conferir; ${AVISO}` })
    expect(ultimoGravado()).toMatchObject({ emitente_cnpj: SILVA_ERRADO })
    expect(h.banco.consultasAprendizado).toEqual([`and(emitente_cnpj.is.null,codigo_barras.is.null),emitente_cnpj.in.("${SILVA_ERRADO}")`])
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('CNPJ conhecido que NÃO fecha as contas (lixo gravado antes) não vale como candidato, nem atrapalha o que vale', async () => {
    semear('cupom', '63540861000103', NOME_SILVA) // a um dígito do lido, mas não fecha as contas
    const sozinho = await corpoDe(await handler(envio()))
    expect(sozinho.resumo).toBe(`1 item(ns) para você conferir; ${AVISO}`)
    h.banco.cupons = []; h.banco.proximoId = 1; fetchFalso.mockClear()
    semear('cupom', '63540861000103', NOME_SILVA)
    semear('cot_nfe') // o certo, em outra fonte
    const junto = await corpoDe(await handler(envio()))
    expect(junto.resumo).toBe(`enviado para lançar; ${FRASE}`)
  })

  it('nome incompatível (a IA leu outra empresa): não corrige e avisa, mesmo sendo o único CNPJ a um dígito', async () => {
    semear('cot_nfe', SILVA_CERTO, 'PADARIA PAO QUENTE LTDA')
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo.resumo).toBe(`1 item(ns) para você conferir; ${AVISO}`)
    expect(ultimoGravado()).toMatchObject({ emitente_cnpj: SILVA_ERRADO })
  })

  it('nome do conhecido ausente (null): vale; a frase fica sem o "o da …"', async () => {
    semear('fornecedor_app', SILVA_CERTO, null)
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo.resumo).toBe('enviado para lançar; corrigi o CNPJ lido na foto: era 63.540.861/0001-02, agora 63.540.861/0001-82')
  })

  it.each(FONTES)('só a fonte %s tem o CNPJ e as OUTRAS TRÊS falham: ainda corrige (uma fonte que cai não impede as outras)', async (fonte) => {
    semear(fonte)
    for (const f of FONTES) if (f !== fonte) h.banco.falharLeitura[chaveDaFalha(f)] = true
    const corpo = await corpoDe(await handler(envio()))
    expect(corpo).toMatchObject({ estado: 'PENDENTE', resumo: `enviado para lançar; ${FRASE}` })
    const log = errosNoLog.join('\n')
    for (const f of FONTES) {
      if (f !== fonte) expect(log).toContain(`não consegui ler os CNPJs conhecidos de ${f}`)
      else expect(log).not.toContain(`conhecidos de ${f}`)
    }
    semVazamento(JSON.stringify(corpo))
  })

  it('as QUATRO fontes falham: o envio NÃO cai (200, linha gravada com o número lido) e o resumo só avisa que o número não fecha as contas', async () => {
    for (const f of FONTES) h.banco.falharLeitura[chaveDaFalha(f)] = true
    const r = await handler(envio())
    const corpo = await corpoDe(r)
    expect(r.status).toBe(200)
    expect(corpo).toMatchObject({ estado: 'REVISAR', resumo: `1 item(ns) para você conferir; ${AVISO}` })
    expect(ultimoGravado()).toMatchObject({ emitente_cnpj: SILVA_ERRADO })
    expect(errosNoLog.filter((l) => l.includes('não consegui ler os CNPJs conhecidos de'))).toHaveLength(4)
    expect(errosNoLog.join('\n')).toContain('connection reset') // só a mensagem do banco; nada de segredo
    semVazamento(JSON.stringify(corpo))
  })

  it('CNPJ que fecha as contas: nenhuma das quatro fontes é lida (cupom comum não paga essa leitura) e o resumo é o de sempre', async () => {
    h.ia.resposta = iaResponde(LEITURA) // 12.345.678/0001-95 fecha as contas
    h.banco.aprendizado = [{ ...APRENDIZADO }] // o do arroz, que casa pelo EAN: o cupom sai sozinho
    const corpo = await corpoDe(await handler(envio()))
    expect(h.banco.consultasConhecidos).toEqual([])
    expect(corpo.resumo).toBe('enviado para lançar')
  })

  it('sem CNPJ lido: nenhuma das quatro fontes é lida', async () => {
    h.ia.resposta = iaResponde({ ...LEITURA, emitente_cnpj: null })
    await handler(envio())
    expect(h.banco.consultasConhecidos).toEqual([])
  })

  it('cada fonte é pedida UMA vez, só com as duas colunas, sem CNPJ nulo, as linhas mais novas primeiro, no máximo 1000 e com tempo máximo', async () => {
    await handler(envio())
    expect(h.banco.consultasConhecidos).toHaveLength(4)
    const por = Object.fromEntries(h.banco.consultasConhecidos.map((c) => [c.tabela, c]))
    expect(por.fornecedor_cadastro).toMatchObject({ colunas: 'cnpj, razao_social', ordem: 'criado_em desc', naoNulos: ['cnpj'] })
    expect(por.fornecedor_app).toMatchObject({ colunas: 'cnpj, razao_social', ordem: 'atualizado_em desc', naoNulos: ['cnpj'] })
    expect(por.cot_nfe).toMatchObject({ colunas: 'cnpj_emitente, emitente', ordem: 'emissao desc', naoNulos: ['cnpj_emitente'] })
    expect(por.cupom).toMatchObject({ colunas: 'emitente_cnpj, emitente_nome', ordem: 'criado_em desc', naoNulos: ['emitente_cnpj'] })
    for (const c of h.banco.consultasConhecidos) expect(c).toMatchObject({ limite: 1000, comTempoMaximo: true })
  })

  describe('o PostgREST corta em 1000 linhas por pedido: vale o que está entre as 1000 MAIS NOVAS de cada fonte', () => {
    /** 1200 notas, da mais velha (i = 0) à mais nova (i = 1199), todas de uma empresa de exemplo; `onde` diz em qual delas está o CNPJ certo. */
    function muitasNotas(onde: number) {
      for (let i = 0; i < 1200; i++) {
        h.banco.notasNfe.push({
          chave: String(i).padStart(44, '0'), cnpj_emitente: i === onde ? SILVA_CERTO : '11222333000181',
          emitente: i === onde ? NOME_SILVA : 'EMPRESA EXEMPLO LTDA', emissao: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
        })
      }
    }
    it('o CNPJ certo na nota mais NOVA (dentro do corte): é achado', async () => {
      muitasNotas(1199)
      const corpo = await corpoDe(await handler(envio()))
      expect(corpo.resumo).toBe(`enviado para lançar; ${FRASE}`)
    })
    it('o CNPJ certo só na nota mais VELHA (fora das 1000 mais novas): não é achado — o limite conhecido, e o resumo avisa em vez de calar', async () => {
      muitasNotas(0)
      const corpo = await corpoDe(await handler(envio()))
      expect(corpo.resumo).toBe(`1 item(ns) para você conferir; ${AVISO}`)
    })
  })
})
