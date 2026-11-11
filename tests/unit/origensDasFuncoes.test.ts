import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Cada função do Supabase confere de onde vem o pedido (CORS). Quando o Comprar ganhou o endereço próprio (10/11/2026), o novo endereço
// precisou entrar em TODAS as listas, mantendo o antigo (github.io) e o local. Esquecer uma lista deixa a função barrando o app no endereço novo.
const PASTA = join(__dirname, '..', '..', 'supabase', 'functions')
const ANTIGO = 'https://ivanlameiradt-crypto.github.io'
const NOVO = 'https://comprar.spazioburgerpizza.cloud'

const comLista = readdirSync(PASTA, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PASTA, d.name, 'index.ts')))
  .map((d) => ({ nome: d.name, codigo: readFileSync(join(PASTA, d.name, 'index.ts'), 'utf-8') }))
  .filter((f) => f.codigo.includes('ORIGENS_PERMITIDAS'))

describe('origens permitidas das funções', () => {
  it('há funções com lista de origens (o teste não pode passar vazio)', () => {
    expect(comLista.length).toBeGreaterThanOrEqual(9)
  })
  it.each(comLista.map((f) => [f.nome, f.codigo]))('%s aceita o endereço próprio E o antigo', (_nome, codigo) => {
    expect(codigo).toContain(`'${NOVO}'`)
    expect(codigo).toContain(`'${ANTIGO}'`)
  })
  it.each(comLista.map((f) => [f.nome, f.codigo]))('%s aceita o endereço local de teste', (_nome, codigo) => {
    expect(codigo).toContain("'http://localhost:5173'")
  })
})
