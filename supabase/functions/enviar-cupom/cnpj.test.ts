import {
  cnpjValido, conferirCnpjLido, formatarCnpj, fraseCnpjCorrigido, fraseCnpjInvalido, juntarConhecidos, nomesCompativeis, type CnpjConhecido,
} from './cnpj'

// Pedido do Ivan (29/10/2026): a leitura da foto às vezes troca UM número do CNPJ (22/10: "8" virou "0" no CNPJ da A. N. da Silva) e o cupom para em
// "fornecedor não encontrado". O CNPJ tem 2 dígitos verificadores, então um número que NÃO fecha as contas está errado; se existe UM só CNPJ já conhecido
// (e válido) a UM dígito de distância, com nome compatível, é o mesmo fornecedor. CNPJ válido nunca é tocado. CNPJs de empresas = dado público.
const MATEUS: CnpjConhecido = { cnpj: '03995515011363', nome: 'MATEUS SUPERMERCADOS SA' }
const ATACADAO: CnpjConhecido = { cnpj: '75315333032655', nome: 'ATACADAO S.A.' }
const LIDER: CnpjConhecido = { cnpj: '05054671003840', nome: 'LIDER COMERCIO E INDUSTRIA LTDA' }
const SILVA: CnpjConhecido = { cnpj: '63540861000182', nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' }
const CONHECIDOS = [MATEUS, ATACADAO, LIDER, SILVA]
/** O caso real de 22/10: o "8" do penúltimo grupo virou "0". */
const SILVA_LIDO_ERRADO = '63540861000102'
const NOME_SILVA_LISTA = 'A. N. DA SILVA DESCARTAVEIS LTDA'

/** Todas as 126 trocas de UM dígito (14 posições × 9 outros dígitos) de um CNPJ. */
function trocasDeUmDigito(cnpj: string): string[] {
  const saida: string[] = []
  for (let i = 0; i < cnpj.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) !== cnpj[i]) saida.push(cnpj.slice(0, i) + d + cnpj.slice(i + 1))
    }
  }
  return saida
}

describe('cnpjValido — as contas dos 2 dígitos verificadores', () => {
  it('os CNPJs reais conhecidos fecham as contas', () => {
    for (const k of CONHECIDOS) expect(cnpjValido(k.cnpj)).toBe(true)
    expect(cnpjValido('12345678000195')).toBe(true) // o CNPJ de exemplo mais usado
  })

  it('o CNPJ lido errado em 22/10 NÃO fecha', () => {
    expect(cnpjValido(SILVA_LIDO_ERRADO)).toBe(false)
  })

  it('não tem 14 dígitos ou tem todos iguais: não vale', () => {
    expect(cnpjValido('')).toBe(false)
    expect(cnpjValido('6354086100018')).toBe(false)    // 13
    expect(cnpjValido('635408610001822')).toBe(false)  // 15
    expect(cnpjValido('00000000000000')).toBe(false)
    expect(cnpjValido('11111111111111')).toBe(false)
  })

  it('aceita a pontuação (só olha os dígitos), como a conta do app em src/admin/fornecedorRegras.ts', () => {
    expect(cnpjValido('63.540.861/0001-82')).toBe(true)
    expect(cnpjValido('63.540.861/0001-02')).toBe(false)
  })
})

describe('formatarCnpj', () => {
  it('14 dígitos viram 00.000.000/0000-00; o que não tem 14 dígitos fica como veio', () => {
    expect(formatarCnpj('63540861000182')).toBe('63.540.861/0001-82')
    expect(formatarCnpj('63.540.861/0001-02')).toBe('63.540.861/0001-02')
    expect(formatarCnpj('123')).toBe('123')
  })
})

describe('nomesCompativeis — o nome lido e o conhecido repartem ao menos uma palavra que identifica a empresa', () => {
  it('faltou um dos nomes (ou os dois): vale', () => {
    for (const vazio of [null, undefined, '', '   ', '---']) {
      expect(nomesCompativeis(vazio, 'ATACADAO S.A.')).toBe(true)
      expect(nomesCompativeis('ATACADAO', vazio)).toBe(true)
    }
    expect(nomesCompativeis(null, null)).toBe(true)
  })

  it('o mesmo nome com ou sem o final da razão social (LTDA) e com pontuação diferente', () => {
    expect(nomesCompativeis('A. N. DA SILVA DESCARTAVEIS', 'A. N. DA SILVA DESCARTAVEIS LTDA')).toBe(true)
    expect(nomesCompativeis('MATEUS SUPERMERCADOS SA - MIX ABAETETUBA', 'MATEUS SUPERMERCADOS SA')).toBe(true)
  })

  it('sem acento e sem diferença de maiúscula: ATACADÃO é ATACADAO', () => {
    expect(nomesCompativeis('Atacadão', 'ATACADAO S.A.')).toBe(true)
    expect(nomesCompativeis('LÍDER', 'lider comercio e industria ltda')).toBe(true)
  })

  it('nomes sem nada em comum não são compatíveis', () => {
    expect(nomesCompativeis('MATEUS SUPERMERCADOS SA', 'ATACADAO S.A.')).toBe(false)
    expect(nomesCompativeis('LIDER COMERCIO E INDUSTRIA LTDA', 'A. N. DA SILVA DESCARTAVEIS LTDA')).toBe(false)
  })

  it('palavras genéricas de nome de empresa (LTDA, COMERCIO, INDUSTRIA, SUPERMERCADO…) não bastam', () => {
    expect(nomesCompativeis('FULANO COMERCIO LTDA', 'BELTRANO COMERCIO LTDA')).toBe(false)
    expect(nomesCompativeis('FULANO INDUSTRIA E COMERCIO EIRELI', 'BELTRANO INDUSTRIA E COMERCIO EIRELI')).toBe(false)
    expect(nomesCompativeis('FULANO SUPERMERCADO EPP', 'BELTRANO SUPERMERCADOS EPP')).toBe(false)
    expect(nomesCompativeis('FULANO DISTRIBUIDORA SA', 'BELTRANO DISTRIBUIDORA SA')).toBe(false)
  })

  it('palavras curtas (menos de 4 letras) não bastam: "DA", "SA", "A. N."', () => {
    expect(nomesCompativeis('A. N. DA SILVA', 'A. N. DA COSTA')).toBe(false)
    expect(nomesCompativeis('JOSE DA SA', 'MARIO DA SA')).toBe(false)
  })

  it('os dois nomes existem mas nenhum tem palavra que identifique (só LTDA e siglas): não vale', () => {
    expect(nomesCompativeis('LTDA', 'SA')).toBe(false)
    expect(nomesCompativeis('J S', 'J S')).toBe(false)
  })

  it('uma palavra em comum basta, mesmo com muitas diferentes', () => {
    expect(nomesCompativeis('MERCADO CENTRAL DE ABAETETUBA', 'CENTRAL DISTRIBUIDORA DE BEBIDAS')).toBe(true)
  })
})

describe('conferirCnpjLido — CNPJ que fecha as contas ou ausente: nada a fazer', () => {
  it('CNPJ válido NUNCA é tocado, mesmo com outro CNPJ conhecido a um dígito de distância', () => {
    // 12345678001400 e 12345678901400 são dois CNPJs válidos que diferem em UM dígito (raro, mas existe): o lido é válido, então fica como veio
    expect(cnpjValido('12345678001400') && cnpjValido('12345678901400')).toBe(true)
    expect(conferirCnpjLido('12345678901400', 'EMPRESA EXEMPLO', [{ cnpj: '12345678001400', nome: 'EMPRESA EXEMPLO LTDA' }])).toEqual({ tipo: 'ok' })
    expect(conferirCnpjLido(SILVA.cnpj, SILVA.nome, CONHECIDOS)).toEqual({ tipo: 'ok' })
  })

  it('CNPJ válido com a lista de conhecidos vazia continua ok', () => {
    expect(conferirCnpjLido(MATEUS.cnpj, null, [])).toEqual({ tipo: 'ok' })
  })

  it('sem CNPJ lido (null, undefined, vazio, sem dígitos): ok, nada a conferir', () => {
    for (const vazio of [null, undefined, '', '   ', 'sem CNPJ']) expect(conferirCnpjLido(vazio, 'ATACADAO', CONHECIDOS)).toEqual({ tipo: 'ok' })
  })
})

describe('conferirCnpjLido — CNPJ que NÃO fecha as contas', () => {
  it('o caso real de 22/10: 63540861000102 volta a ser o da A. N. da Silva (63540861000182)', () => {
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, 'A. N. DA SILVA DESCARTAVEIS', CONHECIDOS)).toEqual({
      tipo: 'corrigido', cnpj: '63540861000182', original: '63540861000102', nome: 'A. N. DA SILVA DESCARTAVEIS LTDA',
    })
  })

  it('o CNPJ lido com pontuação também corrige; o "original" volta só com os 14 dígitos', () => {
    expect(conferirCnpjLido('63.540.861/0001-02', 'A. N. DA SILVA DESCARTAVEIS', CONHECIDOS)).toEqual({
      tipo: 'corrigido', cnpj: '63540861000182', original: '63540861000102', nome: 'A. N. DA SILVA DESCARTAVEIS LTDA',
    })
  })

  it('o mesmo CNPJ conhecido por várias fontes (mesmo ou outro nome) conta UMA vez e corrige', () => {
    const repetido: CnpjConhecido[] = [
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS' },
      { cnpj: SILVA.cnpj, nome: null },
      SILVA,
      MATEUS,
    ]
    const r = conferirCnpjLido(SILVA_LIDO_ERRADO, 'A. N. DA SILVA DESCARTAVEIS', repetido)
    expect(r).toEqual({ tipo: 'corrigido', cnpj: SILVA.cnpj, original: SILVA_LIDO_ERRADO, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' })
  })

  it('o nome devolvido é o primeiro conhecido que tem nome (a ordem da lista manda); sem nenhum nome, null', () => {
    const r1 = conferirCnpjLido(SILVA_LIDO_ERRADO, null, [{ cnpj: SILVA.cnpj, nome: null }, { cnpj: SILVA.cnpj, nome: '  A. N. DA   SILVA  ' }, { cnpj: SILVA.cnpj, nome: 'OUTRO' }])
    expect(r1).toEqual({ tipo: 'corrigido', cnpj: SILVA.cnpj, original: SILVA_LIDO_ERRADO, nome: 'A. N. DA SILVA' })
    const r2 = conferirCnpjLido(SILVA_LIDO_ERRADO, null, [{ cnpj: SILVA.cnpj, nome: null }, { cnpj: SILVA.cnpj, nome: '   ' }])
    expect(r2).toEqual({ tipo: 'corrigido', cnpj: SILVA.cnpj, original: SILVA_LIDO_ERRADO, nome: null })
  })

  it('DOIS candidatos distintos a um dígito: não corrige (ambíguo) — o aviso é de CNPJ inválido', () => {
    // K1 e K2 são válidos e diferem em 2 dígitos (posições 1 e 5); o lido tem o dígito 1 do K2 e o resto do K1: está a UM dígito dos dois
    const K1 = '12345678000195'
    const K2 = '02348678000195'
    const lido = '02345678000195'
    expect([cnpjValido(K1), cnpjValido(K2), cnpjValido(lido)]).toEqual([true, true, false])
    expect(conferirCnpjLido(lido, null, [{ cnpj: K1, nome: 'EMPRESA UM' }, { cnpj: K2, nome: 'EMPRESA DOIS' }])).toEqual({ tipo: 'invalido' })
    // com UM deles só, corrige (prova que a ambiguidade é o que impediu)
    expect(conferirCnpjLido(lido, null, [{ cnpj: K1, nome: 'EMPRESA UM' }])).toMatchObject({ tipo: 'corrigido', cnpj: K1 })
  })

  it('dois candidatos distintos no MESMO dígito (dois CNPJs válidos que diferem em 1 dígito): também ambíguo', () => {
    const lido = '12345678101400' // o 9º dígito não é nem 0 nem 9
    expect(cnpjValido(lido)).toBe(false)
    const dois: CnpjConhecido[] = [{ cnpj: '12345678001400', nome: null }, { cnpj: '12345678901400', nome: null }]
    expect(conferirCnpjLido(lido, null, dois)).toEqual({ tipo: 'invalido' })
  })

  it('nenhum candidato: lista vazia, ou conhecidos a 2 ou mais dígitos de distância', () => {
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, 'A. N. DA SILVA DESCARTAVEIS', [])).toEqual({ tipo: 'invalido' })
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, null, [MATEUS, ATACADAO, LIDER])).toEqual({ tipo: 'invalido' })
    // 2 dígitos trocados (o "8" virou "0" E o "6" virou "5"): fora do alcance, de propósito
    expect(conferirCnpjLido('53540861000102', null, CONHECIDOS)).toEqual({ tipo: 'invalido' })
    expect(conferirCnpjLido('63540861000100', null, CONHECIDOS)).toEqual({ tipo: 'invalido' })
  })

  it('dois dígitos TROCADOS DE LUGAR (transposição) é distância 2: não corrige', () => {
    // 63540861000182 com o 12º e o 13º dígitos trocados de lugar ("18" vira "81") = 63540861000812
    const virado = SILVA.cnpj.slice(0, 11) + SILVA.cnpj[12] + SILVA.cnpj[11] + SILVA.cnpj[13]
    expect(virado).toBe('63540861000812')
    expect(cnpjValido(virado)).toBe(false)
    expect(conferirCnpjLido(virado, null, CONHECIDOS)).toEqual({ tipo: 'invalido' })
  })

  it('o conhecido a um dígito que NÃO fecha as contas não é candidato', () => {
    // 63540861000103 não fecha; o lido 63540861000102 está a UM dígito dele, mas ele não conta
    expect(cnpjValido('63540861000103')).toBe(false)
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, null, [{ cnpj: '63540861000103', nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' }])).toEqual({ tipo: 'invalido' })
    // e o inválido não atrapalha o válido: com os dois na lista, o válido é o único candidato
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, null, [{ cnpj: '63540861000103', nome: null }, SILVA])).toMatchObject({ tipo: 'corrigido', cnpj: SILVA.cnpj })
  })

  it('conhecido com lixo (não tem 14 dígitos) é ignorado, sem estourar', () => {
    const lixo: CnpjConhecido[] = [{ cnpj: '', nome: null }, { cnpj: '6354086100018', nome: 'X' }, { cnpj: '635408610001822', nome: 'X' }, { cnpj: 'abc', nome: null }]
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, null, lixo)).toEqual({ tipo: 'invalido' })
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, null, [...lixo, SILVA])).toMatchObject({ tipo: 'corrigido', cnpj: SILVA.cnpj })
  })

  it('CNPJ lido com o tamanho errado (não são 14 dígitos): inválido, nada é inventado', () => {
    expect(conferirCnpjLido('6354086100010', null, CONHECIDOS)).toEqual({ tipo: 'invalido' })
    expect(conferirCnpjLido('635408610001022', null, CONHECIDOS)).toEqual({ tipo: 'invalido' })
  })
})

describe('conferirCnpjLido — o nome lido tem de combinar com o do CNPJ conhecido', () => {
  it('nome incompatível: não corrige, mesmo sendo o único a um dígito', () => {
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, 'PADARIA PAO QUENTE', CONHECIDOS)).toEqual({ tipo: 'invalido' })
  })

  it('nome ausente no cupom lido: vale (corrige só pelo número)', () => {
    for (const vazio of [null, undefined, '', '  ']) {
      expect(conferirCnpjLido(SILVA_LIDO_ERRADO, vazio, CONHECIDOS)).toMatchObject({ tipo: 'corrigido', cnpj: SILVA.cnpj })
    }
  })

  it('nome ausente no conhecido: vale', () => {
    expect(conferirCnpjLido(SILVA_LIDO_ERRADO, 'PADARIA PAO QUENTE', [{ cnpj: SILVA.cnpj, nome: null }]))
      .toEqual({ tipo: 'corrigido', cnpj: SILVA.cnpj, original: SILVA_LIDO_ERRADO, nome: null })
  })

  it('o conhecido aparece com dois nomes e um deles combina: o CNPJ é candidato (e o nome mostrado é o que combina, não o da frente)', () => {
    const r = conferirCnpjLido(SILVA_LIDO_ERRADO, 'A. N. DA SILVA DESCARTAVEIS', [
      { cnpj: SILVA.cnpj, nome: 'NOME ESTRANHO QUALQUER' },
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
    ])
    expect(r).toEqual({ tipo: 'corrigido', cnpj: SILVA.cnpj, original: SILVA_LIDO_ERRADO, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' })
  })

  it('o nome desempata: dois CNPJs a um dígito, mas só um combina com o nome lido ⇒ corrige para esse', () => {
    const K1 = '12345678000195'
    const K2 = '02348678000195'
    const lido = '02345678000195'
    const conhecidos = [{ cnpj: K1, nome: 'PADARIA PAO QUENTE LTDA' }, { cnpj: K2, nome: 'METALURGICA ACO FORTE LTDA' }]
    expect(conferirCnpjLido(lido, 'PADARIA PAO QUENTE', conhecidos)).toMatchObject({ tipo: 'corrigido', cnpj: K1 })
    expect(conferirCnpjLido(lido, 'METALURGICA ACO FORTE', conhecidos)).toMatchObject({ tipo: 'corrigido', cnpj: K2 })
  })
})

describe('conferirCnpjLido — varredura: TODA troca de um dígito dos CNPJs reais', () => {
  // As 126 trocas de cada um dos 4 CNPJs reais. Quem deixa de fechar as contas volta ao CNPJ certo (o único conhecido a um dígito);
  // quem continua fechando (raro: ~3,5 em 10 mil) é CNPJ válido e fica como veio — esse é o limite da conferência pelos dígitos.
  it.each(CONHECIDOS.map((k) => [k.nome, k.cnpj] as const))('%s: cada troca de um dígito que quebra as contas é corrigida de volta', (_nome, certo) => {
    let quebradas = 0
    for (const errado of trocasDeUmDigito(certo)) {
      const r = conferirCnpjLido(errado, null, CONHECIDOS)
      if (cnpjValido(errado)) {
        expect(r).toEqual({ tipo: 'ok' })
      } else {
        quebradas++
        expect(r).toEqual({ tipo: 'corrigido', cnpj: certo, original: errado, nome: CONHECIDOS.find((k) => k.cnpj === certo)!.nome })
      }
    }
    expect(quebradas).toBeGreaterThan(120) // das 126 trocas, praticamente todas quebram as contas
  })
})

describe('juntarConhecidos — a lista que o index.ts entrega: só CNPJ que fecha as contas, sem repetir', () => {
  it('tira a pontuação e fica com os 14 dígitos; descarta o que não fecha as contas, não tem 14 dígitos ou está vazio', () => {
    const entrada: CnpjConhecido[] = [
      { cnpj: '63.540.861/0001-82', nome: NOME_SILVA_LISTA },
      { cnpj: SILVA_LIDO_ERRADO, nome: 'NÃO FECHA AS CONTAS' },
      { cnpj: '6354086100018', nome: '13 DÍGITOS' },
      { cnpj: '635408610001822', nome: '15 DÍGITOS' },
      { cnpj: '', nome: 'VAZIO' },
      { cnpj: '00000000000000', nome: 'TUDO ZERO' },
      { cnpj: 'sem número', nome: null },
    ]
    expect(juntarConhecidos(entrada)).toEqual([{ cnpj: '63540861000182', nome: NOME_SILVA_LISTA }])
  })

  it('não repete o mesmo CNPJ com o mesmo nome (várias fontes), mas guarda os nomes diferentes do mesmo CNPJ, na ordem em que vieram', () => {
    const entrada: CnpjConhecido[] = [
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
      { cnpj: '63.540.861/0001-82', nome: '  A. N. DA   SILVA DESCARTAVEIS LTDA ' }, // o mesmo nome com espaço sobrando
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA' },
      { cnpj: MATEUS.cnpj, nome: MATEUS.nome },
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
    ]
    expect(juntarConhecidos(entrada)).toEqual([
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' },
      { cnpj: SILVA.cnpj, nome: 'A. N. DA SILVA' },
      { cnpj: MATEUS.cnpj, nome: MATEUS.nome },
    ])
  })

  it('nome vazio, em branco ou ausente vira null (e o mesmo CNPJ sem nome conta uma vez só)', () => {
    const entrada = [
      { cnpj: MATEUS.cnpj, nome: null }, { cnpj: MATEUS.cnpj, nome: '' }, { cnpj: MATEUS.cnpj, nome: '   ' },
      { cnpj: MATEUS.cnpj } as unknown as CnpjConhecido,
    ]
    expect(juntarConhecidos(entrada)).toEqual([{ cnpj: MATEUS.cnpj, nome: null }])
  })

  it('lista vazia dá lista vazia', () => {
    expect(juntarConhecidos([])).toEqual([])
  })
})

describe('frases que o Ivan lê (resumo do envio)', () => {
  it('corrigido, com nome: o que era, o que ficou e de quem é', () => {
    expect(fraseCnpjCorrigido({ tipo: 'corrigido', cnpj: '63540861000182', original: '63540861000102', nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' }))
      .toBe('corrigi o CNPJ lido na foto: era 63.540.861/0001-02, agora 63.540.861/0001-82, o da A. N. DA SILVA DESCARTAVEIS LTDA')
  })

  it('corrigido, sem nome: não inventa "o da …"', () => {
    expect(fraseCnpjCorrigido({ tipo: 'corrigido', cnpj: '63540861000182', original: '63540861000102', nome: null }))
      .toBe('corrigi o CNPJ lido na foto: era 63.540.861/0001-02, agora 63.540.861/0001-82')
  })

  it('inválido: diz qual número e manda conferir na foto', () => {
    expect(fraseCnpjInvalido('63540861000102'))
      .toBe('o CNPJ lido na foto (63.540.861/0001-02) não fecha as contas dos números: confira na foto')
  })

  it('nenhuma das frases termina em ponto: a tela de envio acrescenta o ponto e o resto da frase ("S.A." do nome perde o último ponto)', () => {
    const frase = fraseCnpjCorrigido({ tipo: 'corrigido', cnpj: '75315333032655', original: '75315333032605', nome: 'ATACADAO S.A.' })
    expect(frase).toBe('corrigi o CNPJ lido na foto: era 75.315.333/0326-05, agora 75.315.333/0326-55, o da ATACADAO S.A')
    expect(frase).not.toMatch(/\.$/)
    expect(fraseCnpjInvalido('63540861000102')).not.toMatch(/\.$/)
  })
})
