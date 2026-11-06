import {
  FALHA_PREFIXO, REPETIDA_PREFIXO, diagnosticoDoCupom, falhaDeConferirDoCupom, motivoSemFalha, motivoSemRepetida, parouNoMeioDoSischef, podeExcluirCupom, repetidaDoCupom, trechoDaFalha, trechoDaRepetida,
} from '../../src/admin/cupomRegras'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// E5 (compra repetida, pedido do Ivan de 04/11/2026): o app reconhece o aviso "POSSÍVEL REPETIDA: …" que o servidor e o robô gravam no FIM do motivo do cupom. O aviso aparece JUNTO do
// diagnóstico de sempre (itens sem produto, CONFIRMAR:), nunca no lugar dele; o cupom que parou SÓ pelo aviso (o do robô) tem diagnóstico próprio e sai pelos dois botões.
const FRASE = 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 35,27): cupom de 03/10, lançado no SisChef (pedido 163377089).'
const SEM_PREFIXO = 'já existe compra deste fornecedor com o mesmo total (R$ 35,27): cupom de 03/10, lançado no SisChef (pedido 163377089).'
const MOTIVO_ITENS = '2 item(ns) sem casamento confirmado — confira no Code'
const MOTIVO_CONFIRMAR = 'CONFIRMAR: 3 item(ns) já conhecido(s) — confira e confirme no app'
const SEM: ItemCupomRecente = { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, proposta: null }
const COM: ItemCupomRecente = { descricao_cupom: 'LIMAO TAITI', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884, sugestao_produto: { id: '3469643' }, casado_por: 'descricao', proposta: null }
const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', valor_a_pagar: 35.27, pedido_sischef: null, criado_em: '2026-10-06T13:07:38Z', motivo: null, teste: false, itens: [SEM, COM], ...extra,
})

describe('o trecho POSSÍVEL REPETIDA dentro do motivo (as mesmas regras do servidor)', () => {
  it('o prefixo é o do servidor e do robô', () => {
    expect(REPETIDA_PREFIXO).toBe('POSSÍVEL REPETIDA: ')
  })
  it('acha o trecho (do prefixo até o fim) e devolve o motivo sem ele', () => {
    const motivo = `${MOTIVO_CONFIRMAR}; ${FRASE}`
    expect(trechoDaRepetida(motivo)).toBe(FRASE)
    expect(motivoSemRepetida(motivo)).toBe(MOTIVO_CONFIRMAR)
  })
  it('motivo que é só o trecho: sobra nada; sem trecho ou sem motivo: tudo igual / vazio', () => {
    expect(motivoSemRepetida(FRASE)).toBe('')
    expect(trechoDaRepetida(MOTIVO_ITENS)).toBeNull()
    expect(motivoSemRepetida(MOTIVO_ITENS)).toBe(MOTIVO_ITENS)
    expect(trechoDaRepetida(null)).toBeNull()
    expect(motivoSemRepetida(null)).toBe('')
    expect(trechoDaRepetida('   ')).toBeNull()
  })
})

describe('repetidaDoCupom (o aviso que o cartão mostra)', () => {
  it('REVISAR com o trecho: o aviso vem SEM o prefixo (texto para o Ivan ler) e diz se sobra motivo (botão "seguir com o cupom") ou não (botão "lançar mesmo assim")', () => {
    expect(repetidaDoCupom(cupom({ motivo: `${MOTIVO_ITENS}; ${FRASE}` }))).toEqual({ texto: SEM_PREFIXO, sobraMotivo: true })
    expect(repetidaDoCupom(cupom({ motivo: FRASE }))).toEqual({ texto: SEM_PREFIXO, sobraMotivo: false })
  })
  it('sem o trecho, ou em outro estado que não REVISAR: nada a mostrar', () => {
    expect(repetidaDoCupom(cupom({ motivo: MOTIVO_ITENS }))).toBeNull()
    expect(repetidaDoCupom(cupom({ motivo: null }))).toBeNull()
    for (const estado of ['PENDENTE', 'PROCESSANDO', 'LANCADO', 'TESTE', 'EXCLUIDO'] as const) expect(repetidaDoCupom(cupom({ estado, motivo: FRASE }))).toBeNull()
  })
  it('com pedido já aberto no SisChef, ou parado no meio dele: NÃO há decisão para o Ivan (a compra PODE existir lá): sem aviso com botões', () => {
    expect(repetidaDoCupom(cupom({ motivo: FRASE, pedido_sischef: '163377325' }))).toBeNull()
    expect(repetidaDoCupom(cupom({ motivo: `CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO; ${FRASE}` }))).toBeNull()
  })
  it('o aviso NÃO muda quem pode ser excluído: o cupom com o trecho é excluível como qualquer REVISAR que não parou no meio', () => {
    expect(podeExcluirCupom(cupom({ motivo: FRASE }))).toBe(true)
    expect(podeExcluirCupom(cupom({ motivo: `${MOTIVO_CONFIRMAR}; ${FRASE}` }))).toBe(true)
    expect(parouNoMeioDoSischef(cupom({ motivo: FRASE }))).toBe(false)
  })
})

describe('diagnosticoDoCupom com o aviso de repetida (o aviso vem JUNTO, nunca no lugar)', () => {
  it('itens sem produto + aviso: o diagnóstico é o dos itens (o aviso é tirado do motivo antes), e continua corrigível na tela', () => {
    const sem = diagnosticoDoCupom(cupom({ motivo: MOTIVO_ITENS }))!
    const com = diagnosticoDoCupom(cupom({ motivo: `${MOTIVO_ITENS}; ${FRASE}` }))!
    expect(com).toEqual(sem)
    expect(com.corrigivel).toBe(true)
  })
  it('CONFIRMAR: + aviso: continua "todos os itens conhecidos, falta só confirmar" e corrigível', () => {
    const itens = [{ ...COM }]
    const d = diagnosticoDoCupom(cupom({ motivo: `${MOTIVO_CONFIRMAR}; ${FRASE}`, itens }))!
    expect(d.problema).toMatch(/Todos os itens já são conhecidos/)
    expect(d.corrigivel).toBe(true)
  })
  it('só o aviso (o do robô): diagnóstico próprio, SEM correção na tela (é decisão do Ivan, nos dois botões)', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: FRASE, itens: [COM] }))!
    expect(d.problema).toBe('Parece que esta compra já foi lançada: já existe uma compra do mesmo fornecedor com o mesmo total.')
    expect(d.solucao).toContain('É o mesmo: excluir este envio')
    expect(d.solucao).toContain('É outra compra')
    expect(d.corrigivel).toBe(false)
    expect(d.itens).toEqual([])
    expect(d.pedidos).toEqual([])
  })
  it('o que "pode já estar no SisChef" continua ganhando de tudo, mesmo com o aviso junto', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: `CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO; ${FRASE}` }))!
    expect(d.problema).toMatch(/PODE já existir/)
    expect(d.corrigivel).toBe(false)
  })
})

// ---------- ajuste 2 da revisão do código (05/11): "não consegui conferir" tem aviso PRÓPRIO ("CONFERÊNCIA DE REPETIDA FALHOU: …"), com o botão "Tentar de novo" (confere de novo no servidor).
const FALHA = 'CONFERÊNCIA DE REPETIDA FALHOU: não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef).'

describe('o trecho CONFERÊNCIA DE REPETIDA FALHOU dentro do motivo (as mesmas regras do servidor e do robô)', () => {
  it('o prefixo é o do servidor e do robô, e NÃO é o da repetida: um aviso nunca é lido como o outro', () => {
    expect(FALHA_PREFIXO).toBe('CONFERÊNCIA DE REPETIDA FALHOU: ')
    expect(trechoDaFalha(FRASE)).toBeNull()
    expect(trechoDaRepetida(FALHA)).toBeNull()
  })
  it('acha o trecho (do prefixo até o fim) e devolve o motivo sem ele; sem trecho ou sem motivo: tudo igual / vazio', () => {
    expect(trechoDaFalha(`${MOTIVO_CONFIRMAR}; ${FALHA}`)).toBe(FALHA)
    expect(motivoSemFalha(`${MOTIVO_CONFIRMAR}; ${FALHA}`)).toBe(MOTIVO_CONFIRMAR)
    expect(motivoSemFalha(FALHA)).toBe('')
    expect(trechoDaFalha(MOTIVO_ITENS)).toBeNull()
    expect(motivoSemFalha(MOTIVO_ITENS)).toBe(MOTIVO_ITENS)
    expect(trechoDaFalha(null)).toBeNull()
    expect(motivoSemFalha(null)).toBe('')
    expect(trechoDaFalha('   ')).toBeNull()
  })
})

describe('falhaDeConferirDoCupom (o aviso "não consegui conferir" que o cartão mostra, com "Tentar de novo")', () => {
  it('REVISAR parado SÓ pela falha (o do robô): devolve o texto SEM o prefixo', () => {
    expect(falhaDeConferirDoCupom(cupom({ motivo: FALHA }))).toEqual({ texto: 'não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef).' })
  })
  it('com outro motivo junto (itens sem produto, CONFIRMAR:), sem o trecho, ou com o aviso de repetida: NÃO há "Tentar de novo" (o servidor só aceita a falha sozinha)', () => {
    expect(falhaDeConferirDoCupom(cupom({ motivo: `${MOTIVO_CONFIRMAR}; ${FALHA}` }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: `${MOTIVO_ITENS}; ${FALHA}` }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: MOTIVO_ITENS }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: null }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: FRASE }))).toBeNull()
  })
  it('os dois avisos no mesmo motivo (não deveria acontecer): ganha o de repetida, que tem os botões de decisão', () => {
    expect(falhaDeConferirDoCupom(cupom({ motivo: `${FALHA}; ${FRASE}` }))).toBeNull()
    expect(repetidaDoCupom(cupom({ motivo: `${FALHA}; ${FRASE}` }))).toEqual({ texto: SEM_PREFIXO, sobraMotivo: true })
  })
  it('fora do REVISAR, com pedido aberto no SisChef ou parado no meio dele: nada a mostrar (a compra PODE existir lá)', () => {
    for (const estado of ['PENDENTE', 'PROCESSANDO', 'LANCADO', 'TESTE', 'EXCLUIDO'] as const) expect(falhaDeConferirDoCupom(cupom({ estado, motivo: FALHA }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: FALHA, pedido_sischef: '163377325' }))).toBeNull()
    expect(falhaDeConferirDoCupom(cupom({ motivo: `CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO; ${FALHA}` }))).toBeNull()
  })
  it('o aviso NÃO muda quem pode ser excluído: o cupom parado pela falha é excluível como qualquer REVISAR que não parou no meio', () => {
    expect(podeExcluirCupom(cupom({ motivo: FALHA }))).toBe(true)
    expect(parouNoMeioDoSischef(cupom({ motivo: FALHA }))).toBe(false)
  })
})

describe('diagnosticoDoCupom com o aviso de falha de conferência', () => {
  it('só a falha: diagnóstico próprio (nada foi feito no SisChef), que manda tocar em "Tentar de novo"; sem correção na tela', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: FALHA, itens: [COM] }))!
    expect(d.problema).toContain('Não consegui conferir se esta compra já foi lançada')
    expect(d.problema).toContain('Nada foi feito no SisChef')
    expect(d.solucao).toContain('Tentar de novo')
    expect(d.corrigivel).toBe(false)
    expect(d.itens).toEqual([])
    expect(d.pedidos).toEqual([])
  })
  it('a falha junto de outro motivo: o diagnóstico é o do outro motivo (a falha é tirada antes), e continua corrigível na tela', () => {
    expect(diagnosticoDoCupom(cupom({ motivo: `${MOTIVO_ITENS}; ${FALHA}` }))).toEqual(diagnosticoDoCupom(cupom({ motivo: MOTIVO_ITENS })))
    const d = diagnosticoDoCupom(cupom({ motivo: `${MOTIVO_CONFIRMAR}; ${FALHA}`, itens: [{ ...COM }] }))!
    expect(d.problema).toMatch(/Todos os itens já são conhecidos/)
    expect(d.corrigivel).toBe(true)
  })
})
