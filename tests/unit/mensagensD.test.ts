import { describe, it, expect } from 'vitest'
import { mensagemDiferencaNf, mensagemFaltaAvaria } from '../../src/cotacao/mensagens'
import type { LinhaConferencia } from '../../src/lib/tipos'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.8 / D.11): mensagens 10.6 e 10.7 ao vendedor.

function linha(over: Partial<LinhaConferencia> = {}): LinhaConferencia {
  return {
    cotacao_id: 7, confirmado_em: '2026-10-21T13:00:00Z', entrega_prevista: null,
    numero: 2, produto_id: 1001, nome: 'COCA COLA - ZERO 350 ML', unidade: 'un',
    qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco_combinado: 42, preco_convertido: 3.5, marca: null,
    chegou: null, avaria: null, falta: null, resto: null, falta_definitiva: 0, recebimento: 'aguardando',
    nf_chaves: [], nf_qtd: null, qtd_nf: 'igual', preco: 'igual', valor_acima: 0, combinado_unit: 3.5,
    cobrado_unit: 3.5, imposto: 0, marca_nf: null, motivos: [], ...over,
  }
}

describe('mensagemDiferencaNf (10.6)', () => {
  it('só itens acima; base combinada; total a mais; nunca o último preço nem outro vendedor', () => {
    const linhas = [
      linha({ numero: 2, preco: 'acima', valor_acima: 18 }),       // 9 fardos, +R$ 18,00
      linha({ numero: 3, nome: 'ÁGUA', preco: 'igual', valor_acima: 0 }),
      linha({ numero: 4, nome: 'SUCO', preco: 'confira' }),
    ]
    const txt = mensagemDiferencaNf('Fulano', '123456', '2026-10-21', linhas)
    expect(txt).toContain('recebemos a NF 123456 do pedido de qua 21/10')
    expect(txt).toContain('2. COCA COLA - ZERO 350 ML')
    expect(txt).toContain('combinado R$ 42,00 a embalagem')
    expect(txt).toContain('na NF R$ 44,00')      // 42 + 18/9
    expect(txt).toContain('R$ 18,00 a mais')
    expect(txt).toContain('Pode verificar, por favor? Obrigado!')
    // só o item acima: ÁGUA (igual) e SUCO (confira) não aparecem
    expect(txt).not.toContain('ÁGUA')
    expect(txt).not.toContain('SUCO')
  })
  it('frete acima entra à parte; sem nada acima nem frete → texto vazio', () => {
    const comFrete = mensagemDiferencaNf('Fulano', '1', '2026-10-21', [linha({ preco: 'igual' })], { combinado: 30, nf: 45 })
    expect(comFrete).toContain('Frete: combinado R$ 30,00, na NF R$ 45,00')
    expect(mensagemDiferencaNf('Fulano', '1', '2026-10-21', [linha({ preco: 'igual' })])).toBe('')
  })
  it('não vaza ref_preco nem nome de outro vendedor', () => {
    const l = linha({ preco: 'acima', valor_acima: 18 })
    const txt = mensagemDiferencaNf('Fulano', '123456', '2026-10-21', [l])
    expect(txt).not.toContain('BELTRANO')
    expect(txt).not.toContain('2,79') // um "último preço" hipotético
    expect(txt).not.toMatch(/último|economia|ref/i)
  })
})

describe('mensagemFaltaAvaria (10.7)', () => {
  it('resto por item: o que ainda vem em "Faltou:", o que não vem mais à parte', () => {
    const linhas = [
      linha({ numero: 2, nome: 'COCA', unidade: 'un', fator: 12, falta: 24, resto: 'vem_depois' }),
      linha({ numero: 5, nome: 'QUEIJO MUSSARELA', unidade: 'kg', fator: null, falta: 5, resto: 'nao_vem' }),
    ]
    const txt = mensagemFaltaAvaria('Fulano', '2026-10-21', linhas)
    expect(txt).toContain('chegou o pedido de qua 21/10, obrigado!')
    expect(txt).toContain('Faltou: 2 embalagens de COCA')       // 24 ÷ 12
    expect(txt).toContain('Não precisa mandar: 5 kg de QUEIJO MUSSARELA')
    expect(txt).toContain('Vai mandar o que faltou?')
  })
  it('quando nenhum item ainda vem, a última linha muda', () => {
    const linhas = [linha({ numero: 5, nome: 'QUEIJO', unidade: 'kg', fator: null, falta: 5, resto: 'nao_vem' })]
    const txt = mensagemFaltaAvaria('Fulano', '2026-10-21', linhas)
    expect(txt).toContain('Tudo bem, compramos o que faltou por aqui.')
    expect(txt).not.toContain('Vai mandar o que faltou?')
  })
  it('avaria entra numa linha própria', () => {
    const linhas = [linha({ numero: 3, nome: 'GUARANÁ', unidade: 'un', fator: 12, avaria: 12 })]
    const txt = mensagemFaltaAvaria('Fulano', '2026-10-21', linhas)
    expect(txt).toContain('Com avaria: 1 embalagem de GUARANÁ')
  })
})
