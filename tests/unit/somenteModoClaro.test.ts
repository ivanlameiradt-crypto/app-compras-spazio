import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// O Comprar só existe no modo claro (decisão do Ivan, 10 e 11/11/2026): o manual de marca não tem cores para o escuro. Alguns celulares
// escurecem sozinhos as páginas; para impedir, a página precisa DECLARAR que é só clara, no HTML e no estilo.
const raiz = join(__dirname, '..', '..')
const html = readFileSync(join(raiz, 'index.html'), 'utf-8')
const css = readFileSync(join(raiz, 'src', 'styles.css'), 'utf-8')

describe('somente modo claro', () => {
  it('o HTML declara color-scheme "only light" (impede o escurecimento automático do navegador)', () => {
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="only light"/)
    expect(html).toMatch(/<meta\s+name="supported-color-schemes"\s+content="light"/)
  })
  it('o estilo declara color-scheme "only light" na raiz e não tem nenhum bloco do modo escuro', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*only light/)
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/)
  })
})
