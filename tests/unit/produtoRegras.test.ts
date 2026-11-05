import {
  CANDIDATOS_DE_INICIO, GRUPOS_DE_INSUMO, MAX_LETRAS_NOME, MINUTOS_SEM_RESPOSTA, UNIDADES, candidatoInativo, chaveDoNome, idadeDoPedido, mensagemDoRevisar, motivoSemConselho,
  nomeNoSischef, palavrasSugeridas, problemaDoProduto, separarCandidatos, sugerirUnidade, trocaDeUnidade,
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

describe('trocaDeUnidade — produto que JÁ existe no SisChef em CX, RL… (o grampo 3476468, 04/11/2026)', () => {
  const CX = 'a unidade do produto no SisChef é CX; a lista do app só aceita KG, UN, CT ou PCT — confira o produto 3476468 no SisChef'
  it('devolve a unidade, o código e a frase que o Ivan manda ao Claude (ação nomeada)', () => {
    expect(trocaDeUnidade(CX, 3476468)).toEqual({ unidade: 'CX', produtoId: 3476468, frase: 'pode trocar a unidade do produto 3476468 de CX para UN no SisChef' })
  })
  it('sem o código na coluna, lê o código de dentro do motivo; unidade em minúscula vira maiúscula', () => {
    expect(trocaDeUnidade(CX, null)?.produtoId).toBe(3476468)
    expect(trocaDeUnidade(CX.replace('é CX', 'é rl'), 3476468)?.unidade).toBe('RL')
  })
  it.each([
    ['unidade que o app aceita (texto antigo do banco)', 'a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN — confira o produto 3924999 no SisChef', 3924999],
    ['KG', 'a unidade do produto no SisChef é KG; a lista do app só aceita KG, UN, CT ou PCT — confira o produto 1 no SisChef', 1],
    ['outro motivo qualquer', 'grupo não encontrado: nada foi criado', 3476468],
    ['sem motivo', null, 3476468],
    ['sem nenhum código (nem coluna nem motivo)', 'a unidade do produto no SisChef é CX; a lista do app só aceita KG, UN, CT ou PCT', null],
  ])('não é troca de unidade (devolve null): %s', (_nome, motivo, id) => {
    expect(trocaDeUnidade(motivo as string | null, id as number | null)).toBeNull()
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

  // 04/11/2026 (cupom da A. N. da Silva, o grampo): o texto de "O produto pode ter sido criado" era FALSO quando o produto já existia no SisChef em CX, e "Tentar de novo" repetia o erro.
  const CX = 'a unidade do produto no SisChef é CX; a lista do app só aceita KG, UN, CT ou PCT — confira o produto 3476468 no SisChef'
  it('unidade fora das 4 do app (CX): diz que o produto JÁ EXISTE, em qual unidade está, e a ORDEM (trocar a unidade primeiro, depois "Tentar de novo")', () => {
    const t = mensagemDoRevisar(CX, 3476468)
    // "UN" é a saída comum (caixa, rolo), mas a revisão independente lembrou que nem todo produto fora da lista é contagem (litro, metro): a decisão é do Ivan
    expect(t).toBe('Este produto JÁ EXISTE no SisChef (código 3476468), mas está em CX e o app só trabalha com KG, UN, CT e PCT. Primeiro troque a unidade dele para UN, ou para outra dessas 4 se UN não servir (peça ao Claude com a frase abaixo, ou troque você mesmo no SisChef); depois toque em “Tentar de novo”. Antes disso ele repete este aviso.')
    expect(t).not.toMatch(/pode ter sido criado/i)
    expect(vezes(t)).toBe(0)
  })
  it('a mesma mensagem quando o código só vem dentro do motivo (sem a coluna do código): a saída é o botão de sempre', () => {
    const t = mensagemDoRevisar(CX, null)
    expect(t).toContain('Este produto JÁ EXISTE no SisChef (código 3476468), mas está em CX')
    expect(t).toContain('depois toque de novo em “Cadastrar no SisChef e no app”')
    expect(t).not.toContain('Tentar de novo')
  })
  it('unidade que o app aceita (o texto antigo do banco dizia PCT) NÃO é troca de unidade: segue o texto de sempre', () => {
    const antigo = 'a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN — confira o produto 3924999 no SisChef'
    expect(mensagemDoRevisar(antigo, 3924999)).toMatch(/^O robô parou sem terminar: a unidade do produto no SisChef é PCT/)
  })
  // o robô clicou em Salvar e viu "Salvo com sucesso.", mas a URL não ganhou ?id= (3 de 3 vezes desde 14/10): o produto FOI criado; o 2º toque o acha pelo nome (JA_EXISTIA)
  const SEM_CODIGO = "cliquei em Salvar e não vi o código do produto na URL (estou em https://sistema.sischef.com/admin/produtos/produto.jsf) — o clique em Salvar pode ter criado o produto — confira no SisChef antes de tentar de novo"
  it('"cliquei em Salvar e não vi o código": diz que o produto provavelmente foi criado, que o botão principal o traz pelo nome e que se não vier é para conferir antes de criar dois (1 "confira")', () => {
    const t = mensagemDoRevisar(SEM_CODIGO, null)
    expect(t).toBe('O robô clicou em Salvar no SisChef, mas não conseguiu ler o código do produto: ele provavelmente foi criado. Toque de novo em “Cadastrar no SisChef e no app”: o robô procura o produto pelo nome e traz o código para a sua lista. Se ele não aparecer, confira em Produtos no SisChef antes de tentar outra vez, para não criar dois.')
    expect(vezes(t)).toBe(1)
    expect(t).not.toMatch(/não cria outro/i)   // nunca promete o que só vale se a busca achar o produto
  })
  it('se o robô não viu NEM a mensagem de salvo NEM o código, o produto pode não ter sido criado: texto de sempre', () => {
    const nada = "cliquei em Salvar e não vi a mensagem 'Salvo com sucesso.' nem o código do produto na URL (estou em https://x/produto.jsf) — o clique em Salvar pode ter criado o produto — confira no SisChef antes de tentar de novo"
    expect(mensagemDoRevisar(nada, null)).toMatch(/^O robô parou sem terminar: cliquei em Salvar e não vi a mensagem/)
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
