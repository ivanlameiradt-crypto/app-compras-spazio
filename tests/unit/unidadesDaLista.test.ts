// As unidades que a lista de produtos do app aceita (src/lib/unidadesDaLista.ts). Desde 22/10/2026: KG, UN, CT (cento) e PCT (pacote).
import { UNIDADES_DA_LISTA, ehEmbalagemContada, ehUnidadeDaLista } from '../../src/lib/unidadesDaLista'

describe('unidadesDaLista — kg, un, ct e pct (o resto não entra na lista do app)', () => {
  it('a lista é exatamente kg, un, ct e pct, em minúscula (a mesma do check do banco e da confirmar-cupom)', () => {
    expect([...UNIDADES_DA_LISTA]).toEqual(['kg', 'un', 'ct', 'pct'])
  })

  it.each(['kg', 'KG', ' Un ', 'ct', 'CT', ' pct', 'PCT '])('ehUnidadeDaLista(%j) é verdadeiro (qualquer caixa, espaços nas pontas não importam)', (u) => {
    expect(ehUnidadeDaLista(u)).toBe(true)
  })

  it.each(['cx', 'CX', 'l', 'fd', 'ml', 'g', 'und', 'unidade', 'pç', '', '  ', null, undefined, 3, 'c t', 'ctt'])('ehUnidadeDaLista(%j) é falso', (u) => {
    expect(ehUnidadeDaLista(u)).toBe(false)
  })

  it('ehEmbalagemContada: só ct e pct (a embalagem com várias unidades dentro); kg, un e o resto não', () => {
    for (const u of ['ct', 'CT', ' pct ', 'PCT']) expect(ehEmbalagemContada(u), String(u)).toBe(true)
    for (const u of ['kg', 'un', 'cx', 'fd', 'ml', '', null, undefined, 0]) expect(ehEmbalagemContada(u), String(u)).toBe(false)
  })

  it('toda embalagem contada é unidade da lista (nunca uma que a lista recusa)', () => {
    for (const u of UNIDADES_DA_LISTA) if (ehEmbalagemContada(u)) expect(ehUnidadeDaLista(u)).toBe(true)
  })
})
