// Ação "retomar" (11/11/2026): o botão "Terminar pedido" do app. O robô já sabe continuar um pedido que ficou pela metade
// (`retomar: true` no nota_json); faltava o app pedir. A nota CONTINUA 'erro' o tempo todo (o robô é quem a marca lançada).
import { describe, expect, it } from 'vitest'
import {
  MINUTOS_ENTRE_RETOMADAS, montarNotaJson, montarNotaJsonRetomada, motivoNaoRetomavel, retomar,
  type DepsRetomar, type NotaPelaMetade,
} from './logica'

const CHAVE = '15261102914460060722550010001923231201244920'
const AGORA = new Date('2026-11-11T12:00:00.000Z')
const MOTIVO_PAGAMENTO = "erro no lançamento (pedido JÁ gerado 167483685 — conferir no Sischef; pedido: https://sistema.sischef.com/admin/pedido/pedido.jsf?keyPedido=29e1037a; tela no erro: https://sistema.sischef.com/admin/pedido/gerarCompraVenda.jsf?id=167483685) no passo 'pagamento': pagamento não confere antes de finalizar: vencimento da linha 1 = '11/11/2026', esperado '07/12/2026' (boleto do XML)"
const METADE: NotaPelaMetade = {
  chave: CHAVE, emitente: 'SEARA ALIMENTOS LTDA', numero: '000192323', emissao: '2026-11-09', valor_nf: '621.00', forma_pagamento: 'boleto',
  itens: [{ n: 1, descricao: 'CALABRESA RETA', produto_id: '3454438', associacao: 'sischef', qtd: 30, unidade_sischef: 'KG' }],
  situacao: 'na_fila', lancamento_estado: 'erro', lancamento_motivo: MOTIVO_PAGAMENTO, lancamento_em: '2026-11-11T03:40:00.000Z',
  lancada_em: null, descartada_em: null, parcelas: [{ numero: '001', vencimento: '2026-12-07', valor: 621 }],
  v_prod: 621, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0,
}

function fakeRetomar(over: Partial<DepsRetomar> = {}, nota: NotaPelaMetade | null = METADE) {
  const disparos: string[] = []
  const carimbos: unknown[][] = []
  const desfeitos: unknown[][] = []
  const deps: DepsRetomar = {
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async outraLancando() { return false },
    async notaPelaMetade() { return nota },
    async carimbarRetomada(...a) { carimbos.push(a); return true },
    async desfazerCarimbo(...a) { desfeitos.push(a) },
    async disparar(j) { disparos.push(j) },
    agora: () => AGORA,
    ...over,
  }
  return { deps, disparos, carimbos, desfeitos }
}

describe('motivoNaoRetomavel (o que o app confere antes de chamar o robô; o robô repete tudo, fail-closed)', () => {
  it('boleto simples parado no pagamento, com o número do pedido: pode', () => {
    expect(motivoNaoRetomavel(METADE)).toBeNull()
  })
  it.each([
    ['nota já lançada', { situacao: 'lancada' }, /já foi lançada/],
    ['nota que não está pela metade', { lancamento_estado: 'revisar' }, /não está pela metade/],
    ['nota excluída', { descartada_em: '2026-10-06T00:00:00Z' }, /excluída/],
    ['sem o número do pedido no motivo', { lancamento_motivo: "erro no lançamento no passo 'pagamento': x" }, /não guardou o número do pedido/],
    ['erro depois de finalizar a compra', { lancamento_motivo: MOTIVO_PAGAMENTO.replace("'pagamento'", "'Finalizar compra'") }, /confira o pedido no SisChef/],
    ['compra ou nota já FINALIZADA', { lancamento_motivo: MOTIVO_PAGAMENTO + ' compra FINALIZADA' }, /confira o pedido no SisChef/],
    ['pedido aberto de propósito com o frete', { lancamento_motivo: 'pedido 1 aberto na tela de pagamento com o frete de R$ 10,00' }, /frete/],
    ['forma que não é boleto', { forma_pagamento: 'dinheiro' }, /boleto/],
    ['nota com frete', { frete_valor: 10, frete_tipo: '0' }, /frete/],
    ['parcelas digitadas', { parcelas_manuais: [{ vencimento: '2026-12-07', valor: 621 }] }, /parcelas digitadas/],
    ['nota com imposto ou desconto', { v_ipi: 12.5 }, /imposto|desconto/],
    ['sem boletos lidos', { parcelas: [] }, /boletos/],
  ])('%s: não pode', (_nome, mudanca, texto) => {
    expect(motivoNaoRetomavel({ ...METADE, ...(mudanca as Partial<NotaPelaMetade>) })).toMatch(texto)
  })
  it('vale o passo do erro MAIS RECENTE (o anterior vem depois de " | antes: ")', () => {
    const m = MOTIVO_PAGAMENTO.replace("'pagamento'", "'Gerar nota fiscal'") + ' | antes: ' + MOTIVO_PAGAMENTO
    expect(motivoNaoRetomavel({ ...METADE, lancamento_motivo: m })).toMatch(/confira o pedido no SisChef/)
  })
  it('aceita o número do pedido guardado como " | id: N" (o formato que o robô usa depois de uma retomada que falhou)', () => {
    const m = "RETOMADA: x no passo 'pagamento': y | pedido: https://sistema.sischef.com/admin/pedido/pedido.jsf?keyPedido=ab | id: 167483685"
    expect(motivoNaoRetomavel({ ...METADE, lancamento_motivo: m })).toBeNull()
  })
})

describe('retomar (botão "Terminar pedido")', () => {
  it('só o administrador ativo', async () => {
    const f = fakeRetomar({ async buscarUsuario() { return { papel: 'comprador', ativo: true } } })
    expect((await retomar({ chave: CHAVE }, 'x@y', f.deps)).status).toBe(403)
    expect(f.disparos).toEqual([])
  })
  it('chave inválida e nota inexistente', async () => {
    expect((await retomar({ chave: '123' }, 'a@b', fakeRetomar().deps)).status).toBe(400)
    expect((await retomar({ chave: CHAVE }, 'a@b', fakeRetomar({}, null).deps)).status).toBe(404)
  })
  it('nota que não dá para retomar: recusa com o motivo e não chama o robô', async () => {
    const f = fakeRetomar({}, { ...METADE, forma_pagamento: 'dinheiro' })
    const r = await retomar({ chave: CHAVE }, 'a@b', f.deps)
    expect(r.status).toBe(409)
    expect(String(r.corpo.erro)).toMatch(/boleto/)
    expect(f.disparos).toEqual([])
    expect(f.carimbos).toEqual([])
  })
  it('com outra nota lançando: recusa (um robô por vez)', async () => {
    const f = fakeRetomar({ async outraLancando() { return true } })
    const r = await retomar({ chave: CHAVE }, 'a@b', f.deps)
    expect(r.status).toBe(409)
    expect(f.disparos).toEqual([])
  })
  it('pedido de retomada há menos de 5 minutos: recusa o segundo toque sem chamar o robô', async () => {
    const f = fakeRetomar({ async carimbarRetomada() { return false } })
    const r = await retomar({ chave: CHAVE }, 'a@b', f.deps)
    expect(r.status).toBe(409)
    expect(String(r.corpo.erro)).toMatch(/aguarde/i)
    expect(f.disparos).toEqual([])
  })
  it('caminho feliz: carimba a hora (sem mudar o estado nem o motivo) e dispara com retomar: true', async () => {
    const f = fakeRetomar()
    const r = await retomar({ chave: CHAVE }, 'a@b', f.deps)
    expect(r.status).toBe(202)
    const limite = new Date(AGORA.getTime() - MINUTOS_ENTRE_RETOMADAS * 60_000).toISOString()
    expect(f.carimbos).toEqual([[CHAVE, MOTIVO_PAGAMENTO, AGORA.toISOString(), limite]])
    const enviado = JSON.parse(f.disparos[0])
    expect(enviado.retomar).toBe(true) // booleano de verdade: o robô recusa "true" em texto
    expect(enviado.lancamento_estado).toBe('erro')
    expect(enviado.lancamento_motivo).toBe(MOTIVO_PAGAMENTO)
    expect(enviado.situacao).toBe('na_fila')
    expect(enviado.chave).toBe(CHAVE)
    expect(enviado.forma_pagamento).toBe('boleto')
    expect(enviado.parcelas).toEqual(METADE.parcelas)
    expect(enviado).toMatchObject({ v_prod: 621, valor_nf: '621.00', v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 })
    expect(enviado.itens[0].produto_id).toBe('3454438')
  })
  it('o robô não atendeu: devolve a hora anterior (o botão volta a valer) e avisa', async () => {
    const f = fakeRetomar({ async disparar() { throw new Error('x') } })
    const r = await retomar({ chave: CHAVE }, 'a@b', f.deps)
    expect(r.status).toBe(502)
    expect(f.desfeitos).toEqual([[CHAVE, METADE.lancamento_em]])
  })
})

describe('montarNotaJsonRetomada', () => {
  it('leva tudo o que o lançamento normal leva, mais o registro do erro e os totais do XML', () => {
    const normal = JSON.parse(montarNotaJson(METADE))
    const ret = JSON.parse(montarNotaJsonRetomada(METADE))
    expect(ret).toMatchObject(normal)
    expect(Object.keys(ret)).toEqual(expect.arrayContaining(['retomar', 'situacao', 'lancamento_estado', 'lancamento_motivo', 'parcelas', 'v_prod']))
  })
})
