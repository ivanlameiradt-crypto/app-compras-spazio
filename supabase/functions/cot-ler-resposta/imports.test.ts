// O bundler do Supabase (Deno) exige a extensão nos imports relativos: `'./logica'` sem `.ts` quebra o deploy. O
// vitest resolve sem extensão, então só esta checagem pega. (B.7.1: o teste de imports passa a cobrir esta pasta.)
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const codigoDaFuncao = readdirSync(AQUI).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('Edge Function cot-ler-resposta: imports relativos com extensão (exigência do Deno)', () => {
  it('acha os arquivos da função', () => {
    expect(codigoDaFuncao).toEqual(expect.arrayContaining(['index.ts', 'logica.ts', 'prompt.ts', 'esquema.ts']))
  })

  it.each(codigoDaFuncao)('%s', (arquivo) => {
    const fonte = readFileSync(join(AQUI, arquivo), 'utf8')
    const relativos = [...fonte.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
    expect(relativos.filter((caminho) => !caminho.endsWith('.ts'))).toEqual([])
  })
})
