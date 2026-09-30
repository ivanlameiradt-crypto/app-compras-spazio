import type { ItemEconomia, Metricas, SemanaPainel } from './tipos'

// Fase 2, Bloco E1 (DESIGN-fase-2.md E.6): contas puras do painel de economia. Sem estado nem rede — testadas
// em tests/unit/contas.test.ts. O painel fala por extenso e usa "economia positiva = economizou".

export type Periodo = 'desde_inicio' | 'este_mes' | 'mes_passado' | 'tres_meses'

const dois = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${dois(m)}-${dois(d)}`

/** As datas de/até (AAAA-MM-DD, hora de Brasília, pelo relógio do App) de cada chip de período. */
export function datasDoPeriodo(p: Periodo, hoje: Date): { de: string | null; ate: string } {
  const y = hoje.getFullYear()
  const m = hoje.getMonth() + 1
  const d = hoje.getDate()
  const ate = ymd(y, m, d)
  if (p === 'desde_inicio') return { de: null, ate }
  if (p === 'este_mes') return { de: ymd(y, m, 1), ate }
  if (p === 'mes_passado') {
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    const ultimo = new Date(py, pm, 0).getDate() // dia 0 do mês seguinte = último dia de pm
    return { de: ymd(py, pm, 1), ate: ymd(py, pm, ultimo) }
  }
  // tres_meses: primeiro dia de dois meses atrás (jul quando hoje é set) até hoje
  let sm = m - 2
  let sy = y
  if (sm <= 0) { sm += 12; sy -= 1 }
  return { de: ymd(sy, sm, 1), ate }
}

/** Economia (positivo = economizou) = −diferença. */
export function economia(m: Metricas): number {
  return -m.diferenca
}

/** R$ 1.234,56 */
export function reais(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "5,3%" — uma casa, sem sinal (o sentido vai no texto). null → "". */
export function textoPct(pct: number | null): string {
  if (pct == null) return ''
  return `${Math.abs(pct * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/** As quatro frases do cartão principal (E.6). */
export function textoEconomia(m: Metricas): string {
  if (m.comparados === 0 || m.total_ultimo === 0) return 'Sem itens comparáveis no período.'
  const pct = textoPct(m.pct)
  if (m.diferenca < 0) return `Economizou ${reais(-m.diferenca)} (${pct} abaixo do último preço pago)`
  if (m.diferenca > 0) return `Pagou ${reais(m.diferenca)} a mais (${pct} acima do último preço pago)`
  return 'Igual ao último preço pago.'
}

/** '2026-09-28' → '28/09'. */
export function ddmm(data: string): string {
  const [, m, d] = data.split('-')
  return `${d}/${m}`
}

/** Ordena os itens (cópia): mais economia, mais caros que o último, ou A–Z. Não muda o array recebido. */
export function ordenarItens(itens: ItemEconomia[], por: 'economia' | 'acima' | 'nome'): ItemEconomia[] {
  const xs = [...itens]
  if (por === 'nome') return xs.sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR'))
  if (por === 'acima') return xs.sort((a, b) => b.diferenca - a.diferenca || a.produto.localeCompare(b.produto, 'pt-BR'))
  return xs.sort((a, b) => a.diferenca - b.diferenca || a.produto.localeCompare(b.produto, 'pt-BR'))
}

/** Pontos (x, y em pixels) da curva de economia acumulada, com a linha do zero dentro da escala. */
export function pontosDaCurva(
  semanas: SemanaPainel[], largura: number, altura: number,
): { x: number; y: number; rotulo: string; valor: number }[] {
  if (semanas.length === 0) return []
  const valores = semanas.map((s) => -s.acumulado) // economia acumulada (positivo = economizou)
  const max = Math.max(0, ...valores)
  const min = Math.min(0, ...valores)
  const span = max - min || 1
  const n = semanas.length
  return semanas.map((s, i) => {
    const valor = -s.acumulado
    return {
      x: n === 1 ? largura / 2 : (i / (n - 1)) * largura,
      y: altura - ((valor - min) / span) * altura, // maior economia = topo
      rotulo: ddmm(s.data_referencia),
      valor,
    }
  })
}

/** A altura (px) da linha do zero na escala da curva — dentro do gráfico quando o zero está no intervalo. */
export function zeroDaCurva(semanas: SemanaPainel[], altura: number): number {
  if (semanas.length === 0) return altura
  const valores = semanas.map((s) => -s.acumulado)
  const max = Math.max(0, ...valores)
  const min = Math.min(0, ...valores)
  const span = max - min || 1
  return altura - ((0 - min) / span) * altura
}
