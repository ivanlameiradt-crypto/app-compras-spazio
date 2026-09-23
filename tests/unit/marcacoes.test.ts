import { Acompanhamento, marcacoesDaCompra } from '../../src/comprador/marcacoes'
import { linha } from '../fabricas'
import type { Op } from '../../src/lib/fila'

describe('marcacoesDaCompra', () => {
  it('junta servidor e fila; a fila vale por último', () => {
    const linhas = [
      linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 }),
      linha({ compra_id: 'c1', item_semana_id: 2, qtd: 1, preco_unit: 18 }),
      linha({ compra_id: 'OUTRA', item_semana_id: 3, qtd: 9 }),
    ]
    const ops: Op[] = [
      { id: 'a', tipo: 'registrar_item', args: { p_id: 'x', p_compra: 'c1', p_item: 1, p_qtd: 50, p_preco: 2.9, p_resultado: 'parcial' } },
      { id: 'b', tipo: 'desmarcar_item', args: { p_compra: 'c1', p_item: 2 } },
      { id: 'c', tipo: 'registrar_item', args: { p_id: 'y', p_compra: 'c1', p_item: 4, p_qtd: 7, p_preco: 1, p_resultado: 'nao_achei' } },
      { id: 'd', tipo: 'registrar_item', args: { p_id: 'z', p_compra: 'OUTRA', p_item: 5, p_qtd: 1, p_preco: 1, p_resultado: 'comprado' } },
    ]
    const m = marcacoesDaCompra('c1', linhas, ops)
    expect([...m.keys()].sort()).toEqual([1, 4])
    expect(m.get(1)).toEqual({ qtd: 50, preco: 2.9, resultado: 'parcial', pendente: true })
    expect(m.get(4)).toEqual({ qtd: 0, preco: null, resultado: 'nao_achei', pendente: true })
  })
})

describe('Acompanhamento (da fila até o servidor confirmar)', () => {
  const marcar = (id: string, item: number, qtd: number, preco: number | null = 2.79): Op =>
    ({ id, tipo: 'registrar_item', args: { p_id: `l-${id}`, p_compra: 'c1', p_item: item, p_qtd: qtd, p_preco: preco, p_resultado: 'comprado' } })
  const desmarcar = (id: string, item: number): Op => ({ id, tipo: 'desmarcar_item', args: { p_compra: 'c1', p_item: item } })

  it('operação que saiu da fila continua na tela até o servidor mostrar', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const x = marcar('x', 1, 52)
    a.atualizar(a.leitura(), [x], [], { linhas: [] })
    // x foi enviada; a busca ainda não trouxe a linha
    let v = a.atualizar(a.leitura(), [], [], { linhas: [] })
    expect(v.linhas).toEqual([expect.objectContaining({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79, marcado_por: 'joao@spazio.com' })])
    // busca falhou: nada encolhe
    v = a.atualizar(a.leitura(), [], [])
    expect(v.linhas).toHaveLength(1)
    // o servidor mostra a linha: a do servidor vale
    const doServidor = linha({ id: 'srv', compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })
    v = a.atualizar(a.leitura(), [], [], { linhas: [doServidor] })
    expect(v.linhas).toEqual([doServidor])
    // e depois disso a operação já não segura nada
    v = a.atualizar(a.leitura(), [], [], { linhas: [] })
    expect(v.linhas).toEqual([])
  })

  it('resposta velha do servidor (valores antigos) não apaga a marcação nova', () => {
    const a = new Acompanhamento('joao@spazio.com')
    a.lembrar(marcar('x', 1, 50))
    const velha = linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })
    const v = a.atualizar(a.leitura(), [], [], { linhas: [velha] })
    expect(v.linhas).toEqual([expect.objectContaining({ item_semana_id: 1, qtd: 50 })])
  })

  it('desmarcar enviado esconde a linha até o servidor apagar', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const l = linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52 })
    a.lembrar(desmarcar('d', 1))
    expect(a.atualizar(a.leitura(), [], [], { linhas: [l] }).linhas).toEqual([])
    expect(a.atualizar(a.leitura(), [], [], { linhas: [] }).linhas).toEqual([])
    expect(a.atualizar(a.leitura(), [], [], { linhas: [l] }).linhas).toEqual([l])
  })

  it('a última operação do mesmo item vale', () => {
    const a = new Acompanhamento('joao@spazio.com')
    a.lembrar(marcar('x', 1, 52))
    a.lembrar(desmarcar('d', 1))
    expect(a.atualizar(a.leitura(), [], [], { linhas: [] }).linhas).toEqual([])
  })

  it('operação que deu erro definitivo não fica na tela', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const x = marcar('x', 1, 52)
    a.lembrar(x)
    const v = a.atualizar(a.leitura(), [], [{ op: x, mensagem: 'esta compra já foi fechada', quando: '' }], { linhas: [] })
    expect(v.linhas).toEqual([])
  })

  it('leitura da fila anterior à operação não conta como envio', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const antes = a.leitura() // a leitura começou…
    const x = marcar('x', 1, 52)
    a.lembrar(x) // …e a operação entrou na fila depois
    a.atualizar(antes, [], [], { linhas: [] })
    // continua só "na fila": se der erro depois, não sobra marcação fantasma
    const v = a.atualizar(a.leitura(), [], [{ op: x, mensagem: 'erro', quando: '' }], { linhas: [] })
    expect(v.linhas).toEqual([])
  })

  it('I-3: entrou na fila e já foi enviada entre duas leituras — continua na tela', () => {
    const a = new Acompanhamento('joao@spazio.com')
    a.atualizar(0, [], []) // recarga em andamento: leu a fila antes de a operação existir
    const pedido = a.leitura() // e pediu as linhas ao servidor
    const x = marcar('x', 1, 52)
    a.entrouNaFila(x) // o comprador marca: a operação entra na fila e sai logo (enviada)
    // as linhas foram servidas antes do commit e a fila já está vazia
    const v = a.atualizar(pedido, [], [], { linhas: [] })
    expect(v.linhas).toEqual([expect.objectContaining({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    // até o servidor confirmar
    const doServidor = linha({ id: 'srv', compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })
    expect(a.atualizar(a.leitura(), [], [], { linhas: [doServidor] }).linhas).toEqual([doServidor])
  })

  it('I-3: registrada ao entrar na fila e depois com erro definitivo — some da tela', () => {
    const a = new Acompanhamento('joao@spazio.com')
    a.atualizar(0, [], [])
    const pedido = a.leitura()
    const x = marcar('x', 1, 52)
    a.entrouNaFila(x)
    const v = a.atualizar(pedido, [], [{ op: x, mensagem: 'esta compra já foi fechada', quando: '' }], { linhas: [] })
    expect(v.linhas).toEqual([])
  })

  it('I-3: registrada ao entrar na fila e ainda na fila — aparece só pela fila, sem linha inventada', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const x = marcar('x', 1, 52)
    a.entrouNaFila(x)
    expect(a.atualizar(a.leitura(), [x], [], { linhas: [] }).linhas).toEqual([])
  })

  it('sem nada do servidor ainda, usa a base guardada no celular', () => {
    const a = new Acompanhamento('joao@spazio.com')
    const l = linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52 })
    a.usarBase([l])
    expect(a.atualizar(a.leitura(), [], []).linhas).toEqual([l])
    a.usarBase([]) // só vale a primeira vez
    expect(a.atualizar(a.leitura(), [], []).linhas).toEqual([l])
  })
})
