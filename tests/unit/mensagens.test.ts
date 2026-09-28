// Mensagens de WhatsApp da cotação (spec 10; contrato 8.3). Dados INVENTADOS (repositório público).
import {
  dadosEnvioDe, LIMITE_MENSAGEM, linhaCondicoes, linkCotacao, linkWhatsApp, mensagemCobranca, mensagemCotacao,
  mensagemLinkNovo, mensagemObrigado, mensagemPedido, RECEBIMENTO, restoDaEtiqueta, textoEtiqueta, URL_PAGINA,
} from '../../src/cotacao/mensagens'
import type { DadosEnvio, Gerais, Pedido } from '../../src/lib/tipos'
import { cotacao, dadosEnvio, itemCotacao, PREPARADA, vendedor } from '../fabricas'

const CODIGO = 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG'
type ItemMsg = DadosEnvio['itens'][number]
const im = (p: Partial<ItemMsg>): ItemMsg => ({
  numero: 1, produto_id: 1, nome: 'AGUA MINERAL 500ML', qtd: 60, unidade: 'un', rotulo: 'un', vende_por_litro: false,
  embalagem: null, fator: null, nota: null, ...p,
})
const ITENS: ItemMsg[] = [
  im({ numero: 1, produto_id: 1, nome: 'AGUA MINERAL 500ML', qtd: 60 }),
  im({ numero: 2, produto_id: 2, nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, embalagem: 'fardo', fator: 12 }),
  im({ numero: 3, produto_id: 3, nome: 'GELO ESCAMA', qtd: 3, rotulo: 'saco' }),
  im({ numero: 4, produto_id: 4, nome: 'FERMENTO SECO', qtd: 0.5, unidade: 'kg', rotulo: 'kg' }),
  im({ numero: 5, produto_id: 5, nome: 'LEITE LIQUIDO INTEGRAL', qtd: 19.9, unidade: 'kg', rotulo: 'kg', vende_por_litro: true }),
]
const GERAIS: Gerais = { pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null }

const RODAPE_EXEMPLOS = [
  'Preço de fardo ou caixa: diga quantas unidades vêm (ex.: R$ 31,50 fd c/6).',
  'Itens em kg: preço do kg ou da embalagem, com o peso (ex.: R$ 12,40 pct 400 g).',
]

describe('mensagemCotacao (spec 10.1)', () => {
  it('monta o texto inteiro: link no topo, quantidades com rótulo e fator, líquido, prazo e versão', () => {
    expect(mensagemCotacao(dadosEnvio({ itens: ITENS }))).toBe([
      'Oi, Fulano! Aqui é o Ivan, da Spazio Gourmet.',
      '*É COTAÇÃO, ainda não é pedido.* Pode me passar seus preços para os itens abaixo?',
      '',
      'Para responder pelo link (sem cadastro):',
      `${URL_PAGINA}#c=${CODIGO}`,
      '',
      'Ou copie a lista, escreva o preço no fim de cada linha e me mande de volta:',
      '1. AGUA MINERAL 500ML – 60 un – R$',
      '2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) – R$',
      '3. GELO ESCAMA – 3 sacos – R$',
      '4. FERMENTO SECO – 0,5 kg – R$',
      '5. LEITE LIQUIDO INTEGRAL – 19,9 kg – R$',
      '',
      ...RODAPE_EXEMPLOS,
      'Item 5 (líquido): pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).',
      'Não tem? Escreva "não tenho".',
      '',
      'Prazo: terça, 20/10, até 12h.',
      'Cotação v1 · Obrigado!',
    ].join('\n'))
  })

  it('sem líquido não tem a linha dos líquidos; com dois, "Itens 5 e 7 (líquidos)"', () => {
    expect(mensagemCotacao(dadosEnvio({ itens: ITENS.slice(0, 4) }))).not.toMatch(/líquido/)
    const dois = mensagemCotacao(dadosEnvio({ itens: [...ITENS, im({ numero: 7, produto_id: 7, nome: 'VINAGRE BRANCO', qtd: 2, unidade: 'kg', rotulo: 'kg', vende_por_litro: true })] }))
    expect(dois).toContain('Itens 5 e 7 (líquidos): pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).')
  })

  it('rótulo "saco": 1 saco no singular', () => {
    expect(mensagemCotacao(dadosEnvio({ itens: [im({ numero: 3, nome: 'GELO ESCAMA', qtd: 1, rotulo: 'saco' })] }))).toContain('3. GELO ESCAMA – 1 saco – R$')
  })

  it('nota do Ivan entre parênteses depois da quantidade (também depois da dica de fardo)', () => {
    const texto = mensagemCotacao(dadosEnvio({ itens: [
      im({ numero: 1, nome: 'AGUA MINERAL 500ML', qtd: 60, nota: 'sem gás' }),
      im({ numero: 2, nome: 'REFRIGERANTE COLA 350 ML', qtd: 104, embalagem: 'fardo', fator: 12, nota: 'fardo c/12' }),
    ] }))
    expect(texto).toContain('1. AGUA MINERAL 500ML – 60 un (sem gás) – R$')
    expect(texto).toContain('2. REFRIGERANTE COLA 350 ML – 104 un (9 fd c/12) (fardo c/12) – R$')
  })

  it('o horário de recebimento NÃO entra na mensagem de cotação', () => {
    expect(mensagemCotacao(dadosEnvio({ itens: ITENS }))).not.toContain(RECEBIMENTO)
    expect(mensagemCotacao(dadosEnvio({ itens: ITENS }))).not.toMatch(/recebe/i)
  })

  it('v2 que substitui a v1 e complementar', () => {
    expect(mensagemCotacao(dadosEnvio({ versao: 2, substitui_versao: 1 })).split('\n').at(-1))
      .toBe('Cotação v2 — substitui a v1; números iguais, itens novos no fim · Obrigado!')
    expect(mensagemCotacao(dadosEnvio({ versao: 2, complementar: true })).split('\n').at(-1))
      .toBe('Cotação complementar — itens novos desta semana · Obrigado!')
  })

  it('exemplos de preço idênticos em qualquer cotação, sejam quais forem os itens e as referências', () => {
    const exemplos = (d: DadosEnvio) => mensagemCotacao(d).split('\n').filter((l) => /ex\.:/.test(l))
    const a = exemplos(dadosEnvio({ itens: ITENS }))
    // itens cujo último preço seria exatamente o do exemplo não mudam nada (a mensagem nem recebe referência)
    const b = exemplos(dadosEnvioDe(
      cotacao({ status: 'pronta', ...PREPARADA }),
      [itemCotacao({ numero: 1, ref_preco: 5.25 }), itemCotacao({ id: 101, numero: 2, produto_id: 11, unidade: 'kg', rotulo: 'kg', vende_por_litro: true, ref_preco: 31 })],
      vendedor(), CODIGO,
    ))
    expect(a.slice(0, 2)).toEqual(RODAPE_EXEMPLOS)
    expect(b.slice(0, 2)).toEqual(RODAPE_EXEMPLOS)
    const semNumeros = (l: string) => l.replace(/^(Item|Itens) [\d e,]+\(líquidos?\): /, '')
    expect(semNumeros(a[2])).toBe(semNumeros(b[2]))
    expect(semNumeros(a[2])).toBe('pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).')
  })

  it('13 itens com notas de 80 caracteres passam de 1.300 caracteres (a tela avisa)', () => {
    const nota = 'N'.repeat(80)
    const itens = Array.from({ length: 13 }, (_, k) => im({ numero: k + 1, produto_id: k + 1, nome: `ITEM INVENTADO ${k + 1}`, qtd: 10, nota }))
    expect(mensagemCotacao(dadosEnvio({ itens })).length).toBeGreaterThan(LIMITE_MENSAGEM)
    expect(mensagemCotacao(dadosEnvio({ itens: itens.map((i) => ({ ...i, nota: null })) })).length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })
})

describe('links', () => {
  it('link da cotação com o código depois do "#" e prévia com &p=1', () => {
    expect(linkCotacao(CODIGO)).toBe(`${URL_PAGINA}#c=${CODIGO}`)
    expect(linkCotacao(CODIGO, true)).toBe(`${URL_PAGINA}#c=${CODIGO}&p=1`)
  })
  it('wa.me com o texto codificado', () => {
    expect(linkWhatsApp('5511900000001', 'Oi, Fulano! 1 & 2')).toBe('https://wa.me/5511900000001?text=Oi%2C%20Fulano!%201%20%26%202')
  })
})

describe('mensagemCobranca (10.2)', () => {
  it('fechamento hoje: "até as 17h de hoje"', () => {
    expect(mensagemCobranca('Fulano', PREPARADA.fechamento, new Date('2026-10-20T16:00:00Z')))
      .toBe('Oi, Fulano! Conseguiu ver a cotação? Se der, me manda até as 17h de hoje. Obrigado!')
  })
  it('fechamento em outro dia: dia da semana, data e hora', () => {
    expect(mensagemCobranca('Fulano', PREPARADA.fechamento, new Date('2026-10-19T19:00:00Z')))
      .toBe('Oi, Fulano! Conseguiu ver a cotação? Se der, me manda até terça, 20/10, às 17h. Obrigado!')
  })
})

describe('10.4, 10.5 e etiquetas', () => {
  it('obrigado, desta vez não', () => {
    expect(mensagemObrigado('Fulano')).toBe('Fulano, obrigado pela cotação! Desta vez não vou fechar, mas conto com você na próxima.')
  })
  it('link novo', () => {
    expect(mensagemLinkNovo('Fulano', CODIGO)).toBe(`Fulano, o link da cotação mudou. Use este: ${URL_PAGINA}#c=${CODIGO}. O anterior não vale mais.`)
  })
  it('etiquetas do comprador', () => {
    expect(textoEtiqueta({ item_semana_id: 1, estado: 'pedido', vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: null, qtd: 8 }))
      .toBe('Pedido com FORNECEDOR A — chega por entrega')
    expect(textoEtiqueta({ item_semana_id: 1, estado: 'em_cotacao', vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: null, qtd: 8 }))
      .toBe('Em cotação com FORNECEDOR A — não comprar na loja')
    expect(textoEtiqueta({ item_semana_id: 1, estado: 'aguardando_cotacao', vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: '2026-10-20T15:00:00Z', qtd: null }))
      .toBe('Aguardando cotação com FORNECEDOR A até ter 12h — não comprar na loja')
  })
  it('etiqueta que cobre só parte do item diz quanto e manda comprar o resto na loja (D63)', () => {
    const acucar = { qtd_aprovada: 8, unidade: 'kg' as const }
    const m = (estado: 'pedido' | 'em_cotacao' | 'aguardando_cotacao', qtd: number | null) =>
      ({ item_semana_id: 1, estado, vendedor_id: 1, vendedor: 'FORNECEDOR A', ate: null, qtd })
    expect(textoEtiqueta(m('pedido', 1), acucar)).toBe('Pedido com FORNECEDOR A: 1 kg — comprar o resto (7 kg) na loja')
    expect(textoEtiqueta(m('em_cotacao', 1.5), acucar)).toBe('Em cotação com FORNECEDOR A: 1,5 kg — comprar o resto (6,5 kg) na loja')
    // cobre tudo (ou mais: fardo fechado), sem quantidade, ou "aguardando": o texto de sempre
    expect(textoEtiqueta(m('pedido', 8), acucar)).toBe('Pedido com FORNECEDOR A — chega por entrega')
    expect(textoEtiqueta(m('pedido', 9.6), acucar)).toBe('Pedido com FORNECEDOR A — chega por entrega')
    expect(textoEtiqueta(m('em_cotacao', null), acucar)).toBe('Em cotação com FORNECEDOR A — não comprar na loja')
    expect(restoDaEtiqueta(m('pedido', 1), 8)).toBe(7)
    expect(restoDaEtiqueta(m('pedido', 0.1), 0.3)).toBe(0.2)
    expect(restoDaEtiqueta(m('pedido', 8), 8)).toBeNull()
    expect(restoDaEtiqueta(m('aguardando_cotacao', 1), 8)).toBeNull()
  })
})

describe('mensagemPedido (10.3)', () => {
  const d = dadosEnvio({ itens: ITENS })
  const pedido = (itens: Pedido['itens']): Pedido => ({ cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-10-21T13:00:00Z', itens })
  const linha = (p: Partial<Pedido['itens'][number]>): Pedido['itens'][number] => ({
    numero: 1, produto_id: 1, qtd: 60, base: 'un', embalagens: null, fator: null, preco_combinado: 2, preco_convertido: 2, marca: null, ...p,
  })
  const LINHAS = [
    linha({ numero: 2, produto_id: 2, qtd: 108, base: 'embalagem', embalagens: 9, fator: 12, preco_combinado: 42, preco_convertido: 3.5 }),
    linha({ numero: 4, produto_id: 4, qtd: 0.5, base: 'kg', preco_combinado: 40, preco_convertido: 40 }),
  ]

  it('só os itens do pedido, total com frete, pagamento, entrega com o horário de recebimento', () => {
    expect(mensagemPedido(d, pedido(LINHAS), { ...GERAIS, frete: 30, pagamento: 'boleto 28 dias' }, 'qua 21/10')).toBe([
      'Fulano, vamos fechar! PEDIDO Spazio Gourmet (cotação v1):',
      '2. REFRIGERANTE COLA 350 ML – 9 fardos c/12 (108 un) – R$ 42,00 o fardo',
      '4. FERMENTO SECO – 0,5 kg – R$ 40,00 o kg',
      'Total com frete: R$ 428,00 (itens R$ 398,00 + frete R$ 30,00) · Pagamento: boleto 28 dias',
      `Entrega: qua 21/10, ${RECEBIMENTO}.`,
      'Pode confirmar, por favor?',
    ].join('\n'))
    expect(RECEBIMENTO).toBe('seg a sex, 7h–11h e 14h–18h; sáb, 7h–11h e 14h–16h')
  })

  it('frete 0 → "(sem frete)"; frete não informado → só o total; entrega vazia → "a combinar"', () => {
    expect(mensagemPedido(d, pedido(LINHAS), { ...GERAIS, frete: 0 }, '')).toContain('Total: R$ 398,00 (sem frete)')
    const semFrete = mensagemPedido(d, pedido(LINHAS), GERAIS, null)
    expect(semFrete).toContain('\nTotal: R$ 398,00\n')
    expect(semFrete).toContain(`Entrega: a combinar, ${RECEBIMENTO}.`)
  })

  it('item por litro sem conversão: "+ item 5 sem total"', () => {
    const litro = linha({ numero: 5, produto_id: 5, qtd: 19.9, base: 'litro', preco_combinado: 6, preco_convertido: null })
    const texto = mensagemPedido(d, pedido([...LINHAS, litro]), { ...GERAIS, frete: 30 }, 'amanhã')
    expect(texto).toContain('5. LEITE LIQUIDO INTEGRAL – 19,9 kg – R$ 6,00 o litro')
    expect(texto).toContain('Total com frete: R$ 428,00 (itens R$ 398,00 + frete R$ 30,00) + item 5 sem total')
  })
})

describe('linhaCondicoes (cartão com resposta)', () => {
  it('boleto 28 d · mín. · frete · entrega · validade', () => {
    expect(linhaCondicoes({ pagamento: 'boleto 28 d', validade: '2026-09-23', pedido_minimo: 300, frete: 30, entrega: '1 dia', observacao: 'x' }, '2026-09-21'))
      .toBe('boleto 28 d · mín. R$ 300,00 · frete R$ 30,00 · entrega 1 dia · válido até qua 23/09')
  })
  it('sem mínimo e frete grátis; campo vazio some', () => {
    expect(linhaCondicoes({ ...GERAIS, pedido_minimo: 0, frete: 0 }, '2026-09-21')).toBe('sem mínimo · frete grátis')
    expect(linhaCondicoes(GERAIS, '2026-09-21')).toBe('')
  })
  it('validade anterior a hoje: "preço vencido em dd/mm"', () => {
    expect(linhaCondicoes({ ...GERAIS, pagamento: 'Pix', validade: '2026-09-20' }, '2026-09-21')).toBe('Pix · preço vencido em 20/09')
  })
})

describe('dadosEnvioDe', () => {
  it('mesmo formato do cot_dados_envio: só marcados, por número, embalagem só confirmada, com a nota', () => {
    const d = dadosEnvioDe(
      cotacao({ status: 'enviada', ...PREPARADA }),
      [
        itemCotacao({ id: 2, numero: 2, produto_id: 11, nome: 'B', embalagem: 'fardo', fator: 12, fator_confirmado: true, nota_vendedor: 'fardo c/12' }),
        itemCotacao({ id: 1, numero: 1, produto_id: 10, nome: 'A', embalagem: 'caixa', fator: 6, fator_confirmado: false }),
        itemCotacao({ id: 3, numero: null, incluido: false, produto_id: 12, nome: 'C' }),
      ],
      vendedor(), CODIGO,
    )
    expect(d.itens.map((i) => [i.numero, i.nome, i.embalagem, i.fator, i.nota])).toEqual([[1, 'A', null, null, null], [2, 'B', 'fardo', 12, 'fardo c/12']])
    expect(d.prazo_local).toBe('2026-10-20 12:00')
    expect(d.vendedor.rotulo).toBe('FORNECEDOR A')
  })
})
