import { describe, it, expect } from 'vitest'
import {
  faltaChegar, porEmbalagem, embParaUn, unParaEmb, descricaoPedido, tudoQueFalta, montarItens,
  itensComFalta, prontoParaGravar, resumoRecebido, linhasFaltaAvaria, type EntradaItem,
} from '../../src/recebimento/receber'
import { mensagemFaltaAvaria } from '../../src/cotacao/mensagens'
import type { ItemAReceber, PedidoAReceber, Recebimento } from '../../src/lib/tipos'

// Fase 2, Bloco D (DESIGN-fase-2.md, D.7.1 / D.11).

function item(over: Partial<ItemAReceber> = {}): ItemAReceber {
  return { numero: 2, nome: 'COCA', unidade: 'un', qtd: 108, embalagens: 9, fator: 12, embalagem: 'fardo',
    marca: 'Marca X', chegou: 0, avaria: 0, resto: null, ...over }
}
function pedido(itens: ItemAReceber[]): PedidoAReceber {
  return { cotacao_id: 7, vendedor: 'MATEUS', confirmado_em: 'z', confirmado_local: '', entrega_prevista: null,
    recebimento: 'aguardando', itens, entregas: [] }
}

describe('conversões e descrição', () => {
  it('embalagens ↔ un', () => {
    expect(embParaUn(9, 12)).toBe(108)
    expect(unParaEmb(108, 12)).toBe(9)
    expect(porEmbalagem(item())).toBe(true)
    expect(porEmbalagem(item({ fator: null }))).toBe(false)
  })
  it('faltaChegar = qtd − chegou (nunca negativo)', () => {
    expect(faltaChegar(item({ qtd: 108, chegou: 84 }))).toBe(24)
    expect(faltaChegar(item({ qtd: 108, chegou: 120 }))).toBe(0)
  })
  it('descrição do pedido em embalagens, com o total em un; em kg mostra só a quantidade', () => {
    expect(descricaoPedido(item())).toBe('9 fardos c/12 (108 un)')
    expect(descricaoPedido(item({ unidade: 'kg', fator: null, embalagens: null, qtd: 20 }))).toBe('20 kg')
  })
})

describe('gravação', () => {
  it('"Chegou tudo certo" grava tudo o que falta, sem avaria', () => {
    const p = pedido([item({ numero: 2, qtd: 108, chegou: 0 }), item({ numero: 3, qtd: 20, chegou: 5 })])
    expect(tudoQueFalta(p)).toEqual([{ numero: 2, chegou: 108 }, { numero: 3, chegou: 15 }])
  })
  it('montarItens: item sem entrada conta como chegou 0; avaria/obs/resto só quando há', () => {
    const p = pedido([item({ numero: 2 }), item({ numero: 3 })])
    const entradas: Record<number, EntradaItem> = { 2: { numero: 2, chegou_un: 84, avaria_un: 3, resto: 'vem_depois' } }
    expect(montarItens(p, entradas)).toEqual([
      { numero: 2, chegou: 84, avaria: 3, resto: 'vem_depois' },
      { numero: 3, chegou: 0 },
    ])
  })
  it('itensComFalta e prontoParaGravar (resto por item; kg 2% não é falta)', () => {
    const p = pedido([
      item({ numero: 2, unidade: 'un', qtd: 108, chegou: 0 }),
      item({ numero: 3, unidade: 'kg', qtd: 20, chegou: 0, fator: null }),
    ])
    const entradas: Record<number, EntradaItem> = { 2: { numero: 2, chegou_un: 84 }, 3: { numero: 3, chegou_un: 19.7 } }
    const faltando = itensComFalta(p, entradas).map((x) => x.numero)
    expect(faltando).toEqual([2]) // o item 3 (19,7 de 20 kg) está dentro de 2%
    expect(prontoParaGravar(p, entradas, null)).toBe(false) // o item 2 precisa de resto
    expect(prontoParaGravar(p, entradas, 'nao_vem')).toBe(true) // o atalho "Todos" preenche
    entradas[2].resto = 'vem_depois'
    expect(prontoParaGravar(p, entradas, null)).toBe(true)
  })
  it('resumoRecebido', () => {
    expect(resumoRecebido({ recebimento_id: 1, recebimento: 'completo', faltas: [], avarias: [] })).toBe('Recebido! Chegou tudo certo.')
    const r = resumoRecebido({ recebimento_id: 1, recebimento: 'parcial', faltas: [{ numero: 2, nome: 'COCA', falta: 24, resto: 'vem_depois' }], avarias: [] })
    expect(r).toContain('Faltaram 24 de COCA (ainda vêm)')
  })
})

describe('linhasFaltaAvaria (mensagem ao vendedor, D.8)', () => {
  it('usa a unidade e o fator reais de cada item (não tudo em "un")', () => {
    const p = pedido([
      item({ numero: 2, nome: 'COCA', unidade: 'un', fator: 12, embalagem: 'fardo' }), // por embalagem
      item({ numero: 5, nome: 'QUEIJO MUSSARELA', unidade: 'kg', fator: null, embalagem: 'embalagem' }), // por kg
    ])
    const r: Recebimento = {
      recebimento_id: 1, recebimento: 'parcial',
      faltas: [
        { numero: 2, nome: 'COCA', falta: 24, resto: 'vem_depois' },
        { numero: 5, nome: 'QUEIJO MUSSARELA', falta: 5, resto: 'nao_vem' },
      ],
      avarias: [{ numero: 2, nome: 'COCA', avaria: 12, obs: null }],
    }
    const linhas = linhasFaltaAvaria(p, r)
    expect(linhas.find((l) => l.numero === 2 && l.falta === 24)).toMatchObject({ unidade: 'un', fator: 12 })
    expect(linhas.find((l) => l.numero === 5)).toMatchObject({ unidade: 'kg', fator: null })
    const txt = mensagemFaltaAvaria(p.vendedor, '2026-10-21', linhas)
    expect(txt).toContain('Faltou: 2 embalagens de COCA')            // 24 ÷ 12, não "24 un"
    expect(txt).toContain('Não precisa mandar: 5 kg de QUEIJO MUSSARELA') // "5 kg", não "5 un"
    expect(txt).toContain('Com avaria: 1 embalagem de COCA')          // 12 ÷ 12, não "12 un"
  })
  it('item que não está no pedido cai no padrão "un"/sem fator', () => {
    const p = pedido([item({ numero: 2, unidade: 'kg', fator: null })])
    const r: Recebimento = {
      recebimento_id: 1, recebimento: 'parcial',
      faltas: [{ numero: 99, nome: 'X', falta: 3, resto: 'vem_depois' }], avarias: [],
    }
    expect(linhasFaltaAvaria(p, r)[0]).toMatchObject({ unidade: 'un', fator: null })
  })
})
