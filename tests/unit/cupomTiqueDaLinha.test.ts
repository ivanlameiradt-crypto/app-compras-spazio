import { conferenciaDaLinha, leituraFechaComOTotal, valorLidoDaLinha } from '../../src/admin/cupomCorrigirRegras'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// Pedido do Ivan (05/11/2026, cupom da A. N. da Silva): "se esse valor bater com o que está no cupom fiscal, eu queria um tique verde ao lado do que entra no estoque".
// O app NÃO guarda o valor impresso em cada linha do cupom (só a quantidade, o preço de 1 unidade e o desconto lidos da foto, mais o total do cupom). A régua é o TOTAL:
// quando a leitura do cupom INTEIRO (quantidade lida × preço lido − desconto, linha a linha) fecha o total impresso, cada linha lida merece confiança, e o tique diz que o
// valor que o Ivan confirmou para esta linha é o mesmo que o robô leu. Se a leitura não fecha o total, ela não serve de régua e o tique não aparece.

/** Item ainda sem produto (como o envio o grava): preço do cupom, quantidade lida na foto. */
const pendente = (descricao_cupom: string, unidade_cupom: string, valor_unitario: number, quantidade_cupom: number | null, desconto_item = 0): ItemCupomRecente => ({
  descricao_cupom, unidade_cupom, valor_unitario, desconto_item, entrada_estoque: null, sugestao_produto: null, casado_por: null, quantidade_cupom, proposta: null,
})
/** Item que o servidor já casou: `entrada_estoque` na unidade do produto e `valor_unitario` por essa unidade (a linha vale entrada × preço − desconto). */
const casado = (descricao_cupom: string, valor_unitario: number, entrada_estoque: number, quantidade_cupom: number, desconto_item = 0): ItemCupomRecente => ({
  descricao_cupom, unidade_cupom: 'UN', valor_unitario, desconto_item, entrada_estoque, sugestao_produto: { id: '3836906' }, casado_por: 'descricao', quantidade_cupom, proposta: null,
})

const SACO = pendente('SACO 19X37 2KG AD FONTEPLAST', 'ML', 42.8, 3)           // 3 ML × 42,80 = 128,40
const FITA = pendente('FITA PP TRANSP 18X50 FITAR', 'UN', 1.85, 14)             // 14 × 1,85 = 25,90
const CANUDO = casado('CANUDO BIO MASTER ENVEL. SACHE ULTRA 100UND', 7.8, 1, 1)  // 7,80
const cupom = (itens: ItemCupomRecente[], valor_a_pagar: number | null): CupomRecente => ({
  id: 'c1', estado: 'REVISAR', emitente_nome: 'A. N. DA SILVA DESCARTAVEIS LTDA', emitente_cnpj: '63540861000182', valor_a_pagar, pedido_sischef: null,
  criado_em: '2026-11-04T17:09:00Z', motivo: '2 item(ns) sem casamento confirmado — confira no Code', teste: false, itens,
})
const FECHA = cupom([SACO, FITA, CANUDO], 162.1)   // 128,40 + 25,90 + 7,80 = 162,10

describe('valorLidoDaLinha (o valor da linha como o robô o leu na foto)', () => {
  it('item sem produto: quantidade lida × preço lido − desconto, a 2 casas', () => {
    expect(valorLidoDaLinha(SACO)).toBe(128.4)
    expect(valorLidoDaLinha(FITA)).toBe(25.9)
    expect(valorLidoDaLinha(pendente('LIMAO TAITI', 'KG', 9.9, 2.884, 5.51))).toBe(23.04)   // 28,5516 − 5,51
  })
  it('item que o servidor já casou: entrada no estoque × preço por unidade do estoque − desconto (o mesmo valor da linha, já convertido)', () => {
    expect(valorLidoDaLinha(CANUDO)).toBe(7.8)
    expect(valorLidoDaLinha(casado('TAITI', 9.9, 2.884, 2.884, 5.51))).toBe(23.04)
  })
  it('sem a quantidade lida (envio antigo) ou sem o preço: não há valor a dizer', () => {
    expect(valorLidoDaLinha({ ...SACO, quantidade_cupom: null })).toBeNull()
    expect(valorLidoDaLinha({ ...SACO, quantidade_cupom: undefined })).toBeNull()
    expect(valorLidoDaLinha({ ...SACO, quantidade_cupom: 0 })).toBeNull()
    expect(valorLidoDaLinha({ ...SACO, valor_unitario: null })).toBeNull()
    expect(valorLidoDaLinha({ ...CANUDO, entrada_estoque: null })).toBeNull()
  })
})

describe('leituraFechaComOTotal (a leitura do cupom inteiro é boa régua?)', () => {
  it('a soma das linhas lidas é o total impresso: true', () => {
    expect(leituraFechaComOTotal(FECHA)).toBe(true)
  })
  it('a mesma tolerância do robô: até 2 centavos de diferença fecha; 3 centavos não', () => {
    expect(leituraFechaComOTotal(cupom([SACO, FITA, CANUDO], 162.12))).toBe(true)
    expect(leituraFechaComOTotal(cupom([SACO, FITA, CANUDO], 162.08))).toBe(true)
    expect(leituraFechaComOTotal(cupom([SACO, FITA, CANUDO], 162.13))).toBe(false)
  })
  it('uma linha lida errada (3 ML virou 30 ML) faz a soma passar do total: false', () => {
    expect(leituraFechaComOTotal(cupom([{ ...SACO, quantidade_cupom: 30 }, FITA, CANUDO], 162.1))).toBe(false)
  })
  it('sem total lido (nulo ou zero): não dá para saber (null)', () => {
    expect(leituraFechaComOTotal(cupom([SACO, FITA, CANUDO], null))).toBeNull()
    expect(leituraFechaComOTotal(cupom([SACO, FITA, CANUDO], 0))).toBeNull()
  })
  it('basta UM item sem a quantidade lida (envio antigo) para não dar para saber (null): a leitura incompleta não vale como régua', () => {
    expect(leituraFechaComOTotal(cupom([SACO, { ...FITA, quantidade_cupom: null }, CANUDO], 162.1))).toBeNull()
  })
  it('itens que não vêm como lista, ou lista vazia: null (a tela não pode quebrar)', () => {
    expect(leituraFechaComOTotal(cupom(null as unknown as ItemCupomRecente[], 10))).toBeNull()
    expect(leituraFechaComOTotal(cupom([], 10))).toBeNull()
  })
})

describe('conferenciaDaLinha (o tique ao lado de "entra N no estoque")', () => {
  it('o valor que o Ivan confirmou é o que o robô leu e a leitura fecha o total: confere (com o total, para a frase explicar)', () => {
    expect(conferenciaDaLinha(FECHA, SACO, 128.4)).toEqual({ tipo: 'confere', valor: 128.4, total: 162.1 })
  })
  it('a conversão não muda o valor: 3 ML que entram como 30 un valem os mesmos R$ 128,40 (é isso que o tique confere, não o 30)', () => {
    // a tela passa o valor da linha DEPOIS da conversão (linhaConfirmada): quantidade × preço ÷ entrada × entrada = o mesmo valor
    expect(conferenciaDaLinha(FECHA, SACO, 128.4)?.tipo).toBe('confere')
  })
  it('o Ivan digitou outra quantidade (30 em vez de 3): o valor da linha passa a R$ 1.284,00, diferente do que o robô leu: diferente (com os dois valores)', () => {
    expect(conferenciaDaLinha(FECHA, SACO, 1284)).toEqual({ tipo: 'diferente', lido: 128.4, valor: 1284 })
  })
  it('um centavo de diferença já é diferente (o tique é igualdade no centavo; a tolerância de 2 centavos é só do total do cupom)', () => {
    expect(conferenciaDaLinha(FECHA, SACO, 128.41)).toEqual({ tipo: 'diferente', lido: 128.4, valor: 128.41 })
    expect(conferenciaDaLinha(FECHA, SACO, 128.4000001)?.tipo).toBe('confere')   // ruído de ponto flutuante não conta
  })
  it('a leitura do cupom NÃO fecha o total: sem tique e sem "diferente" (ela não serve de régua)', () => {
    expect(conferenciaDaLinha(cupom([SACO, FITA, CANUDO], 170), SACO, 128.4)).toBeNull()
    expect(conferenciaDaLinha(cupom([SACO, FITA, CANUDO], 170), SACO, 1284)).toBeNull()
  })
  it('sem total lido, ou item sem a quantidade lida (envio antigo): nada a dizer', () => {
    expect(conferenciaDaLinha(cupom([SACO, FITA, CANUDO], null), SACO, 128.4)).toBeNull()
    const antigo = { ...SACO, quantidade_cupom: null }
    expect(conferenciaDaLinha(cupom([antigo, FITA, CANUDO], 162.1), antigo, 128.4)).toBeNull()
  })
  it('desconto do item entra na conta dos dois lados: 2,884 kg × 9,90 − 5,51 = 23,04', () => {
    const taiti = pendente('LIMAO TAITI', 'KG', 9.9, 2.884, 5.51)
    const c = cupom([taiti, CANUDO], 30.84)   // 23,04 + 7,80
    expect(conferenciaDaLinha(c, taiti, 23.04)).toEqual({ tipo: 'confere', valor: 23.04, total: 30.84 })
    expect(conferenciaDaLinha(c, taiti, 28.55)).toEqual({ tipo: 'diferente', lido: 23.04, valor: 28.55 })   // esqueceu o desconto
  })
})
