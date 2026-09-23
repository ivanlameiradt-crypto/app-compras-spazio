import { DOMINIO_INTERNO, SENHA_PADRAO, emailDoLogin, usuarioDoEmail } from '../../src/lib/login'

describe('emailDoLogin', () => {
  it('usuário sem @ vira e-mail interno normalizado', () => {
    expect(emailDoLogin(' Joana ')).toBe('joana@spazio.invalid')
    expect(emailDoLogin('João')).toBe('joao@spazio.invalid')
    expect(emailDoLogin('paula')).toBe('paula@spazio.invalid')
    expect(emailDoLogin('Ana Paula')).toBe('anapaula@spazio.invalid') // espaço não é [a-z0-9._-]
  })

  it('texto com @ entra como e-mail (minúsculas)', () => {
    expect(emailDoLogin('Fulano@Exemplo.com.br')).toBe('fulano@exemplo.com.br')
    expect(emailDoLogin(' ivan@spazio.com ')).toBe('ivan@spazio.com')
  })

  it('constante do domínio interno', () => {
    expect(DOMINIO_INTERNO).toBe('spazio.invalid')
  })
})

describe('usuarioDoEmail', () => {
  it('conta interna mostra só o usuário', () => {
    expect(usuarioDoEmail('joao@spazio.invalid')).toBe('joao')
  })
  it('e-mail de verdade mostra o e-mail inteiro', () => {
    expect(usuarioDoEmail('ivan@spazio.com')).toBe('ivan@spazio.com')
  })
})

describe('SENHA_PADRAO', () => {
  it('é "123456" (Supabase exige >= 6 caracteres)', () => {
    expect(SENHA_PADRAO).toBe('123456')
    expect(SENHA_PADRAO.length).toBeGreaterThanOrEqual(6)
  })
})
