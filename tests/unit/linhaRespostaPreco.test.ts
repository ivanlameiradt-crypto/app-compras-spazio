import { entradaDe, motivoNumeroInvalido, type LinhaTela } from '../../src/admin/cotacoes/linhaResposta'
import { lerColagem } from '../../src/cotacao/leitorTexto'
import { itemCotacao } from '../fabricas'

// Ajuste de 16/11/2026 (análise do app): o preço digitado na resposta do vendedor usava o leitor geral, que lê "2.500" (ponto sem vírgula) como
// MIL E QUINHENTOS. O vendedor que escreve "2.500" pode querer dizer R$ 2,50. Preço unitário com ponto de milhar sem vírgula é ambíguo:
// vira "número inválido" (a tela pede a vírgula), como já é na compra avulsa (lib/dinheiro.lerPrecoUnitario).
const linha = (p: Partial<LinhaTela>): LinhaTela => ({
  estado: 'tem', preco: '', base: 'un', emb: '', tenhoSo: '', similarDesc: '', similarPreco: '', aPartirDe: '', marca: '', ...p,
})

describe('Digitar preços: o preço unitário não aceita o ponto ambíguo', () => {
  it('"2.500" no preço não vira 2500: vira número inválido (NaN) para a tela pedir a vírgula', () => {
    const e = entradaDe(linha({ preco: '2.500' }), 'un') as { preco: number | null }
    expect(Number.isNaN(e.preco)).toBe(true)
  })

  it('o que é claro continua valendo: "2,50", "2.50", "R$ 2.500,00", "1.250,00"', () => {
    const preco = (t: string) => (entradaDe(linha({ preco: t }), 'un') as { preco: number | null }).preco
    expect(preco('2,50')).toBe(2.5)
    expect(preco('2.50')).toBe(2.5)
    expect(preco('R$ 2.500,00')).toBe(2500)
    expect(preco('1.250,00')).toBe(1250)
    expect(preco('')).toBeNull()
  })

  it('o preço de um similar e o "a partir de" seguem a mesma regra', () => {
    const e = entradaDe(linha({ estado: 'tem', preco: '3,00', similarPreco: '1.516', aPartirDe: '4.200' }), 'un') as { similar_preco: number | null; a_partir_de: number | null }
    expect(Number.isNaN(e.similar_preco)).toBe(true)
    expect(Number.isNaN(e.a_partir_de)).toBe(true)
  })

  it('quantidade não muda: "tenho só 2.500" continua sendo 2500', () => {
    const e = entradaDe(linha({ preco: '3,00', tenhoSo: '2.500' }), 'un') as { tenho_so: number | null }
    expect(e.tenho_so).toBe(2500)
  })
})

describe('Colar resposta: preço escrito pelo vendedor com ponto ambíguo não é lido em silêncio', () => {
  const ITENS = [itemCotacao({ id: 101, numero: 1, produto_id: 11, nome: 'MOSTARDA', unidade: 'kg', rotulo: 'kg', qtd: 1.2, rev: 0 })]

  it('"1 - 2.500" fica como linha não entendida, em vez de virar R$ 2.500,00', () => {
    const r = lerColagem('1 - 2.500', ITENS)
    expect(r.reconhecidos).toEqual([])
    expect(r.naoEntendidas.length).toBe(1)
  })

  it('"1 - R$ 2.500,00" continua sendo lido', () => {
    const r = lerColagem('1 - R$ 2.500,00', ITENS)
    expect(r.reconhecidos.length).toBe(1)
  })
})

describe('Digitar preços: a mensagem diz o que fazer quando o preço é ambíguo', () => {
  it('ponto sem vírgula no preço: pede a vírgula nos centavos', () => {
    expect(motivoNumeroInvalido(linha({ preco: '2.500' }))).toMatch(/vírgula/)
    expect(motivoNumeroInvalido(linha({ preco: '3,00', similarPreco: '1.516' }))).toMatch(/vírgula/)
  })

  it('outro defeito (letras): segue "número inválido"', () => {
    expect(motivoNumeroInvalido(linha({ preco: 'abc' }))).toBe('número inválido')
  })
})
