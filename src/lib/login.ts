/**
 * Login com usuário + senha (P1): o funcionário não tem e-mail — o usuário `joao` vira
 * internamente `joao@spazio.invalid` (domínio reservado, nunca recebe e-mail de verdade).
 * Quem digitar um e-mail de verdade (com `@`) entra com ele direto (caso do administrador).
 */
export const DOMINIO_INTERNO = 'spazio.invalid'

/** Senha padrão de toda conta nova/redefinida (P3); o app obriga a trocar no primeiro acesso. */
export const SENHA_PADRAO = '123456'

export function emailDoLogin(texto: string): string {
  const t = texto.trim()
  if (t.includes('@')) return t.toLowerCase()
  const normalizado = t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
  return `${normalizado}@${DOMINIO_INTERNO}`
}

/** O usuário mostrado nas telas: a parte antes do `@` para contas internas, o e-mail inteiro senão. */
export function usuarioDoEmail(email: string): string {
  const [local, dominio] = email.split('@')
  return dominio === DOMINIO_INTERNO ? local : email
}
