import type { ErroFila, Op } from '../lib/fila'
import type { LinhaCompra, Resultado } from '../lib/tipos'

export interface Marcacao { qtd: number; preco: number | null; resultado: Resultado; pendente: boolean }

/** O que ESTA compra já marcou: o que o servidor tem + o que ainda está na fila do celular. */
export function marcacoesDaCompra(compraId: string, linhas: LinhaCompra[], ops: Op[]): Map<number, Marcacao> {
  const m = new Map<number, Marcacao>()
  for (const l of linhas) {
    if (l.compra_id === compraId) {
      m.set(l.item_semana_id, { qtd: Number(l.qtd), preco: l.preco_unit, resultado: l.resultado, pendente: false })
    }
  }
  for (const op of ops) {
    if (op.tipo === 'registrar_item' && op.args.p_compra === compraId) {
      const nao = op.args.p_resultado === 'nao_achei'
      m.set(op.args.p_item, { qtd: nao ? 0 : op.args.p_qtd, preco: nao ? null : op.args.p_preco, resultado: op.args.p_resultado, pendente: true })
    }
    if (op.tipo === 'desmarcar_item' && op.args.p_compra === compraId) m.delete(op.args.p_item)
  }
  return m
}

type OpMarca = Extract<Op, { tipo: 'registrar_item' | 'desmarcar_item' }>

function ehOpDeMarca(op: Op): op is OpMarca {
  return op.tipo === 'registrar_item' || op.tipo === 'desmarcar_item'
}
function chaveOp(op: OpMarca): string {
  return `${op.args.p_compra}:${op.args.p_item}`
}
function linhaSintetica(op: Extract<Op, { tipo: 'registrar_item' }>, email: string): LinhaCompra {
  const nao = op.args.p_resultado === 'nao_achei'
  return {
    id: op.args.p_id,
    compra_id: op.args.p_compra,
    item_semana_id: op.args.p_item,
    qtd: nao ? 0 : op.args.p_qtd,
    preco_unit: nao ? null : op.args.p_preco,
    resultado: op.args.p_resultado,
    marcado_por: email,
    marcado_em: new Date().toISOString(),
  }
}
/** A operação já apareceu do jeito esperado na busca do servidor (ou, pra desmarcar, já sumiu)? */
function confirmada(op: OpMarca, linhas: LinhaCompra[]): boolean {
  const doItem = linhas.find((l) => l.compra_id === op.args.p_compra && l.item_semana_id === op.args.p_item)
  if (op.tipo === 'desmarcar_item') return !doItem
  if (!doItem) return false
  const nao = op.args.p_resultado === 'nao_achei'
  const qtd = nao ? 0 : op.args.p_qtd
  const preco = nao ? null : op.args.p_preco
  return Number(doItem.qtd) === qtd && doItem.preco_unit === preco && doItem.resultado === op.args.p_resultado
}

/**
 * Cobre a janela entre uma marcação sair da fila do celular (enviada) e a busca de `linhas` do
 * servidor confirmar (ou negar) o que foi enviado — pra o item não "desmarcar" na tela nesse
 * meio-tempo, nem se a busca seguinte falhar ou chegar fora de ordem.
 *
 * `leitura()` deve ser chamado logo antes de pedir `linhas` ao servidor; o número devolvido
 * identifica esse pedido. Ao chamar `atualizar` com o resultado, se um pedido mais novo já tiver
 * sido feito nesse meio-tempo, o resultado é tratado como resposta velha (ignorado para fins de
 * confirmação) — mas a fila e os erros (sempre lidos na hora, sem essa corrida) continuam valendo.
 */
export class Acompanhamento {
  private email: string
  private seq = 0
  private emFila = new Map<string, Op>()
  private enviados = new Map<string, OpMarca>()
  private ultimasLinhas: LinhaCompra[] | null = null
  private baseInicial: LinhaCompra[] | null = null

  constructor(email: string) { this.email = email }

  leitura(): number { return ++this.seq }

  /** Usa como base só até a primeira busca real ao servidor (ex.: cache local ao abrir a tela). */
  usarBase(linhas: LinhaCompra[]): void {
    if (this.baseInicial === null && this.ultimasLinhas === null) this.baseInicial = linhas
  }

  /**
   * A operação acabou de entrar na fila (chamar logo ao enfileirar). Sem isso, se ela for enviada
   * antes de alguma leitura da fila vê-la (ex.: uma recarga que já tinha lido a fila), ela não
   * estaria nem na fila nem nas linhas do servidor e o item "desmarcaria" na tela.
   */
  entrouNaFila(op: Op): void {
    this.emFila.set(op.id, op)
  }

  /** Marca uma operação como já enviada sem esperar ela sumir da fila (usado nos testes). */
  lembrar(op: Op): void {
    if (ehOpDeMarca(op)) this.enviados.set(chaveOp(op), op)
  }

  atualizar(pedido: number, filaAtual: Op[], erros: ErroFila[], resultado?: { linhas: LinhaCompra[] }): { linhas: LinhaCompra[] } {
    // 1) quem estava na fila e saiu foi enviado ao servidor — mas ainda não está confirmado
    const idsAgora = new Set(filaAtual.map((o) => o.id))
    for (const [id, op] of this.emFila) {
      if (!idsAgora.has(id) && ehOpDeMarca(op)) this.enviados.set(chaveOp(op), op)
    }
    this.emFila = new Map(filaAtual.map((o) => [o.id, o]))

    // 2) erro definitivo: a operação não pendura mais nada na tela
    for (const erro of erros) {
      if (!ehOpDeMarca(erro.op)) continue
      const chave = chaveOp(erro.op)
      if (this.enviados.get(chave)?.id === erro.op.id) this.enviados.delete(chave)
    }

    // 3) resposta do servidor — só conta se for a mais recente pedida (senão é resposta velha)
    if (resultado && pedido === this.seq) {
      this.ultimasLinhas = resultado.linhas
      for (const [chave, op] of this.enviados) {
        if (confirmada(op, resultado.linhas)) this.enviados.delete(chave)
      }
    }

    const base = this.ultimasLinhas ?? this.baseInicial ?? []
    const linhas = base.filter((l) => !this.enviados.has(`${l.compra_id}:${l.item_semana_id}`))
    for (const op of this.enviados.values()) {
      if (op.tipo === 'registrar_item') linhas.push(linhaSintetica(op, this.email))
    }
    return { linhas }
  }
}
