// Monta um código de barras de teste (44 dígitos) com o dígito verificador calculado à parte da implementação.
export function barras(banco: string, fator: string, centavos: string, livre = '1234567890123456789012345'): string {
  const sem = banco + '9' + fator + centavos.padStart(10, '0') + livre
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  const digs = sem.split('').reverse()
  const soma = digs.reduce((s, c, i) => s + Number(c) * pesos[i % 8], 0)
  let dv = 11 - (soma % 11)
  if (dv === 0 || dv === 10 || dv === 11) dv = 1
  return sem.slice(0, 4) + dv + sem.slice(4)
}
// Converte o código de barras para a linha digitável de 47 dígitos (cada campo leva o seu dígito, módulo 10).
export function linha(b: string): string {
  const mod10 = (c: string) => {
    let s = 0
    let p = 2
    for (let i = c.length - 1; i >= 0; i--) { const x = Number(c[i]) * p; s += x > 9 ? x - 9 : x; p = p === 2 ? 1 : 2 }
    return String((10 - (s % 10)) % 10)
  }
  const c1 = b.slice(0, 4) + b.slice(19, 24)
  const c2 = b.slice(24, 34)
  const c3 = b.slice(34, 44)
  return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + b[4] + b.slice(5, 19)
}
