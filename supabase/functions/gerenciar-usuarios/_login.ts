// Cópia de src/lib/login.ts: a Edge Function (Deno) não pode importar de src/ (bundle do app) nem
// o app pode importar daqui (código Deno). Testado junto para garantir que as duas nunca divirjam
// (ver logica.test.ts).
export const DOMINIO_INTERNO = 'spazio.invalid'
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
