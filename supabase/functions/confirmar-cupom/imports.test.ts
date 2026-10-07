// O bundler do Supabase (Deno) exige a extensão nos imports relativos: './logica' sem .ts quebra o deploy. O vitest resolve sem extensão,
// então só esta checagem pega. E o normalizador tem de ser IDÊNTICO ao da enviar-cupom (a chave do aprendizado, emitente + descrição
// normalizada, é computada pelas duas: se divergirem, o que o Ivan confirma aqui nunca casa lá).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const codigoDaFuncao = readdirSync(AQUI).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('Edge Function confirmar-cupom: imports relativos com extensão (exigência do Deno)', () => {
  it('acha os arquivos da função', () => {
    expect(codigoDaFuncao).toEqual(expect.arrayContaining(['index.ts', 'logica.ts', 'aprendizado.ts', 'normalizar.ts']))
  })
  it.each(codigoDaFuncao)('%s', (arquivo) => {
    const fonte = readFileSync(join(AQUI, arquivo), 'utf8')
    const relativos = [...fonte.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
    expect(relativos.filter((caminho) => !caminho.endsWith('.ts'))).toEqual([])
    // cada função é publicada com os seus próprios arquivos: nada de importar de outra pasta
    expect(relativos.filter((caminho) => caminho.startsWith('../'))).toEqual([])
  })
  it('normalizar.ts é cópia exata do da enviar-cupom (a chave do aprendizado depende disso)', () => {
    const daqui = readFileSync(join(AQUI, 'normalizar.ts'), 'utf8')
    const deLa = readFileSync(join(AQUI, '..', 'enviar-cupom', 'normalizar.ts'), 'utf8')
    expect(daqui).toBe(deLa)
  })
})
