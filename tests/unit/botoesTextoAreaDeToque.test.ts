import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Ajuste de 16/11/2026 (análise do app): dentro de .cupom, os botões em forma de link tinham padding 0 (uns 20 px de altura). Na tela de notas,
// "Remover parcela", "Limpar parcelas" e "Verificar o robô" ficam coladinhos e o dedo erra (e "Limpar parcelas" apaga o que foi digitado).
// Esses três ganham área de toque de pelo menos 48 px.
const css = readFileSync(join(__dirname, '../../src/styles.css'), 'utf8')
const regra = (seletor: string): string => {
  const inicio = css.indexOf(`\n${seletor} {`)
  if (inicio < 0) throw new Error(`regra ${seletor} não encontrada em styles.css`)
  return css.slice(inicio, css.indexOf('}', inicio))
}

describe('CSS: botões de texto da tela de notas com área de toque de 48 px', () => {
  it('"Remover parcela" e "Limpar parcelas" (editor de parcelas)', () => {
    expect(regra('.cupom .editor-parcelas button.link')).toMatch(/min-height: 48px/)
  })

  it('"Verificar o robô"', () => {
    expect(regra('.cupom .verificar-robo button.link')).toMatch(/min-height: 48px/)
  })
})
