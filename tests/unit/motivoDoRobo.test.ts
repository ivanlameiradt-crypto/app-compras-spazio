import { explicarMotivoDoRobo, motivoSemPrefixoTecnico, nomeDoItem, numeroDoRobo } from '../../src/admin/motivoDoRobo'
import { prontidaoDaNota, textoDoEstado, traduzirMotivo } from '../../src/admin/notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

// Os motivos REAIS que o Ivan viu em 21/10/2026 (MATEUS 000089465 e R&C 000011031) e os itens da nota como a cot_nfe os guarda.
const MOTIVO_SHOYU = 'parou antes de gerar o pedido (nada lançado): item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)'
const MOTIVO_FRETE = 'nota com frete (R$ 492,82): o lançamento com frete ainda não está ligado (secret NFE_FRETE_LIGADO) — nada foi lançado; lance esta nota à mão no SisChef ou ligue o frete com o Claude acompanhando'
const ITENS: ItemNotaSefaz[] = [
  { n: 1, descricao: 'CÓD. FOR: 14192 AÇUCAR CRISTAL - INSUMOS', qtd: 60, unidade_sischef: 'KG', produto_id: 1874466, associacao: 'sischef', produto_nome: 'AÇUCAR CRISTAL - INSUMOS' },
  { n: 5, descricao: 'CÓD. FOR: 263230 SHOYU TRADICIONAL - INSUMOS', qtd: 3, unidade_sischef: 'KG', produto_id: 3644178, associacao: 'sischef', produto_nome: 'SHOYU TRADICIONAL - INSUMOS' },
  { n: 6, descricao: 'CÓD. FOR: 473185 ÓLEO DE ALGODÃO - INSUMOS', qtd: 20, unidade_sischef: 'UN', produto_id: 3469755, associacao: 'sischef' },
]

describe('numeroDoRobo — os números como o robô os escreve', () => {
  it.each([['3', 3], ['9,6', 9.6], ['0,395', 0.395], ['1680', 1680], ['1.680', 1680], ['31,995', 31.995]])('%s → %s', (texto, esperado) => {
    expect(numeroDoRobo(texto)).toBe(esperado)
  })
  it.each(['', 'abc', '1,2,3', '1.68', '-3', '3 kg'])('%j não é número do robô', (texto) => {
    expect(numeroDoRobo(texto)).toBeNull()
  })
})

describe('nomeDoItem', () => {
  it('o nome do produto sem o "- INSUMOS" do cadastro', () => {
    expect(nomeDoItem(ITENS, '263230')).toBe('SHOYU TRADICIONAL')
    expect(nomeDoItem(ITENS, '14192')).toBe('AÇUCAR CRISTAL')
  })
  it('sem produto_nome usa a descrição sem o "CÓD. FOR: N"', () => {
    expect(nomeDoItem(ITENS, '473185')).toBe('ÓLEO DE ALGODÃO')
  })
  it('item que a nota não tem: null', () => {
    expect(nomeDoItem(ITENS, '999')).toBeNull()
    expect(nomeDoItem(undefined, '263230')).toBeNull()
  })
})

describe('explicarMotivoDoRobo — a conta de unidades que não bate (o Shoyu da MATEUS 000089465)', () => {
  it('diz o produto pelo nome, a conta do SisChef e a do app, e o que fazer', () => {
    const e = explicarMotivoDoRobo(MOTIVO_SHOYU, ITENS)
    expect(e).not.toBeNull()
    expect(e!.porque).toBe('No SHOYU TRADICIONAL a conta não bate: a nota traz 1 unidade e o SisChef converte isso para 3 kg, mas no app a conversão está em 1 kg por unidade.')
    expect(e!.fazer).toBe('Veja qual é o certo. Se cada unidade tem 3 kg, toque em Editar no SHOYU TRADICIONAL e informe 3. '
      + 'Se o certo é 1 kg, corrija a conversão do produto no SisChef. Depois lance de novo.')
  })

  it('com mais de uma unidade na nota mostra o fator por unidade (o cheddar: 8 barras viraram 9,6 kg)', () => {
    const e = explicarMotivoDoRobo('item CÓD. FOR 263230 já associado: Qtde Conver. na tela 9,6 ≠ 8 x 2,27 (conversão do painel)', ITENS)
    expect(e!.porque).toBe('No SHOYU TRADICIONAL a conta não bate: a nota traz 8 unidades e o SisChef converte isso para 9,6 kg (1,2 kg por unidade), mas no app a conversão está em 2,27 kg por unidade.')
    expect(e!.fazer).toContain('Se cada unidade tem 1,2 kg, toque em Editar no SHOYU TRADICIONAL e informe 1,2.')
  })

  it('sem o item na nota chama de "item 263230" (e sem unidade quando a nota não a trouxe)', () => {
    const e = explicarMotivoDoRobo(MOTIVO_SHOYU, [])
    expect(e!.porque).toBe('No item 263230 a conta não bate: a nota traz 1 unidade e o SisChef converte isso para 3, mas no app a conversão está em 1 por unidade.')
    expect(e!.fazer).toContain('toque em Editar no item 263230 e informe 3.')
  })

  it('quantidade da nota zero ou número ilegível: não explica (a tela mostra o texto do robô)', () => {
    expect(explicarMotivoDoRobo('item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 0 x 1 (conversão do painel)', ITENS)).toBeNull()
  })
})

describe('explicarMotivoDoRobo — frete, UN DIFERE e o que não conhece', () => {
  it('nota com frete (R&C 000011031)', () => {
    const e = explicarMotivoDoRobo(MOTIVO_FRETE, ITENS)
    expect(e!.porque).toBe('Esta nota tem frete (R$ 492,82) e o robô ainda não lança nota com frete sozinho.')
    expect(e!.fazer).toBe('Lance esta nota à mão no SisChef, ou peça o teste acompanhado do frete.')
  })

  it('UN DIFERE sem conversão: um item e vários, pelo nome', () => {
    const um = explicarMotivoDoRobo('UN DIFERE sem conversão na tela: CÓD. FOR 263230 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)', ITENS)
    expect(um!.porque).toBe('O SisChef pede a conversão de unidade de SHOYU TRADICIONAL: a nota vem numa unidade, o produto está em outra, e o app ainda não tem o número.')
    expect(um!.fazer).toBe('Confira se o produto que o SisChef ligou a este código está certo (aqui: SHOYU TRADICIONAL). '
      + 'Se está certo, toque em Editar nesse item e informe quanto vale 1 unidade da nota. '
      + 'Se NÃO está certo, a ligação do SisChef está errada e o app ainda não troca o produto de um item já ligado: peça ao Claude para corrigir no SisChef. Depois lance de novo.')
    const varios = explicarMotivoDoRobo('UN DIFERE sem conversão na tela: CÓD. FOR 263230; 14192; 999 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)', ITENS)
    expect(varios!.porque).toContain('de SHOYU TRADICIONAL, AÇUCAR CRISTAL e item 999:')
    expect(varios!.fazer).toContain('Confira se os produtos que o SisChef ligou a estes códigos estão certos.')
    expect(varios!.fazer).toContain('em cada um desses itens')
    expect(varios!.fazer).toContain('Se algum NÃO está certo')
  })

  it('motivo que nenhuma regra conhece, vazio ou nulo: null', () => {
    expect(explicarMotivoDoRobo('algo que o robô disse e a regra não conhece', ITENS)).toBeNull()
    expect(explicarMotivoDoRobo('', ITENS)).toBeNull()
    expect(explicarMotivoDoRobo(null, ITENS)).toBeNull()
  })
})

describe('motivoSemPrefixoTecnico', () => {
  it('troca "parou antes de gerar o pedido (nada lançado):" por "Nada foi lançado."', () => {
    expect(motivoSemPrefixoTecnico('parou antes de gerar o pedido (nada lançado): o SisChef pediu outra coisa'))
      .toBe('Nada foi lançado. o SisChef pediu outra coisa')
  })
  it('sem o começo técnico, o texto fica igual (só com os espaços arrumados)', () => {
    expect(motivoSemPrefixoTecnico('  item   sem unidade ')).toBe('item sem unidade')
  })
})

// ---------------- como a tela usa: traduzirMotivo, textoDoEstado e a lista de pendências ----------------
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '1'.repeat(44), emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089465', emissao: '2026-10-21', valor_nf: 1308.19, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: ITENS, parcelas: [], lancamento_estado: 'revisar', lancamento_motivo: MOTIVO_SHOYU, ...extra,
})

describe('traduzirMotivo e textoDoEstado com os itens da nota', () => {
  it('traduzirMotivo junta o que aconteceu e o que fazer em uma frase', () => {
    const t = traduzirMotivo(MOTIVO_SHOYU, ITENS)
    expect(t).toContain('No SHOYU TRADICIONAL a conta não bate')
    expect(t).toContain(' O que fazer: Veja qual é o certo.')
    expect(t).not.toContain('CÓD. FOR 263230')
  })

  it('o aviso da nota "Precisa de você" vem em 3 linhas: nada foi lançado, por quê e o que fazer', () => {
    const linhas = textoDoEstado('revisar', MOTIVO_SHOYU, ITENS)!.split('\n')
    expect(linhas).toHaveLength(3)
    expect(linhas[0]).toBe('Precisa de você — nada foi lançado.')
    expect(linhas[1]).toMatch(/^Por quê: No SHOYU TRADICIONAL a conta não bate/)
    expect(linhas[2]).toMatch(/^O que fazer: Veja qual é o certo\. Se cada unidade tem 3 kg, toque em Editar/)
  })

  it('o frete da R&C também vem claro', () => {
    expect(textoDoEstado('revisar', MOTIVO_FRETE, ITENS)).toBe(
      'Precisa de você — nada foi lançado.\nPor quê: Esta nota tem frete (R$ 492,82) e o robô ainda não lança nota com frete sozinho.\n'
      + 'O que fazer: Lance esta nota à mão no SisChef, ou peça o teste acompanhado do frete.')
  })

  it('motivo desconhecido segue como antes ("Precisa de você: <texto>"), só sem o começo técnico', () => {
    expect(textoDoEstado('revisar', 'x', ITENS)).toBe('Precisa de você: x')
    expect(textoDoEstado('revisar', 'parou antes de gerar o pedido (nada lançado): o SisChef pediu outra coisa', ITENS))
      .toBe('Precisa de você: Nada foi lançado. o SisChef pediu outra coisa')
    expect(textoDoEstado('revisar', null, ITENS)).toBe('Precisa de você: confira a nota')
  })

  it('sem passar os itens (chamada antiga) o texto do estado ainda funciona', () => {
    expect(textoDoEstado('revisar', MOTIVO_SHOYU)).toContain('No item 263230 a conta não bate')
  })

  it('a lista do que falta para a nota ficar pronta traz a frase explicada, com o nome do produto', () => {
    const motivos = prontidaoDaNota(nota()).motivos
    expect(motivos.some((m) => m.startsWith('Precisa de você: No SHOYU TRADICIONAL a conta não bate'))).toBe(true)
  })

  it('o motivo "sem boleto" continua virando o aviso de escolher como pagar', () => {
    expect(traduzirMotivo('sem boletos na nota — pagamento manual', ITENS)).toBe('A nota não tem boleto: escolha como pagar')
  })
})

// 31/10/2026: três paradas do robô que o Ivan via com o texto técnico (De Marchi 113752, Plast Mais 8928 e James 128432).
const MOTIVO_XML = 'não consegui ler o XML da nota (Ações → Baixar documento na lista de não importadas não trouxe o XML desta chave (o popup trouxe o XML de outra nota ou um XML ilegível))'
const MOTIVO_FORNECEDOR = 'fornecedor não cadastrado no Sischef e sem autorização do Ivan (autorize no app) — nada lançado'
const MOTIVO_SOZINHO = 'item CÓD. FOR 17898647163635 (PAPEL HIGIENICO FOLHA DUPLA FD C/18): o SisChef converteu por conta própria — a tela mostra 8 UN para 1 FD da nota (8 por unidade) — e o painel decidiu 18 por unidade (18 UN). Nada foi gerado: acerte essa conversão (no painel, se o fator do SisChef for o certo; senão no SisChef) e lance de novo'
const ITENS_JAMES: ItemNotaSefaz[] = [
  { n: 3, descricao: 'CÓD. FOR: 17898647163635 PAPEL HIGIENICO FOLHA DUPLA FD C/18', qtd: 1, unidade_sischef: 'FD', produto_id: 3476456, associacao: 'sischef', produto_nome: 'PAPEL HIGIENICO - INSUMOS' },
]

describe('explicarMotivoDoRobo — XML não lido, fornecedor novo e conversão que o SisChef fez sozinho (31/10/2026)', () => {
  it('XML não lido: o SisChef pode só ter o resumo; diz que digitar as parcelas não adianta e manda esperar e lançar de novo', () => {
    const e = explicarMotivoDoRobo(MOTIVO_XML, ITENS)
    expect(e?.porque).toContain('o SisChef só recebeu da SEFAZ o resumo da nota')
    expect(e?.porque).toContain('algumas horas')
    expect(e?.fazer).toContain('não adianta digitar as parcelas aqui embaixo')
    expect(e?.fazer).toContain('toque em Lançar de novo')
    expect(e?.fazer).toContain('chame o Claude')
  })

  it('XML não lido: reconhece também as outras causas da leitura (sem vProd/vNF, link que não clicou) e o começo técnico', () => {
    for (const m of ['não consegui ler o XML da nota (sem vProd/vNF)', 'não consegui ler o XML da nota (sem XML)',
      'parou antes de gerar o pedido (nada lançado): não consegui ler o XML da nota (link Ações não clicou (Timeout))']) {
      expect(explicarMotivoDoRobo(m, ITENS)?.fazer).toContain('não adianta digitar as parcelas aqui embaixo')
    }
  })

  it('XML não lido: o aviso da nota vem em 3 linhas (nada foi lançado, por quê, o que fazer)', () => {
    const texto = textoDoEstado('revisar', MOTIVO_XML, ITENS) ?? ''
    expect(texto.startsWith('Precisa de você — nada foi lançado.\nPor quê: O robô não conseguiu ler o XML completo desta nota.')).toBe(true)
    expect(texto).toContain('\nO que fazer: Por enquanto não adianta digitar as parcelas aqui embaixo')
  })

  it('fornecedor sem autorização: manda usar a caixa "Cadastrar no SisChef" da própria nota e depois tocar em Lançar', () => {
    const e = explicarMotivoDoRobo(MOTIVO_FORNECEDOR, ITENS)
    expect(e?.porque).toBe('O fornecedor desta nota ainda não está cadastrado no SisChef, e o robô só cadastra fornecedor novo com a sua autorização.')
    expect(e?.fazer).toContain('Use a caixa “Fornecedor não cadastrado no SisChef” logo abaixo')
    expect(e?.fazer).toContain('“Buscar dados do CNPJ”')
    expect(e?.fazer).toContain('“Cadastrar no SisChef”')
    expect(e?.fazer).toContain('toque em Lançar')
  })

  it('fornecedor novo: o aviso do ensaio ("cadastraria … num clique") também é explicado do mesmo jeito', () => {
    const ensaio = 'fornecedor: cadastraria PLAST MAIS SOCIEDADE UNIPESSOAL LTDA CNPJ 55.384.032/0001-20 num clique (cadastra do XML) — conferi Cadastros › Pessoas: 0 com o CNPJ'
    expect(explicarMotivoDoRobo(ensaio, ITENS)?.fazer).toContain('Use a caixa “Fornecedor não cadastrado no SisChef” logo abaixo')
  })

  it('o SisChef converteu por conta própria (James 128432): o produto pelo nome, as duas contas e os dois caminhos', () => {
    const e = explicarMotivoDoRobo(MOTIVO_SOZINHO, ITENS_JAMES)
    expect(e?.porque).toBe('No PAPEL HIGIENICO o SisChef converteu sozinho, pela conversão que ele já tinha guardada: 1 fd da nota viram 8 un (8 un por unidade). '
      + 'Mas no app a conversão está em 18 un por unidade.')
    expect(e?.fazer).toContain('Se a do SisChef (8 un) está certa, toque em Editar no PAPEL HIGIENICO e informe 8.')
    expect(e?.fazer).toContain('Se a certa é a do app (18 un), o SisChef está com a conversão antiga para este código do fornecedor: peça ao Claude')
  })

  it('o SisChef converteu por conta própria: sem o item na nota chama de "item <código>"; sem unidades escreve só os números', () => {
    const sem = explicarMotivoDoRobo(MOTIVO_SOZINHO.replace('8 UN para 1 FD', '8 para 1'), [])
    expect(sem?.porque).toContain('No item 17898647163635 o SisChef converteu sozinho')
    expect(sem?.porque).toContain('1 da nota viram 8 (8 por unidade). Mas no app a conversão está em 18 por unidade.')
  })

  it('o SisChef converteu por conta própria: número ilegível ou nota com quantidade zero não é explicado (a tela mostra o texto do robô)', () => {
    expect(explicarMotivoDoRobo(MOTIVO_SOZINHO.replace('para 1 FD', 'para 0 FD'), ITENS_JAMES)).toBeNull()
    expect(explicarMotivoDoRobo(MOTIVO_SOZINHO.replace('decidiu 18 por', 'decidiu 1.8 por'), ITENS_JAMES)).toBeNull()
  })

  it('texto parecido que nenhuma regra conhece segue como antes', () => {
    expect(explicarMotivoDoRobo('não consegui ler o cadastro de produtos do SisChef (catálogo vivo vazio)', ITENS)).toBeNull()
    expect(explicarMotivoDoRobo('fornecedor não cadastrado no Sischef (cadastrar antes de lançar)', ITENS)).toBeNull()
  })
})
