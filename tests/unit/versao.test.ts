import { describe, it, expect } from 'vitest'
import { precisaAtualizar } from '../../src/lib/versao'

describe('precisaAtualizar — quando trocar para a versão do ar', () => {
  it('sem resposta do servidor (offline): não troca', () => {
    expect(precisaAtualizar(null, 'abc', null)).toBe(false)
    expect(precisaAtualizar(undefined, 'abc', null)).toBe(false)
    expect(precisaAtualizar('', 'abc', null)).toBe(false)
  })

  it('mesma versão que está rodando: não troca', () => {
    expect(precisaAtualizar('abc', 'abc', null)).toBe(false)
  })

  it('versão nova no ar: troca', () => {
    expect(precisaAtualizar('nova', 'abc', null)).toBe(true)
  })

  it('já tentou trocar para essa versão e não assentou: não repete (anti-loop)', () => {
    expect(precisaAtualizar('nova', 'abc', 'nova')).toBe(false)
  })

  it('tentou uma versão antes, mas agora saiu outra ainda mais nova: troca', () => {
    expect(precisaAtualizar('nova2', 'abc', 'nova')).toBe(true)
  })
})
