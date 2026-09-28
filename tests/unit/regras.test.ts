import {
  totalEstimado, quantidadeComprada, situacaoDoItem, variacaoPreco, resumirSemana, separarAbas,
  lerNumero, formatarReais, formatarQtd, formatarData, normalizar, nomeCurto, mensagemDeErro,
  paraConferir, qtdAoIncluir, formatarDataHora,
} from '../../src/lib/regras'
import { item, linha } from '../fabricas'

const sp = (s: string) => s.replace(/\s/g, ' ')

describe('regras', () => {
  const coca = item({ id: 1, produto: 'COCA COLA 350 ML', qtd_aprovada: 52, preco_estimado: 2.79 })
  const must = item({ id: 2, produto: 'MOSTARDA - INSUMO (KG)', bebida: false, unidade: 'kg', qtd_aprovada: 1.2, preco_estimado: 18.5 })
  const fora = item({ id: 3, qtd_aprovada: 10, preco_estimado: 5, incluido: false })
  const neg = item({ id: 4, bebida: false, negativo: true, incluido: false })

  it('total estimado só soma incluídos', () => {
    expect(totalEstimado([coca, must, fora])).toBeCloseTo(52 * 2.79 + 1.2 * 18.5)
  })

  it('soma compras de várias pessoas', () => {
    const ls = [linha({ item_semana_id: 1, qtd: 30 }), linha({ item_semana_id: 1, qtd: 22, compra_id: 'c2' })]
    expect(quantidadeComprada(1, ls)).toBe(52)
    expect(situacaoDoItem(coca, ls)).toBe('completo')
    expect(situacaoDoItem(coca, ls.slice(0, 1))).toBe('parcial')
    expect(situacaoDoItem(coca, [])).toBe('pendente')
    expect(situacaoDoItem(coca, [linha({ item_semana_id: 1, resultado: 'nao_achei' })])).toBe('nao_achei')
  })

  it('variação de preço', () => {
    expect(variacaoPreco(21.9, 18.5)).toBeCloseTo(0.1838, 3)
    expect(variacaoPreco(null, 18.5)).toBeNull()
    expect(variacaoPreco(5, null)).toBeNull()
    expect(variacaoPreco(5, 0)).toBeNull()
  })

  it('resumo da semana com alerta acima de 10%', () => {
    const ls = [
      linha({ item_semana_id: 1, qtd: 52, preco_unit: 2.79 }),
      linha({ item_semana_id: 2, qtd: 1, preco_unit: 21.9, resultado: 'parcial' }),
    ]
    const r = resumirSemana([coca, must, fora], ls)
    expect(r.pedidos).toBe(2)
    expect(r.completos).toBe(1)
    expect(r.parciais).toBe(1)
    expect(r.naoAchados).toBe(0)
    expect(r.pendentes).toBe(0)
    expect(r.pago).toBeCloseTo(52 * 2.79 + 21.9)
    expect(r.alertas).toHaveLength(1)
    expect(r.alertas[0].item.id).toBe(2)
  })

  it('preço exatamente 10% acima não alerta', () => {
    const r = resumirSemana([must], [linha({ item_semana_id: 2, qtd: 1, preco_unit: 20.35 })])
    expect(r.alertas).toHaveLength(0)
  })

  it('separa abas: bebidas, insumos e negativos, em ordem alfabética', () => {
    const b2 = item({ id: 5, produto: 'AGUA 500ML' })
    const a = separarAbas([coca, must, neg, b2])
    expect(a.bebidas.map((i) => i.id)).toEqual([5, 1])
    expect(a.insumos.map((i) => i.id)).toEqual([2])
    expect(a.negativos.map((i) => i.id)).toEqual([4])
  })

  it('lê números com vírgula (padrão brasileiro)', () => {
    expect(lerNumero('1,2')).toBe(1.2)
    expect(lerNumero('21,90')).toBe(21.9)
    expect(lerNumero('R$ 1.234,50')).toBe(1234.5)
    expect(lerNumero('52')).toBe(52)
    expect(lerNumero('2.79')).toBe(2.79)
    expect(lerNumero('')).toBeNull()
    expect(lerNumero('abc')).toBeNull()
    expect(lerNumero('-3')).toBeNull()
  })

  it('"1.250" sem vírgula é milhar (1250), não decimal (M1)', () => {
    expect(lerNumero('1.250')).toBe(1250)
    expect(lerNumero('12.500')).toBe(12500)
    expect(lerNumero('R$ 1.250')).toBe(1250)
    expect(lerNumero('2.79')).toBe(2.79) // só 2 casas: continua decimal
    expect(lerNumero('1.5')).toBe(1.5)
    expect(lerNumero('1.250,00')).toBe(1250) // com vírgula, regra de milhar de sempre
  })

  it('"0.500" é decimal (0,5): um grupo que começa com zero nunca é milhar (M-i)', () => {
    expect(lerNumero('0.500')).toBe(0.5)
    expect(lerNumero('0.250')).toBe(0.25)
    expect(lerNumero('1.000.000')).toBe(1000000)
  })

  it('formata no padrão brasileiro', () => {
    expect(sp(formatarReais(7202.08))).toBe('R$ 7.202,08')
    expect(formatarQtd(1.2, 'kg')).toBe('1,2 kg')
    expect(formatarQtd(52, 'un')).toBe('52 un')
    expect(formatarData('2026-09-22')).toBe('22/09')
  })

  it('utilidades', () => {
    expect(normalizar('Guaraná AÇÚCAR')).toBe('guarana acucar')
    expect(nomeCurto('joao.silva@gmail.com')).toBe('joao.silva')
    expect(mensagemDeErro(new Error('x'))).toBe('x')
    expect(mensagemDeErro('y')).toBe('y')
  })
})

describe('regras da Fase 1A (selos e incluir fora da lista)', () => {
  const selo = { codigo: 'linha_alta' as const, texto: '≈ R$ 1.100,00 nesta linha (acima de R$ 1.000)' }

  it('aba Conferir: só itens com selo e fora da lista, em ordem alfabética', () => {
    const b = item({ id: 1, produto: 'B', incluido: false, selos: [selo] })
    const a = item({ id: 2, produto: 'A', incluido: false, selos: [selo] })
    const incluido = item({ id: 3, produto: 'C', incluido: true, selos: [selo] })
    const semSelo = item({ id: 4, produto: 'D', incluido: false })
    expect(paraConferir([b, a, incluido, semSelo]).map((i) => i.id)).toEqual([2, 1])
  })

  it('quantidade ao incluir: negativo = max(estoque mínimo, passo); demais = sugerido ou um passo', () => {
    const neg = { bebida: false, negativo: true, incluido: false, qtd_sugerida: 4321 }
    expect(qtdAoIncluir(item({ ...neg, unidade: 'un', estoque_minimo: 300 }))).toBe(300)
    expect(qtdAoIncluir(item({ ...neg, unidade: 'kg', estoque_minimo: 0 }))).toBe(0.5)
    expect(qtdAoIncluir(item({ ...neg, unidade: 'kg', estoque_minimo: 0.2 }))).toBe(0.5)
    expect(qtdAoIncluir(item({ ...neg, unidade: 'kg', estoque_minimo: 2.5 }))).toBe(2.5)
    expect(qtdAoIncluir(item({ incluido: false, unidade: 'kg', qtd_sugerida: 40, selos: [selo] }))).toBe(40)
    expect(qtdAoIncluir(item({ incluido: false, unidade: 'un', qtd_sugerida: 0, estoque_minimo: 71 }))).toBe(1)
    expect(qtdAoIncluir(item({ incluido: false, unidade: 'kg', qtd_sugerida: 0 }))).toBe(0.5)
  })

  it('data e hora no horário de Brasília', () => {
    expect(formatarDataHora('2026-09-23T13:05:00Z')).toBe('23/09 às 10h05')
    expect(formatarDataHora('2026-09-24T02:30:00Z')).toBe('23/09 às 23h30') // ainda é dia 23 em Brasília
    expect(formatarDataHora('2026-09-23T03:00:00Z')).toBe('23/09 às 00h00')
  })
})
