import { avisoDePrecoDoItem, itensComPrecoForaDoNormal, precoPorUnidadeDoItem } from '../../src/admin/precoDaNota'
import type { AssociacaoApp, ItemNotaSefaz, NfeAprendizado, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

// Preço fora do normal na NOTA FISCAL (29/10/2026): o total da linha que o robô manda em `valor`, dividido pelo que entra no estoque (quantidade × a conversão que o Ivan decidiu ou que o robô lembra),
// contra as últimas compras do produto. Caso que motivou: a Coca Zero da Mateus (NF 90049), 20 × R$ 21,25 quando eram 120 × ~R$ 3,50. Tudo INVENTADO (repositório público).
const CNPJ = '12345678000190'
const COCA = 1836984
const GUIOZA = 3726403

const compras = (preco = 3.55, unidade = 'un') => [{ preco, data: '2026-10-21', unidade }]
const catalogo = (over: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo[] => [{ produto_id: COCA, nome: 'COCA COLA - ZERO 350 ML', unidade: 'un', compras: compras(), ...over }]
const item = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz => ({
  n: 1, descricao: 'CÓD. FOR: 100 REFRIG COCA ZERO LT 350ML', qtd: 20, unidade_sischef: 'UN', produto_id: COCA, produto_nome: 'COCA COLA - ZERO 350 ML', associacao: 'sischef', valor: 425, ...over,
})
const nota = (itens: ItemNotaSefaz[] = [item()], over: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '1'.repeat(44), cnpj_emitente: CNPJ, emitente: 'FORNECEDOR EXEMPLO', numero: '90049', emissao: '2026-10-28', valor_nf: 425, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  forma_pagamento: null, lancamento_estado: null, lancamento_motivo: null, itens, parcelas: [], associacoes_app: null, ...over,
})
const lembrada = (over: Partial<NfeAprendizado> = {}): NfeAprendizado => ({
  emitente_cnpj: CNPJ, cod_forn: '100', unidade_nota: 'UN', produto_id: COCA, produto_nome: 'COCA COLA - ZERO 350 ML', fator: 6, preco_ref: 21, descricao_exemplo: null, vezes: 2, ultima_chave: null,
  atualizado_em: '2026-10-28T20:15:00+00:00', ...over,
})
const decisao = (over: Partial<AssociacaoApp> = {}): AssociacaoApp => ({ produto_id: GUIOZA, produto_nome: 'GUIOZA CARNE BOVINA - INSUMO (KG)', unidade: 'kg', conversao: null, origem: 'lista', ...over })
const semProduto = (over: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  item({ descricao: 'CÓD. FOR: 200 GUIOZA CARNE BOVINA KG', unidade_sischef: 'KG', qtd: 10, valor: 745.8, produto_id: null, produto_nome: null, associacao: null, ...over })
const catalogoGuioza = (): ProdutoCatalogo[] => [{ produto_id: GUIOZA, nome: 'GUIOZA CARNE BOVINA - INSUMO (KG)', unidade: 'kg', compras: [{ preco: 17.9, data: '2026-10-10', unidade: 'kg' }] }]

describe('o caso da Coca Zero (NF 90049): a UN da nota era um fardo de 6', () => {
  it('sem conversão: R$ 425 ÷ 20 = R$ 21,25 por UN contra R$ 3,55 → fora do normal, quase 6 vezes', () => {
    const n = nota()
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [])).toMatchObject({ preco: 21.25, unidade: 'un', produto_id: COCA })
    const a = avisoDePrecoDoItem(n, n.itens[0], catalogo(), [])
    expect(a).toMatchObject({ sentido: 'alto', usual: 3.55 })
    expect(a!.vezes).toBeCloseTo(5.99, 1)
  })

  it('com a conversão que o Ivan informou (1 UN = 6): 120 UN a R$ 3,54 → o aviso some', () => {
    const n = nota([item()], { associacoes_app: { 1: decisao({ produto_id: COCA, unidade: 'un', conversao: 6, origem: 'sischef' }) } })
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [])).toMatchObject({ unidade: 'un' })
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [])!.preco).toBeCloseTo(3.5417, 3)
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
  })

  it('com a embalagem que o robô lembra (o Ivan não informou número e é o mesmo produto): conta com o fator dela e não avisa', () => {
    const n = nota()
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [lembrada()])!.preco).toBeCloseTo(3.5417, 3)
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [lembrada()])).toBeNull()
  })

  it('a embalagem lembrada é de OUTRO produto: o robô não a aplica, e a conta segue sem ela (avisa)', () => {
    const n = nota()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [lembrada({ produto_id: 999 })])).not.toBeNull()
  })

  it('a embalagem lembrada de outra unidade da nota não vale (a chave é CNPJ + CÓD. FOR + unidade)', () => {
    const n = nota()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [lembrada({ unidade_nota: 'CX' })])).not.toBeNull()
  })

  it('o número que o Ivan informou vence o que o robô lembra', () => {
    const n = nota([item()], { associacoes_app: { 1: decisao({ produto_id: COCA, unidade: 'un', conversao: 2, origem: 'sischef' }) } })
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [lembrada()])!.preco).toBeCloseTo(10.625, 3)   // 425 ÷ (20 × 2), não ÷ (20 × 6)
  })
})

describe('item sem produto no SisChef: vale a decisão completa do app', () => {
  it('produto escolhido no app, mesma unidade: R$ 745,80 ÷ 10 kg = R$ 74,58 contra R$ 17,90 → avisa (4 vezes)', () => {
    const n = nota([semProduto()], { associacoes_app: { 1: decisao() } })
    const a = avisoDePrecoDoItem(n, n.itens[0], catalogoGuioza(), [])
    expect(a).toMatchObject({ sentido: 'alto', usual: 17.9, unidade: 'kg' })
    expect(a!.vezes).toBeCloseTo(4.17, 1)
  })

  it('sem decisão (o Ivan ainda não escolheu o produto): sem aviso', () => {
    const n = nota([semProduto()])
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogoGuioza(), [])).toBeNull()
  })

  it('decisão incompleta (nota em UN, produto em KG, falta a conversão): sem aviso até ele informar', () => {
    const n = nota([semProduto({ unidade_sischef: 'UN' })], { associacoes_app: { 1: decisao() } })
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogoGuioza(), [])).toBeNull()
  })

  it('decisão com a conversão (nota em UN, 1 UN = 0,5 kg): o preço por KG é o da nota ÷ (UN × 0,5)', () => {
    const n = nota([semProduto({ unidade_sischef: 'UN', qtd: 20, valor: 745.8 })], { associacoes_app: { 1: decisao({ conversao: 0.5 }) } })
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogoGuioza(), [])!.preco).toBeCloseTo(74.58, 2)
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogoGuioza(), [])).not.toBeNull()
  })

  it('a embalagem lembrada NÃO entra na conta de item sem produto (ali quem converte é a decisão do app)', () => {
    const n = nota([semProduto({ unidade_sischef: 'KG' })], { associacoes_app: { 1: decisao() } })
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogoGuioza(), [lembrada({ produto_id: GUIOZA, cod_forn: '200', unidade_nota: 'KG', fator: 3 })])!.preco).toBeCloseTo(74.58, 2)
  })

  it('o nome diz SIX PACK e a conversão ainda não foi informada: a decisão está incompleta (o Lançar já está travado por isso), então nada de aviso de preço', () => {
    const seisPack = semProduto({ descricao: 'CÓD. FOR: 420713 REFRIG COCA COLA ZERO LT SIX PACK 350ML', unidade_sischef: 'UN', qtd: 20, valor: 425 })
    const n = nota([seisPack], { associacoes_app: { 1: decisao({ produto_id: COCA, produto_nome: 'COCA COLA - ZERO 350 ML', unidade: 'un', conversao: null }) } })
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
  })

  it('SIX PACK com a conversão 6 (120 UN a R$ 3,54): normal; com a conversão 1 ("o produto já é o fardo inteiro"), R$ 21,25 por UN: avisa', () => {
    const seisPack = semProduto({ descricao: 'CÓD. FOR: 420713 REFRIG COCA COLA ZERO LT SIX PACK 350ML', unidade_sischef: 'UN', qtd: 20, valor: 425 })
    const com = (conversao: number) => nota([seisPack], { associacoes_app: { 1: decisao({ produto_id: COCA, produto_nome: 'COCA COLA - ZERO 350 ML', unidade: 'un', conversao }) } })
    const seis = com(6)
    expect(avisoDePrecoDoItem(seis, seis.itens[0], catalogo(), [])).toBeNull()
    const um = com(1)
    expect(avisoDePrecoDoItem(um, um.itens[0], catalogo(), [])).toMatchObject({ sentido: 'alto', usual: 3.55 })
  })

  it('produto novo, fora da lista do app, com conversão e sem unidade na decisão: sem como saber a unidade, sem aviso', () => {
    const n = nota([semProduto({ unidade_sischef: 'UN' })], { associacoes_app: { 1: decisao({ unidade: null, conversao: 0.5 }) } })
    expect(avisoDePrecoDoItem(n, n.itens[0], [], [])).toBeNull()
  })
})

describe('na dúvida, sem aviso', () => {
  it('sem o total da linha (nota lida antes do robô novo): nada', () => {
    for (const valor of [undefined, null, 0, -5, NaN] as (number | null | undefined)[]) {
      const n = nota([item({ valor })])
      expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
    }
  })

  it('sem a quantidade: nada', () => {
    const n = nota([item({ qtd: null })])
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
  })

  it('dado estranho NUNCA derruba a tela: uma linha nula na memória (ou uma lista de produtos com lixo) vira "sem aviso", não um erro', () => {
    const n = nota()
    expect(() => avisoDePrecoDoItem(n, n.itens[0], catalogo(), [null as unknown as NfeAprendizado])).not.toThrow()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [null as unknown as NfeAprendizado])).toBeNull()
    expect(() => itensComPrecoForaDoNormal(n, [null as unknown as ProdutoCatalogo], [])).not.toThrow()
    expect(itensComPrecoForaDoNormal(n, [null as unknown as ProdutoCatalogo], [])).toEqual([])
  })

  it('a quantidade está em CX e o estoque em UN, sem conversão: a conta não faz sentido, nada', () => {
    const n = nota([item({ unidade_sischef: 'CX', qtd: 5, valor: 425 })])
    expect(precoPorUnidadeDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
  })

  it('o robô parou pedindo a conversão (UN DIFERE) e ninguém informou: nada; informada, volta a contar', () => {
    const parada = { lancamento_estado: 'revisar' as const, lancamento_motivo: 'UN DIFERE sem conversão na tela: CÓD. FOR 100 (no app, toque em Editar)' }
    const sem = nota([item()], parada)
    expect(precoPorUnidadeDoItem(sem, sem.itens[0], catalogo(), [])).toBeNull()
    const com = nota([item()], { ...parada, associacoes_app: { 1: decisao({ produto_id: COCA, unidade: 'un', conversao: 6, origem: 'sischef' }) } })
    expect(precoPorUnidadeDoItem(com, com.itens[0], catalogo(), [])!.preco).toBeCloseTo(3.5417, 3)
  })

  it('item de bonificação (CFOP 5910/6910): o valor da linha é nominal, nada', () => {
    for (const cfop of ['5910', '6910', ' 5910 ']) {
      const n = nota([item({ cfop })])
      expect(avisoDePrecoDoItem(n, n.itens[0], catalogo(), [])).toBeNull()
    }
    const venda = nota([item({ cfop: '5102' })])
    expect(avisoDePrecoDoItem(venda, venda.itens[0], catalogo(), [])).not.toBeNull()
  })

  it('o produto não tem compras na lista (produto novo) ou a lista ainda carrega: nada', () => {
    const n = nota()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo({ compras: undefined }), [])).toBeNull()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo({ compras: [] }), [])).toBeNull()
    expect(avisoDePrecoDoItem(n, n.itens[0], null, [])).toBeNull()
    expect(avisoDePrecoDoItem(n, n.itens[0], [], [])).toBeNull()
  })

  it('as compras da lista estão em outra unidade que a do estoque: nada', () => {
    const n = nota()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo({ compras: compras(3.55, 'kg') }), [])).toBeNull()
  })

  it('a unidade da planilha (a do SisChef) manda sobre a da nota: produto em CT, quantidade em UN sem conversão → nada', () => {
    const n = nota()
    expect(avisoDePrecoDoItem(n, n.itens[0], catalogo({ unidade: 'ct', compras: compras(3.55, 'ct') }), [])).toBeNull()
  })
})

describe('itensComPrecoForaDoNormal', () => {
  it('só os itens com aviso, na ordem da nota, com o número do item e o aviso', () => {
    const itens = [
      item({ n: 1, valor: 425 }),                                              // 21,25 por UN: avisa
      item({ n: 2, valor: 71, descricao: 'CÓD. FOR: 101 OUTRA COCA' }),         // 3,55 por UN: normal
      item({ n: 3, valor: 600, descricao: 'CÓD. FOR: 102 MAIS UMA COCA' }),     // 30 por UN: avisa
    ]
    const n = nota(itens)
    const r = itensComPrecoForaDoNormal(n, catalogo(), [])
    expect(r.map((x) => x.indice)).toEqual([0, 2])
    expect(r.map((x) => x.item.n)).toEqual([1, 3])
    expect(r.every((x) => x.aviso.sentido === 'alto')).toBe(true)
  })

  it('nota sem itens ou itens que não é lista: lista vazia, sem erro', () => {
    expect(itensComPrecoForaDoNormal(nota([]), catalogo(), [])).toEqual([])
    expect(itensComPrecoForaDoNormal(nota(null as unknown as ItemNotaSefaz[]), catalogo(), [])).toEqual([])
  })
})
