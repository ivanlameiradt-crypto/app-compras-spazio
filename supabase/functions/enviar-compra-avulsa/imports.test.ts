// O bundler do Supabase (Deno) exige a extensão nos imports relativos (o vitest resolve sem ela: só esta checagem pega).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const codigoDaFuncao = readdirSync(AQUI).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('Edge Function enviar-compra-avulsa: imports relativos com extensão (exigência do Deno)', () => {
  it('acha os arquivos da função', () => {
    expect(codigoDaFuncao).toEqual(expect.arrayContaining(['index.ts', 'logica.ts', 'gravacao.ts']))
  })
  it.each(codigoDaFuncao)('%s', (arquivo) => {
    const fonte = readFileSync(join(AQUI, arquivo), 'utf8')
    const relativos = [...fonte.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
    expect(relativos.filter((caminho) => !caminho.endsWith('.ts'))).toEqual([])
  })
})
