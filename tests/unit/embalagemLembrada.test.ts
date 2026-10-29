import { entraComALembrada, memoriaDoItem, mesmoNumero, mesmoProdutoLembrado, situacaoDaMemoria, textoVisto } from '../../src/admin/embalagemLembrada'
import type { ItemNotaSefaz, NfeAprendizado } from '../../src/lib/tipos'

// Memória de embalagem das notas fiscais, lado da tela (29/10/2026): quando a linha que o robô lembra vale para o item da nota. Tudo INVENTADO (repositório público).
const CNPJ = '12345678000190'
const COCA = 101

const linha = (over: Partial<NfeAprendizado> = {}): NfeAprendizado => ({
  emitente_cnpj: CNPJ, cod_forn: '17253', unidade_nota: 'UN', produto_id: COCA, produto_nome: 'COCA COLA 350 ML', fator: 6, preco_ref: 42,
  descricao_exemplo: 'REFRIG COLA 6X350ML', vezes: 2, ultima_chave: null, atualizado_em: '2026-10-28T20:15:00+00:00', ...over,
})
const item = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz => ({
  n: 1, descricao: 'CÓD. FOR: 17253 REFRIG COCA COLA LT SIX PACK 350ML', qtd: 10, unidade_sischef: 'UN', produto_id: COCA, produto_nome: 'COCA COLA 350 ML', associacao: 'sischef', ...over,
})
const nota = (cnpj: string | null | undefined = CNPJ) => ({ cnpj_emitente: cnpj })

describe('memoriaDoItem — a chave é CNPJ + CÓD. FOR + unidade da nota', () => {
  it('casa quando os três batem e devolve a própria linha', () => {
    const l = linha()
    expect(memoriaDoItem([l], nota(), item())).toBe(l)
  })

  it('o CNPJ da nota com pontuação casa (só os dígitos contam)', () => {
    expect(memoriaDoItem([linha()], nota('12.345.678/0001-90'), item())).not.toBeNull()
  })

  it('o CNPJ da memória com pontuação também casa (a tela não depende de como a linha veio)', () => {
    expect(memoriaDoItem([linha({ emitente_cnpj: '12.345.678/0001-90' })], nota(), item())).not.toBeNull()
  })

  it('CNPJ de outro fornecedor: o mesmo código e a mesma unidade NÃO bastam', () => {
    expect(memoriaDoItem([linha()], nota('99887766000155'), item())).toBeNull()
  })

  it.each([[null], [undefined], [''], ['   '], ['sem número']])('nota sem CNPJ (%j): nada lembrado, mesmo com tudo o mais igual', (cnpj) => {
    expect(memoriaDoItem([linha()], { cnpj_emitente: cnpj as string | null | undefined }, item())).toBeNull()   // objeto direto: o `nota()` trocaria o undefined pelo CNPJ padrão
  })

  it('a tela NÃO tira o CNPJ da chave de acesso: sem cnpj_emitente não há memória a mostrar', () => {
    expect(memoriaDoItem([linha()], { cnpj_emitente: null, chave: `152610${CNPJ}55001000090049100000000700` } as never, item())).toBeNull()
  })

  it('o código é texto exato: zero à esquerda, outra grafia ou parte dele não casam', () => {
    for (const cod of ['017253', '1725', '172530', '17253A', 'x17253']) {
      expect([cod, memoriaDoItem([linha({ cod_forn: cod })], nota(), item())]).toEqual([cod, null])
    }
    // e do outro lado: a nota com zero à esquerda não casa com a linha sem ele
    expect(memoriaDoItem([linha()], nota(), item({ descricao: 'CÓD. FOR: 017253 REFRIG COCA COLA' }))).toBeNull()
  })

  it('o código não muda de maiúscula para minúscula: "AB-1" é diferente de "ab-1"', () => {
    expect(memoriaDoItem([linha({ cod_forn: 'AB-1' })], nota(), item({ descricao: 'CÓD. FOR: ab-1 PRODUTO' }))).toBeNull()
    expect(memoriaDoItem([linha({ cod_forn: 'AB-1' })], nota(), item({ descricao: 'CÓD. FOR: AB-1 PRODUTO' }))).not.toBeNull()
  })

  it('espaços nas pontas do código da linha não atrapalham (o resto do texto tem de ser igual)', () => {
    expect(memoriaDoItem([linha({ cod_forn: ' 17253 ' })], nota(), item())).not.toBeNull()
  })

  it('a unidade da nota entra na chave: a linha de "CX" não vale para um item em "UN"', () => {
    expect(memoriaDoItem([linha({ unidade_nota: 'CX' })], nota(), item())).toBeNull()
    expect(memoriaDoItem([linha({ unidade_nota: 'CX' })], nota(), item({ unidade_sischef: 'CX' }))).not.toBeNull()
  })

  it('a unidade do item é comparada em maiúsculas e sem espaços nas pontas ("un" e " UN " valem UN)', () => {
    expect(memoriaDoItem([linha()], nota(), item({ unidade_sischef: 'un' }))).not.toBeNull()
    expect(memoriaDoItem([linha()], nota(), item({ unidade_sischef: ' UN ' }))).not.toBeNull()
  })

  it.each([[null], [''], ['  ']])('item sem unidade (%j): nada lembrado', (u) => {
    expect(memoriaDoItem([linha()], nota(), item({ unidade_sischef: u as string | null }))).toBeNull()
  })

  it('item sem "CÓD. FOR" na descrição: nada lembrado (a descrição sozinha nunca é chave)', () => {
    expect(memoriaDoItem([linha()], nota(), item({ descricao: 'REFRIG COLA 6X350ML' }))).toBeNull()
    expect(memoriaDoItem([linha({ descricao_exemplo: 'REFRIG COLA 6X350ML' })], nota(), item({ descricao: 'REFRIG COLA 6X350ML' }))).toBeNull()
  })

  it('o CÓD. FOR vem do começo da descrição, do jeito que o SisChef o escreve (com ou sem ponto e dois-pontos)', () => {
    for (const d of ['CÓD. FOR: 17253 X', 'COD FOR 17253 X', 'CÓD.FOR:17253 X', 'cod. for: 17253 X']) {
      expect([d, memoriaDoItem([linha()], nota(), item({ descricao: d }))?.cod_forn]).toEqual([d, '17253'])
    }
  })

  it('memória vazia, nula ou indefinida: nada lembrado', () => {
    expect(memoriaDoItem([], nota(), item())).toBeNull()
    expect(memoriaDoItem(null, nota(), item())).toBeNull()
    expect(memoriaDoItem(undefined, nota(), item())).toBeNull()
  })

  it('entre várias linhas escolhe a da chave certa (mesmo código em outra unidade ou em outro fornecedor não atrapalha)', () => {
    const certa = linha({ fator: 12, produto_nome: 'CERTA' })
    const memoria = [
      linha({ unidade_nota: 'CX', fator: 2 }),
      linha({ emitente_cnpj: '99887766000155', fator: 3 }),
      linha({ cod_forn: '17254', fator: 4 }),
      certa,
    ]
    expect(memoriaDoItem(memoria, nota(), item())).toBe(certa)
  })

  it('o produto ligado ao item não entra na chave: a linha casa mesmo com o item ligado a outro produto (a tela decide o que dizer)', () => {
    expect(memoriaDoItem([linha()], nota(), item({ produto_id: 999 }))).not.toBeNull()
    expect(memoriaDoItem([linha()], nota(), item({ produto_id: null }))).not.toBeNull()
  })
})

describe('textoVisto — "visto em 2 notas, a última em 28/10"', () => {
  it('duas ou mais notas: a contagem e o dia da última', () => {
    expect(textoVisto({ vezes: 2, atualizado_em: '2026-10-28T20:15:00+00:00' })).toBe('visto em 2 notas, a última em 28/10')
    expect(textoVisto({ vezes: 11, atualizado_em: '2026-01-05T15:00:00Z' })).toBe('visto em 11 notas, a última em 05/01')
  })

  it('uma nota só: não existe "a última"', () => {
    expect(textoVisto({ vezes: 1, atualizado_em: '2026-10-28T20:15:00Z' })).toBe('visto em 1 nota, em 28/10')
  })

  it('o dia é o de Brasília, qualquer que seja o fuso do aparelho: 02h30 UTC ainda é o dia anterior', () => {
    expect(textoVisto({ vezes: 2, atualizado_em: '2026-10-29T02:30:00Z' })).toBe('visto em 2 notas, a última em 28/10')
    expect(textoVisto({ vezes: 2, atualizado_em: '2026-10-29T03:30:00Z' })).toBe('visto em 2 notas, a última em 29/10')
  })

  it('data ilegível ou ausente: só a contagem', () => {
    expect(textoVisto({ vezes: 3, atualizado_em: 'ontem' })).toBe('visto em 3 notas')
    expect(textoVisto({ vezes: 3, atualizado_em: '' })).toBe('visto em 3 notas')
    expect(textoVisto({ vezes: 1, atualizado_em: 'ontem' })).toBe('visto em 1 nota')
  })

  it('contagem estranha (0, texto, vazio) vira "1 nota": nunca "visto em 0 notas"', () => {
    for (const v of [0, -3, Number.NaN, 1.9]) expect([v, textoVisto({ vezes: v, atualizado_em: '2026-10-28T20:15:00Z' })]).toEqual([v, 'visto em 1 nota, em 28/10'])
  })
})

describe('mesmoProdutoLembrado e mesmoNumero', () => {
  it('compara o produto ligado ao item com o da linha, venha o código como número ou como texto', () => {
    expect(mesmoProdutoLembrado(item(), linha())).toBe(true)
    expect(mesmoProdutoLembrado(item({ produto_id: String(COCA) as unknown as number }), linha())).toBe(true)
    expect(mesmoProdutoLembrado(item({ produto_id: ` ${COCA} ` as unknown as number }), linha())).toBe(true)
    expect(mesmoProdutoLembrado(item({ produto_id: 999 }), linha())).toBe(false)
  })

  it('item sem produto nunca é "o mesmo" (nem com a linha de produto 0)', () => {
    expect(mesmoProdutoLembrado(item({ produto_id: null }), linha())).toBe(false)
    expect(mesmoProdutoLembrado(item({ produto_id: '' as unknown as number }), linha())).toBe(false)
    expect(mesmoProdutoLembrado(item({ produto_id: null }), linha({ produto_id: 0 }))).toBe(false)
  })

  it('mesmoNumero tolera o ruído de ponto flutuante e nada além disso', () => {
    expect(mesmoNumero(12, 12)).toBe(true)
    expect(mesmoNumero(0.1 + 0.2, 0.3)).toBe(true)
    expect(mesmoNumero(12, 12.0001)).toBe(false)
    expect(mesmoNumero(6, 12)).toBe(false)
  })
})

describe('situacaoDaMemoria — o que a tela diz no item que já vem associado', () => {
  it('sem linha lembrada: nada', () => {
    expect(situacaoDaMemoria(item(), null, null, false)).toBeNull()
    expect(situacaoDaMemoria(item(), undefined, 12, false)).toBeNull()
  })

  it('Ivan não informou número, item não pede conversão e o produto é o lembrado: "aplica"', () => {
    expect(situacaoDaMemoria(item(), linha(), null, false)).toBe('aplica')
    expect(situacaoDaMemoria(item(), linha(), undefined, false)).toBe('aplica')
  })

  it('o produto ligado é outro: aviso amarelo "outro-produto" (e não "aplica")', () => {
    expect(situacaoDaMemoria(item({ produto_id: 999 }), linha(), null, false)).toBe('outro-produto')
  })

  it('o Ivan informou um número diferente do lembrado: só "vale-o-informado" (mesmo com o produto trocado)', () => {
    expect(situacaoDaMemoria(item(), linha({ fator: 12 }), 6, false)).toBe('vale-o-informado')
    expect(situacaoDaMemoria(item({ produto_id: 999 }), linha({ fator: 12 }), 6, false)).toBe('vale-o-informado')
    expect(situacaoDaMemoria(item(), linha({ fator: 12 }), 1, false)).toBe('vale-o-informado')   // 1 também é um número informado ("o produto já é o fardo")
  })

  it('o Ivan informou exatamente o número lembrado: nada a mais (a linha "Conversão informada" já diz)', () => {
    expect(situacaoDaMemoria(item(), linha({ fator: 12 }), 12, false)).toBeNull()
  })

  it('o robô parou pedindo a conversão (UN DIFERE) e ninguém informou: nada de memória', () => {
    expect(situacaoDaMemoria(item(), linha(), null, true)).toBeNull()
  })

  it('se o Ivan informou um número, vale o que ele informou mesmo que o robô tenha pedido a conversão', () => {
    expect(situacaoDaMemoria(item(), linha({ fator: 12 }), 6, true)).toBe('vale-o-informado')
  })
})

describe('entraComALembrada — a conta que a tela mostra', () => {
  it('quantidade × fator, no jeito do estoque', () => {
    expect(entraComALembrada(item({ qtd: 10 }), linha({ fator: 12 }))).toBe(120)
    expect(entraComALembrada(item({ qtd: 3.18 }), linha({ fator: 0.395 }))).toBe(1.2561)
  })
  it('sem quantidade legível não há conta', () => {
    expect(entraComALembrada(item({ qtd: null }), linha())).toBeNull()
    expect(entraComALembrada(item({ qtd: 0 }), linha())).toBeNull()
  })
})
