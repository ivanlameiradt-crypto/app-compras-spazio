import { describe, expect, it } from 'vitest'
import { ehIos, tipoDeAparelho } from '../../src/lib/instalar'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const WHATSAPP_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36'
const INSTAGRAM_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0'

describe('ehIos', () => {
  it('reconhece iPhone e iPad pelo nome', () => {
    expect(ehIos(IPHONE)).toBe(true)
    expect(ehIos('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')).toBe(true)
  })
  it('reconhece o iPad que se diz Mac (tem tela de toque)', () => {
    expect(ehIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true)
  })
  it('Mac de verdade (sem tela de toque) e Android não são iOS', () => {
    expect(ehIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false)
    expect(ehIos(ANDROID)).toBe(false)
  })
})

describe('tipoDeAparelho', () => {
  it('diz o aparelho pelo que o navegador informa', () => {
    expect(tipoDeAparelho(IPHONE, { ios: true, instalado: false })).toBe('iphone')
    expect(tipoDeAparelho(ANDROID, { ios: false, instalado: false })).toBe('android')
    expect(tipoDeAparelho(WINDOWS, { ios: false, instalado: false })).toBe('computador')
  })
  it('app já instalado vem antes de tudo', () => {
    expect(tipoDeAparelho(IPHONE, { ios: true, instalado: true })).toBe('instalado')
  })
  it('link aberto por dentro do WhatsApp ou do Instagram não instala: avisa para abrir no navegador', () => {
    expect(tipoDeAparelho(WHATSAPP_ANDROID, { ios: false, instalado: false })).toBe('dentro_de_outro_app')
    expect(tipoDeAparelho(INSTAGRAM_IPHONE, { ios: true, instalado: false })).toBe('dentro_de_outro_app')
  })
})
