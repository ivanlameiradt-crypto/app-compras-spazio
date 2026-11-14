import { diagnosticoDoCupom, motivoPassageiroDoCupom, parouNoMeioDoSischef } from '../../src/admin/cupomRegras'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// Etapa 8 do inventário de 14/11: o robô do cupom devolve motivos PASSAGEIROS (SisChef lento, produto que não apareceu na lista, tela que falhou ANTES de "Gerar compra").
// Só aí o app diz "nada foi lançado" e oferece "Tentar de novo". Os moldes abaixo foram copiados do robô (cupom_navegador.py, cupom_lancar.py, lancar_cupom_nuvem.py, reaper_cupom.py).
const COM: ItemCupomRecente = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 13.472, sugestao_produto: { id: '3484974' }, casado_por: 'descricao', proposta: null }
const SEM: ItemCupomRecente = { descricao_cupom: 'PEPINO', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, proposta: null }
const cupom = (motivo: string | null, extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'c1', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', valor_a_pagar: 119.9, pedido_sischef: null, criado_em: '2026-11-14T12:00:00Z',
  motivo, teste: false, itens: [COM], processando_desde: '2026-11-14T12:01:00Z', ...extra,
})

const NAO_COLOCOU = 'item 2: o Sischef não colocou o produto (código 1836986) na lista em ~15 s (demora do Sischef ou produto fora do catálogo)'
const GRADE = 'a grade do Sischef tem 3 linha(s), esperava 2: uma linha pode ter entrado duas vezes (nada foi gerado)'
const GRADE_ITEM = 'item 1: a grade do Sischef tem 2 linha(s), esperava 1: uma linha pode ter entrado duas vezes (nada foi gerado)'
const FALHA_MONTAR = 'falha ao montar o pedido no Sischef: TimeoutError: Page.click: Timeout 30000ms exceeded.'
const FALHA_LINHA = 'item 3: falha ao montar o pedido no Sischef ao preencher a linha (código 1836986): LinhaDobrada: a grade ganhou 2 linhas de uma vez ao adicionar o produto 1836986'
const TESTE_ERRO = 'erro inesperado no teste (dry-run; nada foi criado no Sischef): TimeoutError: Page.goto: Timeout 30000ms exceeded.'
const TESTE_PRESO = 'PROCESSANDO preso há mais de 40 min (cupom de teste: o dry-run nunca cria compra)'

describe('motivoPassageiroDoCupom: só reconhece o que PROVA que nada foi criado no SisChef', () => {
  it.each([
    ['o produto não apareceu na lista', NAO_COLOCOU, /item 2/],
    ['a grade com linha a mais', GRADE, /a mais/],
    ['a grade com linha a mais (de um item)', GRADE_ITEM, /a mais/],
    ['falha ao montar o pedido', FALHA_MONTAR, /demorou ou falhou/],
    ['falha ao preencher a linha', FALHA_LINHA, /demorou ou falhou/],
    ['erro no teste', TESTE_ERRO, /teste/],
    ['teste preso', TESTE_PRESO, /teste/],
  ])('%s: frase curta e "Tentar de novo"', (_n, motivo, frase) => {
    const p = motivoPassageiroDoCupom(cupom(motivo, motivo === TESTE_ERRO || motivo === TESTE_PRESO ? { teste: true } : {}))
    expect(p).not.toBeNull()
    expect(p!.problema).toMatch(frase)
    expect(p!.problema).toMatch(/Nada foi (lançado|criado)/)
    expect(p!.problema.length).toBeLessThan(140)
  })

  it('com espaços sobrando nas pontas e variação de número/código ainda reconhece', () => {
    expect(motivoPassageiroDoCupom(cupom(`  ${NAO_COLOCOU.replace('~15 s', '~20 s').replace('1836986', '99')}\n`))).not.toBeNull()
  })

  it('o texto longo cortado (2000 caracteres) NUNCA ganha botão: o fim (um aviso de "CONFERIR") pode ter sido cortado', () => {
    const longo = `${FALHA_MONTAR} ${'x'.repeat(1600)}`
    expect(longo.length).toBeGreaterThan(1500)
    expect(motivoPassageiroDoCupom(cupom(longo))).toBeNull()
    const cortado = `${FALHA_MONTAR} ${'y'.repeat(1900)}`.slice(0, 2000)
    expect(motivoPassageiroDoCupom(cupom(cortado))).toBeNull()
  })

  it('motivo composto: TODAS as partes têm de ser reconhecidas (senão, sem botão)', () => {
    expect(motivoPassageiroDoCupom(cupom(`${NAO_COLOCOU}; ${GRADE}`))).not.toBeNull()
    expect(motivoPassageiroDoCupom(cupom(`${NAO_COLOCOU}; item 2 sem quantidade`))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(`${FALHA_MONTAR}; CONFERIR NO SISCHEF antes de repetir: x`))).toBeNull()
  })

  it.each([
    ['CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO — conferir no Sischef antes de repetir: TimeoutError: x'],
    ["CONFERIR NO SISCHEF antes de repetir: FINALIZAR_COMPRA_CLICADO — conferir no Sischef antes de repetir: a tela não mostrou 'Compra/Venda finalizada' (x)"],
    ['CONFERIR NO SISCHEF antes de repetir: erro inesperado no robô (RuntimeError: Login no Sischef não foi concluído (senha, 2FA ou bloqueio).)'],
    ['CONFERIR NO SISCHEF antes de repetir: PROCESSANDO preso há mais de 40 min'],
    ['CONFERIR NO SISCHEF antes de repetir: PENDENTE nunca lançado há mais de 60 min'],
    ['falha ao preencher o pagamento no Sischef: total da tela de pagamento 10 ≠ total do cupom 11'],
    ['falha ao montar o pedido no Sischef: pedido criado 123'],
    ['soma dos itens (10.00) difere do total (12.00)'],
    ['item 1 sem código de produto válido (None)'],
    ['algo novo que o robô escreveu'],
    [''],
  ])('NÃO ganha botão: %s', (motivo) => {
    expect(motivoPassageiroDoCupom(cupom(motivo))).toBeNull()
  })

  it('não ganha botão se o cupom já tem pedido no SisChef, se tem item sem produto, se não está em REVISAR ou se o motivo traz o aviso de repetida/falha de conferência', () => {
    expect(motivoPassageiroDoCupom(cupom(FALHA_MONTAR, { pedido_sischef: '163377089' }))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(FALHA_MONTAR, { itens: [COM, SEM] }))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(FALHA_MONTAR, { estado: 'PENDENTE' }))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(`${FALHA_MONTAR}; POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 1,00): x.`))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(`${FALHA_MONTAR}; CONFERÊNCIA DE REPETIDA FALHOU: x`))).toBeNull()
    expect(motivoPassageiroDoCupom(cupom(FALHA_MONTAR, { itens: [] }))).toBeNull()
  })
})

describe('diagnosticoDoCupom com motivo passageiro', () => {
  it('traz a frase curta e a marca tentarDeNovo; o motivo cru fica só no "Motivo registrado" da tela', () => {
    const d = diagnosticoDoCupom(cupom(NAO_COLOCOU))!
    expect(d.tentarDeNovo).toBe(true)
    expect(d.problema).toMatch(/item 2/)
    expect(d.problema).not.toContain('Sischef não colocou')
    expect(d.corrigivel).toBe(false)
    expect(d.solucao).not.toMatch(/Peça ao Claude/)
  })
  it('o que pode ter criado compra segue SEM tentarDeNovo e com o texto de sempre', () => {
    const d = diagnosticoDoCupom(cupom('CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO — conferir no Sischef antes de repetir: x'))!
    expect(d.tentarDeNovo).toBeUndefined()
    expect(d.problema).toMatch(/PODE já existir/)
    expect(parouNoMeioDoSischef(cupom('CONFERIR NO SISCHEF antes de repetir: erro inesperado no robô (x)'))).toBe(true)
  })
  it('motivo longo cortado cai no texto de "não sei explicar", sem botão', () => {
    const d = diagnosticoDoCupom(cupom(`${FALHA_MONTAR} ${'x'.repeat(1700)}`))!
    expect(d.tentarDeNovo).toBeUndefined()
    expect(d.problema).toContain('motivo que ainda não sei explicar')
  })
})
