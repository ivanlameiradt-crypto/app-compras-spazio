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
    tokens: {} as Record<string, string>,
    arquivos: {} as Record<string, Uint8Array<ArrayBuffer>>,
    consultasAprendizado: [] as string[],
    /** cada select(...) pedido: tabela e lista de colunas */
    selects: [] as { tabela: string; colunas: string }[],
    /** simula a corrida: o PRIMEIRO SELECT por foto_path (o do dedup) "não vê" a linha que outro pedido gravou logo depois */
    cegarPrimeiroSelectPorFoto: false,
    /** leitura que falha (rede/permissão): o select devolve erro em vez de dados */
    falharLeitura: { cupom: false, aprendizado: false },
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
    private linhaNova: L | null = null
    private colunas: string[] | null = null // null = todas (select('*') ou sem argumento)
    constructor(private tabela: string) {}
    select(colunas?: string) {
      banco.selects.push({ tabela: this.tabela, colunas: colunas ?? '*' })
      this.colunas = colunas && colunas.trim() !== '*' ? colunas.split(',').map((c) => c.trim()) : null
      return this
    }
    eq(coluna: string, valor: unknown) { this.filtros.push([coluna, valor]); return this }
    or(filtro: string) { this.orFiltro = filtro; return this }
    insert(linha: L) { this.linhaNova = linha; return this }

    private lista(): L[] {
      if (this.tabela === 'usuarios') return banco.usuarios
      if (this.tabela === 'cupom') return banco.cupons
      return banco.aprendizado
    }
    private executar(): { data: L[] | L | null; error: { code?: string; message: string } | null } {
      if (this.linhaNova) return this.gravar(this.linhaNova)
      if (this.tabela === 'cupom' && banco.falharLeitura.cupom) return { data: null, error: { message: 'connection reset' } }
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
  legivel: true, chave: null, emitente_cnpj: '12.345.678/0001-90', emitente_nome: 'ATACADAO', valor_total: 9,
  itens: [{ descricao: 'ARROZ 5KG', quantidade: 4, unidade: 'UN', valor_unitario: 2.25, desconto: null, codigo_barras: EAN }],
}
const APRENDIZADO = {
  codigo_barras: EAN, emitente_cnpj: '12345678000190', descricao_norm: 'arroz 5kg', insumo_id: '333', insumo_nome: 'ARROZ',
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
  h.banco.falharLeitura = { cupom: false, aprendizado: false }
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
      estado: 'PENDENTE', foto_path: 'cupom/a.jpg', teste: false, emitente_cnpj: '12345678000190', valor_a_pagar: 9,
      pagamento: PG, motivo: null,
    })
    expect((h.banco.cupons[0].itens as Linha[])[0]).toMatchObject({
      sugestao_produto: { id: '333' }, entrada_estoque: 2, valor_unitario: 4.5, desconto_item: 0, casado_por: 'ean',
    })

    // o aprendizado foi buscado pelos sinônimos globais (emitente_cnpj null) + o que a leitura trouxe (EAN e CNPJ, só dígitos)
    expect(h.banco.consultasAprendizado).toEqual([`emitente_cnpj.is.null,codigo_barras.in.("${EAN}"),emitente_cnpj.in.("12345678000190")`])

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
    expect(h.banco.consultasAprendizado[0]).toBe(`emitente_cnpj.is.null,codigo_barras.in.("${EAN}"),emitente_cnpj.in.("12345678000190")`)
    expect(h.banco.consultasAprendizado[0]).not.toContain('confirmado')
  })

  it('sem EAN válido nem CNPJ: consulta SÓ os sinônimos globais (não a tabela inteira) e, sem match global, vai a REVISAR', async () => {
    h.ia.resposta = iaResponde({
      ...LEITURA, emitente_cnpj: '123', itens: [{ ...LEITURA.itens[0], codigo_barras: null }],
    })
    const corpo = await corpoDe(await handler(envio()))
    // ainda consulta, mas recortada nos globais (emitente_cnpj null) — nunca a tabela inteira
    expect(h.banco.consultasAprendizado).toEqual(['emitente_cnpj.is.null'])
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
      ...LEITURA, emitente_cnpj: '98.765.432/0001-10', itens: [{ ...LEITURA.itens[0], codigo_barras: null }],
    })
    const corpo = await corpoDe(await handler(envio()))
    expect(h.banco.consultasAprendizado).toEqual([`emitente_cnpj.is.null,emitente_cnpj.in.("98765432000110")`])
    expect(corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true })
    expect(h.banco.cupons[0]).toMatchObject({ itens: [{ sugestao_produto: { id: '777' }, casado_por: 'descricao', entrada_estoque: 4 }] })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })
})
