import { describe, expect, it } from 'vitest'
import { lerDigitosDaImagem } from '../../src/admin/boletoFoto'
import { lerBoleto } from '../../src/admin/boletoRegras'
import { barras } from './boletoAjuda'

// Desenha um código ITF de verdade (o formato do boleto) em pontos cinza: 0 = barra preta, 255 = branco.
const PADROES = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn']
function desenharItf(digitos: string, estreito: number, ruido = 0): { cinza: Uint8ClampedArray; largura: number; altura: number } {
  const larguras: number[] = []
  const cores: number[] = []
  const add = (w: number, preto: boolean) => { larguras.push(w); cores.push(preto ? 0 : 255) }
  ;[0, 1, 0, 1].forEach((_, i) => add(estreito, i % 2 === 0)) // início: barra, espaço, barra, espaço (estreitos)
  for (let i = 0; i < digitos.length; i += 2) {
    const a = PADROES[Number(digitos[i])]
    const b = PADROES[Number(digitos[i + 1])]
    for (let k = 0; k < 5; k++) { add(a[k] === 'w' ? estreito * 3 : estreito, true); add(b[k] === 'w' ? estreito * 3 : estreito, false) }
  }
  add(estreito * 3, true); add(estreito, false); add(estreito, true) // fim
  const margem = estreito * 12
  const largura = larguras.reduce((s, w) => s + w, 0) + margem * 2
  const altura = 120
  const cinza = new Uint8ClampedArray(largura * altura).fill(255)
  let x = margem
  larguras.forEach((w, i) => {
    for (let dx = 0; dx < w; dx++) for (let y = 15; y < altura - 15; y++) cinza[y * largura + x + dx] = cores[i]
    x += w
  })
  if (ruido > 0) for (let i = 0; i < cinza.length; i++) cinza[i] = Math.max(0, Math.min(255, cinza[i] + ((i * 7919) % (ruido * 2 + 1)) - ruido))
  return { cinza, largura, altura }
}

describe('lerDigitosDaImagem', () => {
  const codigo = barras('341', '1656', '46974')
  it('acha os 44 dígitos de um código ITF desenhado', async () => {
    const { cinza, largura, altura } = desenharItf(codigo, 2)
    expect(await lerDigitosDaImagem(cinza, largura, altura)).toBe(codigo)
  })
  it('acha também com ruído de foto', async () => {
    const { cinza, largura, altura } = desenharItf(codigo, 3, 25)
    expect(await lerDigitosDaImagem(cinza, largura, altura)).toBe(codigo)
  })
  it('acha com a imagem girada (boleto fotografado em pé)', async () => {
    const { cinza, largura, altura } = desenharItf(codigo, 2)
    const girada = new Uint8ClampedArray(cinza.length)
    for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) girada[x * altura + (altura - 1 - y)] = cinza[y * largura + x]
    expect(await lerDigitosDaImagem(girada, altura, largura)).toBe(codigo)
  })
  it('imagem sem código devolve null, e os dígitos lidos viram valor e data', async () => {
    expect(await lerDigitosDaImagem(new Uint8ClampedArray(200 * 100).fill(255), 200, 100)).toBeNull()
    const r = lerBoleto(codigo, new Date(2026, 10, 25))
    expect(r.ok && r.boleto.valor).toBe(469.74)
  })
})
