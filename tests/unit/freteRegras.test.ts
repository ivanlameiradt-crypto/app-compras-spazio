import { codigoUfDaChave, lerFrete, notaDeForaDoPara, ratearFrete, siglaDaChave, unidadesDoPacote } from '../../src/admin/freteRegras'

const CHAVE_SP = '35261008637193000106550010001207101371230333' // Tamarozzi (SP)
const CHAVE_PA = '15261003995515011363550020000892841000892852' // Mateus (PA)

describe('estado do emitente pela chave da nota', () => {
  it('lê os 2 primeiros dígitos: 35 = SP, 15 = PA; chave inválida = vazio', () => {
    expect(codigoUfDaChave(CHAVE_SP)).toBe('35')
    expect(siglaDaChave(CHAVE_SP)).toBe('SP')
    expect(siglaDaChave(CHAVE_PA)).toBe('PA')
    expect(siglaDaChave('123')).toBe('')
    expect(siglaDaChave(null)).toBe('')
  })
  it('nota de fora do Pará: SP sim, PA não, chave inválida não', () => {
    expect(notaDeForaDoPara(CHAVE_SP)).toBe(true)
    expect(notaDeForaDoPara(CHAVE_PA)).toBe(false)
    expect(notaDeForaDoPara('123')).toBe(false)
  })
})

describe('lerFrete', () => {
  it('"300", "300,00", "1.250,5" valem; vazio, zero, negativo e texto não', () => {
    expect(lerFrete('300')).toBe(300)
    expect(lerFrete('300,00')).toBe(300)
    expect(lerFrete('1.250,5')).toBe(1250.5)
    expect(lerFrete(' 12,345 ')).toBe(12.35)
    for (const ruim of ['', '0', '0,00', '-5', 'abc']) expect(lerFrete(ruim)).toBeNull()
  })
})

describe('ratearFrete — proporcional ao valor, como o "Distribuir entre os itens" do SisChef', () => {
  it('a nota da Tamarozzi (1 item): 40 pct a R$ 37,90 com frete de R$ 300 → 19,79% e R$ 45,40 o pacote (R$ 1,816 a unidade)', () => {
    const r = ratearFrete([{ descricao: 'EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND', valor: 1516, quantidade: 40, unidade: 'pct' }], 300)!
    expect(r.percentual).toBeCloseTo(19.789, 2)
    expect(r.totalComFrete).toBe(1816)
    expect(r.itens[0].frete).toBe(300)
    expect(r.itens[0].precoNota).toBeCloseTo(37.9, 6)
    expect(r.itens[0].precoFinal).toBeCloseTo(45.4, 6)
    expect(r.itens[0].precoFinal / 25).toBeCloseTo(1.816, 6)
  })
  it('o que o SisChef fez ao vivo: itens de 390,00 e 47,40 com frete de 100,00 → 89,16 e 10,84', () => {
    const r = ratearFrete([{ descricao: 'A', valor: 390, quantidade: 1, unidade: 'pct' }, { descricao: 'B', valor: 47.4, quantidade: 1, unidade: 'kg' }], 100)!
    expect(r.itens.map((i) => i.frete)).toEqual([89.16, 10.84])
    expect(r.totalComFrete).toBe(537.4)
  })
  it('a soma das partes fecha EXATAMENTE no frete (o resto do arredondamento vai para o item de maior valor)', () => {
    const itens = [1, 2, 3].map((k) => ({ descricao: String(k), valor: 100, quantidade: 3, unidade: 'un' }))
    const r = ratearFrete(itens, 100)!
    expect(Math.round(r.itens.reduce((s, i) => s + i.frete, 0) * 100)).toBe(10000)
  })
  it('preço por kg: a parte do item dividida pelos kg', () => {
    const r = ratearFrete([{ descricao: 'QUEIJO', valor: 1000, quantidade: 50, unidade: 'kg' }, { descricao: 'PRESUNTO', valor: 500, quantidade: 25, unidade: 'kg' }], 150)!
    expect(r.itens[0].frete).toBe(100)
    expect(r.itens[0].precoFinal).toBeCloseTo(20 + 100 / 50, 6)    // R$ 20,00/kg + R$ 2,00/kg de frete
    expect(r.itens[1].precoFinal).toBeCloseTo(20 + 50 / 25, 6)
  })
  it('sem como ratear (frete zero, lista vazia, item sem valor ou sem quantidade): null', () => {
    expect(ratearFrete([{ descricao: 'A', valor: 10, quantidade: 1, unidade: 'un' }], 0)).toBeNull()
    expect(ratearFrete([], 10)).toBeNull()
    expect(ratearFrete([{ descricao: 'A', valor: 0, quantidade: 1, unidade: 'un' }], 10)).toBeNull()
    expect(ratearFrete([{ descricao: 'A', valor: 10, quantidade: 0, unidade: 'un' }], 10)).toBeNull()
  })
})

describe('unidadesDoPacote — quantas unidades vêm no pacote, lido do nome do produto', () => {
  it('"PCT 25 UND" → 25; caixa, fardo e "C/" também', () => {
    expect(unidadesDoPacote('EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND')).toBe(25)
    expect(unidadesDoPacote('CÓD. FOR: 2350LG EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND')).toBe(25)
    expect(unidadesDoPacote('COPO 200ML CX 12 UN')).toBe(12)
    expect(unidadesDoPacote('GUARDANAPO FARDO C/ 10 UNID')).toBe(10)
  })
  it('nome sem a quantidade, 1 unidade ou vazio: null (não chuto)', () => {
    expect(unidadesDoPacote('REQUEIJAO CREMOSO 1KG')).toBeNull()
    expect(unidadesDoPacote('SACOLA PCT 1 UND')).toBeNull()
    expect(unidadesDoPacote('')).toBeNull()
    expect(unidadesDoPacote(null)).toBeNull()
  })
})
