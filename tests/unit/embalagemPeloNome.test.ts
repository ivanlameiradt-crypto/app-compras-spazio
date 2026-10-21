import { embalagemPeloNome, formatarQuantidade, quantidadeNoEstoque } from '../../src/admin/associacaoRegras'

describe('embalagemPeloNome: sugestão de conversão tirada do nome da nota para embalagem de várias unidades (o Ivan confere e corrige)', () => {
  it('o ketchup da MATEUS: "168UN" na nota em UN → 168', () => {
    expect(embalagemPeloNome('CÓD. FOR: 594614 KETCHUP SACHE 168UN - INSUMOS', 'UN')).toEqual({ fator: 168, trecho: '168UN' })
    expect(embalagemPeloNome('KETCHUP SACHE 168 UN', 'un')).toEqual({ fator: 168, trecho: '168UN' })
    expect(embalagemPeloNome('GUARDANAPO 500 UND', 'PCT')).toEqual({ fator: 500, trecho: '500UND' })
    expect(embalagemPeloNome('COPO 200UNID', 'CX')).toEqual({ fator: 200, trecho: '200UNID' })
  })

  it('o pão e o brioche da De Marchi: "PCT/15" (com "CX/4" ou "CX/8" ao lado, que não é a conta)', () => {
    expect(embalagemPeloNome('CÓD. FOR: 105900444 PAO CLASSICO AUSTRALIANO 380G PCT/15 CX/4', 'UN')).toEqual({ fator: 15, trecho: 'PCT/15' })
    expect(embalagemPeloNome('CÓD. FOR: 105899939 PAO BQB HB CLASSICO BRIOCHE 4CT PCT/15 CX/8 CONG', 'PCT')).toEqual({ fator: 15, trecho: 'PCT/15' })
    expect(embalagemPeloNome('SALSICHA C/12', 'UN')).toEqual({ fator: 12, trecho: 'C/12' })
  })

  it('o mesmo número dito duas vezes vale; dois números diferentes não dizem qual é a conta: nada', () => {
    expect(embalagemPeloNome('COPO PCT/12 12UN', 'UN')).toEqual({ fator: 12, trecho: '12UN' })
    expect(embalagemPeloNome('COPO 50UN C/10', 'UN')).toBeNull()
    expect(embalagemPeloNome('COPO 50UN PCT/10', 'CX')).toBeNull()
  })

  it('nota em peso ou volume não recebe sugestão: o número do nome não é "unidades por unidade da nota"', () => {
    for (const un of ['KG', 'kg', 'G', 'L', 'ML', 'MT']) expect(embalagemPeloNome('KETCHUP SACHE 168UN', un)).toBeNull()
  })

  it('número colado em outra coisa não conta (12X395G, 2,5UN, 1/2UN, letras antes ou depois, número de um dígito)', () => {
    expect(embalagemPeloNome('LEITE COND 12X395G', 'UN')).toBeNull()
    expect(embalagemPeloNome('MISTURA 6X12UN', 'UN')).toBeNull()
    expect(embalagemPeloNome('ITEM 2,5UN', 'UN')).toBeNull()
    expect(embalagemPeloNome('ITEM 1/2UN', 'UN')).toBeNull()
    expect(embalagemPeloNome('ITEM ABC168UN', 'UN')).toBeNull()
    expect(embalagemPeloNome('ITEM 168UNIDADES', 'UN')).toBeNull()
    expect(embalagemPeloNome('ITEM 5UN', 'UN')).toBeNull()
    expect(embalagemPeloNome('PAO PCT/15X4', 'UN')).toBeNull()
  })

  it('fator 1 ou absurdo, descrição vazia ou sem número: nada', () => {
    expect(embalagemPeloNome('PAO PCT/1', 'UN')).toBeNull()
    expect(embalagemPeloNome('PAO PCT/20000', 'UN')).toBeNull()
    expect(embalagemPeloNome('', 'UN')).toBeNull()
    expect(embalagemPeloNome(undefined, 'UN')).toBeNull()
    expect(embalagemPeloNome('CREME DE LEITE - INSUMOS', 'UN')).toBeNull()
  })

  it('sem a unidade da nota ainda sugere (a leitura do SisChef pode não trazê-la): quem confirma é o Ivan', () => {
    expect(embalagemPeloNome('KETCHUP SACHE 168UN', null)).toEqual({ fator: 168, trecho: '168UN' })
  })
})

describe('quantidadeNoEstoque / formatarQuantidade: a prévia "entram no estoque"', () => {
  it('10 caixas de 168 → 1.680; sem ruído de ponto flutuante', () => {
    expect(quantidadeNoEstoque(10, 168)).toBe(1680)
    expect(quantidadeNoEstoque(3.18, 0.395)).toBe(1.2561)
    expect(quantidadeNoEstoque(31.995, 1)).toBe(31.995)
    expect(quantidadeNoEstoque(8, 15)).toBe(120)
  })

  it('sem quantidade legível ou sem conversão válida: null (a tela não mostra conta que não sabe fazer)', () => {
    expect(quantidadeNoEstoque(null, 168)).toBeNull()
    expect(quantidadeNoEstoque(undefined, 168)).toBeNull()
    expect(quantidadeNoEstoque(0, 168)).toBeNull()
    expect(quantidadeNoEstoque(-1, 168)).toBeNull()
    expect(quantidadeNoEstoque(Number.NaN, 168)).toBeNull()
    expect(quantidadeNoEstoque(10, null)).toBeNull()
    expect(quantidadeNoEstoque(10, 0)).toBeNull()
  })

  it('formata no jeito brasileiro, com milhar e até 4 casas', () => {
    expect(formatarQuantidade(1680)).toBe('1.680')
    expect(formatarQuantidade(3.95)).toBe('3,95')
    expect(formatarQuantidade(0.3024)).toBe('0,3024')
    expect(formatarQuantidade(31.995)).toBe('31,995')
  })
})
