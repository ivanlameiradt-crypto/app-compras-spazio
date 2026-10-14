// A lista de produtos (api.catalogoProdutos) não pode ser cortada em silêncio.
//
// O Supabase (PostgREST) devolve no MÁXIMO 1000 linhas por pedido ("Max rows" da API), peça o app o que pedir. A tabela itens_semana ganha uma linha por
// produto por semana (~300 por semana; 927 em 14/10/2026), então a leitura única de 1000 linhas passaria a perder, sem aviso, os produtos que só aparecem nas
// semanas mais antigas (a caixa diria "não identifiquei este item" para um produto que existe). cot_produto_busca e produto_planilha têm o mesmo teto.
//
// Aqui o banco é um SERVIDOR FALSO de verdade, não um mock que devolve o que o teste mandar: guarda as linhas, ordena, aplica `range`/`limit`, entrega no
// máximo 1000 por pedido, informa o total quando o app o pede e, como o PostgREST, recusa (416) uma página que começa depois do fim quando o total foi pedido.
// Os casos de "o servidor se comporta mal" (empate em ordem diferente a cada pedido, tabela que muda no meio da leitura, erro na 2ª página) são opções dele.
const from = vi.fn()
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
import { ErroApi, catalogoProdutos } from '../../src/lib/api'

type Linha = Record<string, unknown>
type Resposta = { data: Linha[] | null; error: { message: string; code?: string } | null; count: number | null; status: number }
type Pedido = { tabela: string; numero: number; de: number; ate: number; total: boolean; ordem: string }

interface TabelaFalsa {
  linhas: Linha[]
  /** Quantas linhas o servidor entrega por pedido, no máximo (o "Max rows" da API; 1000 no Supabase). */
  maximo?: number
  /** O Postgres não promete ordem entre linhas iguais na coluna do `order`: aqui a ordem dos empates muda a cada pedido. */
  embaralharEmpates?: boolean
  /** A partir do pedido de número N (1 = o primeiro) o servidor responde erro 500. */
  falharAPartirDoPedido?: number
  /** A partir do pedido de número N o servidor responde 200 com lista vazia, apesar de ter informado que há mais linhas. */
  vaziaAPartirDoPedido?: number
  /** Chamado depois de cada pedido respondido: o teste mexe nas linhas "no meio da leitura". */
  depoisDoPedido?: (numero: number, linhas: Linha[]) => void
  /** Servidor que não informa o total (Content-Range sem número): só a página curta mostra o fim. */
  semTotal?: boolean
  /** Servidor com defeito: ignora o intervalo pedido e devolve sempre as primeiras linhas. */
  ignorarIntervalo?: boolean
}
type Tabelas = Partial<Record<'itens_semana' | 'cot_produto_busca' | 'produto_planilha', TabelaFalsa>>

const LIMITE_DO_SERVIDOR = 1000
const pedidos: Pedido[] = []
const pedidosDe = (tabela: string) => pedidos.filter((p) => p.tabela === tabela)

const sorteio = (l: Linha, semente: number) => Math.imul(Number(l.id ?? l.produto_id) | 0, 2654435761) ^ Math.imul(semente, 40503)
function comparar(a: Linha, b: Linha, ordem: [string, boolean][], semente: number): number {
  for (const [coluna, crescente] of ordem) {
    const x = a[coluna] as number   // as colunas ordenadas aqui são sempre números; o `<` do JavaScript serviria igual para texto
    const y = b[coluna] as number
    if (x === y) continue
    return (x < y ? -1 : 1) * (crescente ? 1 : -1)
  }
  return semente === 0 ? 0 : sorteio(a, semente) - sorteio(b, semente)
}
const projetar = (l: Linha, colunas: string): Linha =>
  colunas.trim() === '*' ? l : Object.fromEntries(colunas.split(',').map((c) => c.trim()).map((c) => [c, l[c]]))

interface Cadeia {
  select(colunas: string, opcoes?: { count?: string }): Cadeia
  order(coluna: string, opcoes?: { ascending?: boolean }): Cadeia
  limit(n: number): Cadeia
  range(de: number, ate: number): Cadeia
  then(ok: (r: Resposta) => unknown, ko?: (e: unknown) => unknown): Promise<unknown>
}

function pedidoNovo(tabela: string, t: TabelaFalsa, proximoNumero: () => number): Cadeia {
  let colunas = '*'
  let total = false
  const ordem: [string, boolean][] = []
  let de = 0
  let ate = Infinity
  function responder(): Resposta {
    const numero = proximoNumero()
    // freio do próprio teste: um app com laço sem fim falha rápido aqui (erro que NÃO é ErroApi), em vez de encher a memória até o tempo do teste acabar
    if (numero > 500) throw new Error(`o servidor falso cortou: mais de 500 pedidos à tabela ${tabela} (laço sem fim?)`)
    pedidos.push({ tabela, numero, de, ate, total, ordem: ordem.map(([c, cresc]) => `${c} ${cresc ? 'asc' : 'desc'}`).join(', ') })
    if (t.falharAPartirDoPedido !== undefined && numero >= t.falharAPartirDoPedido) {
      return { data: null, error: { message: 'falha simulada do servidor', code: 'XX000' }, count: null, status: 500 }
    }
    const quantas = t.linhas.length
    if (total && de > 0 && de >= quantas) {
      return { data: null, error: { message: 'Requested range not satisfiable', code: 'PGRST103' }, count: null, status: 416 }
    }
    const maximo = t.maximo ?? LIMITE_DO_SERVIDOR
    const ordenadas = [...t.linhas].sort((a, b) => comparar(a, b, ordem, t.embaralharEmpates ? numero : 0))
    const fatia = t.ignorarIntervalo ? ordenadas.slice(0, maximo) : ordenadas.slice(de, Math.min(ate + 1, de + maximo))
    const vazia = t.vaziaAPartirDoPedido !== undefined && numero >= t.vaziaAPartirDoPedido
    const resposta: Resposta = {
      data: (vazia ? [] : fatia).map((l) => projetar(l, colunas)),
      error: null,
      count: total && !t.semTotal ? quantas : null,
      status: 200,
    }
    t.depoisDoPedido?.(numero, t.linhas)
    return resposta
  }
  const cadeia: Cadeia = {
    select: (c, opcoes) => { colunas = c; total = opcoes?.count === 'exact'; return cadeia },
    order: (coluna, opcoes) => { ordem.push([coluna, opcoes?.ascending !== false]); return cadeia },
    limit: (n) => { de = 0; ate = n - 1; return cadeia },
    range: (a, b) => { de = a; ate = b; return cadeia },
    then: (ok, ko) => Promise.resolve().then(responder).then(ok, ko),
  }
  return cadeia
}

function servidor(tabelas: Tabelas) {
  pedidos.length = 0
  const feitos: Record<string, number> = {}
  from.mockImplementation((nome: string) => {
    const t = (tabelas as Record<string, TabelaFalsa | undefined>)[nome] ?? { linhas: [] }
    return pedidoNovo(nome, t, () => (feitos[nome] = (feitos[nome] ?? 0) + 1))
  })
}

// ---- dados: cada linha de itens_semana é UM produto em UMA semana (chave única: semana_id + produto_id), como no banco
const item = (semana: number, produto_id: number, produto: string, unidade = 'kg'): Linha => ({ id: semana * 100_000_000 + produto_id, semana_id: semana, produto_id, produto, unidade })

/**
 * `quantas` semanas (1 = a mais antiga), cada uma com `comuns` produtos comprados em TODAS as semanas e `exclusivos` produtos que só aparecem naquela semana.
 * Devolve também os códigos que o catálogo TEM de conter: montados daqui, sem passar pelo código testado.
 */
function semanas(quantas: number, comuns: number, exclusivos: number) {
  const linhas: Linha[] = []
  const ids = new Set<number>()
  for (let s = 1; s <= quantas; s++) {
    for (let i = 1; i <= comuns; i++) { const id = 3_000_000 + i; linhas.push(item(s, id, `COMUM ${id} (KG)`)); ids.add(id) }
    for (let i = 1; i <= exclusivos; i++) { const id = 3_100_000 + s * 1000 + i; linhas.push(item(s, id, `SÓ NA SEMANA ${s} - ${id} (KG)`)); ids.add(id) }
  }
  return { linhas, ids }
}
const faltando = (ids: Set<number>, r: { produto_id: number }[]) => { const tem = new Set(r.map((p) => p.produto_id)); return [...ids].filter((id) => !tem.has(id)).sort((a, b) => a - b) }

beforeEach(() => { from.mockReset(); pedidos.length = 0 })

describe('catalogoProdutos: itens_semana com mais linhas do que o servidor entrega por pedido', () => {
  it('com as 927 linhas de hoje a leitura continua sendo UM pedido por tabela e a lista vem inteira (nada piora no que já funciona)', async () => {
    const { linhas, ids } = semanas(3, 250, 59)
    expect(linhas).toHaveLength(927)
    servidor({ itens_semana: { linhas } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])
    expect(r).toHaveLength(ids.size)
    expect(pedidosDe('itens_semana')).toHaveLength(1)
    expect(pedidosDe('cot_produto_busca')).toHaveLength(1)
    expect(pedidosDe('produto_planilha')).toHaveLength(1)
  })

  it('1.300 linhas: o produto que só aparece na semana MAIS ANTIGA continua na lista, e de cada produto vale o nome da semana mais nova', async () => {
    const { linhas, ids } = semanas(5, 220, 40)
    expect(linhas).toHaveLength(1300)
    for (const l of linhas) if (l.produto_id === 3_000_001) l.produto = l.semana_id === 5 ? 'LEITE CONDENSADO NOVO (KG)' : 'LEITE CONDESSADO ANTIGO (KG)'
    servidor({ itens_semana: { linhas } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])                               // nenhum produto sumiu (os 40 só da semana 1 são os que o corte de 1000 perdia)
    expect(r).toHaveLength(420)                                        // 220 comuns + 5 semanas × 40 exclusivos, sem repetir ninguém
    expect(r.find((p) => p.produto_id === 3_101_001)).toEqual({ produto_id: 3_101_001, nome: 'SÓ NA SEMANA 1 - 3101001 (KG)', unidade: 'kg' })
    expect(r.find((p) => p.produto_id === 3_000_001)?.nome).toBe('LEITE CONDENSADO NOVO (KG)')
  })

  it('o Postgres não promete a ordem entre linhas da mesma semana: mesmo mudando a cada pedido, nenhum produto se perde nem se repete', async () => {
    const { linhas, ids } = semanas(5, 220, 40)
    servidor({ itens_semana: { linhas, embaralharEmpates: true } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])
    expect(r).toHaveLength(420)
  })

  it.each([
    ['exatamente 1.000 linhas', 4, 200, 50, 1],
    ['exatamente 2.000 linhas', 8, 200, 50, 2],
  ])('%s: lista inteira e nenhum pedido a mais (o servidor recusa página além do fim)', async (_nome, quantas, comuns, exclusivos, pedidosEsperados) => {
    const { linhas, ids } = semanas(quantas, comuns, exclusivos)
    servidor({ itens_semana: { linhas } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])
    expect(pedidosDe('itens_semana')).toHaveLength(pedidosEsperados)
  })

  it('servidor que entrega menos por pedido do que o app pediu (limite de 500): o app continua de onde parou e lê tudo', async () => {
    const { linhas, ids } = semanas(3, 250, 59)
    servidor({ itens_semana: { linhas, maximo: 500 } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])
    expect(pedidosDe('itens_semana').map((p) => p.de)).toEqual([0, 500])
  })

  it('servidor que não informa o total: a página curta mostra o fim, e as 1.300 linhas vêm em 2 pedidos', async () => {
    const { linhas, ids } = semanas(5, 220, 40)
    servidor({ itens_semana: { linhas, semTotal: true } })
    const r = await catalogoProdutos()
    expect(faltando(ids, r)).toEqual([])
    expect(pedidosDe('itens_semana').map((p) => p.de)).toEqual([0, 1000])
  })

  it('erro no 2º pedido: a lista NÃO vem pela metade, vira erro (a caixa mostra "não consegui carregar")', async () => {
    servidor({ itens_semana: { linhas: semanas(5, 220, 40).linhas, falharAPartirDoPedido: 2 } })
    await expect(catalogoProdutos()).rejects.toMatchObject({ name: 'ErroApi', status: 500 })
  })

  it.each([
    ['linhas apagadas no meio da leitura', (n: number, linhas: Linha[]) => { if (n === 1) linhas.splice(0, 30) }],
    ['semana nova chegando no meio da leitura', (n: number, linhas: Linha[]) => { if (n === 1) linhas.push(...semanas(6, 220, 40).linhas.filter((l) => l.semana_id === 6)) }],
  ])('tabela mudou entre um pedido e outro (%s): erro, não uma lista com buraco', async (_nome, depoisDoPedido) => {
    servidor({ itens_semana: { linhas: semanas(5, 220, 40).linhas, depoisDoPedido } })
    await expect(catalogoProdutos()).rejects.toBeInstanceOf(ErroApi)
  })

  it('servidor disse que há 1.300 linhas e devolveu lista vazia no 2º pedido: erro na hora (sem insistir), não a lista curta', async () => {
    servidor({ itens_semana: { linhas: semanas(5, 220, 40).linhas, vaziaAPartirDoPedido: 2 } })
    await expect(catalogoProdutos()).rejects.toBeInstanceOf(ErroApi)
    expect(pedidosDe('itens_semana')).toHaveLength(2)
  })

  it('servidor com defeito que ignora o intervalo e não informa o total: o app desiste (erro) em vez de ler para sempre', async () => {
    servidor({ itens_semana: { linhas: semanas(5, 220, 40).linhas, ignorarIntervalo: true, semTotal: true } })
    await expect(catalogoProdutos()).rejects.toBeInstanceOf(ErroApi)
  })
})

describe('catalogoProdutos: as outras duas tabelas também passam de 1000 linhas', () => {
  it('produto_planilha com 1.250 linhas (linhas sem ordem natural no servidor): a unidade de TODOS os produtos depois da 1ª página manda sobre a de itens_semana, e o produto da última linha entra na lista', async () => {
    // planilha: tudo KG, menos a última linha (UN, com descrição: produto que só existe nela). Ids 5.001.001 a 5.001.249 = linhas 1.001 a 1.249, depois da 1ª página:
    // estão em itens_semana como UN, e a planilha manda KG.
    const planilha: Linha[] = Array.from({ length: 1250 }, (_, i) => (i === 1249
      ? { produto_id: 5_001_250, unidade: 'UN', descricao: 'PRODUTO NOVO DA PLANILHA - INSUMOS' }
      : { produto_id: 5_000_001 + i, unidade: 'KG', descricao: null }))
    const naLista = Array.from({ length: 249 }, (_, i) => item(1, 5_001_001 + i, `PRODUTO ${5_001_001 + i} (UN)`, 'un'))
    servidor({ itens_semana: { linhas: naLista }, produto_planilha: { linhas: planilha, embaralharEmpates: true } })
    const r = await catalogoProdutos()
    expect(r).toHaveLength(250)
    expect(r.filter((p) => p.unidade === 'kg')).toHaveLength(249)
    expect(r.find((p) => p.produto_id === 5_001_250)).toEqual({ produto_id: 5_001_250, nome: 'PRODUTO NOVO DA PLANILHA - INSUMOS', unidade: 'un' })
    expect(pedidosDe('produto_planilha')).toHaveLength(2)
  })

  it('produto_planilha com erro na 2ª página: ou vale a planilha inteira ou nenhuma linha dela (nunca metade), e o catálogo segue com a unidade de itens_semana', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const planilha: Linha[] = Array.from({ length: 1250 }, (_, i) => ({ produto_id: 5_000_001 + i, unidade: 'KG', descricao: null }))
    servidor({
      itens_semana: { linhas: [item(1, 5_000_005, 'A - PRODUTO DA 1ª PÁGINA DA PLANILHA (UN)', 'un'), item(1, 5_001_201, 'B - PRODUTO DA 2ª PÁGINA DA PLANILHA (UN)', 'un')] },
      produto_planilha: { linhas: planilha, falharAPartirDoPedido: 2 },
    })
    const r = await catalogoProdutos()
    expect(r.map((p) => [p.produto_id, p.unidade])).toEqual([[5_000_005, 'un'], [5_001_201, 'un']])   // a planilha diria KG nos dois
    expect(aviso).toHaveBeenCalled()
    aviso.mockRestore()
  })

  it('cot_produto_busca com 1.100 linhas (linhas sem ordem natural no servidor): as palavras-chave de TODOS os produtos depois da 1ª página chegam a eles', async () => {
    const busca: Linha[] = Array.from({ length: 1100 }, (_, i) => ({ produto_id: 6_000_001 + i, palavras: `palavra ${i}`, nome_corrigido: null, ocultar: false }))
    const naLista = Array.from({ length: 100 }, (_, i) => item(1, 6_001_001 + i, `PRODUTO ${6_001_001 + i} (KG)`))      // linhas 1.001 a 1.100 da busca
    servidor({ itens_semana: { linhas: naLista }, cot_produto_busca: { linhas: busca, embaralharEmpates: true } })
    const r = await catalogoProdutos()
    expect(r).toHaveLength(100)
    expect(r.filter((p) => p.palavras === `palavra ${p.produto_id - 6_000_001}`)).toHaveLength(100)
    expect(pedidosDe('cot_produto_busca')).toHaveLength(2)
  })
})
