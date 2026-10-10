import { faltaNaLinha, lerPreco, lerQuantidade, problemaDaCompra, totalDaLinha, totalGeral } from '../../src/admin/compraAvulsaRegras'

const l = (produtoId: number | null, quantidade: string, preco: string) => ({ produtoId, quantidade, preco })

describe('compra avulsa — números', () => {
  it('lê "12,5", "1.250,75" e "3"; recusa vazio, zero, negativo e texto', () => {
    expect(lerQuantidade('12,5')).toBe(12.5)
    expect(lerPreco('1.250,75')).toBe(1250.75)
    expect(lerQuantidade('3')).toBe(3)
    for (const ruim of ['', '0', '-2', 'abc']) expect(lerQuantidade(ruim)).toBeNull()
  })
  it('total do item = quantidade × preço unitário (a unidade da planilha), em centavos', () => {
    expect(totalDaLinha({ quantidade: '12,5', preco: '8,90' })).toBe(111.25)
    expect(totalDaLinha({ quantidade: '1000', preco: '1,516' })).toBe(1516)
    expect(totalDaLinha({ quantidade: '', preco: '8,90' })).toBeNull()
  })
})

describe('compra avulsa — conferência', () => {
  it('diz o que falta em cada linha', () => {
    expect(faltaNaLinha(l(null, '1', '1'))).toMatch(/produto/)
    expect(faltaNaLinha(l(1, '', '1'))).toMatch(/quantidade/)
    expect(faltaNaLinha(l(1, '1', ''))).toMatch(/preço/)
    expect(faltaNaLinha(l(1, '1000000', '1'))).toMatch(/grande/)
    expect(faltaNaLinha(l(1, '2', '3'))).toBe('')
  })
  it('só soma linhas completas; a compra pede ao menos 1 item e não aceita produto repetido', () => {
    expect(totalGeral([l(1, '12,5', '8,90'), l(2, '1000', '1,516'), l(3, '', '5')])).toBe(1627.25)
    expect(problemaDaCompra([])).toMatch(/pelo menos 1/)
    expect(problemaDaCompra([l(1, '2', '3'), l(null, '', '')])).toMatch(/Item 2/)
    expect(problemaDaCompra([l(1, '2', '3'), l(1, '1', '4')])).toMatch(/repete/)
    expect(problemaDaCompra([l(1, '2', '3'), l(2, '1', '4')])).toBe('')
  })
})
