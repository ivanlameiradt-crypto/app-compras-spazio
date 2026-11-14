import { sugestoesLidas, conversoesDaSugestao, itensMesmoCodigoDaSugestao, falhaPassageiraDaSugestao } from '../../src/admin/sugestoesDoRobo'
import { passageiroDaNota, planoTirarConversao, textoDoEstado } from '../../src/admin/notaSefazRegras'
import { diagnosticoDoCupom, motivoPassageiroDoCupom } from '../../src/admin/cupomRegras'
import type { CupomRecente, NotaSefazLista, SugestaoDoRobo } from '../../src/lib/tipos'

// Etapa 6 (14/11/2026): o robô passa a gravar uma lista ESTRUTURADA de sugestões ({codigo, item_n, acao, dados}) junto do motivo em texto (migração 20261229000001) e o app PREFERE esse dado a
// adivinhar pelo texto. Sem sugestões (coluna nula, ausente ou malformada), tudo igual a hoje.
const FIM = ' não é de embalagem (embalagem é maior que 1 e vale para UN, PCT, CX ou FD): no app, toque em Editar neste item, deixe a conversão vazia e lance de novo (ou associe no SisChef)'
const GUIOZA = `item 5 (CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G): a nota e o produto estão na mesma unidade (UN) no SisChef e o número informado (0,24)${FIM}`
const MESMO_COD = 'escolha do app que o robô não consegue aplicar: dois itens com o mesmo CÓD. FOR 0009085 (itens 1, 2): o robô não sabe qual associar — associe no SisChef'
const TEMPO = 'parou antes de gerar o pedido (nada lançado): TimeoutError: Page.goto: Timeout 90000ms exceeded.'

const CONVERSAO: SugestaoDoRobo = { codigo: 'conversao_desnecessaria', item_n: 5, acao: 'tirar_conversao', dados: { numero: 0.24 } }
const IGUAIS: SugestaoDoRobo = { codigo: 'itens_mesmo_codigo', item_n: 1, acao: 'associar_no_sischef', dados: { itens: [1, 2], cod_for: '0009085' } }
const PASSAGEIRA: SugestaoDoRobo = { codigo: 'falha_passageira', item_n: null, acao: 'tentar_de_novo', dados: { nada_criado: 1 } }

const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '7'.repeat(44), emitente: 'LONG WAY ALIMENTOS LTDA', numero: '000012345', emissao: '2026-11-13', valor_nf: 500, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [
    { n: 4, descricao: 'CÓD. FOR: 2890 LONG WAY HARUMAKI 300G', qtd: 5, unidade_sischef: 'UN', produto_id: 111, associacao: 'sischef', produto_nome: 'HARUMAKI - INSUMOS' },
    { n: 5, descricao: 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G - INSUMOS', qtd: 10, unidade_sischef: 'UN', produto_id: null },
  ],
  associacoes_app: { '5': { produto_id: 3971031, produto_nome: 'GUIOZA DE LEGUMES - INSUMOS', unidade: 'un', conversao: 0.24, origem: 'lista' } },
  parcelas: [], forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: GUIOZA, lancamento_sugestoes: [CONVERSAO], ...extra,
} as unknown as NotaSefazLista)

describe('sugestoesLidas — só o que está bem formado', () => {
  it('lista boa passa como está; nulo, ausente e lixo viram null', () => {
    expect(sugestoesLidas([CONVERSAO, IGUAIS, PASSAGEIRA])).toEqual([CONVERSAO, IGUAIS, PASSAGEIRA])
    for (const ruim of [null, undefined, 'texto', 7, {}, [], [null], [{}], [{ codigo: 'x' }]]) expect(sugestoesLidas(ruim)).toBeNull()
  })
  it('descarta o item torto e fica com o bom; item_n precisa ser inteiro > 0 ou null; dados precisa ser objeto', () => {
    expect(sugestoesLidas([{ ...CONVERSAO, item_n: 0 }, { ...CONVERSAO, item_n: 'a' }, { ...CONVERSAO, dados: 'x' }, PASSAGEIRA])).toEqual([PASSAGEIRA])
  })
  it('código desconhecido é mantido na lista (o app só ignora quando não o entende)', () => {
    const futuro = { codigo: 'algo_novo', item_n: 3, acao: 'fazer_algo', dados: { x: 1 } }
    expect(sugestoesLidas([futuro])).toEqual([futuro])
  })
})

describe('conversão desnecessária — a sugestão manda no lugar do texto', () => {
  it('lê item, número e nome pela própria nota (sem regex do texto do robô)', () => {
    const lido = conversoesDaSugestao(nota({ lancamento_motivo: 'o robô mudou a frase e o app não a reconhece mais' }))
    expect(lido).toEqual({ itens: [{ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' }], resto: 'o robô mudou a frase e o app não a reconhece mais' })
  })
  it('com o texto de sempre reconhecido, o resto é o do texto (vazio = só este problema)', () => {
    expect(conversoesDaSugestao(nota())?.resto).toBe('')
  })
  it('o plano do botão "Tirar a conversão" nasce da sugestão mesmo com o texto irreconhecível, mas o "lança junto" não vale (sobra texto)', () => {
    const p = planoTirarConversao(nota({ lancamento_motivo: 'texto novo do robô' }))
    expect(p?.alvos.map((a) => a.n)).toEqual([5])
    expect(p?.resto).toBe('texto novo do robô')
  })
  it('sem sugestões, o plano é o de hoje (pelo texto)', () => {
    const sem = planoTirarConversao(nota({ lancamento_sugestoes: null }))
    expect(sem?.itens).toEqual([{ n: 5, nome: 'LONG WAY GUIOZA LW LEGUMES 240G', unidade: 'UN', numero: '0,24' }])
    expect(planoTirarConversao(nota({ lancamento_sugestoes: undefined, lancamento_motivo: 'x' }))).toBeNull()
  })
  it('nunca com sinal de que algo foi lançado, fora de "revisar", nem com número inválido', () => {
    expect(conversoesDaSugestao(nota({ lancamento_motivo: `${GUIOZA} | pedido JÁ gerado` }))?.resto ?? 'sem').not.toBe('')
    expect(conversoesDaSugestao(nota({ lancamento_motivo: 'o robô parou antes de terminar: Timeout — confira no SisChef' }))).toBeNull()
    expect(conversoesDaSugestao(nota({ lancamento_sugestoes: [{ ...CONVERSAO, dados: { numero: -1 } }] }))).toBeNull()
    expect(conversoesDaSugestao(nota({ lancamento_sugestoes: [{ ...CONVERSAO, dados: {} }] }))).toBeNull()
    expect(planoTirarConversao(nota({ lancamento_estado: 'erro' }))).toBeNull()
  })
  it('item que a nota não tem: usa "item N" no lugar do nome', () => {
    const lido = conversoesDaSugestao(nota({ itens: [], lancamento_sugestoes: [{ ...CONVERSAO, item_n: 9 }], lancamento_motivo: 'texto novo do robô' }))
    expect(lido?.itens[0]).toMatchObject({ n: 9, nome: 'item 9', numero: '0,24' })
  })
})

describe('dois itens com o mesmo CÓD. FOR — frase curta vinda da sugestão', () => {
  it('lê os itens e o código do dado', () => {
    expect(itensMesmoCodigoDaSugestao(nota({ lancamento_motivo: MESMO_COD, lancamento_sugestoes: [IGUAIS] }))).toEqual({ itens: [1, 2], codFor: '0009085' })
  })
  it('textoDoEstado explica em palavras simples, sem repetir a frase, e diz o que fazer', () => {
    const t = textoDoEstado('revisar', MESMO_COD, undefined, [IGUAIS]) ?? ''
    expect(t).toContain('Precisa de você — nada foi lançado.')
    expect(t).toContain('Os itens 1 e 2 da nota têm o mesmo código do fornecedor (0009085)')
    expect(t).toContain('O que fazer: associe esses itens direto no SisChef e lance de novo.')
    expect(t).not.toContain('CÓD. FOR')
  })
  it('sem a sugestão, o texto é o de hoje', () => {
    expect(textoDoEstado('revisar', MESMO_COD)).toBe(`Precisa de você: ${MESMO_COD}`)
    expect(textoDoEstado('revisar', MESMO_COD, undefined, null)).toBe(`Precisa de você: ${MESMO_COD}`)
  })
  it('com sinal de que algo pode ter sido lançado, ou fora de "revisar", a sugestão não vale', () => {
    expect(textoDoEstado('revisar', `${MESMO_COD} | pedido JÁ gerado`, undefined, [IGUAIS])).not.toContain('nada foi lançado')
    expect(textoDoEstado('erro', MESMO_COD, undefined, [IGUAIS])).not.toContain('mesmo código do fornecedor (0009085)')
  })
  it('três itens: "1, 2 e 3"', () => {
    const tres = { ...IGUAIS, dados: { itens: [1, 2, 3], cod_for: '77' } }
    expect(textoDoEstado('revisar', MESMO_COD, undefined, [tres])).toContain('Os itens 1, 2 e 3 da nota')
  })
})

describe('falha passageira da nota — a sugestão prova, o app confere de novo', () => {
  it('vale com a sugestão e o texto sem sinal de lançamento (mesmo com um texto que o app não conhecia)', () => {
    const p = passageiroDaNota(nota({ lancamento_motivo: 'parou antes de gerar o pedido (nada lançado): erro novo da tela que ninguém mapeou', lancamento_sugestoes: [PASSAGEIRA] }))
    expect(p).toEqual({ frase: 'Nada foi lançado. O robô parou por uma falha passageira do SisChef (demora ou conexão). Toque em Tentar de novo.', repetir: true })
  })
  it('sem a sugestão, é o mesmo de hoje (pelo texto)', () => {
    expect(passageiroDaNota(nota({ lancamento_motivo: TEMPO, lancamento_sugestoes: null }))?.repetir).toBe(true)
    expect(passageiroDaNota(nota({ lancamento_motivo: 'erro novo da tela que ninguém mapeou', lancamento_sugestoes: null }))).toBeNull()
  })
  it.each([
    ['queda do robô depois de começar', 'o robô parou antes de terminar: TimeoutError — confira no SisChef se algo foi criado antes de lançar de novo'],
    ['pedido já gerado', 'pedido JÁ gerado no SisChef; a compra ficou pela metade'],
    ['aviso de conferir', 'parou antes de gerar o pedido (nada lançado): x | CONFERIR NO SISCHEF'],
    ['texto longo (o banco corta em 2000)', `parou antes de gerar o pedido (nada lançado): ${'x'.repeat(1600)}`],
  ])('a sugestão NÃO vence o texto que mostra risco: %s', (_n, motivo) => {
    expect(passageiroDaNota(nota({ lancamento_motivo: motivo, lancamento_sugestoes: [PASSAGEIRA] }))?.repetir ?? false).toBe(false)
  })
  it('só em "revisar"; em erro/lançando a sugestão é ignorada', () => {
    expect(passageiroDaNota(nota({ lancamento_estado: 'erro', lancamento_motivo: TEMPO, lancamento_sugestoes: [PASSAGEIRA] }))).toBeNull()
    expect(falhaPassageiraDaSugestao(nota({ lancamento_estado: 'lancando', lancamento_sugestoes: [PASSAGEIRA] }))).toBe(false)
  })
})

describe('cupom — falha passageira pela sugestão', () => {
  const item = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 13, sugestao_produto: { id: '3484974' }, casado_por: 'descricao', proposta: null, quantidade_cupom: 13 }
  const cupom = (motivo: string, extra: Partial<CupomRecente> = {}): CupomRecente => ({
    id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO', valor_a_pagar: 100, pedido_sischef: null, criado_em: '2026-11-14T12:00:00Z', motivo, teste: false, itens: [item], sugestoes: [PASSAGEIRA], ...extra,
  } as unknown as CupomRecente)
  const NAO_COLOCOU = 'item 1: o Sischef não colocou o produto (código 3484974) na lista em ~15 s (demora do Sischef ou produto fora do catálogo)'

  it('texto conhecido: tudo igual a hoje (com o botão)', () => {
    expect(diagnosticoDoCupom(cupom(NAO_COLOCOU))).toMatchObject({ tentarDeNovo: true, problema: 'O SisChef demorou para mostrar o produto do item 1. Nada foi lançado.' })
  })
  it('texto que o app não conhecia: a sugestão dá a frase curta, mas SEM o botão (a função do servidor ainda confere o texto)', () => {
    const d = diagnosticoDoCupom(cupom('o robô tropeçou numa tela nova do SisChef'))
    expect(d?.problema).toBe('O SisChef falhou antes de lançar. Nada foi criado.')
    expect(d?.tentarDeNovo).toBeFalsy()
    expect(d?.problema).not.toContain('que ainda não sei explicar')
  })
  it('sem sugestão: o texto desconhecido segue como hoje', () => {
    expect(diagnosticoDoCupom(cupom('o robô tropeçou numa tela nova do SisChef', { sugestoes: null }))?.problema).toContain('motivo que ainda não sei explicar')
  })
  it.each([
    ['CONFERIR NO SISCHEF antes de repetir: erro inesperado no robô (x)'],
    ['falha ao montar o pedido no Sischef: x; GERAR_COMPRA_CLICADO'],
  ])('sinal de compra criada vence a sugestão: %s', (motivo) => {
    expect(diagnosticoDoCupom(cupom(motivo))?.problema ?? '').not.toContain('Nada foi criado')
    expect(motivoPassageiroDoCupom(cupom(motivo))).toBeNull()
  })
  it('com pedido no SisChef, item sem produto ou fora de REVISAR, a sugestão não vale', () => {
    expect(motivoPassageiroDoCupom(cupom('erro novo', { pedido_sischef: '163071006' }))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom('erro novo', { estado: 'PENDENTE' }))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom('erro novo', { itens: [{ ...item, sugestao_produto: null }] as never }))).toBeNull()
  })
})
