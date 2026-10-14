import {
  CANDIDATOS_DE_INICIO, GRUPOS_DE_INSUMO, MAX_LETRAS_NOME, MINUTOS_SEM_RESPOSTA, UNIDADES, candidatoInativo, chaveDoNome, idadeDoPedido, mensagemDoRevisar, motivoSemConselho,
  nomeNoSischef, palavrasSugeridas, problemaDoProduto, separarCandidatos, sugerirUnidade,
} from '../../src/admin/produtoRegras'

describe('nomeNoSischef', () => {
  it('maiúsculas, sem o "CÓD. FOR", espaços colapsados e terminado em " - INSUMOS" (o padrão do Ivan)', () => {
    expect(nomeNoSischef('CÓD. FOR: 2350LG  Maionese   Hellmanns 3kg')).toBe('MAIONESE HELLMANNS 3KG - INSUMOS')
    expect(nomeNoSischef('  tomate cereja ')).toBe('TOMATE CEREJA - INSUMOS')
  })
  it('não repete o sufixo e devolve vazio para texto vazio', () => {
    expect(nomeNoSischef('AÇÚCAR CRISTAL - INSUMOS (KG)')).toBe('AÇÚCAR CRISTAL - INSUMOS (KG)')
    expect(nomeNoSischef('ABACATE - INSUMOS')).toBe('ABACATE - INSUMOS')
    expect(nomeNoSischef('   ')).toBe('')
    expect(nomeNoSischef(null)).toBe('')
  })
})

describe('sugerirUnidade', () => {
  it('peso na embalagem ou "(KG)" → KG; o resto (litro, ML, gramas) → UN: a lista do app só aceita KG ou UN', () => {
    expect(sugerirUnidade('MAION.HELLMANNS 1X3Kg')).toBe('KG')
    expect(sugerirUnidade('REPOLHO BCO (KG)')).toBe('KG')
    expect(sugerirUnidade('ÓLEO DE SOJA 900 ML')).toBe('UN')
    expect(sugerirUnidade('SUCO INTEGRAL 1,5 L')).toBe('UN')
    expect(sugerirUnidade('AGUA M.CRYSTAL C/GAS 1X500ML')).toBe('UN')
    expect(sugerirUnidade('FERM.FERMIPAN 1X500G')).toBe('UN')
    expect(sugerirUnidade('')).toBe('UN')
  })
})

describe('palavrasSugeridas', () => {
  it('as palavras do nome, sem medidas soltas e sem o sufixo', () => {
    expect(palavrasSugeridas('MAION.HELLMANNS 1X3Kg')).toBe('maion hellmanns')
    expect(palavrasSugeridas('CÓD. FOR: 77 CREAM CHEESE CATUPIR 1X1,2Kg')).toBe('cream cheese catupir')
  })
})

describe('problemaDoProduto', () => {
  const ok = { nome: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: '' }
  it('só libera com nome, grupo da lista do SisChef e unidade; grupo e unidade nunca são assumidos', () => {
    expect(problemaDoProduto(ok)).toBeNull()
    expect(problemaDoProduto({ ...ok, nome: '  ' })).toMatch(/nome/)
    expect(problemaDoProduto({ ...ok, grupo: '' })).toMatch(/grupo/)
    expect(problemaDoProduto({ ...ok, grupo: 'GRUPO QUE NÃO EXISTE' })).toMatch(/grupo/)
    expect(problemaDoProduto({ ...ok, unidade: 'XX' })).toMatch(/unidade/)
    expect(problemaDoProduto({ ...ok, nome: 'A'.repeat(121) })).toMatch(/grande/)
  })
  it('o limite vale para o nome FINAL, que vai ao SisChef (com o " - INSUMOS" que o app acrescenta), não para o que foi digitado (revisão 2, M13)', () => {
    expect(MAX_LETRAS_NOME).toBe(120)
    expect(problemaDoProduto({ ...ok, nome: 'A'.repeat(110) })).toBeNull()                    // 110 + " - INSUMOS" = 120
    expect(problemaDoProduto({ ...ok, nome: 'A'.repeat(111) })).toMatch(/grande/)             // 121 no SisChef (antes passava: só 111 digitadas)
    expect(problemaDoProduto({ ...ok, nome: `${'A'.repeat(110)} - INSUMOS` })).toBeNull()     // já com o sufixo: não conta duas vezes
  })
  it('a lista de grupos tem os 28 insumos lidos do SisChef e as unidades têm as siglas do SisChef', () => {
    expect(GRUPOS_DE_INSUMO).toContain('ESTOQUE CONTROLADO')
    expect(new Set(GRUPOS_DE_INSUMO).size).toBe(GRUPOS_DE_INSUMO.length)
    expect(GRUPOS_DE_INSUMO).toHaveLength(28)
    expect(UNIDADES.map((u) => u.sigla)).toEqual(['UN', 'KG'])   // a planilha de produtos do app só aceita KG ou UN
  })
})

describe('chaveDoNome', () => {
  it('sem acento, minúscula, só letras e números', () => {
    expect(chaveDoNome('MAIONESE HELLMANNS 3KG - INSUMOS')).toBe('maionese hellmanns 3kg insumos')
    expect(chaveDoNome('  Açúcar   (União) ')).toBe('acucar uniao')
    expect(chaveDoNome(null)).toBe('')
  })
})

// 1º uso real (14/10): o robô devolveu 8 candidatos (4 ativos, 4 inativos) e o botão que decide ficou fora da tela.
describe('candidatoInativo / separarCandidatos', () => {
  const c = (produto_id: number, descricao: string) => ({ produto_id, descricao, unidade: 'KG' })
  it('inativo = o "(inativo)" que o robô põe no fim da descrição', () => {
    expect(candidatoInativo(c(1, 'MAIONESE HEINZ 3KG - INSUMOS (inativo)'))).toBe(true)
    expect(candidatoInativo(c(2, 'MAIONESE DA CASA'))).toBe(false)
    expect(candidatoInativo(c(3, 'MAIONESE (INATIVO) DA CASA'))).toBe(false)   // só no fim, como o robô escreve
  })
  it('de início, só os 4 mais parecidos ATIVOS, na ordem do robô; os inativos e os que passam de 4 ficam para "Ver os outros"', () => {
    expect(CANDIDATOS_DE_INICIO).toBe(4)
    const lista = [c(1, 'A'), c(2, 'B (inativo)'), c(3, 'C'), c(4, 'D'), c(5, 'E (inativo)'), c(6, 'F'), c(7, 'G'), c(8, 'H (inativo)')]
    const { primeiros, outros } = separarCandidatos(lista)
    expect(primeiros.map((x) => x.produto_id)).toEqual([1, 3, 4, 6])
    expect(outros.map((x) => x.produto_id)).toEqual([2, 5, 7, 8])
    expect(separarCandidatos([c(1, 'A (inativo)')])).toEqual({ primeiros: [], outros: [c(1, 'A (inativo)')] })
    expect(separarCandidatos([c(1, 'A')])).toEqual({ primeiros: [c(1, 'A')], outros: [] })
  })
})

// Revisão 2 (14/10), I2/M14: a demora conta pela hora do PEDIDO no servidor, não pela hora em que a tela abriu.
describe('idadeDoPedido', () => {
  const agora = Date.parse('2026-10-14T12:30:00Z')
  it('pela hora do pedido (atualizado_em): pedido retomado parado há 30 min tem 30 min, mesmo com a tela aberta agora', () => {
    expect(idadeDoPedido('2026-10-14T12:00:00Z', agora, agora)).toBe(30 * 60_000)
  })
  it('nunca menos que o tempo que a tela já viu o pedido assim: relógio do aparelho atrasado não esconde a saída', () => {
    expect(idadeDoPedido('2026-10-14T14:30:00Z', agora - 21 * 60_000, agora)).toBe(21 * 60_000)   // hora "no futuro" para o aparelho
  })
  it('sem hora (ou ilegível): o tempo desde que a tela viu o pedido; nunca negativo', () => {
    expect(idadeDoPedido(null, agora - 1000, agora)).toBe(1000)
    expect(idadeDoPedido('não é data', agora + 5000, agora)).toBe(0)
  })
  it('o prazo de "o robô não respondeu" é de 20 minutos (o mesmo do servidor)', () => {
    expect(MINUTOS_SEM_RESPOSTA).toBe(20)
  })
})

// Revisão 2 (14/10), M2/I5: o aviso do REVISAR é honesto e curto, e o "confira" aparece uma vez só (o motivo do robô e do banco já costuma trazer o dele).
describe('motivoSemConselho / mensagemDoRevisar', () => {
  const vezes = (t: string) => (t.match(/confira/gi) ?? []).length
  it.each([
    ['a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN — confira o produto 3924999 no SisChef', 'a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN'],
    ['o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo', 'o robô não respondeu a tempo'],
    ['o clique em Salvar pode ter criado o produto — confira no SisChef antes de tentar de novo', 'o clique em Salvar pode ter criado o produto'],
    ['Confira os campos no SisChef (código 3924999); se estiverem certos, toque de novo: o robô só vai trazer o produto para a sua lista (não cria outro)', ''],
    ['unidade lida ausente: confira no SisChef', 'unidade lida ausente'],
    ['grupo não encontrado: nada foi criado', 'grupo não encontrado: nada foi criado'],
    [null, ''],
    // um conselho com OUTRA instrução (o do produto inativo, do robô) nunca é cortado: o Ivan precisa do "reative"
    ['existe no SisChef um produto INATIVO com esse nome (cód. 3924284): confira e reative no SisChef antes de tentar de novo', 'existe no SisChef um produto INATIVO com esse nome (cód. 3924284): confira e reative no SisChef antes de tentar de novo'],
  ])('tira do motivo só o conselho final genérico ("confira…"): %s', (motivo, fato) => {
    expect(motivoSemConselho(motivo)).toBe(fato)
  })

  it.each([
    ['existe no SisChef um produto INATIVO com esse nome (cód. 3924284): reative no SisChef antes de tentar de novo', 'reative no SisChef antes de tentar de novo'],
    ['existe no SisChef um produto INATIVO com esse nome (cód. 3924284): confira e reative no SisChef antes de tentar de novo', 'confira e reative no SisChef'],
    ['o pedido foi gravado, mas não consegui chamar o robô agora: tente de novo em instantes', 'tente de novo em instantes'],
    ['pedido antigo demais: peça de novo', 'peça de novo'],
  ])('motivo que já traz a instrução dele (%s): aparece inteiro e a tela não junta o conselho dela', (motivo, instrucao) => {
    const t = mensagemDoRevisar(motivo, null)
    expect(t).toBe(`O robô parou sem terminar: ${motivo}.`)
    expect(t).toContain(instrucao)
    expect(vezes(t)).toBeLessThanOrEqual(1)
  })

  it('com o código e um motivo que ficou com o "confira" dele: o conselho da tela não repete a palavra', () => {
    const t = mensagemDoRevisar('existe no SisChef um produto INATIVO com esse nome: confira e reative no SisChef antes de tentar de novo', 3924284)
    expect(t).toBe('O robô parou sem terminar: existe no SisChef um produto INATIVO com esse nome: confira e reative no SisChef antes de tentar de novo. O produto pode ter sido criado no SisChef com o código 3924284; se os campos lá estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).')
    expect(vezes(t)).toBe(1)
  })

  it('sem o código do produto: o texto de sempre, com o motivo e o conselho de conferir (uma vez)', () => {
    expect(mensagemDoRevisar('grupo não encontrado', null)).toBe('O robô parou sem terminar: grupo não encontrado. Confira no SisChef se o produto já existe antes de tentar de novo.')
    expect(mensagemDoRevisar(null, null)).toBe('O robô parou sem terminar. Confira no SisChef se o produto já existe antes de tentar de novo.')
    const preso = mensagemDoRevisar('o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo', null)
    expect(preso).toBe('O robô parou sem terminar: o robô não respondeu a tempo. Confira no SisChef se o produto já existe antes de tentar de novo.')
    expect(vezes(preso)).toBe(1)
  })

  it('com o código (o robô pode ter criado o produto): diz o código e que "Tentar de novo" só traz o produto para a lista; o "confira" do robô não se repete', () => {
    const conselho = 'O produto pode ter sido criado no SisChef com o código 3924999: confira os campos lá; se estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).'
    const doRobo = mensagemDoRevisar('Confira os campos no SisChef (código 3924999); se estiverem certos, toque de novo: o robô só vai trazer o produto para a sua lista (não cria outro)', 3924999)
    expect(doRobo).toBe(conselho)
    const doBanco = mensagemDoRevisar('a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN — confira o produto 3924999 no SisChef', 3924999)
    expect(doBanco).toBe(`O robô parou sem terminar: a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN. ${conselho}`)
    expect(vezes(doRobo)).toBe(1)
    expect(vezes(doBanco)).toBe(1)
    expect(doBanco).not.toMatch(/não existe/i)
  })
})
