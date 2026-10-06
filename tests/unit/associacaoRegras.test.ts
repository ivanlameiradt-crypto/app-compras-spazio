import { MAX_RESULTADOS, buscarProdutos, sugestaoNoCatalogo, unidadesDiferem } from '../../src/admin/associacaoRegras'
import type { ItemNotaSefaz, ProdutoCatalogo } from '../../src/lib/tipos'

const p = (produto_id: number, nome: string, unidade: string | null = 'kg'): ProdutoCatalogo => ({ produto_id, nome, unidade })
const CATALOGO: ProdutoCatalogo[] = [
  p(3138573, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un'),
  p(3469755, 'ÓLEO DE ALGODÃO - INSUMOS (UN)', 'un'),
  p(3496930, 'OLEO DE GERGELIM - INSUMOS (KG)'),
  p(3469626, 'LEITE CONDESSADO - INSUMOS (KG)'),
  p(3469635, 'LEITE LIQUIDO INTREGAL - INSUMOS (KG)'),
  p(1854713, 'Q. MUÇARELA - INSUMOS (KG)'),
  p(1836957, 'AGUA SEM GÁS 500ML', 'un'),
]

describe('buscarProdutos (a caixa de associação)', () => {
  it('texto vazio ou só espaço: nada (não despeja a lista inteira)', () => {
    expect(buscarProdutos(CATALOGO, '')).toEqual({ itens: [], total: 0 })
    expect(buscarProdutos(CATALOGO, '   ')).toEqual({ itens: [], total: 0 })
  })

  it('ignora acento e maiúsculas, e todas as palavras digitadas têm de aparecer (em qualquer ordem)', () => {
    expect(buscarProdutos(CATALOGO, 'oleo soja').itens.map((x) => x.produto_id)).toEqual([3138573])
    expect(buscarProdutos(CATALOGO, 'SOJA ÓLEO').itens.map((x) => x.produto_id)).toEqual([3138573])
    expect(buscarProdutos(CATALOGO, 'leite cond').itens.map((x) => x.produto_id)).toEqual([3469626])   // "cond" casa com "condessado"
    expect(buscarProdutos(CATALOGO, 'mucarela').itens.map((x) => x.produto_id)).toEqual([1854713])     // sem a cedilha
    expect(buscarProdutos(CATALOGO, 'agua gas').itens.map((x) => x.produto_id)).toEqual([1836957])
  })

  it('acha pelo código do produto (inteiro ou um pedaço)', () => {
    expect(buscarProdutos(CATALOGO, '3138573').itens.map((x) => x.produto_id)).toEqual([3138573])
    expect(buscarProdutos(CATALOGO, '34696').itens.map((x) => x.produto_id).sort()).toEqual([3469626, 3469635])
    expect(buscarProdutos(CATALOGO, 'soja 3138').total).toBe(1)                                          // nome e código juntos
  })

  it('ordem: começa com a 1ª palavra < tem no começo de alguma palavra < tem em qualquer lugar; empate: nome mais curto, depois alfabética', () => {
    const lista = [p(1, 'MOLHO DE LEITE'), p(2, 'XLEITEX'), p(3, 'LEITE EM PO LONGA VIDA'), p(4, 'LEITE'), p(5, 'CREME DE LEITE')]
    expect(buscarProdutos(lista, 'leite').itens.map((x) => x.nome)).toEqual(['LEITE', 'LEITE EM PO LONGA VIDA', 'CREME DE LEITE', 'MOLHO DE LEITE', 'XLEITEX'])
  })

  it('mostra no máximo 8 e diz quantos achou no total', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => p(100 + i, `QUEIJO TIPO ${String.fromCharCode(65 + i)}`))
    const r = buscarProdutos(muitos, 'queijo')
    expect(MAX_RESULTADOS).toBe(8)
    expect(r.itens).toHaveLength(8)
    expect(r.total).toBe(12)
    expect(buscarProdutos(muitos, 'queijo', 3).itens).toHaveLength(3)
  })

  it('sem resultado: lista vazia e total 0', () => {
    expect(buscarProdutos(CATALOGO, 'chocolate bis')).toEqual({ itens: [], total: 0 })
    expect(buscarProdutos([], 'oleo')).toEqual({ itens: [], total: 0 })
  })
})

describe('unidadesDiferem', () => {
  it('compara sem ligar para maiúsculas e espaços; sem uma das unidades, não dá para dizer (false)', () => {
    expect(unidadesDiferem('UN', 'un')).toBe(false)
    expect(unidadesDiferem(' KG ', 'kg')).toBe(false)
    expect(unidadesDiferem('UN', 'kg')).toBe(true)
    expect(unidadesDiferem('CX', 'un')).toBe(true)
    expect(unidadesDiferem(null, 'kg')).toBe(false)
    expect(unidadesDiferem('UN', undefined)).toBe(false)
    expect(unidadesDiferem('', 'kg')).toBe(false)
  })
})

describe('sugestaoNoCatalogo (o palpite do robô)', () => {
  const item = (extra: Partial<ItemNotaSefaz>): ItemNotaSefaz => ({ descricao: 'X', qtd: 1, unidade_sischef: 'UN', produto_id: null, ...extra })
  it('devolve o produto da lista quando o palpite (código texto ou número) existe nela', () => {
    expect(sugestaoNoCatalogo(item({ sugestao: { id: '3469626', nome: 'LEITE CONDENSADO - INSUMOS' } }), CATALOGO)?.produto_id).toBe(3469626)
    expect(sugestaoNoCatalogo(item({ sugestao: { id: 3138573, nome: 'x' } }), CATALOGO)?.nome).toBe('ÓLEO DE SOJA - INSUMOS (UN)')
  })
  it('palpite de produto que NÃO está na lista de insumos (produto novo no SisChef): vale mesmo assim, marcado como "novo", com o nome do palpite e sem unidade', () => {
    expect(sugestaoNoCatalogo(item({ sugestao: { id: '3476455', nome: ' CHOCOLATE  BIS ORIGINAL - INSUMOS ' } }), CATALOGO))
      .toEqual({ produto_id: 3476455, nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS', unidade: null, novo: true })
    expect(sugestaoNoCatalogo(item({ sugestao: { id: 3469626, nome: 'x' } }), [])).toMatchObject({ produto_id: 3469626, novo: true })
    expect(sugestaoNoCatalogo(item({ sugestao: { id: '3469626', nome: 'LEITE CONDENSADO - INSUMOS' } }), CATALOGO)?.novo).toBeUndefined() // o da lista não é "novo"
  })
  it('null quando não há palpite, o código não é inteiro positivo ou o palpite veio sem nome', () => {
    expect(sugestaoNoCatalogo(item({}), CATALOGO)).toBeNull()
    expect(sugestaoNoCatalogo(item({ sugestao: null }), CATALOGO)).toBeNull()
    for (const id of ['abc', '', '0', '-5', '12.5']) expect(sugestaoNoCatalogo(item({ sugestao: { id, nome: 'x' } }), CATALOGO)).toBeNull()
    expect(sugestaoNoCatalogo(item({ sugestao: { id: 999, nome: '   ' } }), CATALOGO)).toBeNull()
    expect(sugestaoNoCatalogo(item({ sugestao: { id: null as unknown as string, nome: 'x' } }), CATALOGO)).toBeNull()
  })
})
