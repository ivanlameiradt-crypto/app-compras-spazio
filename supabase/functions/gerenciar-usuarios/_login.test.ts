// Garante que a cópia da função (_login.ts, Deno) nunca diverge da original do app (src/lib/login.ts).
import { emailDoLogin as emailDoLoginFuncao, SENHA_PADRAO as SENHA_PADRAO_FUNCAO } from './_login'
import { emailDoLogin as emailDoLoginApp, SENHA_PADRAO as SENHA_PADRAO_APP } from '../../../src/lib/login'

const casos = [' Joana ', 'João', 'paula', 'Fulano@Exemplo.com.br', ' ivan@spazio.com ', 'Ana Paula', '']

describe('_login.ts (função) === lib/login.ts (app)', () => {
  it.each(casos)('emailDoLogin(%j) é igual nas duas cópias', (texto) => {
    expect(emailDoLoginFuncao(texto)).toBe(emailDoLoginApp(texto))
  })

  it('SENHA_PADRAO é igual nas duas cópias', () => {
    expect(SENHA_PADRAO_FUNCAO).toBe(SENHA_PADRAO_APP)
  })
})
