import {
  boletosDaNotaPrevalecem, conversoesPedidasPeloRobo, formaRecusadaPeloRobo, fraseBoletosDaNota, fraseConversaoGravada, fraseConversaoSugerida, fraseFormaLembrada,
} from '../../src/admin/motivoDoRobo'
import { lembrarForma, planoBoletosDaNota, planoConversaoSugerida, planoFormaLembrada } from '../../src/admin/notaSefazRegras'
import type { NotaSefazLista } from '../../src/lib/tipos'

// 14/11/2026 (pedido do Ivan, etapas 4 a 6 do inventário dos erros do robô): quando falta ou está errado um NÚMERO que o app consegue tirar com segurança de uma fonte certa
// (o nome do produto na nota, os boletos da própria nota, a forma que o app lembra do fornecedor), a faixa amarela mostra a sugestão pronta, com a conta.
const PREFIXO = 'parou antes de gerar o pedido (nada lançado): '
const UN_DIFERE = (cods: string) => `UN DIFERE sem conversão na tela: CÓD. FOR ${cods} (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)`
const KETCHUP_A = (nome: number, noApp: string) => `ketchup sachê: o nome diz ${nome} un por caixa e o app tem 1 UN = ${noApp}: no app, toque em Editar neste item e informe ${nome} (ou acerte no SisChef) e lance de novo`
const KETCHUP_B = 'ketchup sachê: a nota traz 10 caixa(s) de 168 un e a tela mostra 10 un; o certo é 1.680 un — no app, toque em Editar neste item e informe 1 UN = 168 (ou acerte a quantidade no SisChef) e lance de novo'
const BOLETOS = 'o XML desta nota já traz boletos (R$ 60,00 em 05/11/2026 + R$ 40,00 em 12/11/2026) e as parcelas digitadas são outras: o XML prevalece e não uso as digitadas — no app, toque em Atualizar e lance de novo sem digitar parcelas — REVISAR'

const KETCHUP_ITEM = { n: 3, descricao: 'CÓD. FOR: 5510 KETCHUP SACHE HEINZ 168UN', qtd: 10, qtd_nota: 10, unidade_sischef: 'UN', unidade_nota: 'CX', produto_id: '777', produto_nome: 'KETCHUP SACHE - INSUMOS', associacao: 'sischef' }
const LEITE_ITEM = { n: 4, descricao: 'CÓD. FOR: 99 LEITE COND TIROL SEMIDES TP 395G', qtd: 24, qtd_nota: 24, unidade_sischef: 'KG', unidade_nota: 'UN', produto_id: '888', produto_nome: 'LEITE CONDENSADO - INSUMOS', associacao: 'sischef' }
const nota = (extra: Record<string, unknown> = {}): NotaSefazLista => ({
  chave: '5'.repeat(44), cnpj_emitente: '03995515011363', emitente: 'FORNECEDOR TESTE LTDA', numero: '000100', emissao: '2026-11-13', valor_nf: 100,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [{ numero: '001', vencimento: '2026-11-05', valor: 60 }, { numero: '002', vencimento: '2026-11-12', valor: 40 }],
  itens: [KETCHUP_ITEM, LEITE_ITEM], associacoes_app: null, forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: PREFIXO + KETCHUP_B,
  ...extra,
} as unknown as NotaSefazLista)
const decisao = (n: number, produto_id: number, conversao: number | null, origem = 'sischef') => ({ [String(n)]: { produto_id, produto_nome: 'X', unidade: null, conversao, origem } })

describe('conversoesPedidasPeloRobo — UN DIFERE sem conversão e ketchup sachê com o fator errado', () => {
  it('UN DIFERE: os CÓD. FOR, e nada sobra', () => {
    expect(conversoesPedidasPeloRobo(PREFIXO + UN_DIFERE('5510; 99'))).toEqual({ cods: ['5510', '99'], fatores: [], resto: '' })
  })
  it('ketchup (o nome diz N e o app tem outro número; ou a conta da tela não bate): o N', () => {
    expect(conversoesPedidasPeloRobo(KETCHUP_A(168, '12'))).toEqual({ cods: [], fatores: [168], resto: '' })
    expect(conversoesPedidasPeloRobo(KETCHUP_B)).toEqual({ cods: [], fatores: [168], resto: '' })
  })
  it('o que não é isto vem em `resto`; sem nenhum dos dois, null', () => {
    expect(conversoesPedidasPeloRobo(`${UN_DIFERE('5510')}; item 7: 3 linhas na tela (esperava 1)`)?.resto).toBe('item 7: 3 linhas na tela (esperava 1)')
    expect(conversoesPedidasPeloRobo('sem boletos na nota — pagamento manual')).toBeNull()
    expect(conversoesPedidasPeloRobo(null)).toBeNull()
  })
  it('ketchup com dois números diferentes no mesmo trecho não é reconhecido (dúvida)', () => {
    expect(conversoesPedidasPeloRobo(KETCHUP_A(168, '12').replace('informe 168', 'informe 100'))).toBeNull()
  })
})

describe('planoConversaoSugerida — o número vem do NOME do produto, com a conta', () => {
  it('ketchup, embalagem no nome (168UN): sugere 168 e mostra 10 × 168 = 1.680 UN', () => {
    const p = planoConversaoSugerida(nota())
    expect(p?.resto).toBe('')
    expect(p?.sugestoes).toEqual([expect.objectContaining({
      n: 3, nome: 'KETCHUP SACHE HEINZ 168UN', produtoNome: 'KETCHUP SACHE - INSUMOS', numero: 168, trecho: '168UN', conta: '10 × 168 = 1.680 UN', via: 'converter', produtoId: 777, gravado: false, antes: null,
    })])
  })
  it('peso no nome (395G), nota em UN e produto em KG: sugere 0,395', () => {
    const p = planoConversaoSugerida(nota({ lancamento_motivo: PREFIXO + UN_DIFERE('99') }))
    expect(p?.sugestoes).toEqual([expect.objectContaining({ n: 4, numero: 0.395, trecho: '395G', conta: '24 × 0,395 = 9,48 KG', via: 'converter', produtoId: 888 })])
  })
  it('dois itens: só sugere se TODOS têm número seguro', () => {
    expect(planoConversaoSugerida(nota({ lancamento_motivo: `${PREFIXO}${KETCHUP_B}; ${UN_DIFERE('99')}` }))?.sugestoes.map((s) => s.n).sort()).toEqual([3, 4])
    const semNumero = { ...LEITE_ITEM, descricao: 'CÓD. FOR: 99 LEITE COND TIROL SEMIDES' }
    expect(planoConversaoSugerida(nota({ itens: [KETCHUP_ITEM, semNumero], lancamento_motivo: `${PREFIXO}${KETCHUP_B}; ${UN_DIFERE('99')}` } as unknown as Partial<NotaSefazLista>))).toBeNull()
  })
  it.each([
    ['dois números no nome', { descricao: 'CÓD. FOR: 5510 KETCHUP SACHE 168UN CX 100UN' }],
    ['embalagem múltipla no nome (12X395G)', { descricao: 'CÓD. FOR: 5510 LEITE COND 12X395G', unidade_sischef: 'KG' }],
    ['produto em PCT (o número do nome conta unidades e o estoque é em pacote)', { unidade_sischef: 'PCT' }],
    ['sem a quantidade (não há conta para mostrar)', { qtd: null }],
    ['o SisChef já converteu a linha sozinho (quantidade da nota diferente da que a tela mostra)', { qtd_nota: 1680, unidade_nota: 'UN' }],
    ['sem o nome do produto', { produto_nome: null }],
  ])('não sugere: %s', (_t, troca) => {
    const n = nota({ itens: [{ ...KETCHUP_ITEM, ...troca }, LEITE_ITEM] } as unknown as Partial<NotaSefazLista>)
    expect(planoConversaoSugerida(n)).toBeNull()
  })
  it('não sugere com o mesmo CÓD. FOR em dois itens', () => {
    expect(planoConversaoSugerida(nota({ itens: [KETCHUP_ITEM, { ...KETCHUP_ITEM, n: 5 }] } as unknown as Partial<NotaSefazLista>))).toBeNull()
  })
  it('já tem outro número gravado: não contradiz (dúvida entre dois valores)', () => {
    expect(planoConversaoSugerida(nota({ lancamento_motivo: PREFIXO + UN_DIFERE('99'), associacoes_app: decisao(4, 888, 0.5) }))).toBeNull()
  })
  it('já gravou o mesmo número: continua no plano, marcado como gravado (falta só lançar)', () => {
    const p = planoConversaoSugerida(nota({ associacoes_app: decisao(3, 777, 168) }))
    expect(p?.sugestoes[0]).toEqual(expect.objectContaining({ numero: 168, gravado: true }))
  })
  it('decisão do app com o produto escolhido no app: grava pela função de associar', () => {
    const n = nota({ associacoes_app: { '3': { produto_id: 777, produto_nome: 'X', unidade: 'un', conversao: null, origem: 'lista' } }, itens: [{ ...KETCHUP_ITEM, produto_id: null, associacao: null }, LEITE_ITEM] } as unknown as Partial<NotaSefazLista>)
    const p = planoConversaoSugerida(n)
    expect(p?.sugestoes[0]).toEqual(expect.objectContaining({ via: 'associar', produtoId: 777 }))
    expect(p?.notaDepois.associacoes_app?.['3']?.conversao).toBe(168)
  })
  it('ketchup: o robô disse o fator (168) e o nome concorda; o app tinha outro (12): sugere 168 e diz o que tinha', () => {
    const p = planoConversaoSugerida(nota({ lancamento_motivo: KETCHUP_A(168, '12'), associacoes_app: decisao(3, 777, 12) }))
    expect(p?.sugestoes).toEqual([expect.objectContaining({ n: 3, numero: 168, antes: 12, gravado: false, conta: '10 × 168 = 1.680 UN' })])
    expect(planoConversaoSugerida(nota({ lancamento_motivo: KETCHUP_B }))?.sugestoes[0]).toEqual(expect.objectContaining({ n: 3, numero: 168 }))
  })
  it('ketchup: o fator do robô não é o do nome do item, ou há dois itens de ketchup iguais: não sugere', () => {
    expect(planoConversaoSugerida(nota({ lancamento_motivo: KETCHUP_A(100, '12') }))).toBeNull()
    expect(planoConversaoSugerida(nota({ lancamento_motivo: KETCHUP_B, itens: [KETCHUP_ITEM, { ...KETCHUP_ITEM, n: 8, descricao: 'CÓD. FOR: 5511 CATCHUP SACHE 168UN' }] } as unknown as Partial<NotaSefazLista>))).toBeNull()
  })
  it('outro problema no mesmo motivo vem em `resto` (o botão só grava, não lança)', () => {
    expect(planoConversaoSugerida(nota({ lancamento_motivo: `${PREFIXO}${KETCHUP_B}; item 7: 3 linhas na tela (esperava 1)` }))?.resto).toBe('item 7: 3 linhas na tela (esperava 1)')
  })
  it.each([
    ['estado diferente de revisar', { lancamento_estado: 'erro' }],
    ['o robô avisa que pode ter lançado', { lancamento_motivo: `${UN_DIFERE('5510')} — confira no SisChef se algo foi criado antes de lançar de novo` }],
    ['pedido pela metade', { lancamento_motivo: `pedido JÁ gerado 123; ${UN_DIFERE('5510')}` }],
  ])('não sugere: %s', (_t, troca) => { expect(planoConversaoSugerida(nota(troca as unknown as Partial<NotaSefazLista>))).toBeNull() })
})

describe('as frases da conversão sugerida', () => {
  const s = { n: 3, nome: 'KETCHUP SACHE HEINZ 168UN', produtoNome: 'KETCHUP SACHE - INSUMOS', numero: 168, trecho: '168UN', conta: '10 × 168 = 1.680 UN', antes: null as number | null, gravado: false }
  it('curta: o item, o número do nome, a conta e o produto', () => {
    expect(fraseConversaoSugerida(s)).toBe('Item 3 (KETCHUP SACHE HEINZ 168UN): falta a conversão de unidade. Sugestão: 1 unidade da nota = 168 (o nome diz 168UN). Conta: 10 × 168 = 1.680 UN. Produto no SisChef: KETCHUP SACHE.')
  })
  it('diz o número que o app tinha', () => { expect(fraseConversaoSugerida({ ...s, antes: 12 })).toContain('Hoje o app tem 12.') })
  it('depois de gravar: manda tocar em Lançar', () => {
    expect(fraseConversaoGravada(s)).toBe('Item 3 (KETCHUP SACHE HEINZ 168UN): conversão 168 gravada (10 × 168 = 1.680 UN). Agora toque em Lançar.')
  })
})

describe('boletosDaNotaPrevalecem / planoBoletosDaNota — os boletos que a nota já traz', () => {
  it('lê os boletos que o robô listou', () => {
    expect(boletosDaNotaPrevalecem(PREFIXO + BOLETOS)).toEqual({ boletos: [{ valor: 60, vencimento: '2026-11-05' }, { valor: 40, vencimento: '2026-11-12' }], resto: '' })
    expect(boletosDaNotaPrevalecem('sem boletos na nota — pagamento manual')).toBeNull()
  })
  it('o app tem os MESMOS boletos e a soma fecha com a nota: oferece usar', () => {
    const p = planoBoletosDaNota(nota({ lancamento_motivo: PREFIXO + BOLETOS }))
    expect(p?.resto).toBe('')
    expect(p?.parcelas.map((x) => x.valor)).toEqual([60, 40])
    expect(p?.soma).toBe(100)
  })
  it.each([
    ['o app ainda não leu os boletos', { parcelas: null }],
    ['os boletos do app são outros', { parcelas: [{ numero: '001', vencimento: '2026-11-05', valor: 70 }, { numero: '002', vencimento: '2026-11-12', valor: 30 }] }],
    ['a soma não fecha com o valor da nota', { valor_nf: 110 }],
    ['sem o começo que prova que nada foi lançado e com aviso de conferir', { lancamento_motivo: `${BOLETOS} — confira no SisChef se algo foi criado antes de lançar de novo` }],
  ])('não oferece: %s', (_t, troca) => { expect(planoBoletosDaNota(nota({ lancamento_motivo: PREFIXO + BOLETOS, ...troca } as unknown as Partial<NotaSefazLista>))).toBeNull() })
  it('a frase mostra a conta', () => {
    expect(fraseBoletosDaNota([{ valor: 60, vencimento: '2026-11-05' }, { valor: 40, vencimento: '2026-11-12' }], 100)).toBe(
      'A nota já traz os boletos e eles valem mais do que as parcelas digitadas. Sugestão: usar os boletos da nota. Conta: R$ 60,00 (05/11/2026) + R$ 40,00 (12/11/2026) = R$ 100,00, o valor da nota.')
  })
})

describe('formaRecusadaPeloRobo / planoFormaLembrada — a forma que o app lembra deste fornecedor', () => {
  const FALTA = 'falta a forma de pagamento — escolha "como pagar" no app'
  beforeEach(() => { localStorage.clear() })
  it('reconhece falta, desconhecida, inválida e conta PIX que não existe', () => {
    expect(formaRecusadaPeloRobo(FALTA)).toEqual({ resto: '' })
    expect(formaRecusadaPeloRobo("forma de pagamento desconhecida: 'xyz'")).toEqual({ resto: '' })
    expect(formaRecusadaPeloRobo("forma de pagamento inválida: 'boleto:1'")).toEqual({ resto: '' })
    expect(formaRecusadaPeloRobo("conta PIX 'itau|ij' não existe (esperado 'pix:<banco>|<empresa>' com uma destas: bradesco|ij, pangbank|ij)")).toEqual({ resto: '' })
    expect(formaRecusadaPeloRobo('sem boletos na nota — pagamento manual')).toBeNull()
  })
  it('padrão do fornecedor no banco: sugere', () => {
    const p = planoFormaLembrada(nota({ lancamento_motivo: PREFIXO + FALTA, parcelas: [] }), { '03995515011363': 'dinheiro' })
    expect(p).toEqual({ forma: 'dinheiro', rotulo: 'Dinheiro à vista', origem: 'banco', resto: '' })
  })
  it('só o aparelho lembra: sugere', () => {
    lembrarForma('FORNECEDOR TESTE LTDA', 'tesouraria')
    expect(planoFormaLembrada(nota({ lancamento_motivo: PREFIXO + FALTA, parcelas: [] }), {})?.origem).toBe('aparelho')
  })
  it('o banco e o aparelho lembram formas diferentes: não sugere (dúvida)', () => {
    lembrarForma('FORNECEDOR TESTE LTDA', 'tesouraria')
    expect(planoFormaLembrada(nota({ lancamento_motivo: PREFIXO + FALTA, parcelas: [] }), { '03995515011363': 'dinheiro' })).toBeNull()
  })
  it('nada lembrado, ou Pix/cartão (nunca vêm sozinhos): não sugere', () => {
    expect(planoFormaLembrada(nota({ lancamento_motivo: PREFIXO + FALTA, parcelas: [] }), {})).toBeNull()
    expect(planoFormaLembrada(nota({ lancamento_motivo: PREFIXO + FALTA, parcelas: [] }), { '03995515011363': 'pix:bradesco|ij' })).toBeNull()
  })
  it('a frase diz de onde vem', () => {
    expect(fraseFormaLembrada({ forma: 'dinheiro', rotulo: 'Dinheiro', origem: 'banco', resto: '' })).toBe('Falta uma forma de pagamento que o robô aceite. Sugestão: Dinheiro, a forma da última nota lançada deste fornecedor.')
    expect(fraseFormaLembrada({ forma: 'dinheiro', rotulo: 'Dinheiro', origem: 'aparelho', resto: '' })).toContain('que este aparelho lembra')
  })
})
