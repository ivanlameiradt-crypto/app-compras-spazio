// 14/11/2026: o botão "Tentar de novo" do cupom (app, cupomRegras.motivoPassageiroDoCupom) e o modo `tentar_de_novo` da função (passageiro.motivoEhPassageiro) têm de reconhecer os MESMOS textos:
// o app que oferece o botão para um texto que o servidor recusa mostra um erro; o servidor que aceita um texto que o app esconde solta cupom sem o Ivan ver. Este teste compara os dois.
import { motivoPassageiroDoCupom } from '../../src/admin/cupomRegras'
import { motivoEhPassageiro } from '../../supabase/functions/confirmar-cupom/passageiro'
import type { CupomRecente } from '../../src/lib/tipos'

const item = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 1, sugestao_produto: { id: '3484974' }, casado_por: 'descricao' }
const doApp = (motivo: string | null) => motivoPassageiroDoCupom({ id: 'c', estado: 'REVISAR', pedido_sischef: null, motivo, itens: [item] } as unknown as CupomRecente) !== null

const NAO_COLOCOU = 'item 2: o Sischef não colocou o produto (código 3484991) na lista em ~30 s (demora do Sischef ou produto fora do catálogo)'
const GRADE = 'a grade do Sischef tem 4 linha(s), esperava 3: uma linha pode ter entrado duas vezes (nada foi gerado)'
const MONTAR = 'falha ao montar o pedido no Sischef ao preencher a linha (código 3484974): tempo esgotado'
const TESTE = 'erro inesperado no teste (dry-run, nada foi criado no Sischef): x'
const TESTE_PRESO = 'PROCESSANDO preso há mais de 20 min (cupom de teste: o dry-run nunca cria compra)'
const FALHA = 'CONFERÊNCIA DE REPETIDA FALHOU: não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef).'
const REPETIDA = 'POSSÍVEL REPETIDA: já existe uma compra parecida'

const CASOS: (string | null)[] = [
  null, '', '   ', NAO_COLOCOU, GRADE, MONTAR, TESTE, TESTE_PRESO, 'falha ao montar o pedido no Sischef: Timeout', 'item 3: falha ao montar o pedido no Sischef: Timeout',
  `${NAO_COLOCOU}; ${GRADE}`, `${MONTAR}; ${TESTE}`, `${NAO_COLOCOU}; texto desconhecido`, 'texto desconhecido', 'CONFIRMAR: confira antes de lançar', 'fornecedor não encontrado no Sischef (CNPJ 1)',
  FALHA, REPETIDA, `${MONTAR}; ${FALHA}`, `${MONTAR}; ${REPETIDA}`, `${MONTAR}; GERAR_COMPRA_CLICADO`, `${MONTAR}: pedido criado 5`, 'CONFERIR NO SISCHEF antes de repetir: ' + MONTAR,
  'PROCESSANDO preso há mais de 20 min (nunca lançado)', 'falha ao montar o pedido no Sischef: ' + 'x'.repeat(1499), 'falha ao montar o pedido no Sischef: ' + 'x'.repeat(1500),
  'falha ao montar o pedido no Sischef: Finalizar compra', 'falha ao montar o pedido no Sischef: pagamento no Sischef', 'erro inesperado no teste (dry-run; nada foi criado no Sischef): x',
]

describe('"Tentar de novo" do cupom: o app e a função reconhecem os mesmos motivos', () => {
  it.each(CASOS.map((m, i) => [i, m] as const))('caso %i', (_i, motivo) => {
    expect(motivoEhPassageiro(motivo)).toBe(doApp(motivo))
  })
  it('os casos cobrem os dois lados (alguns aceitos, outros recusados)', () => {
    const aceitos = CASOS.filter((m) => motivoEhPassageiro(m)).length
    expect(aceitos).toBeGreaterThanOrEqual(8)
    expect(CASOS.length - aceitos).toBeGreaterThanOrEqual(10)
  })
})
