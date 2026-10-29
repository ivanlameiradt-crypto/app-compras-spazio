// Memória de embalagem das notas fiscais (29/10/2026), as duas chamadas do app ao banco: memoriaDeEmbalagem (lê tudo o que o robô lembra) e esquecerEmbalagem (o botão "Esquecer").
// O cliente do Supabase é simulado; o banco de verdade é testado em tests/db/nfe-aprendizado-esquecer.test.ts.
const rpc = vi.fn()
const from = vi.fn()
vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}))
import { ErroApi, esquecerEmbalagem, memoriaDeEmbalagem } from '../../src/lib/api'

type Resposta = { data: Record<string, unknown>[] | null; error: { message: string; code?: string } | null; count?: number | null; status?: number }

/** Imita a consulta do supabase-js que a leitura usa: select → order (varias) → range, que entrega a resposta da vez. */
function cadeia(respostas: Resposta[]) {
  let vez = 0
  const c = {
    select: vi.fn((_colunas: string, _opcoes?: unknown) => c),
    order: vi.fn((_coluna: string, _opcoes?: unknown) => c),
    range: vi.fn(async (_de: number, _ate: number) => respostas[Math.min(vez++, respostas.length - 1)]),
  }
  return c
}
const CRUA = {
  emitente_cnpj: '12345678000190', cod_forn: '17253', unidade_nota: 'UN', produto_id: 101, produto_nome: 'COCA COLA 350 ML', fator: 6, preco_ref: 42,
  descricao_exemplo: 'REFRIG COLA 6X350ML', vezes: 2, ultima_chave: '1'.repeat(44), atualizado_em: '2026-10-28T20:15:00+00:00',
}

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('memoriaDeEmbalagem — lê tudo o que o robô lembra', () => {
  it('lê a tabela nfe_aprendizado, na ordem da chave única, só com as colunas do tipo', async () => {
    const q = cadeia([{ data: [CRUA], error: null, count: 1 }])
    from.mockReturnValue(q)
    expect(await memoriaDeEmbalagem()).toEqual([CRUA])
    expect(from).toHaveBeenCalledWith('nfe_aprendizado')
    expect(String(q.select.mock.calls[0][0]).split(',').map((c) => c.trim())).toEqual([
      'emitente_cnpj', 'cod_forn', 'unidade_nota', 'produto_id', 'produto_nome', 'fator', 'preco_ref', 'descricao_exemplo', 'vezes', 'ultima_chave', 'atualizado_em',
    ])
    expect(q.order.mock.calls.map((c) => c[0])).toEqual(['emitente_cnpj', 'cod_forn', 'unidade_nota'])      // ordem total: a leitura em páginas não repete nem pula linha
  })

  it('numeric que chega como texto vira número (fator, preço, produto, vezes); o resto fica como veio', async () => {
    from.mockReturnValue(cadeia([{ data: [{ ...CRUA, fator: '12', preco_ref: '42.50', produto_id: '101', vezes: '3' }], error: null, count: 1 }]))
    expect(await memoriaDeEmbalagem()).toEqual([{ ...CRUA, fator: 12, preco_ref: 42.5, produto_id: 101, vezes: 3 }])
  })

  it('preço de referência ausente fica null; nome e descrição ausentes ficam null', async () => {
    from.mockReturnValue(cadeia([{ data: [{ ...CRUA, preco_ref: null, produto_nome: null, descricao_exemplo: null, ultima_chave: null }], error: null, count: 1 }]))
    expect(await memoriaDeEmbalagem()).toEqual([{ ...CRUA, preco_ref: null, produto_nome: null, descricao_exemplo: null, ultima_chave: null }])
  })

  it('linha fora do formato (que o banco não deixaria gravar) fica de fora e não derruba as boas', async () => {
    const ruins = [
      { ...CRUA, cod_forn: 'A1', fator: 1 },            // fator 1 não é embalagem
      { ...CRUA, cod_forn: 'B', fator: 0.5 },
      { ...CRUA, cod_forn: 'C', fator: 'abc' },
      { ...CRUA, cod_forn: 'D', emitente_cnpj: '123' },      // CNPJ curto
      { ...CRUA, cod_forn: '', unidade_nota: 'UN' },         // sem código
      { ...CRUA, cod_forn: 'F', unidade_nota: '  ' },        // sem unidade
      { ...CRUA, cod_forn: 'G', produto_id: 0 },
      { ...CRUA, cod_forn: 'H', produto_id: 'x' },
    ]
    from.mockReturnValue(cadeia([{ data: [...ruins, CRUA], error: null, count: ruins.length + 1 }]))
    expect(await memoriaDeEmbalagem()).toEqual([CRUA])
  })

  it('CNPJ com pontuação e unidade em minúscula chegam normalizados (14 dígitos, maiúscula)', async () => {
    from.mockReturnValue(cadeia([{ data: [{ ...CRUA, emitente_cnpj: '12.345.678/0001-90', unidade_nota: ' un ' }], error: null, count: 1 }]))
    const [l] = await memoriaDeEmbalagem()
    expect([l.emitente_cnpj, l.unidade_nota]).toEqual(['12345678000190', 'UN'])
  })

  it('tabela vazia: lista vazia', async () => {
    from.mockReturnValue(cadeia([{ data: [], error: null, count: 0 }]))
    expect(await memoriaDeEmbalagem()).toEqual([])
  })

  it('mais de 1000 linhas: lê as páginas todas (o servidor corta em 1000 por pedido)', async () => {
    const linha = (i: number) => ({ ...CRUA, cod_forn: String(100000 + i) })
    const primeira = Array.from({ length: 1000 }, (_, i) => linha(i))
    const segunda = Array.from({ length: 500 }, (_, i) => linha(1000 + i))
    const q = cadeia([{ data: primeira, error: null, count: 1500 }, { data: segunda, error: null, count: 1500 }])
    from.mockReturnValue(q)
    const todas = await memoriaDeEmbalagem()
    expect(todas).toHaveLength(1500)
    expect(todas[1499].cod_forn).toBe('101499')
    expect(q.range.mock.calls).toEqual([[0, 999], [1000, 1999]])
  })

  it('tabela ainda não criada (migração não aplicada): lista vazia, sem erro', async () => {
    for (const code of ['PGRST205', '42P01']) {
      from.mockReturnValue(cadeia([{ data: null, error: { message: 'relation does not exist', code }, status: 404 }]))
      expect(await memoriaDeEmbalagem()).toEqual([])
    }
  })

  it('qualquer outro erro sobe como ErroApi (a tela decide não mostrar nada)', async () => {
    from.mockReturnValue(cadeia([{ data: null, error: { message: 'permission denied for table nfe_aprendizado', code: '42501' }, status: 403 }]))
    const erro = await memoriaDeEmbalagem().catch((e) => e)
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro).toMatchObject({ message: 'permission denied for table nfe_aprendizado', code: '42501', status: 403 })
  })
})

describe('esquecerEmbalagem — o botão "Esquecer"', () => {
  it('chama nfe_aprendizado_esquecer com o CNPJ, o código e a unidade da linha e devolve quantas linhas foram apagadas', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    expect(await esquecerEmbalagem('12345678000190', '17253', 'UN')).toBe(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('nfe_aprendizado_esquecer', { p_cnpj: '12345678000190', p_cod_forn: '17253', p_unidade: 'UN' })
  })

  it('0 (a linha já não existia) volta como 0; resposta estranha também', async () => {
    for (const data of [0, '0', null, 'abc']) {
      rpc.mockResolvedValue({ data, error: null })
      expect(await esquecerEmbalagem('12345678000190', '17253', 'UN')).toBe(0)
    }
    rpc.mockResolvedValue({ data: '1', error: null })
    expect(await esquecerEmbalagem('12345678000190', '17253', 'UN')).toBe(1)
  })

  it('"não autorizado" do banco vira o texto simples de administrador; o status HTTP é mantido', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'não autorizado', code: '42501' }, status: 403 })
    const erro = await esquecerEmbalagem('12345678000190', '17253', 'UN').catch((e) => e)
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro).toMatchObject({ message: 'Só o administrador pode fazer isso.', status: 403 })
  })

  it('qualquer outro erro (rede, função ainda não criada no banco) vira um texto em português, nunca o texto do banco', async () => {
    for (const mensagem of ['TypeError: Failed to fetch', 'Could not find the function public.nfe_aprendizado_esquecer in the schema cache', 'CNPJ inválido: informe os 14 dígitos do emitente']) {
      rpc.mockResolvedValue({ data: null, error: { message: mensagem, code: 'PGRST202' }, status: 404 })
      await expect(esquecerEmbalagem('12345678000190', '17253', 'UN')).rejects.toMatchObject({ message: 'Não consegui esquecer agora. Confira a internet e tente de novo.' })
    }
  })
})
