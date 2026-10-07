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
  it('o caso real: 2 itens sem produto confirmado → lista cada um com a proposta e o preço, e diz o que fazer (incluindo o peso que não ficou guardado)', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: '2 item(ns) sem casamento confirmado — confira no Code', itens: [LIMAO_SICILIANO, PEPINO, TAITI] }))!
    expect(d.problema).toBe('2 itens ainda não têm produto confirmado no SisChef (o robô nunca chuta: só lança item que você já confirmou uma vez para este fornecedor).')
    expect(d.itens.map((i) => ({ ...i, preco: i.preco && espacos(i.preco) }))).toEqual([
      { descricao: 'LIMAO SICILIANO', proposta: 'LIMÃO SICILIANO - INSUMOS · cód. 3484974', preco: 'R$ 13,90 por KG' },
      { descricao: 'PEPINO JAPONES', proposta: 'PEPINO JAPONÊS - INSUMOS · cód. 3484991', preco: 'R$ 5,79 por KG' },
    ])                                                                                       // o LIMAO TAITI já está confirmado: não trava
    expect(d.solucao).toContain('Peça ao Claude: “confirma os produtos do cupom do ATACADAO S.A.”')
    expect(d.solucao).toContain('você confirma, ele grava a confirmação')
    expect(d.solucao).toContain('o peso (kg) desses itens não ficou guardado')
  })

  it('1 item: singular; sem proposta do sistema: proposta nula; sem emitente: "cupom"; peso já conhecido: não fala do peso; total não lido: avisa junto', () => {
    const d = diagnosticoDoCupom(cupom({ emitente_nome: null, motivo: '1 item(ns) sem casamento confirmado — confira no Code; não consegui ler o total do cupom',
      itens: [{ ...PEPINO, proposta: null, entrada_estoque: 0.9 }, TAITI] }))!
    expect(d.problema.startsWith('1 item ainda não tem produto confirmado no SisChef')).toBe(true)
    expect(d.problema).toContain('Além disso, o total do cupom não foi lido.')
    expect(d.itens).toHaveLength(1)
    expect(d.itens[0].proposta).toBeNull()
    expect(d.solucao).toContain('“confirma os produtos do cupom do cupom”')
    expect(d.solucao).not.toContain('peso')
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
  })

  it('o que pode ter chegado ao SisChef vem ANTES do resto: conferir/pedido aberto/já lançado ganham de "item sem produto"', () => {
    const itens = [LIMAO_SICILIANO, PEPINO]
    expect(diagnosticoDoCupom(cupom({ motivo: 'CONFERIR NO SISCHEF antes de repetir: x', itens }))!.problema).toMatch(/PODE já existir/)
    expect(diagnosticoDoCupom(cupom({ motivo: 'falha ao preencher o pagamento no Sischef: x', itens }))!.problema).toMatch(/pedido ABERTO/)
    expect(diagnosticoDoCupom(cupom({ motivo: 'JÁ LANÇADO em outro envio — NÃO reenviar', itens }))!.problema).toMatch(/já foi lançado/)
  })

  it('motivo que ninguém reconhece (ou ausente): não inventa causa; pede ao Claude e não repete o texto (a tela o mostra à parte)', () => {
    const d = diagnosticoDoCupom(cupom({ motivo: 'algo novo que o robô escreveu', itens: [TAITI] }))!
    expect(d.problema).toContain('motivo que ainda não sei explicar')
    expect(d.problema).not.toContain('algo novo que o robô escreveu')
    expect(d.solucao).toContain('Peça ao Claude')
    expect(diagnosticoDoCupom(cupom({ motivo: null, itens: [TAITI] }))!.problema).toBe('O robô não conseguiu lançar este cupom.')
  })

  it('itens que não vêm como lista não derrubam a tela', () => {
    expect(diagnosticoDoCupom(cupom({ motivo: 'x', itens: null as unknown as ItemCupomRecente[] }))).not.toBeNull()
  })
})
