// O bundler do Supabase (Deno) exige a extensão nos imports relativos e cada função é publicada só com os seus arquivos. Vale para consultar-cnpj e cadastrar-fornecedor.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FUNCOES = join(dirname(fileURLToPath(import.meta.url)), '..')

describe.each(['consultar-cnpj', 'cadastrar-fornecedor'])('Edge Function %s: imports relativos com extensão (exigência do Deno)', (funcao) => {
  const pasta = join(FUNCOES, funcao)
  const codigo = readdirSync(pasta).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  it('acha os arquivos da função', () => {
    expect(codigo).toEqual(expect.arrayContaining(['index.ts', 'logica.ts']))
  })
  it.each(codigo)('%s', (arquivo) => {
    const fonte = readFileSync(join(pasta, arquivo), 'utf8')
    const relativos = [...fonte.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
    expect(relativos.filter((caminho) => !caminho.endsWith('.ts'))).toEqual([])
    expect(relativos.filter((caminho) => caminho.startsWith('../'))).toEqual([])
  })
})
