// supabase/functions/confirmar-cupom/logica.test.ts
// A lógica pura da confirmar-cupom com deps falsos (molde: enviar-cupom/logica.test.ts). O caso de referência é o cupom real do ATACADAO de
// 06/10 (R$ 35,27): LIMAO TAITI já aprendido, LIMAO SICILIANO e PEPINO JAPONES sem produto — o pedido do Ivan de corrigir isso dentro do app.
// Além do contrato HTTP (status e textos), prova-se que o item refeito é o que o ROBÔ aceita: validar_cupom (cupom_contrato.py) e a soma de
// cupom_valores.py estão reproduzidos em JS aqui embaixo — se a conta daqui divergir da de lá, o cupom voltaria a REVISAR depois do disparo.
import {
  TOLERANCIA, conferirSoma, ehGtin, lerConfirmacoes, linhaDeAprendizado, refazerItem, tratar, unidadeNorm,
  type Confirmacao, type CupomLinha, type Deps, type LinhaAprendizado, type Produto,
} from './logica'
import { normalizar } from './normalizar'

type Item = Record<string, unknown>

const CUPOM_ID = 'aaf54e6f-0b1c-4d2e-9f3a-4b5c6d7e8f90'
const IVAN = 'ivan@spazio.com'
const CNPJ_ATACADAO = '75315333000109'
const EAN = '7891234567895'

/** O cupom do ATACADAO de 06/10 como o enviar-cupom o gravou: 2 itens sem produto (só com a proposta do sistema) e o LIMAO TAITI já aprendido. */
const ITENS_ATACADAO: Item[] = [
  { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
    codigo_barras: null, casado_por: null, proposta: { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS' }, quantidade_cupom: 0.5 },
  { descricao_cupom: 'PEPINO JAPONES', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
    codigo_barras: null, casado_por: null, proposta: { insumo_id: '3484991', insumo_nome: 'PEPINO JAPONÊS - INSUMOS' }, quantidade_cupom: 0.912 },
  { descricao_cupom: 'LIMAO TAITI TROPICAL', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884,
    sugestao_produto: { id: '3469643' }, codigo_barras: null, casado_por: 'descricao', proposta: null, quantidade_cupom: 2.884 },
]
/** A lista de insumos do app (itens_semana), só o que os testes usam. */
const PRODUTOS: Record<string, Produto> = {
  '3484974': { id: '3484974', nome: 'LIMÃO SICILIANO - INSUMOS', unidade: 'KG' },
  '3484991': { id: '3484991', nome: 'PEPINO JAPONÊS - INSUMOS', unidade: 'KG' },
  '3469643': { id: '3469643', nome: 'LIMÃO - INSUMOS', unidade: 'KG' },
  '3487562': { id: '3487562', nome: 'OVO - INSUMOS', unidade: 'KG' },
}
/** O que o app manda para o cupom do ATACADAO: os pesos lidos na foto, lembrando os dois. */
const CONFIRMACOES = [
  { indice: 0, insumo_id: '3484974', quantidade: 0.5, lembrar: true },
  { indice: 1, insumo_id: '3484991', quantidade: 0.912, lembrar: true },
]

function cupom(over: Partial<CupomLinha> = {}): CupomLinha {
  return {
    id: CUPOM_ID, estado: 'REVISAR', pedido_sischef: null, motivo: '2 item(ns) sem casamento confirmado — confira no Code',
    itens: structuredClone(ITENS_ATACADAO), valor_a_pagar: 35.27, emitente_cnpj: CNPJ_ATACADAO, teste: false, ...over,
  }
}
const pedido = (itens: unknown = CONFIRMACOES, cupomId: unknown = CUPOM_ID) => ({ cupom_id: cupomId, itens })

interface Registro {
  atualizacoes: { id: string; itens: Item[] }[]
  aprendizados: LinhaAprendizado[]
  disparos: string[]
  /** a ordem em que o banco e o GitHub foram chamados (a correção tem de estar gravada antes do aprendizado e do disparo) */
  ordem: string[]
}
/** Deps falsos: admin ativo, o cupom do ATACADAO, a lista de insumos acima; tudo o que é gravado fica registrado. */
function fakeDeps(o: Partial<Deps> & { cupom?: CupomLinha | null } = {}): Deps & Registro {
  const { cupom: linha = cupom(), ...sobre } = o
  const registro: Registro = { atualizacoes: [], aprendizados: [], disparos: [], ordem: [] }
  const base: Deps = {
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async lerCupom() { return linha },
    async buscarProduto(id) { return PRODUTOS[id] ?? null },
    async atualizarCupom(id, itens) { registro.ordem.push('atualizar'); registro.atualizacoes.push({ id, itens }); return true },
    async gravarAprendizado(l) { registro.ordem.push('aprender'); registro.aprendizados.push(l) },
    async dispararLancamento(id) { registro.ordem.push('disparar'); registro.disparos.push(id) },
  }
  return Object.assign(base, sobre, registro)
}
function nadaGravado(deps: Registro) {
  expect(deps.atualizacoes).toHaveLength(0)
  expect(deps.aprendizados).toHaveLength(0)
  expect(deps.disparos).toHaveLength(0)
}

// ---- As regras do robô em JS. validar_cupom (cupom_contrato.py) exige sugestao_produto.id não vazio e entrada_estoque > 0; linha_valor e
// conferir_total (cupom_valores.py) arredondam CADA linha a 2 casas, somam, arredondam e aceitam |soma − total| ≤ 0,02. O Python arredonda
// "metade para o par" e o JS "metade para cima", mas sobre o valor binário exato isso quase nunca difere — e nunca nos valores destes testes.
const round2 = (v: number) => Math.round(v * 100) / 100
function validarCupomComoORobo(itens: Item[]): string[] {
  const problemas: string[] = []
  itens.forEach((it, i) => {
    if (String((it.sugestao_produto as { id?: unknown } | null)?.id ?? '').trim() === '') problemas.push(`item ${i + 1} sem produto associado`)
    const entrada = parseFloat(String(it.entrada_estoque ?? 0).replace(',', '.'))
    if (!(entrada > 0)) problemas.push(`item ${i + 1} sem quantidade`)
  })
  return problemas
}
const linhaValorComoORobo = (it: Item) => round2(Number(it.entrada_estoque ?? 0) * Number(it.valor_unitario ?? 0) - Number(it.desconto_item ?? 0))
function conferirTotalComoORobo(itens: Item[], total: number, tol = 0.02): string {
  const soma = round2(itens.reduce((acc, it) => acc + linhaValorComoORobo(it), 0))
  const t = round2(total)
  return round2(Math.abs(soma - t)) <= tol ? '' : `soma dos itens (${soma.toFixed(2)}) difere do total (${t.toFixed(2)})`
}

describe('as regras do robô reproduzidas aqui batem com o que o Python faria no cupom do ATACADAO', () => {
  it('o item sem produto e sem entrada é recusado; o LIMAO TAITI já aprendido passa', () => {
    expect(validarCupomComoORobo(ITENS_ATACADAO))
      .toEqual(['item 1 sem produto associado', 'item 1 sem quantidade', 'item 2 sem produto associado', 'item 2 sem quantidade'])
    expect(validarCupomComoORobo([ITENS_ATACADAO[2]])).toEqual([])
  })
  it('2,884 × 9,90 − 5,51 = R$ 23,04 (a linha arredondada como o robô digita)', () => {
    expect(linhaValorComoORobo(ITENS_ATACADAO[2])).toBe(23.04)
  })
})

describe('unidadeNorm — UN, UND, UNID, PC e PÇ são a mesma unidade para a conversão', () => {
  it('as grafias de unidade viram "un"; o resto só perde espaços e maiúsculas', () => {
    for (const u of ['UN', 'un', 'UND', 'Unid', 'unidade', 'PC', 'pç', ' UN ']) expect(unidadeNorm(u)).toBe('un')
    expect(unidadeNorm(' KG ')).toBe('kg')
    expect(unidadeNorm('Cx')).toBe('cx')
    expect(unidadeNorm(null)).toBe('')
    expect(unidadeNorm(undefined)).toBe('')
  })
})

const ERRO_ENTRADA = 'item 1: quantidade do estoque inválida (precisa ser maior que zero)'

describe('lerConfirmacoes — o corpo do app vira uma lista limpa, ou um texto de erro', () => {
  it('aceita a lista do ATACADAO; entrada ausente vira null e lembrar só é true quando é exatamente true', () => {
    const r = lerConfirmacoes([{ ...CONFIRMACOES[0] }, { ...CONFIRMACOES[1], lembrar: 'true' }])
    expect(r).toEqual({ ok: true, itens: [
      { indice: 0, insumo_id: '3484974', quantidade: 0.5, entrada: null, lembrar: true },
      { indice: 1, insumo_id: '3484991', quantidade: 0.912, entrada: null, lembrar: false },
    ] })
  })
  it('o código do produto é aparado e aceito como número (o app pode mandar produto_id numérico); a entrada informada é guardada', () => {
    const r = lerConfirmacoes([{ indice: 0, insumo_id: 3487562, quantidade: 5, entrada: 0.4, lembrar: true }])
    expect(r).toEqual({ ok: true, itens: [{ indice: 0, insumo_id: '3487562', quantidade: 5, entrada: 0.4, lembrar: true }] })
    expect(lerConfirmacoes([{ indice: 0, insumo_id: ' 3487562 ', quantidade: 5, lembrar: false }])).toMatchObject({ ok: true })
  })
  it.each([
    ['lista vazia', [], 'nenhum item confirmado'],
    ['não é lista', { indice: 0 }, 'nenhum item confirmado'],
    ['item que não é objeto', ['x'], 'item em formato inválido'],
    ['item null', [null], 'item em formato inválido'],
    ['sem posição', [{ insumo_id: '3484974', quantidade: 1 }], 'item sem posição válida'],
    ['posição negativa', [{ indice: -1, insumo_id: '3484974', quantidade: 1 }], 'item sem posição válida'],
    ['posição fracionária', [{ indice: 0.5, insumo_id: '3484974', quantidade: 1 }], 'item sem posição válida'],
    ['posição em texto', [{ indice: '0', insumo_id: '3484974', quantidade: 1 }], 'item sem posição válida'],
    ['mesma posição duas vezes', [{ indice: 0, insumo_id: '3484974', quantidade: 1 }, { indice: 0, insumo_id: '3484991', quantidade: 1 }],
      'item 1 confirmado duas vezes'],
    ['código com letras', [{ indice: 0, insumo_id: '34a974', quantidade: 1 }], 'item 1: código do produto inválido'],
    ['código vazio', [{ indice: 0, insumo_id: '', quantidade: 1 }], 'item 1: código do produto inválido'],
    ['código ausente', [{ indice: 0, quantidade: 1 }], 'item 1: código do produto inválido'],
    ['código com 13 dígitos', [{ indice: 0, insumo_id: '1234567890123', quantidade: 1 }], 'item 1: código do produto inválido'],
    ['quantidade zero', [{ indice: 1, insumo_id: '3484974', quantidade: 0 }], 'item 2: quantidade inválida (precisa ser maior que zero)'],
    ['quantidade negativa', [{ indice: 0, insumo_id: '3484974', quantidade: -0.5 }], 'item 1: quantidade inválida (precisa ser maior que zero)'],
    ['quantidade em texto', [{ indice: 0, insumo_id: '3484974', quantidade: '0,5' }], 'item 1: quantidade inválida (precisa ser maior que zero)'],
    ['quantidade ausente', [{ indice: 0, insumo_id: '3484974' }], 'item 1: quantidade inválida (precisa ser maior que zero)'],
    ['quantidade infinita', [{ indice: 0, insumo_id: '3484974', quantidade: Infinity }], 'item 1: quantidade inválida (precisa ser maior que zero)'],
    ['entrada zero', [{ indice: 0, insumo_id: '3484974', quantidade: 1, entrada: 0 }], ERRO_ENTRADA],
    ['entrada negativa', [{ indice: 0, insumo_id: '3484974', quantidade: 1, entrada: -1 }], ERRO_ENTRADA],
    ['entrada em texto', [{ indice: 0, insumo_id: '3484974', quantidade: 1, entrada: '0,4' }], ERRO_ENTRADA],
  ])('recusa: %s', (_nome, corpo, erro) => {
    expect(lerConfirmacoes(corpo)).toEqual({ ok: false, erro })
  })
})

describe('refazerItem — o item com produto, entrada e preço por unidade DO ESTOQUE', () => {
  const conf = (over: Partial<Confirmacao> = {}): Confirmacao => ({ indice: 0, insumo_id: '3484974', quantidade: 0.5, entrada: null, lembrar: true, ...over })

  it('sem entrada: fator 1, entrada = quantidade, preço do cupom intocado; casado_por "app" e proposta apagada', () => {
    const r = refazerItem(ITENS_ATACADAO[0], conf())
    expect(r).toEqual({ ok: true, fator: 1, item: {
      ...ITENS_ATACADAO[0], sugestao_produto: { id: '3484974' }, entrada_estoque: 0.5, valor_unitario: 13.9, desconto_item: 0,
      casado_por: 'app', proposta: null, quantidade_cupom: 0.5,
    } })
  })
  it('entrada igual à quantidade (informada mesmo assim): fator 1 e preço do cupom', () => {
    const r = refazerItem(ITENS_ATACADAO[0], conf({ entrada: 0.5 }))
    expect(r).toMatchObject({ ok: true, fator: 1, item: { entrada_estoque: 0.5, valor_unitario: 13.9 } })
  })
  it('UN → KG: 5 un a R$ 7,99 que entram como 0,4 kg ⇒ 0,4 kg a R$ 99,875/kg (fator 0,08) — entrada × preço devolve o valor da linha', () => {
    const ovo: Item = {
      descricao_cupom: 'OVO BRANCO DZ', unidade_cupom: 'UN', valor_unitario: 7.99, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
    }
    const r = refazerItem(ovo, conf({ insumo_id: '3487562', quantidade: 5, entrada: 0.4 }))
    if (!r.ok) throw new Error(r.erro)
    expect(r.item).toMatchObject({ sugestao_produto: { id: '3487562' }, entrada_estoque: 0.4, valor_unitario: 99.875, quantidade_cupom: 5, casado_por: 'app' })
    expect(r.fator).toBeCloseTo(0.08, 12)
    expect(Number(r.item.entrada_estoque) * Number(r.item.valor_unitario)).toBeCloseTo(5 * 7.99, 9)
  })
  it('a entrada é guardada com 3 casas (o Sischef digita 4, o cupom pesa 3); o preço NÃO é arredondado (o robô arredonda ao digitar)', () => {
    const r = refazerItem(ITENS_ATACADAO[1], conf({ insumo_id: '3484991', quantidade: 0.91249 }))
    expect(r).toMatchObject({ ok: true, item: { entrada_estoque: 0.912, valor_unitario: 5.79 } })
  })
  it('entrada que arredonda para zero (0,0001 kg) é erro: não há preço possível (dividiria por zero)', () => {
    expect(refazerItem(ITENS_ATACADAO[0], conf({ quantidade: 1, entrada: 0.0001 })))
      .toEqual({ ok: false, erro: 'item 1: a quantidade do estoque arredonda para zero' })
  })
  it('preço do cupom que não é número (leitura ruim) é erro, nunca NaN gravado', () => {
    expect(refazerItem({ ...ITENS_ATACADAO[0], valor_unitario: 'x' }, conf({ indice: 1 }))).toEqual({ ok: false, erro: 'item 2: preço do cupom inválido' })
    expect(refazerItem({ ...ITENS_ATACADAO[0], valor_unitario: -1 }, conf()).ok).toBe(false)
  })
  it('desconto que não é número vira 0 (o robô lê desconto_item sempre)', () => {
    const r = refazerItem({ ...ITENS_ATACADAO[0], desconto_item: 'abc' }, conf())
    expect(r).toMatchObject({ ok: true, item: { desconto_item: 0 } })
    const semDesconto = refazerItem({ ...ITENS_ATACADAO[0], desconto_item: undefined }, conf())
    expect(semDesconto).toMatchObject({ ok: true, item: { desconto_item: 0 } })
  })
})

describe('conferirSoma — a mesma conta e tolerância do robô (cupom_valores.py)', () => {
  const refeitos = (): Item[] => {
    const a = refazerItem(ITENS_ATACADAO[0], { indice: 0, insumo_id: '3484974', quantidade: 0.5, entrada: null, lembrar: false })
    const b = refazerItem(ITENS_ATACADAO[1], { indice: 1, insumo_id: '3484991', quantidade: 0.912, entrada: null, lembrar: false })
    if (!a.ok || !b.ok) throw new Error('fixture')
    return [a.item, b.item, ITENS_ATACADAO[2]]
  }
  it('23,04 + 6,95 + 5,28 = 35,27: bate com o total do ATACADAO, diferença zero', () => {
    expect(conferirSoma(refeitos(), 35.27)).toEqual({ soma: 35.27, diferenca: 0, bate: true })
    expect(conferirTotalComoORobo(refeitos(), 35.27)).toBe('')
  })
  it('a tolerância é exatamente 0,02 (como o robô): 2 centavos passam, 3 não', () => {
    expect(TOLERANCIA).toBe(0.02)
    expect(conferirSoma(refeitos(), 35.29)).toMatchObject({ diferenca: -0.02, bate: true })
    expect(conferirSoma(refeitos(), 35.25)).toMatchObject({ diferenca: 0.02, bate: true })
    expect(conferirSoma(refeitos(), 35.3)).toMatchObject({ diferenca: -0.03, bate: false })
    expect(conferirSoma(refeitos(), 35.24)).toMatchObject({ diferenca: 0.03, bate: false })
    // e o robô concorda em cada caso
    expect(conferirTotalComoORobo(refeitos(), 35.29)).toBe('')
    expect(conferirTotalComoORobo(refeitos(), 35.3)).toMatch(/difere do total/)
  })
  it('cada linha é arredondada antes de somar (como o robô digita), e o item sem entrada conta zero', () => {
    // 3 linhas de 0,335 cada: por linha ⇒ 0,34 × 3 = 1,02; somando antes ⇒ 1,005 ⇒ 1,01 (o robô faz a primeira conta)
    const tres: Item[] = [1, 2, 3].map(() => ({ entrada_estoque: 0.1, valor_unitario: 3.35, desconto_item: 0 }))
    expect(conferirSoma(tres, 1.02)).toMatchObject({ soma: 1.02, bate: true })
    expect(conferirSoma([{ entrada_estoque: null, valor_unitario: 13.9, desconto_item: 0 }], 0)).toMatchObject({ soma: 0, bate: true })
  })
})

describe('ehGtin — só um GTIN de verdade vira chave global de aprendizado (o casamento por EAN não confere descrição nem fornecedor)', () => {
  it('EAN-13, EAN-8, UPC-12 e GTIN-14 com o dígito verificador certo (módulo 10 do GS1)', () => {
    for (const codigo of [EAN, '7891000100103', '96385074', '036000291452', '17891234567892']) expect(ehGtin(codigo)).toBe(true)
  })
  it('dígito verificador errado: um EAN mal lido ou com dígitos trocados não vale', () => {
    expect(ehGtin('7891234567890')).toBe(false)
    expect(ehGtin('7891234567985')).toBe(false)   // dois dígitos trocados
    expect(ehGtin('96385075')).toBe(false)
  })
  it('tamanho fora do GS1 (código interno do mercado, EAN cortado na borda da foto, 15 dígitos), só zeros, letras, vazio ou não texto', () => {
    const invalidos = ['7891234', '1', '123456789', '12345678901', '123456789012345', '0000000000000', '00000000', '789-ABC', '', null, undefined,
      7891234567895]
    for (const codigo of invalidos) expect(ehGtin(codigo)).toBe(false)
  })
})

describe('linhaDeAprendizado — por GTIN válido se o cupom o imprime; senão por (emitente, descrição normalizada); senão não há como lembrar', () => {
  const c: Confirmacao = { indice: 0, insumo_id: '3484974', quantidade: 0.5, entrada: null, lembrar: true }
  const base = { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true }

  it('com código de barras: a linha é global (emitente e descrição null) — vale para qualquer fornecedor', () => {
    expect(linhaDeAprendizado({ ...ITENS_ATACADAO[0], codigo_barras: EAN }, c, PRODUTOS['3484974'], CNPJ_ATACADAO, 1))
      .toEqual({ codigo_barras: EAN, emitente_cnpj: null, descricao_norm: null, ...base })
  })
  it('sem código de barras: chave (CNPJ, descricao_norm) com o MESMO normalizador do enviar-cupom', () => {
    expect(linhaDeAprendizado(ITENS_ATACADAO[0], c, PRODUTOS['3484974'], CNPJ_ATACADAO, 1))
      .toEqual({ codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: normalizar('LIMAO SICILIANO'), ...base })
    expect(normalizar('LIMAO SICILIANO')).toBe('limao siciliano')
  })
  it('código que não é GTIN válido (letras, EAN cortado, "0000000000000" de item pesado, verificador errado) cai na chave por descrição', () => {
    for (const codigo of ['789-ABC', '7891234', '0000000000000', '7891234567890', '1']) {
      expect(linhaDeAprendizado({ ...ITENS_ATACADAO[0], codigo_barras: codigo }, c, PRODUTOS['3484974'], CNPJ_ATACADAO, 1))
        .toEqual({ codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', ...base })
    }
  })
  it('código inválido e sem CNPJ do emitente: null — melhor não lembrar do que guardar uma chave que casaria o produto errado', () => {
    expect(linhaDeAprendizado({ ...ITENS_ATACADAO[0], codigo_barras: '7891234' }, c, PRODUTOS['3484974'], null, 1)).toBeNull()
  })
  it('sem EAN e sem CNPJ válido (null, 13 dígitos, formatado) ou sem descrição: null', () => {
    for (const cnpj of [null, '7531533300010', '75.315.333/0001-09', '']) {
      expect(linhaDeAprendizado(ITENS_ATACADAO[0], c, PRODUTOS['3484974'], cnpj, 1)).toBeNull()
    }
    expect(linhaDeAprendizado({ ...ITENS_ATACADAO[0], descricao_cupom: '  --  ' }, c, PRODUTOS['3484974'], CNPJ_ATACADAO, 1)).toBeNull()
    expect(linhaDeAprendizado({ ...ITENS_ATACADAO[0], descricao_cupom: null }, c, PRODUTOS['3484974'], CNPJ_ATACADAO, 1)).toBeNull()
  })
  it('o fator e a unidade de destino vêm da confirmação e do produto (conversão UN → KG)', () => {
    expect(linhaDeAprendizado(ITENS_ATACADAO[0], { ...c, insumo_id: '3487562' }, PRODUTOS['3487562'], CNPJ_ATACADAO, 0.08))
      .toMatchObject({ insumo_id: '3487562', insumo_nome: 'OVO - INSUMOS', fator_conversao: 0.08, unidade_destino: 'KG' })
  })
})

describe('tratar — autorização e validação do corpo (antes de ler o cupom)', () => {
  it('não-admin (comprador), admin inativo ou usuário inexistente: 403 sem nem ler o cupom', async () => {
    for (const usuario of [{ papel: 'comprador', ativo: true }, { papel: 'admin', ativo: false }, null]) {
      let leu = 0
      const deps = fakeDeps({ async buscarUsuario() { return usuario }, async lerCupom() { leu++; return cupom() } })
      const r = await tratar(pedido(), 'joao@spazio.com', deps)
      expect(r.status).toBe(403)
      expect(r.corpo).toEqual({ erro: 'apenas o administrador pode fazer isso' })
      expect(leu).toBe(0)
      nadaGravado(deps)
    }
  })

  it('o e-mail do chamador chega aparado e em minúsculas', async () => {
    let recebido = ''
    const deps = fakeDeps({ async buscarUsuario(email) { recebido = email; return { papel: 'admin', ativo: true } } })
    await tratar(pedido(), '  Ivan@Spazio.COM ', deps)
    expect(recebido).toBe(IVAN)
  })

  it.each([
    ['corpo null', null, 'sem o cupom'],
    ['sem cupom_id', { itens: CONFIRMACOES }, 'sem o cupom'],
    ['cupom_id que não é uuid', pedido(CONFIRMACOES, 'aaf54e6f'), 'sem o cupom'],
    ['cupom_id que não é texto', pedido(CONFIRMACOES, 123), 'sem o cupom'],
    ['itens ausente', { cupom_id: CUPOM_ID }, 'nenhum item confirmado'],
    ['itens vazio', pedido([]), 'nenhum item confirmado'],
    ['item sem posição', pedido([{ insumo_id: '3484974', quantidade: 0.5 }]), 'item sem posição válida'],
    ['mesma posição duas vezes', pedido([CONFIRMACOES[0], { ...CONFIRMACOES[1], indice: 0 }]), 'item 1 confirmado duas vezes'],
    ['código do produto inválido', pedido([{ ...CONFIRMACOES[0], insumo_id: 'LIMÃO' }, CONFIRMACOES[1]]), 'item 1: código do produto inválido'],
    ['quantidade zero', pedido([CONFIRMACOES[0], { ...CONFIRMACOES[1], quantidade: 0 }]), 'item 2: quantidade inválida (precisa ser maior que zero)'],
    ['quantidade negativa', pedido([{ ...CONFIRMACOES[0], quantidade: -0.5 }, CONFIRMACOES[1]]), 'item 1: quantidade inválida (precisa ser maior que zero)'],
    ['entrada zero', pedido([{ ...CONFIRMACOES[0], entrada: 0 }, CONFIRMACOES[1]]), ERRO_ENTRADA],
    ['entrada negativa', pedido([{ ...CONFIRMACOES[0], entrada: -0.4 }, CONFIRMACOES[1]]), ERRO_ENTRADA],
  ])('400 %s: nada lido nem gravado', async (_nome, corpo, erro) => {
    let leu = 0
    const deps = fakeDeps({ async lerCupom() { leu++; return cupom() } })
    const r = await tratar(corpo as Record<string, unknown>, IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro })
    expect(leu).toBe(0)
    nadaGravado(deps)
  })
})

describe('tratar — o cupom tem de estar parado por item sem produto, sem nada ter chegado ao SisChef', () => {
  it('cupom inexistente: 404', async () => {
    const deps = fakeDeps({ cupom: null })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(404)
    expect(r.corpo).toEqual({ erro: 'cupom não encontrado' })
    nadaGravado(deps)
  })

  it.each([
    ['LANCADO', { estado: 'LANCADO', pedido_sischef: '163377325' }],
    ['PENDENTE (já na fila)', { estado: 'PENDENTE' }],
    ['PROCESSANDO (o robô está nele)', { estado: 'PROCESSANDO' }],
    ['TESTE', { estado: 'TESTE' }],
    ['REVISAR mas com pedido_sischef (algo chegou ao SisChef)', { estado: 'REVISAR', pedido_sischef: '163377325' }],
  ])('409 quando o cupom está %s: "atualize a tela", nada gravado', async (_nome, over) => {
    const deps = fakeDeps({ cupom: cupom(over as Partial<CupomLinha>) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(409)
    expect(r.corpo).toEqual({ erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' })
    nadaGravado(deps)
  })

  it.each([
    'CONFERIR NO SISCHEF antes de repetir: falha depois de Gerar compra',
    'GERAR_COMPRA_CLICADO: timeout esperando a tela de pagamento',
    'pagamento: FINALIZAR_COMPRA_CLICADO sem confirmação da tela',
    'falha ao preencher o pagamento no Sischef: conta PIX ITAU IJ não encontrada',
    'JÁ LANÇADO em outro envio — NÃO reenviar (duplicaria a compra)',
    'não consegui ler a foto do cupom',
  ])('409 motivo não reenviável (a compra PODE já existir, ou não há itens lidos): %s', async (motivo) => {
    const deps = fakeDeps({ cupom: cupom({ motivo }) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(409)
    expect(String(r.corpo.erro)).toMatch(/pode já ter chegado ao SisChef/)
    expect(String(r.corpo.erro)).toMatch(/peça ao Claude conferir/)
    nadaGravado(deps)
  })

  it('o motivo do enviar-cupom (item sem casamento) e motivo null são reenviáveis', async () => {
    for (const motivo of ['2 item(ns) sem casamento confirmado — confira no Code', null, '']) {
      const deps = fakeDeps({ cupom: cupom({ motivo }) })
      expect((await tratar(pedido(), IVAN, deps)).status).toBe(200)
    }
  })

  it.each([0, null, '0', -1, 'abc'])('409 total não lido (valor_a_pagar %s): sem ele não há como conferir a soma', async (valor) => {
    const deps = fakeDeps({ cupom: cupom({ valor_a_pagar: valor as CupomLinha['valor_a_pagar'] }) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(409)
    expect(String(r.corpo.erro)).toMatch(/o total deste cupom não foi lido/)
    nadaGravado(deps)
  })

  it('409 sem item pendente: todos os itens já têm produto (ou o cupom não tem itens)', async () => {
    const todosCasados = structuredClone(ITENS_ATACADAO).map((it) => ({ ...it, sugestao_produto: { id: '3469643' }, entrada_estoque: 1 }))
    for (const itens of [todosCasados, [], null]) {
      const deps = fakeDeps({ cupom: cupom({ itens }) })
      const r = await tratar(pedido(), IVAN, deps)
      expect(r.status).toBe(409)
      expect(r.corpo).toEqual({ erro: 'este cupom não tem item sem produto para confirmar' })
      nadaGravado(deps)
    }
  })

  it('item com sugestao_produto.id vazio ou só espaços conta como pendente (a mesma leitura do validar_cupom do robô)', async () => {
    const itens = structuredClone(ITENS_ATACADAO)
    itens[0].sugestao_produto = { id: '   ' }
    itens[1].sugestao_produto = { id: '' }
    const deps = fakeDeps({ cupom: cupom({ itens }) })
    expect((await tratar(pedido(), IVAN, deps)).status).toBe(200)
  })

  it('400 falta confirmar item pendente: confirmar só o 3º deixa o 1º e o 2º de fora', async () => {
    const deps = fakeDeps()
    const r = await tratar(pedido([{ indice: 2, insumo_id: '3469643', quantidade: 2.884, lembrar: false }]), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro: 'falta confirmar o item 1, 2' })
    nadaGravado(deps)
  })

  it('400 item que já tem produto (o LIMAO TAITI) ou que não existe na lista do cupom', async () => {
    const deps = fakeDeps()
    const r = await tratar(pedido([...CONFIRMACOES, { indice: 2, insumo_id: '3469643', quantidade: 2.884, lembrar: false }]), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro: 'o item 3 já tem produto confirmado (ou não existe)' })
    const r2 = await tratar(pedido([...CONFIRMACOES, { indice: 7, insumo_id: '3469643', quantidade: 1, lembrar: false }]), IVAN, deps)
    expect(r2.corpo).toEqual({ erro: 'o item 8 já tem produto confirmado (ou não existe)' })
    nadaGravado(deps)
  })

  it('400 produto fora da lista de insumos do app (buscarProduto null): diz o código', async () => {
    const buscados: string[] = []
    const deps = fakeDeps({ async buscarProduto(id) { buscados.push(id); return PRODUTOS[id] ?? null } })
    const r = await tratar(pedido([{ ...CONFIRMACOES[0], insumo_id: '9999999' }, CONFIRMACOES[1]]), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro: 'item 1: o produto cód. 9999999 não está na lista de insumos do app' })
    expect(buscados).toEqual(['9999999'])
    nadaGravado(deps)
  })

  it('400 unidade do cupom (KG) difere da do produto (UN) e o app não disse quanto entra no estoque', async () => {
    const deps = fakeDeps({ async buscarProduto(id) { return id === '3484974' ? { ...PRODUTOS[id], unidade: 'UN' } : PRODUTOS[id] ?? null } })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro: 'item 1: o cupom está em KG e o produto é em UN: informe quanto entra no estoque em UN' })
    nadaGravado(deps)
  })

  it('unidade igual com grafia diferente (kg/KG, UN/UND) ou vazia de um dos lados NÃO exige entrada', async () => {
    const casos: [string | null, string | null][] = [['KG', 'kg'], ['UN', 'UND'], ['unid', 'PC'], ['KG', null], ['', 'KG'], [null, null]]
    for (const [uCupom, uProduto] of casos) {
      const itens = structuredClone(ITENS_ATACADAO)
      itens[0].unidade_cupom = uCupom
      itens[1].unidade_cupom = uCupom
      const deps = fakeDeps({
        cupom: cupom({ itens }),
        async buscarProduto(id) { return PRODUTOS[id] ? { ...PRODUTOS[id], unidade: uProduto } : null },
      })
      expect((await tratar(pedido(), IVAN, deps)).status).toBe(200)
    }
  })

  it('400 soma que não bate: diz as duas somas e a diferença em R$, e NADA é gravado (nem o cupom, nem aprendizado, nem disparo)', async () => {
    const deps = fakeDeps()
    // 0,6 kg em vez de 0,5: 0,6 × 13,90 = 8,34 ⇒ 23,04 + 8,34 + 5,28 = 36,66, diferença 1,39
    const r = await tratar(pedido([{ ...CONFIRMACOES[0], quantidade: 0.6 }, CONFIRMACOES[1]]), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({
      erro: 'a soma dos itens (R$ 36,66) não bate com o total do cupom (R$ 35,27): diferença de R$ 1,39. Confira os pesos.',
      soma: 36.66, total: 35.27,
    })
    nadaGravado(deps)
  })

  it('a soma aceita a tolerância do robô (2 centavos) e recusa 3', async () => {
    for (const [total, status] of [[35.29, 200], [35.25, 200], [35.3, 400], [35.24, 400]] as const) {
      const deps = fakeDeps({ cupom: cupom({ valor_a_pagar: total }) })
      const r = await tratar(pedido(), IVAN, deps)
      expect(r.status, `total ${total}`).toBe(status)
      if (status === 400) {
        expect(String(r.corpo.erro)).toMatch(/diferença de R\$ 0,03/)
        nadaGravado(deps)
      }
    }
  })

  it('valor_a_pagar como texto "35.27" (numeric do PostgREST) funciona igual', async () => {
    const deps = fakeDeps({ cupom: cupom({ valor_a_pagar: '35.27' }) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(200)
    expect(deps.atualizacoes).toHaveLength(1)
  })
})

describe('tratar — caminho feliz: o cupom do ATACADAO de 06/10 (R$ 35,27)', () => {
  it('200 PENDENTE, disparo ok, 2 lembrados; os itens refeitos no formato do robô, o LIMAO TAITI intocado, a lista inteira gravada', async () => {
    const linha = cupom()
    const deps = fakeDeps({ cupom: linha })
    const r = await tratar(pedido(), IVAN, deps)

    expect(r.status).toBe(200)
    expect(r.corpo).toEqual({
      cupom_id: CUPOM_ID, estado: 'PENDENTE', resumo: 'corrigido e reenviado para lançar', disparo_ok: true, lembrados: 2, nao_lembrados: 0,
    })

    expect(deps.atualizacoes).toHaveLength(1)
    expect(deps.atualizacoes[0].id).toBe(CUPOM_ID)
    const itens = deps.atualizacoes[0].itens
    expect(itens).toHaveLength(3)
    // fator 1: a entrada é o peso do cupom, o preço é o do cupom; a proposta some e fica registrado que o Ivan casou pelo app
    expect(itens[0]).toEqual({
      ...ITENS_ATACADAO[0], sugestao_produto: { id: '3484974' }, entrada_estoque: 0.5, valor_unitario: 13.9, desconto_item: 0,
      casado_por: 'app', proposta: null, quantidade_cupom: 0.5,
    })
    expect(itens[1]).toEqual({
      ...ITENS_ATACADAO[1], sugestao_produto: { id: '3484991' }, entrada_estoque: 0.912, valor_unitario: 5.79, desconto_item: 0,
      casado_por: 'app', proposta: null, quantidade_cupom: 0.912,
    })
    // o item já confirmado é o MESMO objeto que veio do banco: nada nele foi refeito
    expect(itens[2]).toBe((linha.itens as Item[])[2])
    expect(itens[2]).toEqual(ITENS_ATACADAO[2])

    // o que o robô vai fazer com isso: validar_cupom aceita e a soma fecha com o total
    expect(validarCupomComoORobo(itens)).toEqual([])
    expect(conferirTotalComoORobo(itens, 35.27)).toBe('')

    expect(deps.disparos).toEqual([CUPOM_ID])
  })

  it('o aprendizado: 2 linhas por (emitente_cnpj, descricao_norm) com o normalizador do enviar-cupom, fator 1, unidade do produto, confirmado', async () => {
    const deps = fakeDeps()
    await tratar(pedido(), IVAN, deps)
    expect(deps.aprendizados).toEqual([
      { codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: normalizar('LIMAO SICILIANO'), insumo_id: '3484974',
        insumo_nome: 'LIMÃO SICILIANO - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true },
      { codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: normalizar('PEPINO JAPONES'), insumo_id: '3484991',
        insumo_nome: 'PEPINO JAPONÊS - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true },
    ])
  })

  it('a ordem: o cupom volta à fila ANTES do aprendizado e do disparo (uma falha depois não desfaz a correção)', async () => {
    const deps = fakeDeps()
    await tratar(pedido(), IVAN, deps)
    expect(deps.ordem).toEqual(['atualizar', 'aprender', 'aprender', 'disparar'])
  })

  it('o aprendizado é por EAN quando o cupom imprime o código de barras (emitente e descrição null: vale para qualquer fornecedor)', async () => {
    const itens = structuredClone(ITENS_ATACADAO)
    itens[0].codigo_barras = EAN
    const deps = fakeDeps({ cupom: cupom({ itens }) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.corpo).toMatchObject({ lembrados: 2, nao_lembrados: 0 })
    expect(deps.aprendizados[0]).toEqual({
      codigo_barras: EAN, emitente_cnpj: null, descricao_norm: null, insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS',
      fator_conversao: 1, unidade_destino: 'KG', confirmado: true,
    })
    expect(deps.aprendizados[1]).toMatchObject({ codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'pepino japones' })
  })

  it('código que não é GTIN válido (EAN cortado na foto, "7891234") NÃO vira chave global: o aprendizado é por (emitente, descrição)', async () => {
    // cenário da revisão: com a chave global, um PEPINO de outro fornecedor com o mesmo número cortado seria lançado como LIMÃO em silêncio
    const itens = structuredClone(ITENS_ATACADAO)
    itens[0].codigo_barras = '7891234'
    const deps = fakeDeps({ cupom: cupom({ itens }) })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.corpo).toMatchObject({ lembrados: 2, nao_lembrados: 0 })
    expect(deps.aprendizados.map((a) => a.codigo_barras)).toEqual([null, null])
    expect(deps.aprendizados[0]).toMatchObject({ emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', insumo_id: '3484974' })
    // e sem o CNPJ do emitente esse item não é lembrado (melhor do que guardar uma chave que casaria o produto errado)
    const semCnpj = fakeDeps({ cupom: cupom({ itens: structuredClone(itens), emitente_cnpj: null }) })
    expect((await tratar(pedido(), IVAN, semCnpj)).corpo).toMatchObject({ lembrados: 0, nao_lembrados: 2 })
  })

  it('lembrar:false não grava aprendizado (e não conta como "não lembrado"): o cupom é corrigido do mesmo jeito', async () => {
    const deps = fakeDeps()
    const r = await tratar(pedido(CONFIRMACOES.map((c) => ({ ...c, lembrar: false }))), IVAN, deps)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', lembrados: 0, nao_lembrados: 0 })
    expect(deps.aprendizados).toHaveLength(0)
    expect(deps.atualizacoes).toHaveLength(1)
    expect(deps.disparos).toEqual([CUPOM_ID])
  })

  it('sem CNPJ do emitente e sem EAN não há como lembrar: nao_lembrados conta, nada é gravado, o cupom é corrigido mesmo assim', async () => {
    for (const emitente of [null, '7531533300010']) {
      const deps = fakeDeps({ cupom: cupom({ emitente_cnpj: emitente }) })
      const r = await tratar(pedido([CONFIRMACOES[0], { ...CONFIRMACOES[1], lembrar: false }]), IVAN, deps)
      expect(r.status).toBe(200)
      expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true, lembrados: 0, nao_lembrados: 1 })
      expect(deps.aprendizados).toHaveLength(0)
      expect(deps.atualizacoes).toHaveLength(1)
    }
  })

  it('conversão UN → KG: 5 un de OVO a R$ 7,99 entram como 0,4 kg ⇒ 0,4 kg a R$ 99,875/kg, fator 0,08; a linha vale os mesmos R$ 39,95', async () => {
    const ovo: Item = {
      descricao_cupom: 'OVO BRANCO DZ', unidade_cupom: 'UN', valor_unitario: 7.99, desconto_item: 0, entrada_estoque: null, sugestao_produto: null,
      codigo_barras: null, casado_por: null, proposta: null, quantidade_cupom: 5,
    }
    const deps = fakeDeps({ cupom: cupom({ itens: [ovo], valor_a_pagar: 39.95 }) })
    const r = await tratar(pedido([{ indice: 0, insumo_id: '3487562', quantidade: 5, entrada: 0.4, lembrar: true }]), IVAN, deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', lembrados: 1 })
    const item = deps.atualizacoes[0].itens[0]
    expect(item).toMatchObject({ sugestao_produto: { id: '3487562' }, entrada_estoque: 0.4, valor_unitario: 99.875, quantidade_cupom: 5, casado_por: 'app' })
    // invariante: entrada × preço do estoque == quantidade × preço do cupom (o valor da linha é preservado pela conversão)
    expect(Number(item.entrada_estoque) * Number(item.valor_unitario)).toBeCloseTo(5 * 7.99, 9)
    expect(validarCupomComoORobo([item])).toEqual([])
    expect(conferirTotalComoORobo([item], 39.95)).toBe('')
    expect(deps.aprendizados[0]).toMatchObject({ insumo_id: '3487562', unidade_destino: 'KG', confirmado: true })
    expect(deps.aprendizados[0].fator_conversao).toBeCloseTo(0.08, 12)
  })

  it('entrada que arredonda para zero: 400 e nada gravado', async () => {
    const deps = fakeDeps()
    const r = await tratar(pedido([{ ...CONFIRMACOES[0], entrada: 0.0001 }, CONFIRMACOES[1]]), IVAN, deps)
    expect(r.status).toBe(400)
    expect(r.corpo).toEqual({ erro: 'item 1: a quantidade do estoque arredonda para zero' })
    nadaGravado(deps)
  })

  it('cupom teste=true é corrigido e disparado igual (o robô é quem só ensaia)', async () => {
    const deps = fakeDeps({ cupom: cupom({ teste: true }) })
    expect((await tratar(pedido(), IVAN, deps)).corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true })
    expect(deps.disparos).toEqual([CUPOM_ID])
  })
})

describe('tratar — falhas depois da conferência', () => {
  it('atualizarCupom devolve false (tela velha: outro processo já reenviou/lançou): 409 e NADA de aprendizado nem disparo', async () => {
    const deps = fakeDeps({ async atualizarCupom() { return false } })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(409)
    expect(r.corpo).toEqual({ erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' })
    expect(deps.aprendizados).toHaveLength(0)
    expect(deps.disparos).toHaveLength(0)
  })

  it('erro do banco no UPDATE sobe (quem responde 500 é o index.ts): nada de aprendizado nem disparo', async () => {
    const deps = fakeDeps({ async atualizarCupom() { throw new Error('connection reset') } })
    await expect(tratar(pedido(), IVAN, deps)).rejects.toThrow('connection reset')
    expect(deps.aprendizados).toHaveLength(0)
    expect(deps.disparos).toHaveLength(0)
  })

  it('falha ao gravar um aprendizado NÃO derruba: 200 com lembrados 1 e nao_lembrados 1, cupom corrigido e disparado', async () => {
    let chamadas = 0
    const deps = fakeDeps({ async gravarAprendizado(l) { chamadas++; if (chamadas === 1) throw new Error('duplicate key'); deps.aprendizados.push(l) } })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true, lembrados: 1, nao_lembrados: 1 })
    expect(deps.aprendizados).toHaveLength(1)
    expect(deps.aprendizados[0]).toMatchObject({ insumo_id: '3484991' })
    expect(deps.atualizacoes).toHaveLength(1)
    expect(deps.disparos).toEqual([CUPOM_ID])
  })

  it('falha no disparo NÃO desfaz: 200 PENDENTE com disparo_ok:false e o aviso de que nada o relança sozinho (reaper em ~60 min)', async () => {
    const deps = fakeDeps({ async dispararLancamento() { throw new Error('sem GITHUB_PAT') } })
    const r = await tratar(pedido(), IVAN, deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cupom_id: CUPOM_ID, estado: 'PENDENTE', disparo_ok: false, lembrados: 2, nao_lembrados: 0 })
    const resumo = String(r.corpo.resumo)
    expect(resumo).toMatch(/disparo automático falhou/)
    expect(resumo).toMatch(/sozinho/)
    expect(resumo).toMatch(/60 min/)
    expect(deps.atualizacoes).toHaveLength(1)
    expect(deps.aprendizados).toHaveLength(2)
  })
})
