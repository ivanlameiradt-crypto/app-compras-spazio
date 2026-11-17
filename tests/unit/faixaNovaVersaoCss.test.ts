import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A janela obrigatória "Tem uma versão nova do app." (16/11, no lugar da faixa de 13/11) cobre a tela inteira, fica acima de tudo, tem o botão grande
// (mínimo 60 px, fácil de tocar no celular) e margens que respeitam os recortes do aparelho. Só modo claro, como o resto do app.
const css = readFileSync(join(__dirname, '../../src/styles.css'), 'utf8')
const regra = (seletor: string): string => {
  const inicio = css.indexOf(`\n${seletor} {`)
  if (inicio < 0) throw new Error(`regra ${seletor} não encontrada em styles.css`)
  return css.slice(inicio, css.indexOf('}', inicio))
}

describe('CSS da janela de versão nova', () => {
  it('cobre a tela inteira, acima de tudo, com fundo escuro', () => {
    const r = regra('.aviso-versao')
    expect(r).toMatch(/position: fixed/)
    expect(r).toMatch(/inset: 0/)
    expect(r).toMatch(/z-index: 1000/)
    expect(r).toMatch(/background: rgba\(35, 31, 32/)
  })

  it('respeita os recortes do celular nos quatro lados', () => {
    const r = regra('.aviso-versao')
    for (const lado of ['top', 'right', 'bottom', 'left']) expect(r).toContain(`env(safe-area-inset-${lado})`)
  })

  it('o cartão é centralizado e estreito, e o botão tem pelo menos 60 px de altura', () => {
    expect(regra('.aviso-versao-cartao')).toMatch(/max-width: 384px/)
    expect(regra('.aviso-versao-cartao .botao')).toMatch(/min-height: 60px/)
  })

  it('a faixa discreta de 13/11 saiu do CSS', () => {
    expect(css).not.toContain('.faixa.nova-versao')
  })
})
