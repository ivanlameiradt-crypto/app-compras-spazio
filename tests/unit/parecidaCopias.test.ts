import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Cada Edge Function é publicada sozinha (o bundler do Supabase não importa de outra pasta), então a procura de compras parecidas (E5) mora em TRÊS cópias do mesmo arquivo.
// Se alguém mexer numa e esquecer as outras, a função que ficou para trás avisaria diferente das demais (ou deixaria passar uma repetida): este teste pega.
const FUNCOES = join(__dirname, '..', '..', 'supabase', 'functions')
const ler = (funcao: string) => readFileSync(join(FUNCOES, funcao, 'parecida.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('parecida.ts: as três cópias são iguais (enviar-cupom é a de referência)', () => {
  const referencia = ler('enviar-cupom')
  it('a referência existe e não está vazia', () => {
    expect(referencia.length).toBeGreaterThan(1000)
    expect(referencia).toContain('export const REPETIDA_PREFIXO')
  })
  it.each(['confirmar-cupom', 'enviar-compra-avulsa'])('%s tem a mesma cópia, byte a byte', (funcao) => {
    expect(ler(funcao)).toBe(referencia)
  })
})
