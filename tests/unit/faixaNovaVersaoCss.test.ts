import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A faixa "Tem uma versão nova do app." (13/11) precisa ter o botão fácil de tocar no celular (mínimo 44 px de altura) e margens que respeitam os recortes do aparelho.
const css = readFileSync(join(__dirname, '../../src/styles.css'), 'utf8')
const regra = (seletor: string): string => {
  const achou = new RegExp(`(?:^|\\n)${seletor.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)
  if (!achou) throw new Error(`regra ${seletor} não encontrada em styles.css`)
  return achou[1]
}

describe('CSS da faixa de versão nova', () => {
  it('o botão "Atualizar" da faixa tem pelo menos 44 px de altura (área de toque confortável)', () => {
    expect(regra('.faixa.nova-versao .link')).toMatch(/min-height:\s*44px/)
  })

  it('a faixa respeita os recortes do celular nas laterais', () => {
    const r = regra('.faixa.nova-versao')
    expect(r).toMatch(/margin-left:\s*max\(20px,\s*env\(safe-area-inset-left\)\)/)
    expect(r).toMatch(/margin-right:\s*max\(20px,\s*env\(safe-area-inset-right\)\)/)
  })
})
