// Roda o index.ts de verdade (handler HTTP + logica.ts + gravacao.ts + parecida.ts) com tudo que é do Deno/rede trocado por falsos: o global `Deno`, o cliente do Supabase e o `fetch` do GitHub
// (molde: confirmar-cupom/index.test.ts). Aqui se prova a LIGAÇÃO do E5 (compra repetida, pedido do Ivan de 04/11/2026): as consultas que o index.ts monta (cupom e cot_nfe), o 409 com a frase,
// a marca "outra compra" gravada na linha, o duplo toque antes da procura e o 503 quando a consulta falha.
import { vi } from 'vitest'

type Linha = Record<string, unknown>

const h = vi.hoisted(() => {
  type L = Record<string, unknown>
  type Filtro = [op: 'eq' | 'is' | 'in' | 'gte', coluna: string, valor: unknown]
  type Erro = { code?: string; message: string }
  const banco = {
    usuarios: [] as L[],
    cupons: [] as L[],
    notas: [] as L[],
    itensSemana: [] as L[],
    planilha: [] as L[],
    tokens: {} as Record<string, string>,
    operacoes: [] as { tabela: string; tipo: 'select' | 'insert'; filtros: Filtro[]; dados?: L }[],
    /** leitura que falha (rede/permissão) em cada tabela */
    falharLeitura: { cupom: false, cot_nfe: false } as Record<string, boolean>,
    proximoId: 1,
  }
  class Consulta {
    private filtros: Filtro[] = []
    private linhaNova: L | null = null
    private colunas: string[] | null = null
    private limite: number | null = null
    constructor(private tabela: string) {}
    select(colunas?: string) { this.colunas = colunas && colunas.trim() !== '*' ? colunas.split(',').map((c) => c.trim()) : null; return this }
    eq(coluna: string, valor: unknown) { this.filtros.push(['eq', coluna, valor]); return this }
    is(coluna: string, valor: unknown) { this.filtros.push(['is', coluna, valor]); return this }
    in(coluna: string, valor: unknown) { this.filtros.push(['in', coluna, valor]); return this }
    gte(coluna: string, valor: unknown) { this.filtros.push(['gte', coluna, valor]); return this }
    limit(n: number) { this.limite = n; return this }
    insert(linha: L) { this.linhaNova = linha; return this }
    private lista(): L[] {
      if (this.tabela === 'usuarios') return banco.usuarios
      if (this.tabela === 'cupom') return banco.cupons
      if (this.tabela === 'cot_nfe') return banco.notas
      if (this.tabela === 'itens_semana') return banco.itensSemana
      if (this.tabela === 'produto_planilha') return banco.planilha
      throw new Error(`tabela ${this.tabela} não prevista no banco falso`)
    }
    private filtrar(linhas: L[]): L[] {
      let r = linhas
      for (const [op, c, v] of this.filtros) {
        r = r.filter((l) => {
          if (op === 'is') return v === null ? l[c] == null : l[c] === v
          if (op === 'in') return (v as unknown[]).map(String).includes(String(l[c]))   // o PostgREST compara texto com número sem reclamar
          if (op === 'gte') return String(l[c]) >= String(v)
          return l[c] === v
        })
      }
      return r
    }
    private executar(): { data: L[] | null; error: Erro | null } {
      if (this.linhaNova) {
        banco.operacoes.push({ tabela: this.tabela, tipo: 'insert', filtros: [], dados: this.linhaNova })
        const l = this.linhaNova
        if (this.tabela !== 'cupom') return { data: null, error: { message: `insert em ${this.tabela} não previsto` } }
        // o índice único PARCIAL de foto_path (where foto_path is not null)
        if (l.foto_path != null && banco.cupons.some((c) => c.foto_path === l.foto_path)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_foto_path_uniq"' } }
        const nova = { id: `novo-${banco.proximoId++}`, criado_em: '2026-11-05T05:00:00Z', ...l }
        banco.cupons.push(nova)
        return { data: [nova], error: null }
      }
      banco.operacoes.push({ tabela: this.tabela, tipo: 'select', filtros: this.filtros })
      if (banco.falharLeitura[this.tabela]) return { data: null, error: { message: 'connection reset' } }
      let linhas = this.filtrar(this.lista())
      if (this.limite !== null) linhas = linhas.slice(0, this.limite)
      return { data: linhas, error: null }
    }
    private projetar(linha: L): L { return this.colunas === null ? linha : Object.fromEntries(this.colunas.map((c) => [c, linha[c]])) }
    private resultado() {
      const r = this.executar()
      if (r.error || r.data === null) return r
      return { data: r.data.map((l) => this.projetar(l)), error: null as Erro | null }
    }
    async maybeSingle() { const r = this.resultado(); return { data: r.data ? (r.data[0] ?? null) : null, error: r.error } }
    async single() { const r = this.resultado(); return { data: r.data ? (r.data[0] ?? null) : null, error: r.error } }
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
const ENVIO = '3f2b8c1e-5d4a-4e7b-9a10-6c2d8f0b1a23'
const CNPJ = '75315333032655'
const CORPO = {
  envio_id: ENVIO, fornecedor: { cnpj: '75.315.333/0326-55', nome: 'ATACADAO S.A.' }, pagamento: { forma: 'dinheiro', conta: 'DINHEIRO - À Vista' },
  itens: [{ produto_id: 1001, quantidade: 12.5, preco: 8.9, descricao: 'TOMATE ITALIANO' }, { produto_id: 3862312, quantidade: 1000, preco: 1.516 }],   // total R$ 1627,25
}
const URL_DISPARO = 'https://api.github.com/repos/ivanlameiradt-crypto/sischef-monitor-notas/actions/workflows/lancar-cupom.yml/dispatches'

const CAMINHO_DO_INDEX = './index.ts'
let handler: (req: Request) => Promise<Response>
let env: Record<string, string | undefined> = {}
const fetchFalso = vi.fn<(url: string, init: { method: string; body: string }) => Promise<{ status: number; text(): Promise<string> }>>()
let errosNoLog: string[] = []

beforeAll(async () => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] }, serve: (fn: (req: Request) => Promise<Response>) => { handler = fn } }
  vi.stubGlobal('fetch', fetchFalso)
  await import(/* @vite-ignore */ CAMINHO_DO_INDEX)
})
afterAll(() => { delete (globalThis as unknown as { Deno?: unknown }).Deno; vi.unstubAllGlobals() })
beforeEach(() => {
  // o index usa `new Date()` (a janela de 45 dias): relógio fixo, senão os cupons de 03/10 destes testes saem da janela daqui a umas semanas e o teste passa a falhar sozinho
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T05:00:00Z'))
  env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-SEGREDO_NAO_VAZAR', GITHUB_PAT: PAT }
  h.banco.usuarios = [{ email: 'ivan@spazio.com', papel: 'admin', ativo: true }]
  h.banco.cupons = []
  h.banco.notas = []
  h.banco.itensSemana = [{ produto_id: 1001 }, { produto_id: 3862312 }]
  h.banco.planilha = []
  h.banco.tokens = { 'tok-ivan': 'ivan@spazio.com' }
  h.banco.operacoes = []
  h.banco.falharLeitura = { cupom: false, cot_nfe: false }
  h.banco.proximoId = 1
  fetchFalso.mockReset()
  fetchFalso.mockResolvedValue({ status: 204, text: async () => '' })
  errosNoLog = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errosNoLog.push(args.map(String).join(' ')) })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const pedido = (corpo: unknown) => new Request('https://x.supabase.co/functions/v1/enviar-compra-avulsa', {
  method: 'POST', headers: { origin: ORIGEM, 'content-type': 'application/json', authorization: 'Bearer tok-ivan' }, body: JSON.stringify(corpo),
})
async function corpoDe(r: Response): Promise<Record<string, unknown>> { return (await r.json()) as Record<string, unknown> }
const jaLancado = (over: Linha = {}): Linha => ({
  id: 'c-lancado', estado: 'LANCADO', origem: 'cupom', emitente_cnpj: CNPJ, valor_a_pagar: '1627.25', pedido_sischef: '163377089', motivo: null, criado_em: '2026-10-03T18:04:00Z', teste: false, foto_path: 'cupom/x.jpg', ...over,
})
const gravacoes = () => h.banco.operacoes.filter((o) => o.tipo === 'insert')

describe('enviar-compra-avulsa/index.ts — compra repetida (E5)', () => {
  it('nada parecido: grava a compra e dispara o robô, como sempre', async () => {
    const r = await handler(pedido(CORPO))
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ estado: 'PENDENTE', disparo_ok: true })
    expect(gravacoes()).toHaveLength(1)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    expect(fetchFalso.mock.calls[0][0]).toBe(URL_DISPARO)
    expect(h.banco.cupons[0]).not.toHaveProperty('outra_compra_ok_em')
  })

  it('o Atacadão repetido: cupom LANCADO do mesmo CNPJ e total ⇒ 409 com a frase, NADA gravado, o GitHub NÃO é chamado', async () => {
    h.banco.cupons = [jaLancado()]
    const r = await handler(pedido(CORPO))
    expect(r.status).toBe(409)
    expect(String((await corpoDe(r)).erro)).toBe('POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 1627,25): cupom de 03/10, lançado no SisChef (pedido 163377089).')
    expect(gravacoes()).toEqual([])
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('as consultas que o index.ts monta: cupom (CNPJ, sem teste, 4 estados, janela) e cot_nfe (CNPJ, sem descartadas, janela)', async () => {
    h.banco.cupons = [jaLancado()]
    await handler(pedido(CORPO))
    const leituras = h.banco.operacoes.filter((o) => o.tipo === 'select')
    const cupons = leituras.find((o) => o.tabela === 'cupom' && o.filtros.some(([, c]) => c === 'emitente_cnpj'))!
    expect(cupons.filtros).toEqual(expect.arrayContaining([
      ['eq', 'emitente_cnpj', CNPJ], ['eq', 'teste', false], ['in', 'estado', ['LANCADO', 'PENDENTE', 'PROCESSANDO', 'REVISAR']],
    ]))
    expect(cupons.filtros.some(([op, c]) => op === 'gte' && c === 'criado_em')).toBe(true)
    const notas = leituras.find((o) => o.tabela === 'cot_nfe')!
    expect(notas.filtros).toEqual(expect.arrayContaining([['eq', 'cnpj_emitente', CNPJ], ['is', 'descartada_em', null]]))
    expect(notas.filtros.some(([op, c]) => op === 'gte' && c === 'emissao')).toBe(true)
  })

  it('nota fiscal lançada do mesmo CNPJ e total também avisa (a compra já entrou pela nota)', async () => {
    h.banco.notas = [{ chave: '3'.repeat(44), cnpj_emitente: CNPJ, numero: '000112786', emissao: '2026-10-16', valor_nf: '1627.25', situacao: 'lancada', lancamento_estado: null, nf_sischef: '4410', descartada_em: null }]
    const r = await handler(pedido(CORPO))
    expect(r.status).toBe(409)
    expect(String((await corpoDe(r)).erro)).toContain('nota fiscal nº 000112786 de 16/10, lançada no SisChef')
    expect(gravacoes()).toEqual([])
  })

  it('"É outra compra" (outra_compra: true): grava com a marca (quando e quem) e dispara', async () => {
    h.banco.cupons = [jaLancado()]
    const r = await handler(pedido({ ...CORPO, outra_compra: true }))
    expect(r.status).toBe(200)
    const nova = h.banco.cupons.find((c) => c.foto_path === `avulsa/${ENVIO}`)!
    expect(nova).toMatchObject({ estado: 'PENDENTE', origem: 'avulsa', outra_compra_ok_por: 'ivan@spazio.com' })
    expect(String(nova.outra_compra_ok_em)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('reenvio do MESMO envio (a rede caiu depois de gravar): "já recebido", sem aviso falso de repetida e sem disparar de novo', async () => {
    h.banco.cupons = [{ ...jaLancado({ id: 'c-antigo', estado: 'PENDENTE', origem: 'avulsa', pedido_sischef: null, criado_em: '2026-11-05T04:59:00Z' }), foto_path: `avulsa/${ENVIO}` }]
    const r = await handler(pedido(CORPO))
    expect(r.status).toBe(200)
    expect(await corpoDe(r)).toMatchObject({ cupom_id: 'c-antigo', resumo: 'já recebido', duplicado: true })
    expect(gravacoes()).toEqual([])
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(h.banco.operacoes.filter((o) => o.tipo === 'select' && o.filtros.some(([, c]) => c === 'emitente_cnpj'))).toEqual([])   // nem chegou a procurar parecidas
  })

  it('a consulta falhou (cupom ou cot_nfe): 503 em texto simples, nada gravado, nada disparado, sem segredo no log', async () => {
    for (const tabela of ['cupom', 'cot_nfe']) {
      h.banco.operacoes = []
      h.banco.cupons = []
      h.banco.falharLeitura = { cupom: false, cot_nfe: false, [tabela]: true }
      // com a leitura de `cupom` quebrada, o duplo toque (foto_path) também falharia: o erro sobe como 500 do index; com só cot_nfe quebrada o 503 vem da procura
      const r = await handler(pedido(CORPO))
      expect([500, 503]).toContain(r.status)
      expect(gravacoes()).toEqual([])
      expect(fetchFalso).not.toHaveBeenCalled()
      expect(JSON.stringify(await corpoDe(r))).not.toContain('SEGREDO_NAO_VAZAR')
      expect(errosNoLog.join('\n')).not.toContain('SEGREDO_NAO_VAZAR')
    }
    h.banco.falharLeitura = { cupom: false, cot_nfe: true }
    const r = await handler(pedido(CORPO))
    expect(r.status).toBe(503)
    expect(String((await corpoDe(r)).erro)).toBe('Não consegui conferir se esta compra é repetida agora. Tente de novo em instantes.')
  })
})
