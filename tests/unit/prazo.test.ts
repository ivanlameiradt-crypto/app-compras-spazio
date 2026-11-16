import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ehErroTemporario } from '../../src/lib/fila'
import { comPrazo, prazoDe, PRAZO_PADRAO_MS } from '../../src/lib/prazo'

// Tempo limite das chamadas ao servidor (pedido do Ivan, 16/11/2026, depois da análise do app): sem ele, com 4G pendurado os botões ficavam em
// "Enviando…" por minutos. Cada tipo de chamada tem o seu prazo; o que passa dele vira "sem resposta" (e a tela manda conferir antes de repetir).
const BASE = 'https://projeto.supabase.co'

/** Um fetch que nunca responde, mas respeita o sinal de cancelamento (como o de verdade). */
function fetchPendurado() {
  const chamadas: Array<{ url: string; sinal: AbortSignal }> = []
  const fn = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    const sinal = init?.signal as AbortSignal
    chamadas.push({ url, sinal })
    return new Promise<Response>((_, rejeitar) => {
      if (sinal.aborted) return rejeitar(sinal.reason) // como o fetch de verdade: sinal já cancelado falha na hora
      sinal.addEventListener('abort', () => rejeitar(sinal.reason), { once: true })
    })
  }) as typeof fetch
  return { fn, chamadas }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('prazoDe: cada tipo de chamada tem o seu tempo', () => {
  it('banco e login: 30 s; funções: 45 s; lancar-nfe: 60 s; leitura com IA: 130 s; foto: 90 s', () => {
    expect(PRAZO_PADRAO_MS).toBe(30_000)
    expect(prazoDe(`${BASE}/rest/v1/cot_nfe?select=*`)).toBe(30_000)
    expect(prazoDe(`${BASE}/auth/v1/token?grant_type=refresh_token`)).toBe(30_000)
    expect(prazoDe(`${BASE}/functions/v1/enviar-cupom`)).toBe(45_000)
    expect(prazoDe(`${BASE}/functions/v1/consultar-cnpj`)).toBe(45_000)
    expect(prazoDe(`${BASE}/functions/v1/lancar-nfe`)).toBe(60_000)
    expect(prazoDe(`${BASE}/functions/v1/cot-ler-resposta`)).toBe(130_000)
    expect(prazoDe(`${BASE}/storage/v1/object/cupons/a/b.jpg`)).toBe(90_000)
  })
})

describe('comPrazo: cancela a chamada que passa do prazo', () => {
  it('banco: aos 30 s a chamada falha com AbortError (o cliente não a repete) e a mensagem diz "timeout"', async () => {
    const { fn } = fetchPendurado()
    const f = comPrazo(fn)
    const p = f(`${BASE}/rest/v1/cot_nfe`).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(29_999)
    let resolvida = false
    void p.then(() => { resolvida = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolvida).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = (await p) as Error
    expect(e.name).toBe('AbortError')
    expect(e.message).toMatch(/timeout/i)
    expect(e.message).toContain('30 s')
  })

  it('função comum espera 45 s; lancar-nfe 60 s; leitura com IA 130 s; foto 90 s', async () => {
    for (const [caminho, ms] of [['functions/v1/enviar-cupom', 45_000], ['functions/v1/lancar-nfe', 60_000], ['functions/v1/cot-ler-resposta', 130_000], ['storage/v1/object/cupons/x.jpg', 90_000]] as const) {
      const { fn, chamadas } = fetchPendurado()
      const p = comPrazo(fn)(`${BASE}/${caminho}`).catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(ms - 1)
      expect(chamadas[0].sinal.aborted, `${caminho} cedo demais`).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(chamadas[0].sinal.aborted, `${caminho} no prazo`).toBe(true)
      expect(((await p) as Error).name).toBe('AbortError')
    }
  })

  it('resposta que chega a tempo passa intacta e o relógio é desligado (nada fica pendurado)', async () => {
    const resposta = new Response('{"ok":true}', { status: 200 })
    const f = comPrazo((async () => resposta) as typeof fetch)
    expect(await f(`${BASE}/rest/v1/x`)).toBe(resposta)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falha da rede (antes do prazo) também desliga o relógio e repassa o erro', async () => {
    const f = comPrazo((async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)
    await expect(f(`${BASE}/rest/v1/x`)).rejects.toThrow('Failed to fetch')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('quem chamou pode cancelar antes (o sinal dele continua valendo)', async () => {
    const { fn, chamadas } = fetchPendurado()
    const dono = new AbortController()
    const p = comPrazo(fn)(`${BASE}/rest/v1/x`, { signal: dono.signal }).catch((e: unknown) => e)
    dono.abort(new Error('cancelado por mim'))
    expect(chamadas[0].sinal.aborted).toBe(true)
    expect(((await p) as Error).message).toBe('cancelado por mim')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sinal já cancelado: falha na hora, sem esperar o prazo', async () => {
    const { fn } = fetchPendurado()
    const dono = new AbortController()
    dono.abort(new Error('já estava cancelado'))
    await expect(comPrazo(fn)(`${BASE}/rest/v1/x`, { signal: dono.signal })).rejects.toThrow('já estava cancelado')
  })

  it('os outros dados da chamada (método, corpo, cabeçalhos) seguem como vieram', async () => {
    const visto: RequestInit[] = []
    const f = comPrazo((async (_u: RequestInfo | URL, init?: RequestInit) => { visto.push(init ?? {}); return new Response('{}') }) as typeof fetch)
    await f(`${BASE}/functions/v1/enviar-cupom`, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })
    expect(visto[0]).toMatchObject({ method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })
    expect(visto[0].signal).toBeInstanceOf(AbortSignal)
  })
})

describe('com a biblioteca do Supabase de verdade: o que a tela recebe quando o prazo estoura', () => {
  const cliente = (fn: typeof fetch) => createClient(BASE, 'chave-publica-de-teste', { global: { fetch: comPrazo(fn) }, auth: { persistSession: false, autoRefreshToken: false } })

  it('função: vira o erro "Failed to send a request…", que o app já traduz em "Sem resposta do servidor… confira antes de repetir"', async () => {
    const { fn } = fetchPendurado()
    const p = cliente(fn).functions.invoke('enviar-cupom', { body: { a: 1 } })
    await vi.advanceTimersByTimeAsync(45_000)
    const { error } = await p
    expect(error?.message).toMatch(/Failed to send a request to the Edge Function/i)
  })

  it('banco: a leitura pendurada falha aos 30 s e NÃO é repetida sozinha (uma só chamada); o erro traz "timeout" e é temporário para a fila offline', async () => {
    const { fn, chamadas } = fetchPendurado()
    const p = cliente(fn).from('cot_nfe').select('chave').then((r) => r) // o pedido só começa quando alguém espera pelo resultado
    await vi.advanceTimersByTimeAsync(30_000)
    const { error } = await p
    expect(chamadas).toHaveLength(1)
    expect(error?.message).toMatch(/timeout/i)
    expect(ehErroTemporario(new Error(error?.message ?? ''), true)).toBe(true)
  })

  it('foto: o erro do envio traz "timeout" e também é temporário', async () => {
    const { fn } = fetchPendurado()
    const p = cliente(fn).storage.from('cupons').upload('a/b.jpg', new Blob(['x']), { contentType: 'image/jpeg' })
    await vi.advanceTimersByTimeAsync(90_000)
    const { error } = await p
    expect(error?.message).toMatch(/timeout/i)
    expect(ehErroTemporario(new Error(error?.message ?? ''), true)).toBe(true)
  })
})

describe('o cliente do app usa o prazo', () => {
  it('src/lib/supabase.ts monta o cliente com fetch: comPrazo()', () => {
    const fonte = readFileSync(join(__dirname, '../../src/lib/supabase.ts'), 'utf8')
    expect(fonte).toContain("from './prazo'")
    expect(fonte).toContain('fetch: comPrazo()')
  })
})
