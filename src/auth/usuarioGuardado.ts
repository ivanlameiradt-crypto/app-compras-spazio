import type { Usuario } from '../lib/tipos'

/**
 * O último usuário ativo confirmado pelo servidor, guardado no celular: sem internet (e até com o
 * login vencido) o app abre com ele em vez de travar na tela de login. Todo acesso ao localStorage
 * pode falhar (modo privado, sem espaço) — aí o app só segue sem essa memória.
 */
const chave = (email: string) => `usuario:${email.trim().toLowerCase()}`
const chaveTroca = (email: string) => `trocar-senha:${email.trim().toLowerCase()}`
const ULTIMO = 'ultimo-usuario'

/** Disparado no `window` por `sair()`: sem internet o Supabase pode não avisar que a sessão acabou. */
export const EVENTO_SAIU = 'compras:saiu'

/**
 * `trocarSenha` guarda junto se a troca de senha obrigatória (P3) está pendente para essa pessoa —
 * é o que permite manter a tela "Escolha sua senha" mesmo reabrindo o app sem internet (sem sessão
 * pra ler `user_metadata`).
 */
export function guardarUsuario(u: Usuario, opts?: { trocarSenha?: boolean }): void {
  try {
    localStorage.setItem(chave(u.email), JSON.stringify(u))
    localStorage.setItem(ULTIMO, u.email.trim().toLowerCase())
    if (opts && typeof opts.trocarSenha === 'boolean') {
      localStorage.setItem(chaveTroca(u.email), opts.trocarSenha ? '1' : '0')
    }
  } catch { /* segue sem guardar */ }
}

export function trocaSenhaPendente(email: string): boolean {
  try {
    return localStorage.getItem(chaveTroca(email)) === '1'
  } catch {
    return false
  }
}

export function usuarioGuardado(email: string): Usuario | null {
  try {
    const u = JSON.parse(localStorage.getItem(chave(email)) ?? 'null') as Usuario | null
    return u && u.ativo && typeof u.email === 'string' ? u : null
  } catch {
    return null
  }
}

export function ultimoUsuario(): Usuario | null {
  try {
    const email = localStorage.getItem(ULTIMO)
    return email ? usuarioGuardado(email) : null
  } catch {
    return null
  }
}

/** Esquece `email` (ou, sem argumento, o último usuário que entrou neste celular). */
export function esquecerUsuario(email?: string): void {
  try {
    const ultimo = localStorage.getItem(ULTIMO)
    const alvo = email?.trim().toLowerCase() ?? ultimo
    if (alvo) { localStorage.removeItem(chave(alvo)); localStorage.removeItem(chaveTroca(alvo)) }
    if (!email || ultimo === alvo) localStorage.removeItem(ULTIMO)
  } catch { /* nada a fazer */ }
}
