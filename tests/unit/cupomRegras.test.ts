import { diagnosticoDoCupom } from '../../src/admin/cupomRegras'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// O cupom do ATACADAO de 06/10/2026 (R$ 35,27) como está no banco: 2 itens sem produto confirmado (só com proposta) e 1 já aprendido.
const LIMAO_SICILIANO: ItemCupomRecente = { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null,
  sugestao_produto: null, casado_por: null, proposta: { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS' } }
const PEPINO: ItemCupomRecente = { descricao_cupom: 'PEPINO JAPONES', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null,
  sugestao_produto: null, casado_por: null, proposta: { insumo_id: '3484991', insumo_nome: 'PEPINO JAPONÊS - INSUMOS' } }
const TAITI: ItemCupomRecente = { descricao_cupom: 'LIMAO TAITI TROPICAL', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884,
  sugestao_produto: { id: '3469643' }, casado_por: 'descricao', proposta: null }

const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', valor_a_pagar: 35.27, pedido_sischef: null, criado_em: '2026-10-06T13:07:38Z',
  motivo: null, teste: false, itens: [], ...extra,
})
const espacos = (t: string) => t.replace(/\s/g, ' ')

describe('diagnosticoDoCupom (o que está errado e como resolver)', () => {
  it('o caso real: 2 itens sem produto confirmado → lista os fatos, a lista EXATA do que o Ivan informa (produto + peso), a conta para conferir e um exemplo de resposta', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: '2 item(ns) sem casamento confirmado — confira no Code', itens: [LIMAO_SICILIANO, PEPINO, TAITI] }))!
    expect(d.problema).toBe('2 itens ainda não têm produto confirmado no SisChef (o robô nunca chuta: só lança item que você já confirmou uma vez para este fornecedor).')
    expect(d.itens.map((i) => ({ ...i, preco: i.preco && espacos(i.preco) }))).toEqual([
      { descricao: 'LIMAO SICILIANO', preco: 'R$ 13,90 por KG' },
      { descricao: 'PEPINO JAPONES', preco: 'R$ 5,79 por KG' },
    ])                                                                                       // o LIMAO TAITI já está confirmado: não trava
    expect(d.pedidos).toEqual([
      'LIMAO SICILIANO: confirmar que é LIMÃO SICILIANO - INSUMOS (cód. 3484974) e dizer o peso (kg) que está no cupom.',
      'PEPINO JAPONES: confirmar que é PEPINO JAPONÊS - INSUMOS (cód. 3484991) e dizer o peso (kg) que está no cupom.',
    ])
    // 2,884 kg × R$ 9,90 − R$ 5,51 = R$ 23,04 (o LIMAO TAITI); R$ 35,27 − R$ 23,04 = R$ 12,23 para os dois itens sem peso
    expect(espacos(d.conferencia ?? '')).toBe('O cupom é R$ 35,27 e os itens já confirmados somam R$ 23,04: estes itens devem somar R$ 12,23 (peso × preço, com até 2 centavos de diferença).')
    // total lido e só item sem produto: dá para corrigir na própria tela (confirmar-cupom), sem passar pelo Claude
    expect(d.corrigivel).toBe(true)
    expect(d.solucao).toBe('Confirme cada item abaixo (o produto do SisChef e o peso que está no cupom) e toque em “Reenviar para lançar”. O app guarda a confirmação (nos próximos cupons desse fornecedor o item passa direto), confere a soma e o robô lança.')
  })

  it('1 item, sem proposta do sistema, peso já conhecido, total não lido, nenhum item já confirmado: cada variação muda o texto certo', () => {
    const sozinho = diagnosticoDoCupom(cupom({ emitente_nome: null, valor_a_pagar: 20, motivo: '1 item(ns) sem casamento confirmado — confira no Code; não consegui ler o total do cupom',
      itens: [{ ...PEPINO, proposta: null }] }))!
    expect(sozinho.problema.startsWith('1 item ainda não tem produto confirmado no SisChef')).toBe(true)
    expect(sozinho.problema).toContain('Além disso, o total do cupom não foi lido.')
    expect(sozinho.pedidos).toEqual(['PEPINO JAPONES: dizer qual é o produto do SisChef e dizer o peso (kg) que está no cupom.'])
    expect(espacos(sozinho.conferencia ?? '')).toBe('O cupom é R$ 20,00: este item deve dar R$ 20,00 (peso × preço, com até 2 centavos de diferença).')   // nenhum item já confirmado
    // o total não foi lido: a tela não consegue conferir a soma (e a Edge Function recusaria), então o caminho continua sendo o Claude
    expect(sozinho.corrigivel).toBe(false)
    expect(sozinho.solucao).toContain('Peça ao Claude e responda, por exemplo: “PEPINO JAPONES: é <produto>, __ kg”')
    const comPeso = diagnosticoDoCupom(cupom({ motivo: 'x', itens: [{ ...PEPINO, entrada_estoque: 0.9 }, TAITI] }))!
    expect(comPeso.pedidos).toEqual(['PEPINO JAPONES: confirmar que é PEPINO JAPONÊS - INSUMOS (cód. 3484991).'])   // o peso já se sabe: não pede
    expect(comPeso.conferencia).toBeNull()                                                                         // a conta mistura item com peso: não oferece
    expect(comPeso.corrigivel).toBe(true)                                                                          // total lido: corrige na tela
    expect(comPeso.solucao).toContain('Confirme cada item abaixo')
    expect(comPeso.solucao).not.toContain('Peça ao Claude')
    const unidade = diagnosticoDoCupom(cupom({ motivo: 'x', itens: [{ ...PEPINO, unidade_cupom: 'UN' }] }))!
    expect(unidade.pedidos[0]).toContain('dizer a quantidade (un) que está no cupom')                              // unidade que não é peso: "quantidade"
    expect(unidade.corrigivel).toBe(true)
  })

  it('corrigível na tela só com o total lido: motivo que diz "não consegui ler o total" (mesmo com valor gravado), total nulo ou zero → Claude', () => {
    expect(diagnosticoDoCupom(cupom({ motivo: 'x; não consegui ler o total do cupom', valor_a_pagar: 35.27, itens: [PEPINO] }))!.corrigivel).toBe(false)
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', valor_a_pagar: null, itens: [PEPINO] }))!.corrigivel).toBe(false)
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', valor_a_pagar: 0, itens: [PEPINO] }))!.corrigivel).toBe(false)
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', pedido_sischef: '163559145', itens: [PEPINO] }))!.corrigivel).toBe(false)   // já tem pedido no SisChef: o servidor recusaria (409)
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', valor_a_pagar: 0, itens: [PEPINO] }))!.solucao).toContain('Peça ao Claude')
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', valor_a_pagar: 10, itens: [PEPINO, TAITI] }))!.corrigivel).toBe(true)   // soma que não fecha é problema da tela, não do caminho
  })

  it('sem total lido (0 ou nulo) ou com os itens já confirmados somando mais que o cupom: não há conta para conferir', () => {
    expect(diagnosticoDoCupom(cupom({ valor_a_pagar: null, motivo: 'x', itens: [PEPINO] }))!.conferencia).toBeNull()
    expect(diagnosticoDoCupom(cupom({ valor_a_pagar: 0, motivo: 'x', itens: [PEPINO] }))!.conferencia).toBeNull()
    expect(diagnosticoDoCupom(cupom({ valor_a_pagar: 10, motivo: 'x', itens: [PEPINO, TAITI] }))!.conferencia).toBeNull()   // 23,04 já passa de 10
  })

  it('só os REVISAR têm diagnóstico', () => {
    for (const estado of ['PENDENTE', 'PROCESSANDO', 'LANCADO', 'TESTE'] as const) expect(diagnosticoDoCupom(cupom({ estado, motivo: 'resto antigo' }))).toBeNull()
  })

  it.each([
    ['CONFERIR NO SISCHEF antes de repetir: falha depois de Gerar compra', /começou a lançar no SisChef e parou no meio.*PODE já existir/, /Não envie de novo.*só olhe, não clique em nada/],
    ['falha em GERAR_COMPRA_CLICADO no passo 3', /PODE já existir/, /Não envie de novo/],
    ['erro em FINALIZAR_COMPRA_CLICADO', /PODE já existir/, /Não envie de novo/],
    ['falha ao preencher o pagamento no Sischef: campo X', /pedido ABERTO e nada foi pago/, /cancela com o seu OK e lança de novo/],
    ['JÁ LANÇADO em outro envio — NÃO reenviar (duplicaria a compra)', /já foi lançado em outro envio/, /Nada a fazer: não envie de novo/],
    ['não consegui ler a foto do cupom', /foto não ficou legível/, /Tire outra foto.*envie de novo/],
    ['não consegui ler o total do cupom', /total do cupom não foi lido/, /lê o total na foto/],
    ["forma de pagamento não suportada (ex.: cartão): 'cartao' (o robô paga só: dinheiro, tesouraria, pix, sem_cartao)", /não paga com esta forma/, /Lance este cupom à mão no SisChef/],
    ["forma de pagamento ausente ou desconhecida (None)", /Faltou a forma de pagamento/, /corrige o pagamento/],
    ['sem a conta de pagamento', /Faltou a forma de pagamento/, /corrige o pagamento/],
    ['item 2 sem quantidade', /dados incompletos/, /confere os itens com a foto/],
    ['item 1 com quantidade inválida; cupom sem itens', /dados incompletos/, /confere os itens com a foto/],
  ])('motivo "%s" → problema e solução específicos', (motivo, problema, solucao) => {
    const d = diagnosticoDoCupom(cupom({ motivo, itens: [TAITI] }))!
    expect(d.problema).toMatch(problema)
    expect(d.solucao).toMatch(solucao)
    expect(d.itens).toEqual([])
    expect(d.pedidos).toEqual([])
    expect(d.conferencia).toBeNull()
    expect(d.corrigivel).toBe(false)   // nada disso se resolve escolhendo produto na tela
  })

  it('o que pode ter chegado ao SisChef vem ANTES do resto: conferir/pedido aberto/já lançado ganham de "item sem produto"', () => {
    const itens = [LIMAO_SICILIANO, PEPINO]
    expect(diagnosticoDoCupom(cupom({ motivo: 'CONFERIR NO SISCHEF antes de repetir: x', itens }))!.problema).toMatch(/PODE já existir/)
    expect(diagnosticoDoCupom(cupom({ motivo: 'falha ao preencher o pagamento no Sischef: x', itens }))!.problema).toMatch(/pedido ABERTO/)
    expect(diagnosticoDoCupom(cupom({ motivo: 'JÁ LANÇADO em outro envio — NÃO reenviar', itens }))!.problema).toMatch(/já foi lançado/)
    // e, mesmo com item sem produto e total lido, NÃO é corrigível na tela: reenviar poderia duplicar a compra (a Edge Function também recusa)
    expect(diagnosticoDoCupom(cupom({ motivo: 'CONFERIR NO SISCHEF antes de repetir: x', itens }))!.corrigivel).toBe(false)
    expect(diagnosticoDoCupom(cupom({ motivo: 'JÁ LANÇADO em outro envio — NÃO reenviar', itens }))!.corrigivel).toBe(false)
  })

  it('motivo que ninguém reconhece (ou ausente): não inventa causa; pede ao Claude e não repete o texto (a tela o mostra à parte)', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: 'algo novo que o robô escreveu', itens: [TAITI] }))!
    expect(d.problema).toContain('motivo que ainda não sei explicar')
    expect(d.problema).not.toContain('algo novo que o robô escreveu')
    expect(d.solucao).toContain('Peça ao Claude')
    expect(d.corrigivel).toBe(false)
    expect(diagnosticoDoCupom(cupom({ motivo: null, itens: [TAITI] }))!.problema).toBe('O robô não conseguiu lançar este cupom.')
  })

  it('itens que não vêm como lista não derrubam a tela', () => {
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', itens: null as unknown as ItemCupomRecente[] }))).not.toBeNull()
  })
})
