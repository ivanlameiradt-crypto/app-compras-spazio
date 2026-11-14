import { motivoPassageiro } from '../../src/admin/motivoDoRobo'
import { passageiroDaNota, textoDoEstado } from '../../src/admin/notaSefazRegras'
import type { NotaSefazLista } from '../../src/lib/tipos'

// 14/11/2026 (pedido do Ivan, leigo): os motivos PASSAGEIROS da nota fiscal (rede, SisChef lento, login que caiu, tela que não abriu...) chegavam crus ("Timeout 60000ms exceeded",
// "item 12: 3 linhas na tela (esperava 1)"). Agora: uma frase curta que diz se algo foi lançado e, quando nada foi criado, o botão "Tentar de novo".
// Os moldes abaixo foram copiados do código do robô (sischef-monitor-notas, master 96a469b): motor.py, nfe_decisoes_app.py, lancar_nfe_nuvem.py, analisar.py e a função lancar-nfe do app.
const ANTES = 'parou antes de gerar o pedido (nada lançado): '
const SUFIXO_CONFIRA = ' — confira no SisChef se algo foi criado antes de lançar de novo'

const TECNICO = /Timeout|TimeoutError|RuntimeError|net::|Cód\. Interno|snapshot|catálogo vivo|Supabase|Playwright|Target page|CÓD\. FOR|PrimeFaces|UN DIFERE/i

// [nome, motivo do robô]: nada foi criado no SisChef, repetir é seguro
const SEGUROS: Array<[string, string]> = [
  ['login que não entrou, com o começo "nada lançado"', `${ANTES}RuntimeError: Login no Sischef não foi concluído (senha, 2FA ou bloqueio).`],
  ['antes_do_sischef: sem o cliente do app', 'o robô parou antes de terminar: lançamento real sem o cliente do app (Supabase) para marcar o desfecho'],
  ['antes_do_sischef: sem falar com o app', 'o robô parou antes de terminar: não consegui falar com o app (Supabase) antes de começar: ConnectError: timed out'],
  ['tempo esgotado ao abrir a tela', `${ANTES}TimeoutError: Page.goto: Timeout 90000ms exceeded.`],
  ['rede caiu', `${ANTES}Error: Page.goto: net::ERR_INTERNET_DISCONNECTED at https://sischef.example/lista`],
  ['navegador fechou', `${ANTES}TargetClosedError: Target page, context or browser has been closed`],
  ['a tela não foi para o endereço', `${ANTES}abrir a importação: a tela não foi para /importacao/ (estou em https://sischef.example/lista): TimeoutError: Timeout 60000ms exceeded.`],
  ['não achei o botão', `${ANTES}não achei o botão/link 'Finalizar importação' visível na tela (Timeout 15000ms exceeded.); parecidos na tela: Cancelar importação, Voltar`],
  ['esperava exatamente 1 botão', `${ANTES}esperava exatamente 1 botão/link 'Salvar' visível e achei 2: Salvar, Salvar — não cliquei`],
  ['o clique não chegou', `${ANTES}o clique no botão não chegou: Timeout 30000ms exceeded. | por cima do botão: div.ui-blockui`],
  ['item: 3 linhas na tela', `${ANTES}item 17253: 3 linhas na tela (esperava 1)`],
  ['item: nenhuma opção', `${ANTES}item 17253: nenhuma opção com Cód. Interno 3971031 (digitei: "GUIOZA"; "3971031")`],
  ['item: o modal de conversão não abriu', `${ANTES}item 17253: cliquei em UN DIFERE e o modal de conversão não abriu`],
  ['item: a linha ficou', `${ANTES}item 17253: depois da escolha a linha ficou 'Produto não encontrado' (esperava Cód. Interno 3971031 e 'Produto encontrado')`],
  ['item: o campo da conversão ficou', `${ANTES}item 17253: o campo da conversão ficou '1' (esperava 0,24)`],
  ['item: o modal não fechou', `${ANTES}item 17253: o modal de conversão não fechou depois do Adicionar`],
  ['não li o total da tela de importação', 'não li o total da tela de importação'],
  ['total da importação diferente', 'total da importação R$ 1.000,00 ≠ NF R$ 990,00'],
  ['associação por ID divergiu', `${ANTES}associação por ID divergiu do snapshot esperado`],
  ['itens do painel que não estão na tela', 'item(ns) do painel que não estão na tela: CÓD. FOR 123, 456'],
  ['memória de embalagens ilegível', 'não consegui ler a memória de embalagens do app (ConnectError: timed out): um fardo ou pacote lembrado poderia entrar no estoque sem multiplicar — nada foi feito no SisChef; tente de novo (se o banco continuar fora, avise o Claude)'],
  ['catálogo vivo vazio', 'não consegui ler o cadastro de produtos do SisChef (catálogo vivo vazio): não dá para conferir as unidades da escolha do app — tente de novo'],
  ['produto fora da leitura do cadastro', 'item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar — se ele existe lá, a leitura do cadastro pode ter vindo incompleta: lance de novo ou associe no SisChef'],
  ['dois itens com produto fora da leitura', 'item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar — lance de novo ou associe no SisChef; item 6: o produto 3971040 não está no cadastro do SisChef (ou está sem unidade): não dá para associar — lance de novo ou associe no SisChef'],
  ['unidade do item não lida', 'item 5 (CÓD. FOR: 2894 GUIOZA 240G): a leitura do SisChef não trouxe a unidade deste item na nota — não dá para saber se precisa de conversão para UN; atualize a lista de notas do app e tente de novo (ou associe no SisChef)'],
  ['outra importação aberta', 'há outra importação aberta no Sischef — não cancelei a importação dos outros'],
  ['a tela de importação não abriu', 'não foi possível ler a tela de importação desta nota'],
  ['XML não lido (resumo)', 'não consegui ler o XML da nota (Ações → Baixar documento na lista de não importadas não trouxe o XML desta chave (sem XML))'],
  ['XML não lido com o começo técnico', `${ANTES}não consegui ler o XML da nota (link Ações não clicou (Timeout))`],
  ['execução do GitHub que morreu antes de começar', 'O robô não chegou a começar: a execução no GitHub foi cancelada antes de tocar no SisChef (por exemplo, travou ao preparar o navegador). Nada foi criado no SisChef; pode lançar de novo.'],
  ['fornecedor já cadastrado pelo robô, depois uma queda de tela', `${ANTES}TimeoutError: Page.goto: Timeout 60000ms exceeded. | fornecedor JÁ cadastrado pelo robô (1 clique, cadastra do XML) e fica; a próxima tentativa vê 'Fornecedor encontrado' e não cadastra de novo`],
]

// o robô parou, mas o SisChef PODE ter recebido a nota (ou parte dela): nunca repetir sem conferir
const TALVEZ: Array<[string, string]> = [
  ['queda do robô depois de começar', `o robô parou antes de terminar: TargetClosedError: Target page, context or browser has been closed${SUFIXO_CONFIRA}`],
  ['queda com tempo esgotado depois de começar', `o robô parou antes de terminar: TimeoutError: Timeout 600000ms exceeded.${SUFIXO_CONFIRA}`],
  ['login no meio de uma queda depois de começar', `o robô parou antes de terminar: RuntimeError: Login no Sischef não foi concluído (senha, 2FA ou bloqueio).${SUFIXO_CONFIRA}`],
  ['login sem o começo "nada lançado" e sem o "confira": só os dois textos legítimos de antes_do_sischef provam que nada foi tocado', 'o robô parou antes de terminar: RuntimeError: Login no Sischef não foi concluído (senha, 2FA ou bloqueio).'],
  ['queda sem o "confira" (qualquer outro texto)', 'o robô parou antes de terminar: TimeoutError: Page.goto: Timeout 30000ms exceeded.'],
  ['texto longo que perdeu o "confira" no corte de 2.000 letras', `o robô parou antes de terminar: TimeoutError: ${'x'.repeat(2100)}`],
  ['texto legítimo de antes_do_sischef mas longo demais', `o robô parou antes de terminar: não consegui falar com o app (Supabase) antes de começar: ConnectError: ${'x'.repeat(1600)}`],
  ['começo "nada lançado" mas sobrou um trecho que nenhuma regra explica', `${ANTES}item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar; Gerar compra: pedido criado`],
  ['começo "nada lançado", uma parte conhecida e outra item desconhecido', `${ANTES}item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar; item 6 (CÓD. FOR: 31 MOLHO): precisa de conversão: 1 UN da nota = ? KG`],
  ['clique que estourou o prazo depois de começar', `${ANTES}o clique no botão estourou o prazo DEPOIS de começar (Timeout 30000ms exceeded.): NÃO cliquei de novo — confira no SisChef se o passo foi feito antes de lançar outra vez`],
]

// textos que esta regra NÃO reconhece: seguem como hoje (outras regras ou o texto do robô)
const FORA: Array<[string, string | null | undefined]> = [
  ['vazio', ''],
  ['nulo', null],
  ['indefinido', undefined],
  ['a conta de unidades que não bate', 'item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)'],
  ['frete desligado', 'nota com frete (R$ 492,82): o lançamento com frete ainda não está ligado (secret NFE_FRETE_LIGADO) — nada foi lançado; lance esta nota à mão no SisChef'],
  ['UN DIFERE sem conversão', 'UN DIFERE sem conversão na tela: CÓD. FOR 17253; 999 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)'],
  ['sem boletos', 'sem boletos na nota — pagamento manual'],
  ['falta a forma de pagamento', 'falta a forma de pagamento — escolha "como pagar" no app'],
  ['fornecedor novo', 'fornecedor não cadastrado no Sischef e sem autorização do Ivan (autorize no app) — nada lançado (ACME LTDA)'],
  ['dois itens com o mesmo código', 'dois itens com o mesmo CÓD. FOR 0009085 (itens 1, 2): o robô não sabe qual associar — associe no SisChef'],
  ['a função da memória não existe (não adianta repetir)', 'a função da memória de embalagens não existe no banco do app (PGRST202): um fardo ou pacote lembrado poderia entrar no estoque sem multiplicar — nada foi feito no SisChef; avise o Claude'],
  ['exceção de tela SEM o começo "nada lançado" (não dá para saber em que ponto parou)', 'item 17253: 3 linhas na tela (esperava 1)'],
  ['tempo esgotado solto, sem o começo "nada lançado"', 'TimeoutError: Page.goto: Timeout 60000ms exceeded.'],
  ['nota que ficou pela metade (estado erro)', "erro no lançamento (pedido JÁ gerado 998877 — conferir no Sischef; pedido: https://sischef.example/pedido/998877; tela no erro: https://sischef.example/x) no passo 'Gerar compra': TimeoutError: Timeout 30000ms exceeded. | diálogos: (nenhum)"],
  ['uma parte conhecida e outra que a regra não conhece (sem o começo "nada lançado")', 'item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar; item 6 (CÓD. FOR: 31 MOLHO): precisa de conversão: 1 UN da nota = ? KG'],
  ['conversão que não serve (tem botão próprio)', 'item 5 (CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G): a nota e o produto estão na mesma unidade (UN) no SisChef e o número informado (0,24) não é de embalagem (embalagem é maior que 1 e vale para UN, PCT, CX ou FD): no app, toque em Editar neste item, deixe a conversão vazia e lance de novo (ou associe no SisChef)'],
]

describe('motivoPassageiro — motivos em que nada foi lançado: frase curta e "Tentar de novo"', () => {
  it.each(SEGUROS)('%s', (_nome, motivo) => {
    const r = motivoPassageiro(motivo)
    expect(r).not.toBeNull()
    expect(r!.repetir).toBe(true)
    expect(r!.frase.startsWith('Nada foi lançado.')).toBe(true)
    expect(r!.frase).toContain('Tentar de novo')
    expect(r!.frase.length).toBeLessThanOrEqual(220)
    expect(r!.frase).not.toMatch(TECNICO)
    expect(r!.frase).not.toContain('\n')
  })

  it('cada molde tem a SUA frase (não é uma frase única para tudo)', () => {
    const frases = new Set(SEGUROS.map(([, m]) => motivoPassageiro(m)!.frase))
    expect(frases.size).toBeGreaterThanOrEqual(10)
  })

  it('espaços e quebras de linha a mais não atrapalham', () => {
    const r = motivoPassageiro(`  ${ANTES}\n TimeoutError:   Page.goto: Timeout 90000ms exceeded.  `)
    expect(r?.repetir).toBe(true)
  })

  it('dois itens do mesmo problema viram UMA frase só', () => {
    const [, motivo] = SEGUROS.find(([n]) => n === 'dois itens com produto fora da leitura')!
    const r = motivoPassageiro(motivo)!
    expect(r.frase.match(/Nada foi lançado\./g)).toHaveLength(1)
    expect(r.frase.match(/Tentar de novo/g)).toHaveLength(1)
  })

  it('dois problemas passageiros diferentes na mesma nota: uma frase com os dois, ainda com "Tentar de novo"', () => {
    const r = motivoPassageiro('item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar; item 6 (CÓD. FOR: 31 MOLHO): a leitura do SisChef não trouxe a unidade deste item na nota — não dá para saber se precisa de conversão para UN')
    expect(r?.repetir).toBe(true)
    expect(r!.frase).toMatch(/lista de produtos|produto escolhido/)
    expect(r!.frase).toMatch(/unidade/)
  })

  it('a frase do XML mantém o aviso de não digitar as parcelas', () => {
    const r = motivoPassageiro('não consegui ler o XML da nota (sem XML)')!
    expect(r.frase).toMatch(/não digite as parcelas/i)
    expect(r.frase).toMatch(/horas/)
  })
})

describe('motivoPassageiro — pode ter sido lançado em parte: só orienta conferir, NUNCA oferece repetir', () => {
  it.each(TALVEZ)('%s', (_nome, motivo) => {
    const r = motivoPassageiro(motivo)
    expect(r).not.toBeNull()
    expect(r!.repetir).toBe(false)
    expect(r!.frase.startsWith('Pode ter sido lançado em parte')).toBe(true)
    expect(r!.frase).toMatch(/confira/i)
    expect(r!.frase).not.toContain('Tentar de novo')
    expect(r!.frase).not.toMatch(TECNICO)
  })

  it('se uma das partes pode ter lançado, o conjunto não oferece repetir (mesmo com outra parte segura)', () => {
    const r = motivoPassageiro(`${ANTES}item 5: o produto 3971031 não está no cadastro do SisChef (ou está sem unidade): não dá para associar; o clique no botão estourou o prazo DEPOIS de começar (Timeout 30000ms exceeded.): NÃO cliquei de novo — confira no SisChef se o passo foi feito antes de lançar outra vez`)
    expect(r?.repetir).toBe(false)
  })
})

describe('motivoPassageiro — o que não é passageiro fica como está', () => {
  it.each(FORA)('%s', (_nome, motivo) => {
    expect(motivoPassageiro(motivo)).toBeNull()
  })
})

const nota = (extra: Partial<NotaSefazLista>): NotaSefazLista => ({
  chave: '5'.repeat(44), cnpj_emitente: '11222333000144', emitente: 'ACME LTDA', numero: '000001', emissao: '2026-11-13', valor_nf: 100, situacao: 'na_fila',
  lancada_em: null, nf_sischef: null, parcelas: [], itens: [], associacoes_app: null, forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: null,
  ...extra,
} as unknown as NotaSefazLista)

describe('passageiroDaNota e textoDoEstado', () => {
  const MOTIVO = `${ANTES}TimeoutError: Page.goto: Timeout 90000ms exceeded.`
  it('só vale para nota que o robô devolveu (revisar)', () => {
    expect(passageiroDaNota(nota({ lancamento_motivo: MOTIVO }))?.repetir).toBe(true)
    for (const estado of ['erro', 'lancando', 'ensaio_ok', null] as const) {
      expect(passageiroDaNota(nota({ lancamento_estado: estado, lancamento_motivo: MOTIVO }))).toBeNull()
    }
  })
  it('o texto do estado "revisar" passa a ser a frase curta, sem o texto cru do robô', () => {
    const t = textoDoEstado('revisar', MOTIVO)!
    expect(t).toBe(motivoPassageiro(MOTIVO)!.frase)
    expect(t).not.toMatch(/Timeout/)
  })
  it('estado "erro" mantém o texto de sempre (pela metade)', () => {
    expect(textoDoEstado('erro', MOTIVO)).toBe('Ficou pela metade — NÃO lance de novo (chame o Ivan/confira no SisChef)')
  })
  it('motivo que a regra não reconhece mantém o texto de hoje', () => {
    expect(textoDoEstado('revisar', 'sem boletos na nota — pagamento manual')).toContain('A nota não tem boleto')
    expect(textoDoEstado('revisar', 'alguma coisa nova que o robô inventou')).toBe('Precisa de você: alguma coisa nova que o robô inventou')
  })
})
