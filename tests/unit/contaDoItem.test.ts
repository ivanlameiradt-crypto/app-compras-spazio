import { contaDoItem } from '../../src/admin/contaDoItem'
import type { ItemNotaSefaz } from '../../src/lib/tipos'

// A conta de cada item já ligado ao produto do SisChef (31/10/2026, pedido do Ivan: "48 PC × 15 = 720 UN — automático"). Tudo INVENTADO (repositório público), com os números do caso real:
// 48 pacotes de 15 = 720; o pacote de 15 da regra fixa do robô; 8 UN de 2,27 kg = 18,16 KG.
const PAO_REGRA = 9002

/** O Brioche inventado: a nota traz 48 PC, o SisChef converte e mostra 720 UN. */
const item = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz => ({
  n: 1, descricao: 'CÓD. FOR: 1001 PAO BRIOCHE PCT/15', qtd: 720, unidade_sischef: 'UN', produto_id: 9001, produto_nome: 'PAO BRIOCHE - INSUMOS', associacao: 'sischef',
  qtd_nota: 48, unidade_nota: 'PC', ...over,
})
/** O pão com a regra fixa do robô: a tela do SisChef ainda mostra a quantidade da nota (4 UN) e o robô multiplica por 15 ao lançar. */
const pao = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz => item({
  descricao: 'CÓD. FOR: 1002 PAO AUSTRALIANO PCT/15', qtd: 4, unidade_sischef: 'UN', produto_id: PAO_REGRA, qtd_nota: 4, unidade_nota: 'UN',
  regra_embalagem: { fator: 15, unidade: 'UN', produto_id: PAO_REGRA }, ...over,
})

describe('contaDoItem — o SisChef já converteu (a quantidade convertida difere da da nota)', () => {
  it('48 PC viram 720 UN: "48 PC × 15 = 720 UN"', () => {
    expect(contaDoItem(item())).toEqual({ conta: '48 PC × 15 = 720 UN', entra: '720 UN', quem: 'sischef' })
  })

  it('UN em KG: 8 UN de 2,27 kg = 18,16 KG (o fator sai da divisão, com vírgula)', () => {
    expect(contaDoItem(item({ qtd: 18.16, unidade_sischef: 'KG', qtd_nota: 8, unidade_nota: 'UN' }))).toEqual({ conta: '8 UN × 2,27 = 18,16 KG', entra: '18,16 KG', quem: 'sischef' })
  })

  it('quantidade grande ganha o ponto de milhar: 10 CX de 168 = 1.680 UN', () => {
    expect(contaDoItem(item({ qtd: 1680, qtd_nota: 10, unidade_nota: 'CX' }))?.conta).toBe('10 CX × 168 = 1.680 UN')
  })

  it('a unidade vem em maiúsculas e sem espaços nas pontas', () => {
    expect(contaDoItem(item({ unidade_nota: ' pc ', unidade_sischef: ' un ' }))?.conta).toBe('48 PC × 15 = 720 UN')
  })

  it('fator que não fecha redondo (1/3) continua mostrando a conta com 4 casas', () => {
    expect(contaDoItem(item({ qtd: 100, qtd_nota: 3, unidade_nota: 'CX' }))?.conta).toBe('3 CX × 33,3333 = 100 UN')
  })

  it('fator pequeno demais para as 4 casas (arredonda para zero): sem a multiplicação, só "→" com o que o SisChef mostra', () => {
    expect(contaDoItem(item({ qtd: 1, unidade_sischef: 'KG', qtd_nota: 100000, unidade_nota: 'UN' }))).toEqual({ conta: '100.000 UN → 1 KG', entra: '1 KG', quem: 'sischef' })
  })

  it('fator que arredonda para um número ERRADO nas 4 casas (6 ÷ 100.000 → 0,0001 reproduziria 10): nunca escreve uma conta que não fecha, usa só "→"', () => {
    expect(contaDoItem(item({ qtd: 6, unidade_sischef: 'KG', qtd_nota: 100000, unidade_nota: 'UN' }))).toEqual({ conta: '100.000 UN → 6 KG', entra: '6 KG', quem: 'sischef' })
  })
})

describe('contaDoItem — a regra FIXA do robô (ele multiplica a linha do pedido ao lançar)', () => {
  it('pão 4 UN com a regra ×15: "4 UN × 15 = 60 UN", quem faz é o robô', () => {
    expect(contaDoItem(pao())).toEqual({ conta: '4 UN × 15 = 60 UN', entra: '60 UN', quem: 'robo' })
  })

  it('se o SisChef já converteu (60 UN) a conta é a mesma, mas quem fez foi o SisChef', () => {
    expect(contaDoItem(pao({ qtd: 60 }))).toEqual({ conta: '4 UN × 15 = 60 UN', entra: '60 UN', quem: 'sischef' })
  })

  it('o produto da regra pode vir como texto ("9002") ou número', () => {
    expect(contaDoItem(pao({ regra_embalagem: { fator: 15, unidade: 'UN', produto_id: String(PAO_REGRA) } }))?.quem).toBe('robo')
    expect(contaDoItem(pao({ produto_id: Number(PAO_REGRA) }))?.quem).toBe('robo')
  })

  it('regra de OUTRO produto não vale para este item: sem conta (a mesma quantidade, nada a multiplicar)', () => {
    expect(contaDoItem(pao({ regra_embalagem: { fator: 15, unidade: 'UN', produto_id: 9999 } }))).toBeNull()
  })

  it('regra para outra unidade da nota (CX) não vale para a nota em UN', () => {
    expect(contaDoItem(pao({ regra_embalagem: { fator: 15, unidade: 'CX', produto_id: PAO_REGRA } }))).toBeNull()
  })

  it('a quantidade que não é nem a da nota nem a da regra NÃO é "automática" (o robô para nesse caso)', () => {
    expect(contaDoItem(pao({ qtd: 30 }))).toBeNull()
  })

  it.each([[1], [0], [-3], [Number.NaN], ['15'], [null]])('fator da regra inválido (%j): a regra é ignorada e, com a mesma quantidade, não há conta', (fator) => {
    expect(contaDoItem(pao({ regra_embalagem: { fator: fator as never, unidade: 'UN', produto_id: PAO_REGRA } }))).toBeNull()
  })

  it('regra com a nota em UN e o SisChef mostrando OUTRA unidade na mesma quantidade (4 UN → 4 KG): não se diz automática', () => {
    expect(contaDoItem(pao({ unidade_sischef: 'KG' }))).toBeNull()
  })
})

describe('contaDoItem — quando NÃO há o que mostrar', () => {
  it('item sem produto no SisChef (nem o "painel", que não é produto de verdade)', () => {
    expect(contaDoItem(item({ produto_id: null }))).toBeNull()
    expect(contaDoItem(item({ associacao: 'painel' }))).toBeNull()
  })

  it('nada a multiplicar: a mesma quantidade e a mesma unidade', () => {
    expect(contaDoItem(item({ qtd: 48, unidade_sischef: 'PC' }))).toBeNull()
  })

  it('a mesma quantidade com outro NOME de unidade (10 PC → 10 UN) não é conta', () => {
    expect(contaDoItem(item({ qtd: 10, qtd_nota: 10 }))).toBeNull()
  })

  it('nota lida antes do robô novo (sem qtd_nota nem unidade_nota): a tela segue como sempre', () => {
    const antiga: ItemNotaSefaz = { n: 1, descricao: 'CÓD. FOR: 1001 PAO BRIOCHE PCT/15', qtd: 720, unidade_sischef: 'UN', produto_id: 9001, associacao: 'sischef' }
    expect(contaDoItem(antiga)).toBeNull()
  })

  it.each([[undefined], [null], [0], [-48], [Number.NaN], [Number.POSITIVE_INFINITY], ['48']])('quantidade da nota ilegível (%j)', (q) => {
    expect(contaDoItem(item({ qtd_nota: q as never }))).toBeNull()
  })

  it.each([[null], [0], [-720], [Number.NaN]])('quantidade convertida ilegível (%j)', (q) => {
    expect(contaDoItem(item({ qtd: q as never }))).toBeNull()
  })

  it.each([[undefined], [null], [''], ['   ']])('unidade da nota ilegível (%j)', (u) => {
    expect(contaDoItem(item({ unidade_nota: u as never }))).toBeNull()
  })

  it.each([[null], ['']])('unidade convertida ilegível (%j)', (u) => {
    expect(contaDoItem(item({ unidade_sischef: u }))).toBeNull()
  })
})
