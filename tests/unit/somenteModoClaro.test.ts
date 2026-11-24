import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Padrão visual único dos apps (23/11/2026): o Comprar passou a ter modo escuro AUTOMÁTICO (pelo aparelho), com as cores do manual (tema.css).
// Este arquivo era "somenteModoClaro" (decisão de 10/11, "only light"); a decisão mudou e o teste agora garante o contrário.
// O nome do arquivo foi mantido para o histórico do git; ele cuida do modo claro/escuro.
const raiz = join(__dirname, '..', '..')
const html = readFileSync(join(raiz, 'index.html'), 'utf-8')
const css = readFileSync(join(raiz, 'src', 'styles.css'), 'utf-8').split(String.fromCharCode(13)).join('') // fim de linha do Windows

describe('modo claro e escuro automáticos', () => {
  it('o HTML declara color-scheme "light dark" (o aparelho escolhe)', () => {
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"/)
    expect(html).toMatch(/<meta\s+name="supported-color-schemes"\s+content="light dark"/)
    expect(html).not.toMatch(/only light/)
  })
  it('o estilo declara "light dark" na raiz e tem o bloco do modo escuro com as cores do manual', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/)
    expect(css).not.toMatch(/only light;/)
    const escuro = css.slice(css.indexOf('prefers-color-scheme: dark'))
    for (const cor of ['#151314', '#231F20', '#F6F5F2', '#CFCAC2', '#8BDCA6', '#F3C88A', '#FF9C93']) expect(escuro).toContain(cor)
  })
  it('as telas usam só os nomes de cor ligados aos tokens (nada de cor solta que não troque no escuro)', () => {
    // fora da definição dos tokens e do bloco escuro, só podem sobrar estas cores fixas de marca/aviso
    const corpo = css.slice(css.indexOf('\n/* Modo escuro automático'))
    const depoisDoBloco = corpo.slice(corpo.indexOf('\n}\n', corpo.indexOf('@media (prefers-color-scheme: dark)')) + 3)
    const soltas = [...depoisDoBloco.matchAll(/#[0-9a-fA-F]{6}\b|#fff\b/g)].map((m) => m[0].toLowerCase())
    const permitidas = new Set(['#fff', '#d6141a', '#231f20', '#ffd201', '#5b300e', '#d9d5ce'])
    expect(soltas.filter((c) => !permitidas.has(c))).toEqual([])
  })
})
