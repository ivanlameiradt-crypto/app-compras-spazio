import { describe, it, expect } from 'vitest'
import {
  normalizarWhatsapp, whatsappValido, mascararWhatsapp, formatarWhatsapp, embalagemSugerida, textoFator,
  resumoMudanca, type Mudanca,
} from '../../src/cadastros/regras'

describe('normalizarWhatsapp / whatsappValido (C.4.3)', () => {
  it('normaliza como o banco', () => {
    expect(normalizarWhatsapp('(91) 90000-1234')).toBe('5591900001234')
    expect(normalizarWhatsapp('091 90000-1234')).toBe('5591900001234')
    expect(normalizarWhatsapp('5591900001234')).toBe('5591900001234')
    expect(normalizarWhatsapp('90000-1234')).toBe('900001234') // 9 dígitos: não vira 55…
  })
  it('valida com a regex da 7.2', () => {
    expect(whatsappValido('5591900001234')).toBe(true)
    expect(whatsappValido('900001234')).toBe(false)  // sem o 55 + DDD (só o celular)
    expect(whatsappValido('20001234')).toBe(false)   // curto e sem prefixo, não é telefone
  })
})

describe('mascararWhatsapp / formatarWhatsapp', () => {
  it('mascara o miolo para as listas', () => {
    expect(mascararWhatsapp('5591900001234')).toBe('+55 91 9····-1234')
  })
  it('formata sem mascarar no formulário', () => {
    expect(formatarWhatsapp('5591900001234')).toBe('+55 91 90000-1234')
  })
})

describe('embalagemSugerida (C.4.9)', () => {
  it('fardo bebida/un, caixa insumo/un, pacote kg', () => {
    expect(embalagemSugerida('un', true)).toBe('fardo')
    expect(embalagemSugerida('un', false)).toBe('caixa')
    expect(embalagemSugerida('kg', false)).toBe('pacote')
  })
})

describe('textoFator (C.4.5)', () => {
  it('un mostra a contagem, kg mostra a medida', () => {
    expect(textoFator('fardo', 12, 'un')).toBe('fardo c/12')
    expect(textoFator('pacote', 0.5, 'kg')).toBe('pacote de 500 g')
    expect(textoFator('saco', 1.5, 'kg')).toBe('saco de 1,5 kg')
  })
})

describe('resumoMudanca (C.5)', () => {
  const base = (over: Partial<Mudanca>): Mudanca => ({
    id: 1, quem: 'ivan@spazio.com', quando: '2026-10-29T21:05:00Z', tabela: 'cot_vendedores', registro: '1',
    antes: null, depois: null, ...over,
  })
  it('cadastro, WhatsApp trocado (mascarado) e (pelo Claude)', () => {
    expect(resumoMudanca(base({ antes: null, depois: { empresa: 'ATACADÃO (Loja)', via: 'app' } })))
      .toBe('ATACADÃO: cadastrado')
    expect(resumoMudanca(base({
      antes: { empresa: 'ATACADÃO (Loja)', whatsapp: '5591900000000' },
      depois: { empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', via: 'claude' },
    }))).toBe('ATACADÃO: WhatsApp trocado (+55 91 9····-1234) (pelo Claude)')
  })
  it('vendedor ligado/desligado e fator do catálogo', () => {
    expect(resumoMudanca(base({ antes: { empresa: 'X', ativo: false }, depois: { empresa: 'X', ativo: true, via: 'app' } })))
      .toBe('X: ligado')
    expect(resumoMudanca(base({
      tabela: 'cot_catalogo', antes: { fator: null }, depois: { fator: 12, via: 'app' },
    }))).toBe('Produto: embalagem para c/12')
  })
})
