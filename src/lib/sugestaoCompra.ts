// Quanto comprar, a partir do histórico de compras do SisChef (tabela compra_historico, 11/11/2026).
// Conta pura: sem banco, sem React. Datas em 'AAAA-MM-DD'; quantidades na unidade do produto; custo = custo líquido ("Custo unt. total").

export interface LinhaCompra {
  data: string
  /** null ou vazio: compra sem fornecedor no SisChef (conta na média e no gasto, fica fora dos preços). */
  fornecedor: string | null
  referencia?: string | null
  qtd: number
  precoUnit: number
  custoLiquido: number
}

export interface ProdutoHistorico {
  produtoId: number
  nome: string
  unidade?: string | null
  linhas: LinhaCompra[]
}

export interface ParametrosSugestao {
  /** Semanas olhadas para trás (padrão 8). */
  semanas?: number
  /** Folga sobre a média semanal (padrão 0,25 = 25%). */
  folga?: number
  /** Dias de compras que contam para o preço dos fornecedores (padrão 90). */
  diasPrecoRecente?: number
}

export interface PrecoFornecedor {
  fornecedor: string
  /** Último custo líquido desse fornecedor. */
  custo: number
  /** Data dessa última compra. */
  data: string
}

export interface SugestaoProduto {
  produtoId: number
  nome: string
  unidade: string | null
  /** Semanas da janela usada (pode ser menos que o pedido, ver janelaEncolhida). */
  semanas: number
  /** O produto tem 10+ compras e a mais antiga é mais nova que o início da janela: a janela começa nela. */
  janelaEncolhida: boolean
  /** Compras dentro da janela. */
  compras: number
  mediaSemana: number
  /** mediaSemana × (1 + folga); null quando esporádico (sem sugestão automática). */
  alvo: number | null
  /** Quanto se gasta por semana (qtd × custo líquido ÷ semanas). */
  gastoSemana: number
  /** Só 1 compra na janela. */
  esporadico: boolean
  classe: 'A' | 'B' | 'C'
  fornecedores: {
    /** O de menor custo; null quando conferirUnidade. */
    melhor: PrecoFornecedor | null
    /** Os demais (ou todos, quando conferirUnidade), do mais barato ao mais caro. */
    outros: PrecoFornecedor[]
    /** O maior preço passa do dobro do menor: alguma compra foi lançada em outra unidade. Nunca chamar de melhor preço. */
    conferirUnidade: boolean
  }
}

const DIA_MS = 86_400_000
const diaUtc = (d: string): number => Date.parse(`${d}T00:00:00Z`)

function precos(linhas: LinhaCompra[], hoje: number, dias: number): SugestaoProduto['fornecedores'] {
  const inicio = hoje - dias * DIA_MS
  const ultimo = new Map<string, PrecoFornecedor>()
  for (const l of linhas) {
    const t = diaUtc(l.data)
    const forn = l.fornecedor?.trim()
    if (t < inicio || t > hoje || !forn) continue
    const atual = ultimo.get(forn)
    if (!atual || l.data > atual.data) ultimo.set(forn, { fornecedor: forn, custo: l.custoLiquido, data: l.data })
  }
  const lista = [...ultimo.values()].sort((a, b) => a.custo - b.custo || a.fornecedor.localeCompare(b.fornecedor))
  if (lista.length === 0) return { melhor: null, outros: [], conferirUnidade: false }
  const conferirUnidade = lista[lista.length - 1].custo > 2 * lista[0].custo
  if (conferirUnidade) return { melhor: null, outros: lista, conferirUnidade }
  return { melhor: lista[0], outros: lista.slice(1), conferirUnidade }
}

/** Sugestão por produto, do maior gasto semanal para o menor. Produto sem compra na janela fica de fora. */
export function sugerirCompras(produtos: ProdutoHistorico[], hoje: string, p: ParametrosSugestao = {}): SugestaoProduto[] {
  const semanasPedidas = p.semanas ?? 8
  const folga = p.folga ?? 0.25
  const dias = p.diasPrecoRecente ?? 90
  const tHoje = diaUtc(hoje)
  const saida: Omit<SugestaoProduto, 'classe'>[] = []

  for (const prod of produtos) {
    let inicio = tHoje - semanasPedidas * 7 * DIA_MS
    let semanas = semanasPedidas
    let janelaEncolhida = false
    if (prod.linhas.length >= 10) {
      const maisAntiga = Math.min(...prod.linhas.map((l) => diaUtc(l.data)))
      if (maisAntiga > inicio) {
        inicio = maisAntiga
        semanas = Math.max(1, (tHoje - maisAntiga) / (7 * DIA_MS))
        janelaEncolhida = true
      }
    }
    const naJanela = prod.linhas.filter((l) => {
      const t = diaUtc(l.data)
      return t >= inicio && t <= tHoje
    })
    if (naJanela.length === 0) continue
    const soma = naJanela.reduce((s, l) => s + l.qtd, 0)
    const gasto = naJanela.reduce((s, l) => s + l.qtd * l.custoLiquido, 0)
    const mediaSemana = soma / semanas
    const esporadico = naJanela.length === 1
    saida.push({
      produtoId: prod.produtoId,
      nome: prod.nome,
      unidade: prod.unidade ?? null,
      semanas,
      janelaEncolhida,
      compras: naJanela.length,
      mediaSemana,
      alvo: esporadico ? null : mediaSemana * (1 + folga),
      gastoSemana: gasto / semanas,
      esporadico,
      fornecedores: precos(prod.linhas, tHoje, dias),
    })
  }

  saida.sort((a, b) => b.gastoSemana - a.gastoSemana || a.produtoId - b.produtoId)
  const total = saida.reduce((s, x) => s + x.gastoSemana, 0)
  let acumulado = 0
  return saida.map((x, k) => {
    acumulado += x.gastoSemana
    const parte = total > 0 ? acumulado / total : 1
    // o 1º (maior gasto) é sempre A, mesmo que sozinho passe de 80%
    const classe: SugestaoProduto['classe'] = (k === 0 && total > 0) || parte <= 0.8 + 1e-9 ? 'A' : parte <= 0.95 + 1e-9 ? 'B' : 'C'
    return { ...x, classe }
  })
}

/** Quanto comprar para chegar no alvo. Base = a contagem, senão o estoque do SisChef (só se ≥ 0); sem base, null ("precisa contar").
 * Nunca negativo; arredondado para cima em 1 casa decimal. */
export function quantoComprar(alvo: number, contagem: number | null, estoqueSischef: number | null): number | null {
  const base = contagem ?? (estoqueSischef !== null && estoqueSischef >= 0 ? estoqueSischef : null)
  if (base === null) return null
  const falta = Math.max(0, alvo - base)
  return Math.ceil(Math.round(falta * 1e6) / 1e5) / 10
}
