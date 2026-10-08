import { entradaEmKg as clienteEntrada, kgPorUnidadeAbsurdo, pesoNaDescricao } from '../../src/admin/regraQuilos'
import { entradaEmKg as servidorEntrada, pesoNaDescricao as servidorPeso } from '../../supabase/functions/enviar-cupom/regraQuilos'

/** Casos REAIS dos cupons do Líder, Mateus e Atacadão (08/10/2026): descrição, unidade do cupom, quantidade → o que entra em kg (null = o Ivan decide). */
const CASOS: [string, string, number, number | null, 1 | 2 | null][] = [
  ['IOG CANTO MINAS NATURAL 850g', 'GF', 10, 8.5, 1],            // Regra 1: o erro do iogurte (entrou 8500)
  ['BROCOLIS MAPE BAND 250G', 'BJ', 1, 0.25, 1],                  // Regra 1: bandeja de 250 g
  ['BROCOLIS NINJA KG +++', 'KG', 0.462, 0.462, 2],               // Regra 2
  ['PIMENTAO KG', 'KG', 1.29, 1.29, 2],
  ['FILE MIGON C CORDAO KG ATCD', 'KG', 11.91, 11.91, 2],
  ['LIMAO TAITI TROPICAL', 'KG', 2.884, 2.884, 2],
  ['ABACATE', 'G', 500, 0.5, 2],                                  // Regra 2 em gramas
  ['MOLHO QJO CHEDDAR 1X1,5Kg', 'UN', 1, 1.5, 1],                 // "1X" = uma embalagem de 1,5 kg
  ['REQ.CHEDDAR CATUPIRY 1X1,010K', 'UN', 1, 1.01, 1],            // "K" = kg
  ['MANJERICAO REGIONAL', 'MC', 3, null, null],                   // maço, sem peso no nome: o Ivan decide
  ['ALFACE CRESPA HID.', 'UND', 8, null, null],                   // unidade, sem peso no nome: o Ivan decide
  ['ALFACE CRESPA HID. 1X1UND', 'UN', 3, null, null],
  ['REF.COCA-COLA PET 1X2L', 'UND', 18, null, null],              // litros: não é peso
  ['REF.SCHWEPPES T.LATA 6X350ML', 'PCT', 1, null, null],         // várias embalagens e ml
  ['LEITE COND 12X395G', 'CX', 2, null, null],                    // várias embalagens: pergunta
  ['IOG 850g E 500g', 'UN', 2, null, null],                       // dois pesos: pergunta
]

describe('regra do Ivan: quanto entra em kg (peso no nome × unidades, ou a quantidade do cupom)', () => {
  it.each(CASOS)('%s (%s, %s) → %s', (desc, un, qtd, kg, regra) => {
    for (const f of [clienteEntrada, servidorEntrada]) {
      const r = f(desc, un, qtd)
      expect(r?.kg ?? null).toBe(kg)
      expect(r?.regra ?? null).toBe(regra)
    }
  })
  it('as cópias (app e servidor) leem o mesmo peso no nome', () => {
    for (const d of ['IOG 850g', '1X1,5Kg', '12X395G', '250G', 'SEM PESO', 'SACO 25KG', 'BARRA 60KG']) expect(servidorPeso(d)).toBe(pesoNaDescricao(d))
  })
  it('peso fora de 1 g a 50 kg não conta', () => { expect(pesoNaDescricao('BARRA 60KG')).toBeNull(); expect(pesoNaDescricao('SACO 25KG')).toBe(25) })
  it('quantidade zero, negativa ou inválida: nada', () => { expect(clienteEntrada('IOG 850g', 'UN', 0)).toBeNull(); expect(clienteEntrada('IOG 850g', 'UN', NaN)).toBeNull() })
  it('trava: mais de 50 kg por unidade é absurdo', () => {
    expect(kgPorUnidadeAbsurdo(8500, 10)).toBe(true)   // 850 kg por pote (o erro de 07/10)
    expect(kgPorUnidadeAbsurdo(8.5, 10)).toBe(false)
    expect(kgPorUnidadeAbsurdo(50, 1)).toBe(false)
  })
})
