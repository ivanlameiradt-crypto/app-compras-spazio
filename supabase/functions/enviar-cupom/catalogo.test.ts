import { CATALOGO } from './catalogo'

describe('catálogo de insumos (403 curados)', () => {
  it('tem exatamente 403 itens', () => {
    expect(CATALOGO).toHaveLength(403)
  })
  it('cada item tem id e nome não vazios; ids únicos', () => {
    for (const i of CATALOGO) {
      expect(typeof i.id).toBe('string'); expect(i.id).toBeTruthy()
      expect(typeof i.nome).toBe('string'); expect(i.nome).toBeTruthy()
    }
    expect(new Set(CATALOGO.map((i) => i.id)).size).toBe(403)
  })
})
