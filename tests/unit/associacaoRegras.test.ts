import {
  CONVERSAO_CASAS, CONVERSAO_MAXIMA, MAX_RESULTADOS, buscarProdutos, conversaoDaDecisao, formatarConversao, nomeParaMostrar, parseConversao, rotuloUnidade,
  situacaoConversao, sugestaoNoCatalogo, sugestaoPorPalavras, textoConversao,
} from '../../src/admin/associacaoRegras'
import type { AssociacaoApp, ItemNotaSefaz, ProdutoCatalogo } from '../../src/lib/tipos'

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

describe('situacaoConversao (a caixa pede, oferece ou esconde o campo da conversão?)', () => {
  // A unidade da lista do app é um palpite pelo nome: "kg" (nome com "(KG)") é confiável; "un" é o chute para todo o resto; null = produto novo.
  // O robô é quem confere no cadastro vivo antes de gravar: o app só OBRIGA quando tem certeza, e "opcional" nunca trava o Lançar.
  const NOTAS: (string | null)[] = ['UN', 'KG', 'CX', 'L', 'PCT', '', null]
  const esperado = (nota: string | null, produto: string | null): ReturnType<typeof situacaoConversao> => {
    const n = (nota ?? '').trim().toUpperCase()
    const p = (produto ?? '').trim().toLowerCase()
    if (n === '') return 'oculta'                       // sem a unidade da nota não há o que comparar (o robô também barra)
    if (p === '') return 'opcional'                     // produto novo: unidade desconhecida
    if (p === 'kg') return n === 'KG' ? 'oculta' : 'obrigatoria'
    return n === 'UN' ? 'oculta' : 'opcional'           // "un" é chute: no SisChef pode ser PCT/CX…
  }

  it.each<string | null>(['kg', 'un', null, 'KG', ' un '])('produto %j × todas as unidades da nota (UN, KG, CX, L, PCT, vazia, null)', (produto) => {
    for (const nota of NOTAS) expect([nota, produto, situacaoConversao(nota, produto)]).toEqual([nota, produto, esperado(nota, produto)])
  })

  it('a tabela completa, escrita por extenso (para ninguém depender só da função espelho acima)', () => {
    // produto "kg" (confiável): só KG × KG esconde; o resto OBRIGA
    expect(situacaoConversao('KG', 'kg')).toBe('oculta')
    expect(situacaoConversao('UN', 'kg')).toBe('obrigatoria')
    expect(situacaoConversao('CX', 'kg')).toBe('obrigatoria')
    expect(situacaoConversao('L', 'kg')).toBe('obrigatoria')
    expect(situacaoConversao('PCT', 'KG')).toBe('obrigatoria')
    // produto "un" (chute): UN × UN esconde; o resto só OFERECE
    expect(situacaoConversao('UN', 'un')).toBe('oculta')
    expect(situacaoConversao('UN', ' un ')).toBe('oculta')
    expect(situacaoConversao('KG', 'un')).toBe('opcional')                      // impasse (a) da revisão: antes obrigava "1 KG em UN"
    expect(situacaoConversao('CX', 'un')).toBe('opcional')
    expect(situacaoConversao('L', 'un')).toBe('opcional')
    expect(situacaoConversao('PCT', 'un')).toBe('opcional')
    // produto novo (unidade desconhecida): sempre OFERECE
    for (const nota of ['UN', 'KG', 'CX', 'L', 'PCT']) expect(situacaoConversao(nota, null)).toBe('opcional')
    expect(situacaoConversao('UN', undefined)).toBe('opcional')
    // nota sem unidade: nada a comparar
    for (const produto of ['kg', 'un', null, 'KG', ' un ']) {
      expect(situacaoConversao('', produto)).toBe('oculta')
      expect(situacaoConversao(null, produto)).toBe('oculta')
    }
    expect(situacaoConversao(undefined, 'kg')).toBe('oculta')
    expect(situacaoConversao(' kg ', 'KG')).toBe('oculta')                     // espaços e maiúsculas não importam
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


// A lista do Ivan com as palavras-chave e os nomes corrigidos da planilha de 06/10 (os mesmos textos que ele escreveu).
const kw = (produto_id: number, nome: string, palavras?: string, extra: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo =>
  ({ produto_id, nome, unidade: 'kg', ...(palavras ? { palavras } : {}), ...extra })
const DO_IVAN: ProdutoCatalogo[] = [
  kw(1854713, 'Q. MUÇARELA - INSUMOS (KG)', 'queijo mussarela mozarela mozzarella'),
  kw(3469626, 'LEITE CONDENSADO - INSUMOS (KG)', 'leite semi condensado ou leite condensado', { nome_sischef: 'LEITE CONDESSADO - INSUMOS (KG)' }),
  kw(3138573, 'ÓLEO DE SOJA - INSUMOS (UN)', 'ÓLEO DE SOJA', { unidade: 'un' }),
  kw(3469754, 'NUGGETS SUPREME - INSUMOS (KG)', 'nuggets ou Chicken Supreme 2,5Kg', { nome_sischef: 'NUGGSTES SUPREME - INSUMOS (KG)' }),
  kw(3469643, 'LIMÃO - INSUMOS (KG)', 'LIMÃO OU LIMÃO TAHITI OU LIMÃO TAITI'),                  // "o limão Tahiti é o mesmo limão" (Ivan)
  kw(3484974, 'LIMÃO SICILIANO - INSUMOS (KG)', 'LIMÃO SICILIANO'),
  kw(3469590, 'CARNE LAGARTO - INSUMOS (KG)', 'CARNE LAGARTO OU CARNE RESFRIADA LARGATO'),
  // o resto da lista, que também tem "queijo", "leite", "carne" e "bis" nas palavras
  kw(3474203, 'Q. GORGONZOLA - INSUMOS (KG)', 'queijo gorgonzola'),
  kw(3476531, 'Q. PARMESÃO - INSUMOS (KG)', 'queijo parmesão'),
  kw(3469628, 'LEITE EM PÓ INTEGRAL - INSUMOS (KG)', 'leite em pó integral', { nome_sischef: 'LEITE EM PÓ INTREGAL - INSUMOS (KG)' }),
  kw(1855900, 'CREME DE LEITE - INSUMOS (KG)', 'CREME DE LEITE'),
  kw(3469593, 'CARNE PICANHA - INSUMOS (KG)', 'CARNE PICANHA'),
  kw(1855890, 'BISCOITO OREO - INSUMOS (KG)', 'BISCOITO OREO'),
  kw(3484992, 'QUEIJO MUÇARELA DE BÚFALA - INSUMOS (KG)', 'mussarela mozarela mozzarella'),
  kw(3476532, 'Q. PROVOLONE - INSUMOS (KG)', 'QUEIJO PROVOLONE'),
  kw(3839640, 'QUEIJO PROVOLONE FATIA - INSUMOS (KG)', 'QUEIJO PROVOLONE'),
]
const ids = (r: { itens: ProdutoCatalogo[] }) => r.itens.map((x) => x.produto_id)
const nota = (descricao: string): ItemNotaSefaz => ({ descricao, qtd: 1, unidade_sischef: 'KG', produto_id: null, n: 1 })

describe('buscarProdutos com as palavras-chave e os nomes corrigidos do Ivan', () => {
  it('acha pela palavra-chave ("chicken" só existe nelas) e pelo nome ERRADO do SisChef; "queijo" acha os produtos que a lista chama de "Q."', () => {
    expect(ids(buscarProdutos(DO_IVAN, 'chicken'))).toEqual([3469754])
    expect(ids(buscarProdutos(DO_IVAN, 'nuggstes'))).toEqual([3469754])                       // nome_sischef (errado)
    expect(ids(buscarProdutos(DO_IVAN, 'nuggets'))).toEqual([3469754])                        // nome corrigido
    expect(ids(buscarProdutos(DO_IVAN, 'condessado'))).toEqual([3469626])                     // como está no SisChef
    expect(ids(buscarProdutos(DO_IVAN, 'queijo muss'))).toEqual([1854713, 3484992])                    // abreviação da nota: "muss" é começo de "mussarela"
    expect(buscarProdutos(DO_IVAN, 'queijo').total).toBe(6)                                   // muçarela, muçarela de búfala, gorgonzola, parmesão e os 2 provolones
  })

  it('as palavras podem vir uma do nome e outra das palavras-chave; todas têm de aparecer', () => {
    expect(ids(buscarProdutos(DO_IVAN, 'queijo gorgonzola'))).toEqual([3474203])              // "gorgonzola" no nome, "queijo" nas palavras
    const r = buscarProdutos(DO_IVAN, 'queijo gorgonzola xyz')                                // "xyz" não existe: ninguém tem todas → parcial
    expect(r.parcial).toBe(true)
    expect(ids(r)[0]).toBe(3474203)                                                           // o único que casa 2 palavras vem primeiro
  })

  it('quem casa pelo nome/código vem antes de quem só casa pelas palavras-chave', () => {
    const lista = [kw(1, 'Q. GORGONZOLA', 'queijo gorgonzola'), kw(2, 'QUEIJO TIPO X'), kw(3, 'MOLHO DE QUEIJO')]
    expect(ids(buscarProdutos(lista, 'queijo'))).toEqual([2, 3, 1])                           // 2 (começa) < 3 (no meio) < 1 (só pela palavra-chave)
  })

  it('nenhum produto com TODAS as palavras: devolve os que têm ALGUMA (mais palavras primeiro), marcado como parcial', () => {
    const r = buscarProdutos(DO_IVAN, 'leite creme zzzz')
    expect(r.parcial).toBe(true)
    expect(ids(r)[0]).toBe(1855900)                                                           // CREME DE LEITE casa 2 palavras; os outros "leite" só 1
    expect(ids(r)).toEqual(expect.arrayContaining([3469626, 3469628]))
    const so1 = buscarProdutos(DO_IVAN, 'leite chocolate')
    expect(so1.parcial).toBe(true)
    expect(ids(so1)).toEqual(expect.arrayContaining([3469626, 3469628, 1855900]))
    expect(so1.total).toBe(3)
  })

  it('no modo parcial palavra curta (menos de 3 letras) não conta, e sem nenhuma palavra casando não há resultado nem "parcial"', () => {
    expect(buscarProdutos(DO_IVAN, 'ab zzzz')).toEqual({ itens: [], total: 0 })
    expect(buscarProdutos(DO_IVAN, 'zzzz')).toEqual({ itens: [], total: 0 })
    expect(buscarProdutos(DO_IVAN, 'queijo').parcial).toBeUndefined()                         // achou com todas as palavras: não é parcial
  })

  it('o modo parcial também respeita o limite e informa o total', () => {
    const r = buscarProdutos(DO_IVAN, 'queijo zzzz', 2)
    expect(r.parcial).toBe(true)
    expect(r.itens).toHaveLength(2)
    expect(r.total).toBe(6)
  })
})

describe('sugestaoPorPalavras (a descrição da nota contra as palavras-chave do Ivan)', () => {
  const sug = (descricao: string) => sugestaoPorPalavras(nota(descricao), DO_IVAN)

  it.each([
    ['CÓD. FOR: 221430 QUEIJO MUSS ARGE LA PAULINA BARR KG', 1854713, ['queijo', 'muss']],       // "queijo muss é mesmo que mussarela" (Ivan, 06/10 à noite)
    ['CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', 3469626, ['leite', 'cond', 'semides']],   // "semi" (palavra-chave) é o começo de "semides"
    ['CÓD. FOR: 454513 OLEO SOJA VITALIV PET 900ML', 3138573, ['oleo', 'soja']],
    ['CÓD. FOR: 031647 CHICKEN SUPREME FS 2,5KG', 3469754, ['chicken', 'supreme']],               // o robô não tinha palpite: as palavras do Ivan têm
    ['CÓD. FOR: 120 LAGARTO RESF', 3469590, ['lagarto', 'resf']],                                 // "resf" é começo de "resfriada"
  ])('%s → produto %i', (descricao, id, palavras) => {
    const r = sug(descricao)
    expect(r?.produto.produto_id).toBe(id)
    expect(r?.palavras).toEqual(palavras)
  })

  it('limão: Tahiti/Taiti é o produto LIMÃO; siciliano é outro produto; só "limão" não basta para sugerir', () => {
    expect(sug('LIMAO TAITI TROPICAL')?.produto.produto_id).toBe(3469643)                      // o que o cupom do ATACADAO traz
    expect(sug('LIMAO TAITI TROPICAL')?.palavras).toEqual(['limao', 'taiti'])
    expect(sug('CÓD. FOR: 77 LIMAO TAHITI KG')?.produto.produto_id).toBe(3469643)              // a outra grafia
    expect(sug('LIMAO SICILIANO')?.produto.produto_id).toBe(3484974)
    expect(sug('LIMAO')).toBeNull()                                                            // uma palavra só não basta (os dois limões têm "limão")
    expect(ids(buscarProdutos(DO_IVAN, 'tahiti'))).toEqual([3469643])
    expect(ids(buscarProdutos(DO_IVAN, 'limão'))).toEqual([3469643, 3484974])                  // o mais curto primeiro
  })

  it('não chuta: CHOC LACTA BIS ORIGINAL não vira BISCOITO ("bis" tem 3 letras: só abreviação de 4 ou mais vale)', () => {
    expect(sug('CÓD. FOR: 515972 CHOC LACTA BIS ORIGINAL PACK 302,4G')).toBeNull()
  })

  it('empate de contagem: fica o produto com MENOS palavras do nome que a nota não menciona (a variante só vale quando a nota fala dela)', () => {
    // existem Q. MUÇARELA e QUEIJO MUÇARELA DE BÚFALA, os dois com "queijo" + "muss" casando: a nota não fala de búfala, então é a muçarela comum
    expect(sug('CÓD. FOR: 221430 QUEIJO MUSS ARGE LA PAULINA BARR KG')?.produto.produto_id).toBe(1854713)
    expect(sug('QUEIJO MUSS BUFALA KG')?.produto.produto_id).toBe(3484992)                       // aqui a nota fala de búfala: 3 palavras contra 2
    expect(sug('QUEIJO PROVOLONE KG')?.produto.produto_id).toBe(3476532)                         // o fatiado tem "fatia" a mais no nome
    expect(sug('QUEIJO PROVOLONE FATIADO KG')?.produto.produto_id).toBe(3839640)                 // "fatiado" reconhece "fatia": 3 palavras contra 2
  })

  it('empate de verdade (mesma contagem e mesmas palavras sobrando) = nada: o Ivan escolhe', () => {
    const gemeos = [kw(1, 'MOLHO PICANTE - INSUMOS (KG)', 'molho picante'), kw(2, 'MOLHO PICANTE - INSUMOS (UN)', 'molho picante')]
    expect(sugestaoPorPalavras(nota('MOLHO PICANTE 1KG'), gemeos)).toBeNull()
    expect(sugestaoPorPalavras(nota('MOLHO PICANTE 1KG'), [...gemeos, kw(3, 'MOLHO PICANTE FORTE - INSUMOS (KG)', 'molho picante')])).toBeNull()  // o 3º tem sobra, mas os gêmeos empatam na frente
  })

  it('uma palavra só não basta; ligações, unidades e "insumos" não contam; plural vale', () => {
    expect(sug('LEITE KG')).toBeNull()
    expect(sug('CREME DE LEITE UHT 200G')?.produto.produto_id).toBe(1855900)                    // "de" não conta, mas "creme" e "leite" sim
    expect(sug('QUEIJOS MUSSARELA')?.produto.produto_id).toBe(1854713)                          // "queijos" reconhece "queijo"
    expect(sug('INSUMOS INSUMOS')).toBeNull()
  })

  it('sem descrição, sem catálogo ou sem nada que case: null; o "CÓD. FOR: 123" do SisChef é ignorado', () => {
    expect(sugestaoPorPalavras({ ...nota(''), descricao: '' }, DO_IVAN)).toBeNull()
    expect(sugestaoPorPalavras({ ...nota('x'), descricao: undefined as unknown as string }, DO_IVAN)).toBeNull()
    expect(sugestaoPorPalavras(nota('QUEIJO MUSS'), [])).toBeNull()
    expect(sug('CÓD. FOR: 999999 DETERGENTE NEUTRO 500ML')).toBeNull()
    expect(sug('CÓD. FOR: 221430 123456')).toBeNull()
  })
})

describe('nomeParaMostrar', () => {
  it('usa o nome da lista (o corrigido) e informa o original do SisChef; sem a lista, ou sem o produto nela, fica o nome guardado na decisão', () => {
    expect(nomeParaMostrar(DO_IVAN, 3469626, 'LEITE CONDESSADO - INSUMOS (KG)'))
      .toEqual({ nome: 'LEITE CONDENSADO - INSUMOS (KG)', noSischef: 'LEITE CONDESSADO - INSUMOS (KG)' })
    expect(nomeParaMostrar(DO_IVAN, 1854713, 'X')).toEqual({ nome: 'Q. MUÇARELA - INSUMOS (KG)', noSischef: undefined })
    expect(nomeParaMostrar(DO_IVAN, 42, 'GUARDADO')).toEqual({ nome: 'GUARDADO' })
    expect(nomeParaMostrar(null, 3469626, 'GUARDADO')).toEqual({ nome: 'GUARDADO' })
  })
})

describe('produto escondido (receita da casa, não é de compra): MAIONESE DA CASA e MAIONESE ALHO NEGRO', () => {
  const MAIONESES: ProdutoCatalogo[] = [
    kw(3661383, 'MAIONESE DA CASA (KG)', undefined, { oculto: true }),
    kw(3661381, 'MAIONESE ALHO NEGRO (KG)', undefined, { oculto: true }),
    kw(3474674, 'MAIONESE MARIANA - INSUMOS (KG)', 'MAIONESE MARIANA'),
  ]

  it('a busca não o oferece (nem por nome, nem por código); os outros produtos continuam', () => {
    expect(ids(buscarProdutos(MAIONESES, 'maionese'))).toEqual([3474674])
    expect(buscarProdutos(MAIONESES, 'maionese').total).toBe(1)
    expect(ids(buscarProdutos(MAIONESES, '3661383'))).toEqual([])
    expect(ids(buscarProdutos(MAIONESES, 'casa'))).toEqual([])
    expect(ids(buscarProdutos(MAIONESES, 'maionese zzzz'))).toEqual([3474674])                 // nem no modo parcial
  })

  it('a sugestão pelas palavras-chave o ignora, mesmo quando a nota o descreve melhor', () => {
    expect(sugestaoPorPalavras(nota('MAIONESE DA CASA KG'), MAIONESES)).toBeNull()
    expect(sugestaoPorPalavras(nota('MAIONESE MARIANA BALDE'), MAIONESES)?.produto.produto_id).toBe(3474674)
  })

  it('o palpite do robô para um produto escondido não vira sugestão (nem como "produto novo"); o nome continua disponível para decisões antigas', () => {
    expect(sugestaoNoCatalogo({ ...nota('MAIONESE'), sugestao: { id: '3661383', nome: 'MAIONESE DA CASA' } }, MAIONESES)).toBeNull()
    expect(sugestaoNoCatalogo({ ...nota('MAIONESE'), sugestao: { id: '3474674', nome: 'MAIONESE MARIANA' } }, MAIONESES)?.produto_id).toBe(3474674)
    expect(nomeParaMostrar(MAIONESES, 3661383, 'GUARDADO')).toEqual({ nome: 'MAIONESE DA CASA (KG)', noSischef: undefined })
  })
})

// ---------- conversão de unidade (etapa 2): o que a caixa aceita, como mostra e o que lê da decisão gravada
describe('parseConversao (o que o Ivan digita em "Quanto vale 1 UN em KG?")', () => {
  it('aceita vírgula ou ponto como decimal, espaços em volta e número sem a parte inteira', () => {
    expect(parseConversao('0,395')).toBe(0.395)
    expect(parseConversao('0.395')).toBe(0.395)
    expect(parseConversao(',5')).toBe(0.5)
    expect(parseConversao('2')).toBe(2)
    expect(parseConversao(' 1 ')).toBe(1)
  })

  it('os limites são os do banco (cot_nfe_associar) e do robô (conversao_decidida): > 0, até 10000, até 4 casas', () => {
    expect(CONVERSAO_MAXIMA).toBe(10000)
    expect(CONVERSAO_CASAS).toBe(4)
    expect(parseConversao('0,0001')).toBe(0.0001)
    expect(parseConversao('10000')).toBe(10000)
    expect(parseConversao('0')).toBeNull()                 // zero não converte nada
    expect(parseConversao('0,00001')).toBeNull()           // 5 casas: o modal do SisChef só tem 4
    expect(parseConversao('0,12345')).toBeNull()
    expect(parseConversao('10001')).toBeNull()
    expect(parseConversao('10000,0001')).toBeNull()        // passa do máximo por uma fração
  })

  it('recusa texto, negativo, vazio, ponto de milhar e notação científica (fail-closed: o número vai para o SisChef para sempre)', () => {
    for (const ruim of ['', '   ', 'abc', '-1', '1,', '1.000,5', '1e3', '1,5,5', '100000']) expect(parseConversao(ruim)).toBeNull()
  })

  it('ponto E vírgula no mesmo texto é recusado (não dá para saber qual é o milhar): "1.000,5", "1,000.5", "1.5,"', () => {
    for (const ambiguo of ['1.000,5', '1,000.5', '1.5,', ',1.', '10.000,0001']) expect([ambiguo, parseConversao(ambiguo)]).toEqual([ambiguo, null])
    expect(parseConversao('1.000')).toBe(1)                // só ponto: é decimal (1,000 = 1), por isso formatarConversao não pode pôr milhar
  })
})

describe('formatarConversao e textoConversao (como a tela mostra a conversão)', () => {
  it('jeito brasileiro na vírgula, até 4 casas, sem zeros à toa e SEM ponto de milhar (o texto volta para o campo e "1.000" seria lido como 1)', () => {
    expect(formatarConversao(0.395)).toBe('0,395')
    expect(formatarConversao(2)).toBe('2')
    expect(formatarConversao(1.5)).toBe('1,5')
    expect(formatarConversao(0.0001)).toBe('0,0001')
    expect(formatarConversao(1000)).toBe('1000')
    expect(formatarConversao(1234.5)).toBe('1234,5')
    expect(formatarConversao(10000)).toBe('10000')
  })

  it('ida e volta: o que a tela mostra, o campo lê de volta igual (achado 2 da revisão: 1000 virava "1.000" e era gravado como 1)', () => {
    for (const v of [0.395, 1, 1000, 1234.5, 10000, 0.0001, 2.5]) expect([v, parseConversao(formatarConversao(v))]).toEqual([v, v])
  })

  it('"1 UN = 0,395 KG" só quando a unidade do produto é confiável (produto "(KG)", conversão obrigatória); sem a unidade da nota só "conversão 0,395"', () => {
    expect(textoConversao('UN', 'kg', 0.395)).toBe('1 UN = 0,395 KG')
    expect(textoConversao(' cx ', 'KG', 12)).toBe('1 CX = 12 KG')
    expect(textoConversao(null, 'kg', 2)).toBe('conversão 2')
    expect(textoConversao('', 'un', 2)).toBe('conversão 2')
  })

  it('unidade do produto que é palpite ("un") ou desconhecida (produto novo): "na unidade do produto no SisChef", nunca "= 2 UN"', () => {
    // Revisão adversarial: a linha "confirmado no app" dizia "1 KG = 2 UN" para um produto que no SisChef pode estar em PCT — a unidade "un" da
    // lista é um chute pelo nome. Antes, sem a unidade do produto, saía "conversão 2"; agora a frase é a mesma do eco "Vai gravar", nos três lugares.
    expect(textoConversao('KG', 'un', 2)).toBe('1 KG = 2 na unidade do produto no SisChef')
    expect(textoConversao('UN', 'un', 3)).toBe('1 UN = 3 na unidade do produto no SisChef')         // unidades "iguais", conversão aberta pelo link
    expect(textoConversao('KG', 'kg', 2)).toBe('1 KG = 2 na unidade do produto no SisChef')         // idem com "(KG)" no nome e nota em KG
    expect(textoConversao('UN', '', 2)).toBe('1 UN = 2 na unidade do produto no SisChef')           // produto novo (sem unidade na lista)
    expect(textoConversao('UN', undefined, 0.5)).toBe('1 UN = 0,5 na unidade do produto no SisChef')
    expect(textoConversao('UN', null, 1000)).toBe('1 UN = 1000 na unidade do produto no SisChef')  // sem ponto de milhar aqui também
  })

  it('rotuloUnidade: maiúsculas sem espaços; desconhecida = vazio', () => {
    expect(rotuloUnidade(' kg ')).toBe('KG')
    expect(rotuloUnidade('un')).toBe('UN')
    expect(rotuloUnidade(null)).toBe('')
    expect(rotuloUnidade(undefined)).toBe('')
  })
})

describe('conversaoDaDecisao (o que está gravado em cot_nfe.associacoes_app)', () => {
  const dec = (extra: Partial<AssociacaoApp> = {}): AssociacaoApp => ({ produto_id: 5, produto_nome: 'PRODUTO 5', unidade: 'kg', ...extra })
  it('número > 0 vale; decisão da etapa 1 (sem o campo), null, zero, negativo ou lixo = nenhuma conversão', () => {
    expect(conversaoDaDecisao(dec({ conversao: 0.395 }))).toBe(0.395)
    expect(conversaoDaDecisao(dec({ conversao: 2 }))).toBe(2)
    expect(conversaoDaDecisao(dec())).toBeNull()
    expect(conversaoDaDecisao(dec({ conversao: null }))).toBeNull()
    expect(conversaoDaDecisao(dec({ conversao: 0 }))).toBeNull()
    expect(conversaoDaDecisao(dec({ conversao: -1 }))).toBeNull()
    expect(conversaoDaDecisao(dec({ conversao: Number.NaN }))).toBeNull()
    expect(conversaoDaDecisao(dec({ conversao: '0,5' as unknown as number }))).toBeNull()   // texto vindo de um banco velho: não é número
    expect(conversaoDaDecisao(null)).toBeNull()
    expect(conversaoDaDecisao(undefined)).toBeNull()
  })
})
