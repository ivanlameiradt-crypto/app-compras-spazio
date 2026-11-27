import { describe, expect, it } from 'vitest'
import { criarLeitorDeBarras, esticarContraste, faixaDoMeio, lerDigitosDaImagem } from '../../src/admin/boletoFoto'
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

describe('leitura robusta (revisão de 27/11)', () => {
  const codigo = barras('341', '1656', '46974')
  it('esticarContraste: imagem cinzenta (100 a 140) passa a usar a faixa toda', () => {
    const c = new Uint8ClampedArray(1000)
    for (let i = 0; i < c.length; i++) c[i] = 100 + (i % 41)
    const e = esticarContraste(c)
    expect(Math.min(...e)).toBeLessThan(10)
    expect(Math.max(...e)).toBeGreaterThan(245)
  })
  it('faixaDoMeio: recorta 40% da altura, do meio, com a mesma largura', () => {
    const c = new Uint8ClampedArray(10 * 10)
    for (let y = 0; y < 10; y++) c.fill(y * 10, y * 10, y * 10 + 10)
    const f = faixaDoMeio(c, 10, 10, 0.4)
    expect(f.altura).toBe(4)
    expect(f.largura).toBe(10)
    expect(f.cinza[0]).toBe(30) // começa na linha 3
  })
  it('código pequeno (40% da largura) num quadro cinzento e grande: a faixa do meio com contraste esticado lê', async () => {
    const { cinza, largura, altura } = desenharItf(codigo, 2)
    // quadro 1920x1080 cinza-claro (180) com o código (largura ~850 px) colado no meio e sem contraste cheio
    const W = 1920, H = 1080
    const quadro = new Uint8ClampedArray(W * H).fill(170)
    const x0 = Math.floor((W - largura) / 2), y0 = Math.floor((H - altura) / 2)
    for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) quadro[(y0 + y) * W + x0 + x] = 120 + Math.round(cinza[y * largura + x] / 255 * 60)
    const leitor = await criarLeitorDeBarras()
    const f = faixaDoMeio(quadro, W, H)
    expect(leitor(esticarContraste(f.cinza), f.largura, f.altura)).toBe(codigo)
  })
  it('um dígito trocado (dígito verificador não confere) é descartado: devolve null em vez de um número errado', async () => {
    const trocado = codigo.slice(0, 20) + (codigo[20] === '9' ? '8' : String(Number(codigo[20]) + 1)) + codigo.slice(21)
    const { cinza, largura, altura } = desenharItf(trocado, 2)
    expect(await lerDigitosDaImagem(cinza, largura, altura)).toBeNull()
  })
})
