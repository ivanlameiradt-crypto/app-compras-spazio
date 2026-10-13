import { GRUPOS_DE_INSUMO, UNIDADES, nomeNoSischef, palavrasSugeridas, problemaDoProduto, sugerirUnidade } from '../../src/admin/produtoRegras'

describe('nomeNoSischef', () => {
  it('maiúsculas, sem o "CÓD. FOR", espaços colapsados e terminado em " - INSUMOS" (o padrão do Ivan)', () => {
    expect(nomeNoSischef('CÓD. FOR: 2350LG  Maionese   Hellmanns 3kg')).toBe('MAIONESE HELLMANNS 3KG - INSUMOS')
    expect(nomeNoSischef('  tomate cereja ')).toBe('TOMATE CEREJA - INSUMOS')
  })
  it('não repete o sufixo e devolve vazio para texto vazio', () => {
    expect(nomeNoSischef('AÇÚCAR CRISTAL - INSUMOS (KG)')).toBe('AÇÚCAR CRISTAL - INSUMOS (KG)')
    expect(nomeNoSischef('ABACATE - INSUMOS')).toBe('ABACATE - INSUMOS')
    expect(nomeNoSischef('   ')).toBe('')
    expect(nomeNoSischef(null)).toBe('')
  })
})

describe('sugerirUnidade', () => {
  it('peso na embalagem ou "(KG)" → KG; litro → L; bebida em ML e o resto → UN', () => {
    expect(sugerirUnidade('MAION.HELLMANNS 1X3Kg')).toBe('KG')
    expect(sugerirUnidade('REPOLHO BCO (KG)')).toBe('KG')
    expect(sugerirUnidade('ÓLEO DE SOJA 900 ML')).toBe('UN')
    expect(sugerirUnidade('SUCO INTEGRAL 1,5 L')).toBe('L')
    expect(sugerirUnidade('AGUA M.CRYSTAL C/GAS 1X500ML')).toBe('UN')
    expect(sugerirUnidade('FERM.FERMIPAN 1X500G')).toBe('UN')
    expect(sugerirUnidade('')).toBe('UN')
  })
})

describe('palavrasSugeridas', () => {
  it('as palavras do nome, sem medidas soltas e sem o sufixo', () => {
    expect(palavrasSugeridas('MAION.HELLMANNS 1X3Kg')).toBe('maion hellmanns')
    expect(palavrasSugeridas('CÓD. FOR: 77 CREAM CHEESE CATUPIR 1X1,2Kg')).toBe('cream cheese catupir')
  })
})

describe('problemaDoProduto', () => {
  const ok = { nome: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: '' }
  it('só libera com nome, grupo da lista do SisChef e unidade; grupo e unidade nunca são assumidos', () => {
    expect(problemaDoProduto(ok)).toBeNull()
    expect(problemaDoProduto({ ...ok, nome: '  ' })).toMatch(/nome/)
    expect(problemaDoProduto({ ...ok, grupo: '' })).toMatch(/grupo/)
    expect(problemaDoProduto({ ...ok, grupo: 'GRUPO QUE NÃO EXISTE' })).toMatch(/grupo/)
    expect(problemaDoProduto({ ...ok, unidade: 'XX' })).toMatch(/unidade/)
    expect(problemaDoProduto({ ...ok, nome: 'A'.repeat(121) })).toMatch(/grande/)
  })
  it('a lista de grupos tem os 28 insumos lidos do SisChef e as unidades têm as siglas do SisChef', () => {
    expect(GRUPOS_DE_INSUMO).toContain('ESTOQUE CONTROLADO')
    expect(new Set(GRUPOS_DE_INSUMO).size).toBe(GRUPOS_DE_INSUMO.length)
    expect(UNIDADES.map((u) => u.sigla)).toEqual(expect.arrayContaining(['UN', 'KG', 'L']))
  })
})
