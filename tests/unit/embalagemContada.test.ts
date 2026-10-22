// As contas do cupom de EMBALAGEM contada (src/admin/embalagemContada.ts): "ML" no cupom de saco é MILHEIRO (1.000 unidades), o produto no SisChef é em CT (cento, "C/ 100 UND")
// ou PCT (pacote). O app só SUGERE; quem decide o número é o Ivan. Caso real de 22/10/2026: cupom da A. N. da Silva Descartáveis.
import { ehMilheiro, sugestaoPorMilheiro, unidadesNaEmbalagem, unidadesNaEmbalagemDoProduto } from '../../src/admin/embalagemContada'
import type { ProdutoCatalogo } from '../../src/lib/tipos'

const produto = (over: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo => ({ produto_id: 3476481, nome: 'SACO 1/2 KG - C/ 100 UND', unidade: 'ct', ...over })

describe('ehMilheiro — ML do cupom de um produto em CT ou PCT', () => {
  it('ML (qualquer caixa e espaços) com produto ct ou pct é milheiro', () => {
    expect(ehMilheiro('ML', 'ct')).toBe(true)
    expect(ehMilheiro(' ml ', 'CT')).toBe(true)
    expect(ehMilheiro('Ml', 'pct')).toBe(true)
  })
  it('ML com produto em kg, un ou desconhecido NÃO é milheiro (continua mililitro, como sempre); e outra unidade do cupom também não', () => {
    for (const p of ['kg', 'un', 'cx', '', null, undefined]) expect(ehMilheiro('ML', p), String(p)).toBe(false)
    for (const c of ['UN', 'CT', 'PCT', 'KG', 'L', 'G', '', null, undefined]) expect(ehMilheiro(c, 'ct'), String(c)).toBe(false)
  })
})

describe('unidadesNaEmbalagem — o número que o NOME do produto diz ("C/ 100 UND", "PCT 50 UND")', () => {
  it.each([
    ['SACO 1/2 KG - C/ 100 UND', 100],
    ['SACO 2KG - C/ 100 UND', 100],
    ['SACOLA CHOPP (4CMX20CM) - PCT C/ 100 UND', 100],      // o saco de chope real do SisChef (3476489): as medidas "4CMX20CM" não contam
    ['GARFO PARA BATATA - PCT 50 UND', 50],
    ['COPO 300 ML C/50', 50],
    ['COPO 300 ML - C / 50 UND', 50],
    ['GUARDANAPO C/ 1000 UND', 1000],
    ['SACO 24X38 3KG - 100 UND', 100],
    ['SACO C/100 - 100 UND', 100],           // o mesmo número escrito duas vezes vale
    ['c/ 25 und', 25],
  ])('%s → %d', (nome, n) => {
    expect(unidadesNaEmbalagem(nome)).toBe(n)
  })

  it.each([
    ['SACO PARA CHOPP'],
    ['SACO 26X44 5KG'],                      // medidas e peso não são "unidades na embalagem"
    ['PAPEL TOALHA'],
    ['SACO C/ 100 - 50 UND'],                // dois números diferentes: não adivinha
    ['SACO C/ 1 UND'],                       // 1 não é embalagem
    ['SACO C/ 0 UND'],
    ['SACO C/ 2,5 UND'],                     // decimal não é contagem
    ['SACO 1.000 UND'],                      // milhar escrito com ponto: não confunde com 1 ou 000
    ['SACOS200UND'],                         // o número colado numa palavra não conta
    [''],
  ])('%j → null (não adivinha)', (nome) => {
    expect(unidadesNaEmbalagem(nome)).toBeNull()
  })

  it('texto vazio, null e undefined → null', () => {
    expect(unidadesNaEmbalagem(null)).toBeNull()
    expect(unidadesNaEmbalagem(undefined)).toBeNull()
  })
})

describe('unidadesNaEmbalagemDoProduto — o nome corrigido, o do SisChef ou a descrição da planilha (o primeiro que diz o número)', () => {
  it('o nome mostrado manda; se ele não diz, vale o do SisChef; depois a descrição da planilha', () => {
    expect(unidadesNaEmbalagemDoProduto(produto())).toBe(100)
    expect(unidadesNaEmbalagemDoProduto(produto({ nome: 'SACO PARA CHOPP', nome_sischef: 'SACO CHOPP C/ 100 UND' }))).toBe(100)
    expect(unidadesNaEmbalagemDoProduto(produto({ nome: 'SACO PARA CHOPP', descricao_sischef: 'SACO CHOPP - 50 UND' }))).toBe(50)
    expect(unidadesNaEmbalagemDoProduto(produto({ nome: 'SACO C/ 200 UND', nome_sischef: 'SACO C/ 100 UND' }))).toBe(200)
  })
  it('nenhum dos três diz → null', () => {
    expect(unidadesNaEmbalagemDoProduto(produto({ nome: 'SACO PARA CHOPP' }))).toBeNull()
  })
})

describe('sugestaoPorMilheiro — quantos CT/PCT vêm em 1 ML: 1.000 ÷ unidades da embalagem, só quando é número inteiro', () => {
  it('C/ 100 UND → 10 ct por ML; C/ 50 → 20; C/ 1000 → 1; C/ 250 → 4', () => {
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'SACO C/ 100 UND' }))).toBe(10)
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'GARFO PCT 50 UND', unidade: 'pct' }))).toBe(20)
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'GUARDANAPO C/ 1000 UND' }))).toBe(1)
    expect(sugestaoPorMilheiro('ml', produto({ nome: 'SACO C/ 250 UND' }))).toBe(4)
  })
  it('conta que não dá inteira (C/ 30, C/ 300) ou nome sem número → null: a caixa pergunta sem chutar', () => {
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'SACO C/ 30 UND' }))).toBeNull()
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'SACO C/ 300 UND' }))).toBeNull()
    expect(sugestaoPorMilheiro('ML', produto({ nome: 'SACO PARA CHOPP' }))).toBeNull()
  })
  it('só vale para ML com produto ct/pct: UN, CT, KG no cupom ou produto em kg/un → null', () => {
    for (const c of ['UN', 'CT', 'PCT', 'KG', '']) expect(sugestaoPorMilheiro(c, produto()), c).toBeNull()
    for (const u of ['kg', 'un', null]) expect(sugestaoPorMilheiro('ML', produto({ unidade: u })), String(u)).toBeNull()
  })
})
