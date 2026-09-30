import {
  basePresumida, entradasParaGravar, juntarLeituras, marcadoPorPadrao, textoParaIA, type Escolhas,
} from '../../src/cotacao/ia'
import type { Colagem } from '../../src/cotacao/leitorTexto'
import type { Cotacao, ItemCotacao, LeituraIA } from '../../src/lib/tipos'

// Fase 2, Bloco B — lógica do App (B.14.3, parte pura). Dados inventados.

function item(over: Partial<ItemCotacao> = {}): ItemCotacao {
  return {
    id: 1, cotacao_id: 1, item_semana_id: 1, produto_id: 101, numero: 1, incluido: true, nome: 'COCA COLA 350 ML',
    unidade: 'un', rotulo: 'un', vende_por_litro: false, qtd: 100, qtd_sugerida: 100, embalagem: null, fator: null,
    fator_confirmado: false, kg_por_litro: null, descricao_fornecedor: null, codigo_fornecedor: null, nota_vendedor: null,
    ref_preco: null, ref_data: null, ref_situacao: null, estado: 'sem_resposta', preco_digitado: null, base: null,
    emb_unidades: null, emb_gramas: null, emb_ml: null, fator_informado: null, preco_convertido: null, tenho_so: null,
    similar_desc: null, similar_preco: null, a_partir_de: null, marca_informada: null, avisos_vendedor: [], avisos_ivan: [],
    confirmado_pelo_vendedor: false, origem: null, copiada_da_versao: null, respondido_em: null, rev: 0, delta: null,
    ...over,
  }
}

function iaItem(numero: number, over: Partial<LeituraIA['itens'][number]['entrada']> = {}, extra: Partial<LeituraIA['itens'][number]> = {}): LeituraIA['itens'][number] {
  return {
    numero, fonte: 'texto', casou_por: 'numero', trecho: `${numero} coca`, certeza: 'alta', duvida: null, sinais: [],
    entrada: { estado: 'tem', preco: 2.5, base: 'un', emb_unidades: null, emb_gramas: null, emb_ml: null,
      tenho_so: null, a_partir_de: null, similar_desc: null, similar_preco: null, marca: null, ...over },
    ...extra,
  }
}
function leitura(itens: LeituraIA['itens'], over: Partial<LeituraIA> = {}): LeituraIA {
  return {
    ok: true, leitura_id: 88, modelo: 'claude-opus-5', duracao_ms: 9000, custo_usd: 0.066, itens,
    gerais: { pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null },
    fora_da_lista: [], nao_entendidos: [], uso: { hoje: 1, limite_dia: 30, mes: 1, limite_mes: 150, custo_mes_usd: 0.066 },
    ...over,
  }
}
function colagemDe(recon: { numero: number; estado: string; preco?: number; base?: string }[]): Colagem {
  return {
    reconhecidos: recon.map((r) => ({ numero: r.numero, rev_lida: 0, estado: r.estado as 'tem',
      preco: r.preco ?? null, base: (r.base ?? null) as 'un', emb_unidades: null, emb_gramas: null, emb_ml: null } as never)),
    naoEntendidas: [], foraDaVersao: [], linhas: Object.fromEntries(recon.map((r) => [r.numero, [`${r.numero} coca`]])),
    horas: Object.fromEntries(recon.map((r) => [r.numero, [null]])),
  }
}
const COT: Cotacao = {
  id: 1, semana_id: 1, vendedor_id: 1, versao: 2, complementar: false, status: 'enviada', resultado: null,
  substituida_por: null, congelada_em: null, enviada_em: null, fechada_em: null, prazo: null, fechamento: null,
  primeiro_acesso: null, ultimo_acesso: null, acessos: 0, envios_aceitos: 0, ultimo_envio_em: null, gerais_rev: 0,
  gerais_origem: null, respostas_rev: 0, cobranca_em: null, consolidado_em: null,
  pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null,
}
const HOJE = '2026-10-20'

describe('basePresumida (B.5.5)', () => {
  it('fator confirmado → embalagem; senão un/litro/kg', () => {
    expect(basePresumida({ unidade: 'un', vende_por_litro: false, fator_confirmado: true, fator: 12 }))
      .toEqual({ base: 'embalagem', emb_unidades: 12, emb_gramas: null, emb_ml: null })
    expect(basePresumida({ unidade: 'kg', vende_por_litro: false, fator_confirmado: true, fator: 5 }))
      .toEqual({ base: 'embalagem', emb_unidades: null, emb_gramas: 5000, emb_ml: null })
    expect(basePresumida({ unidade: 'un', vende_por_litro: false, fator_confirmado: false, fator: null }).base).toBe('un')
    expect(basePresumida({ unidade: 'kg', vende_por_litro: true, fator_confirmado: false, fator: null }).base).toBe('litro')
    expect(basePresumida({ unidade: 'kg', vende_por_litro: false, fator_confirmado: false, fator: null }).base).toBe('kg')
  })
})

describe('textoParaIA (B.10)', () => {
  it('tira cabeçalho, telefone e documento e troca o nome do vendedor por [vendedor]', () => {
    const t = textoParaIA('[05/10, 09:14] Fulano: 1 coca 42, abraço Fulano, zap 5591900001234', { nome: 'Fulano', rotulo: 'MATEUS', empresa: 'MATEUS MIX (Centro)' })
    expect(t).toContain('1 coca 42')
    expect(t).toContain('[telefone]')
    expect(t).toContain('[vendedor]') // "Fulano" no corpo trocado (o do cabeçalho já saiu com o cabeçalho)
    expect(t).not.toMatch(/Fulano/i)
  })
  it('troca também o rótulo em maiúsculas (MATEUS) que aparece no texto', () => {
    const t = textoParaIA('obrigado, MATEUS agradece', { nome: 'Fulano', rotulo: 'MATEUS', empresa: 'MATEUS MIX' })
    expect(t).not.toContain('MATEUS')
    expect(t).toContain('[vendedor]')
  })
})

describe('juntarLeituras (B.5.3, B.5.4)', () => {
  it('concordam: sinal concorda, certeza alta, marcado', () => {
    const p = juntarLeituras([item({ numero: 1 })], colagemDe([{ numero: 1, estado: 'tem', preco: 2.5, base: 'un' }]),
      leitura([iaItem(1, { preco: 2.5, base: 'un' })]), COT, HOJE)
    expect(p.linhas[0].sinais).toContain('concorda')
    expect(p.linhas[0].certeza).toBe('alta')
    expect(p.linhas[0].marcadoPadrao).toBe(true)
  })
  it('discordam: duas opções, nenhuma escolhida, desmarcado', () => {
    const p = juntarLeituras([item({ numero: 1 })], colagemDe([{ numero: 1, estado: 'tem', preco: 3, base: 'un' }]),
      leitura([iaItem(1, { preco: 2.5, base: 'un' })]), COT, HOJE)
    expect(p.linhas[0].duasOpcoes).not.toBeNull()
    expect(p.linhas[0].marcadoPadrao).toBe(false)
  })
  it('só IA e só leitor comum', () => {
    const p = juntarLeituras([item({ numero: 1 }), item({ numero: 2, id: 2, produto_id: 102 })],
      colagemDe([{ numero: 2, estado: 'tem', preco: 4, base: 'un' }]),
      leitura([iaItem(1, { preco: 2.5, base: 'un' })]), COT, HOJE)
    const l1 = p.linhas.find((l) => l.numero === 1)!
    const l2 = p.linhas.find((l) => l.numero === 2)!
    expect(l1.fonte).toBe('texto')
    expect(l2.sinais).toContain('so_leitor')
    expect(l2.marcadoPadrao).toBe(true)
  })
  it('base presumida: a IA devolve base null → aplica basePresumida, sinal e certeza média', () => {
    const p = juntarLeituras([item({ numero: 1 })], null, leitura([iaItem(1, { preco: 2.5, base: null })]), COT, HOJE)
    expect(p.linhas[0].entrada.base).toBe('un')
    expect(p.linhas[0].sinais).toContain('base_presumida')
    expect(p.linhas[0].certeza).toBe('media')
  })
  it('unidade suspeita chega desmarcada', () => {
    const it = item({ numero: 1, ref_preco: 10, ref_situacao: 'ok' })
    const p = juntarLeituras([it], null, leitura([iaItem(1, { preco: 50, base: 'un' })]), COT, HOJE)
    expect(p.linhas[0].marcadoPadrao).toBe(false)
  })
  it('item protegido (resposta do link) chega desmarcado', () => {
    const it = item({ numero: 1, origem: 'vendedor', estado: 'tem', preco_digitado: 2.5, base: 'un' })
    const p = juntarLeituras([it], null, leitura([iaItem(1, { preco: 2.5, base: 'un' })]), COT, HOJE)
    expect(p.linhas[0].protegido).toBe(true)
    expect(p.linhas[0].marcadoPadrao).toBe(false)
  })
  it('número fora da versão e não entendidos', () => {
    const p = juntarLeituras([item({ numero: 1 })], null,
      leitura([iaItem(1, { preco: 2.5, base: 'un' })], { fora_da_lista: [{ numero: 17, trecho: '17 9,90' }], nao_entendidos: [{ trecho: 'coca 1l', motivo: 'ambíguo' }] }), COT, HOJE)
    expect(p.foraDaVersao).toEqual([17])
    expect(p.naoEntendidos[0].motivo).toBe('ambíguo')
  })
  it('não entendida do leitor comum coberta por um trecho da IA não aparece (B.5.3)', () => {
    const colagem: Colagem = {
      reconhecidos: [],
      // o leitor comum não mapeou nenhuma destas linhas; a IA leu as duas primeiras (por nome e por número)
      naoEntendidas: ['coca zero 42', '2 COCA 30', 'agua com gas 2,50'],
      foraDaVersao: [], linhas: {}, horas: {},
    }
    const ia = leitura([
      iaItem(1, { preco: 42, base: 'un' }, { trecho: 'coca zero 42', casou_por: 'nome' }),
      iaItem(2, { preco: 30, base: 'un' }, { trecho: '2 coca 30', casou_por: 'numero' }),
    ])
    const p = juntarLeituras([item({ numero: 1 }), item({ numero: 2, id: 2, produto_id: 102 })], colagem, ia, COT, HOJE)
    // as duas linhas que a IA leu não podem duplicar como "o leitor comum não entendeu"
    expect(p.naoEntendidos.some((n) => n.trecho === 'coca zero 42')).toBe(false)
    expect(p.naoEntendidos.some((n) => n.trecho === '2 COCA 30')).toBe(false)
    // a linha que ninguém entendeu continua
    expect(p.naoEntendidos.some((n) => n.trecho === 'agua com gas 2,50' && n.motivo === 'o leitor comum não entendeu')).toBe(true)
  })
})

describe('marcadoPorPadrao (B.5.6)', () => {
  const base = { certeza: 'alta' as const, duvida: null, duasOpcoes: null, avisos: [] as string[], protegido: false, sinais: [] as never[] }
  it('alta sem avisos marca; baixa, dúvida, discordância, aviso e proteção desmarcam', () => {
    expect(marcadoPorPadrao(base)).toBe(true)
    expect(marcadoPorPadrao({ ...base, certeza: 'baixa' })).toBe(false)
    expect(marcadoPorPadrao({ ...base, duvida: 'x' })).toBe(false)
    expect(marcadoPorPadrao({ ...base, duasOpcoes: { ia: { rotulo: 'a', entrada: {} as never }, comum: { rotulo: 'b', entrada: {} as never } } })).toBe(false)
    expect(marcadoPorPadrao({ ...base, avisos: ['confira: valor alto'] })).toBe(false)
    expect(marcadoPorPadrao({ ...base, protegido: true })).toBe(false)
  })
})

describe('entradasParaGravar (B.5.8)', () => {
  function esc(over: Partial<Escolhas> = {}): Escolhas {
    return { marcados: new Set(), substituir: new Set(), escolha: new Map(), correcoes: new Map(), condicoes: new Set(), ...over }
  }
  it('manda só as marcadas, com o rev da leitura', () => {
    const its = [item({ numero: 1 }), item({ numero: 2, id: 2, produto_id: 102, rev: 3 })]
    const p = juntarLeituras(its, null, leitura([iaItem(1, { preco: 2.5, base: 'un' }), iaItem(2, { preco: 3, base: 'un' })]), COT, HOJE)
    const r = entradasParaGravar(p, esc({ marcados: new Set([2]) }), its, COT)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0].numero).toBe(2)
    expect(r.itens[0].rev_lida).toBe(3)
    expect(r.resumo.gravados).toBe(1)
  })
  it('item protegido só entra com "substituir"', () => {
    const its = [item({ numero: 1, origem: 'vendedor', estado: 'tem', preco_digitado: 2.5, base: 'un' })]
    const p = juntarLeituras(its, null, leitura([iaItem(1, { preco: 3, base: 'un' })]), COT, HOJE)
    expect(entradasParaGravar(p, esc({ marcados: new Set([1]) }), its, COT).itens).toHaveLength(0)
    expect(entradasParaGravar(p, esc({ marcados: new Set([1]), substituir: new Set([1]) }), its, COT).itens).toHaveLength(1)
  })
  it('correção conta como corrigido; condição marcada substitui só ela', () => {
    const its = [item({ numero: 1 })]
    const p = juntarLeituras(its, null, leitura([iaItem(1, { preco: 2.5, base: 'un' })], {
      gerais: { pagamento: { valor: 'boleto 28', trecho: 'boleto', certeza: 'alta' }, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null },
    }), COT, HOJE)
    const correcoes = new Map([[1, { estado: 'tem', preco: 9, base: 'un', emb_unidades: null, emb_gramas: null, emb_ml: null, tenho_so: null, a_partir_de: null, similar_desc: null, similar_preco: null, marca: null } as never]])
    const r = entradasParaGravar(p, esc({ marcados: new Set([1]), correcoes, condicoes: new Set(['pagamento']) }), its, COT)
    expect(r.resumo.corrigidos).toBe(1)
    expect(r.itens[0].preco).toBe(9)
    expect(r.gerais?.pagamento).toBe('boleto 28')
    expect(r.gerais?.frete).toBeNull() // não marcada: fica como estava (null)
  })
})
