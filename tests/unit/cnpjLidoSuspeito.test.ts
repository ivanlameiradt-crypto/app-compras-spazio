// CNPJ lido errado na foto do cupom (pedido do Ivan, 29/10/2026), a parte das REGRAS do app: `cnpjLidoSuspeito` diz se o CNPJ que a leitura trouxe NÃO fecha as contas dos
// dois dígitos verificadores (a leitura trocou um número) e a tela, então, avisa. A mesma conta mora no servidor (supabase/functions/enviar-cupom/cnpj.ts), que corrige sozinho
// quando acha um só CNPJ conhecido a um dígito: os dois têm de dar sempre a mesma resposta (as duas últimas partes deste arquivo conferem). CNPJs de empresas = dado público.
import { cnpjLidoSuspeito, cnpjValido, formatarCnpj } from '../../src/admin/fornecedorRegras'
import { cnpjValido as cnpjValidoDoServidor, formatarCnpj as formatarCnpjDoServidor } from '../../supabase/functions/enviar-cupom/cnpj'

const REAIS = ['03995515011363', '75315333032655', '05054671003840', '63540861000182'] // MATEUS, ATACADAO, LIDER, A. N. DA SILVA
const ERRADO_DE_22_10 = '63540861000102' // o "8" virou "0"

describe('cnpjLidoSuspeito — o CNPJ lido tem valor e NÃO fecha as contas', () => {
  it('o CNPJ errado de 22/10 é suspeito', () => {
    expect(cnpjLidoSuspeito(ERRADO_DE_22_10)).toBe(true)
  })

  it('CNPJ que fecha as contas não é suspeito, com ou sem pontuação', () => {
    for (const k of REAIS) {
      expect(cnpjLidoSuspeito(k)).toBe(false)
      expect(cnpjLidoSuspeito(formatarCnpj(k))).toBe(false)
    }
  })

  it('o CNPJ errado com pontuação também é suspeito', () => {
    expect(cnpjLidoSuspeito('63.540.861/0001-02')).toBe(true)
  })

  it('sem valor (null, undefined, vazio, só espaços, sem nenhum dígito): não é suspeito — não há o que avisar', () => {
    for (const vazio of [null, undefined, '', '   ', 'sem CNPJ', '--']) expect(cnpjLidoSuspeito(vazio)).toBe(false)
  })

  it('tem valor mas não é um CNPJ (poucos dígitos, dígitos demais, tudo igual): é suspeito', () => {
    for (const estranho of ['123', '6354086100018', '635408610001822', '00000000000000', '11111111111111']) expect(cnpjLidoSuspeito(estranho)).toBe(true)
  })

  it('é exatamente "tem valor e não é um CNPJ válido": concorda com cnpjValido em toda troca de UM dígito dos CNPJs reais', () => {
    for (const k of REAIS) {
      for (let i = 0; i < 14; i++) {
        for (let d = 0; d <= 9; d++) {
          if (String(d) === k[i]) continue
          const lido = k.slice(0, i) + d + k.slice(i + 1)
          expect(cnpjLidoSuspeito(lido)).toBe(!cnpjValido(lido))
        }
      }
    }
  })
})

describe('a conta do servidor (enviar-cupom/cnpj.ts) dá sempre a mesma resposta que a do app', () => {
  /** Muitos números: os reais, todas as trocas de UM dígito deles, formatos com pontuação, tamanhos errados, repetidos, e uma varredura de números "aleatórios" (sempre os mesmos). */
  function amostra(): string[] {
    const lista: string[] = ['', '123', '00000000000000', '11111111111111', '99999999999999', '12345678000195', '12.345.678/0001-95', '12.345.678/0001-90', '6354086100018', '635408610001822']
    for (const k of REAIS) {
      lista.push(k, formatarCnpj(k))
      for (let i = 0; i < 14; i++) for (let d = 0; d <= 9; d++) if (String(d) !== k[i]) lista.push(k.slice(0, i) + d + k.slice(i + 1))
    }
    let semente = 20261029
    const proximo = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente }
    for (let n = 0; n < 3000; n++) lista.push(String(proximo()).padStart(10, '0') + String(proximo()).padStart(10, '0').slice(0, 4))
    return lista
  }

  it('cnpjValido: a mesma resposta em toda a amostra (e a amostra tem válidos e inválidos de verdade)', () => {
    const lista = amostra()
    let validos = 0
    for (const n of lista) {
      expect(cnpjValidoDoServidor(n)).toBe(cnpjValido(n))
      if (cnpjValido(n)) validos++
    }
    expect(lista.length).toBeGreaterThan(3500)
    expect(validos).toBeGreaterThanOrEqual(REAIS.length * 2) // os reais (com e sem pontuação) são válidos
    expect(validos).toBeLessThan(lista.length / 2)
  })

  it('formatarCnpj: o mesmo texto', () => {
    for (const n of [...REAIS, ERRADO_DE_22_10, '123', '', '63.540.861/0001-82', '635408610001822']) expect(formatarCnpjDoServidor(n)).toBe(formatarCnpj(n))
  })
})
