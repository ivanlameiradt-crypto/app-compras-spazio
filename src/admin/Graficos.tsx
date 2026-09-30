import type { ItemEconomia, MesPainel, SemanaPainel } from '../lib/tipos'
import { ddmm, economia, pontosDaCurva, reais, zeroDaCurva } from '../lib/contas'

// Fase 2, Bloco E1 (DESIGN-fase-2.md E.6): gráficos SVG inline do painel, sem biblioteca nova. Cores por
// currentColor/CSS; o texto acessível vai em <title>/aria-label para o leitor de tela e os testes.

const L = 320
const A = 120

/** Curva "Economia acumulada, semana a semana": linha do zero, rótulos dd/mm e o valor no último ponto. */
export function Curva({ semanas }: { semanas: SemanaPainel[] }) {
  if (semanas.length === 0) return <p className="sub">Sem semanas com pedido no período.</p>
  const pts = pontosDaCurva(semanas, L, A)
  const zero = zeroDaCurva(semanas, A)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const ultimo = pts[pts.length - 1]
  const emCompra = semanas[semanas.length - 1].status === 'em_compra'
  return (
    <svg className="curva" viewBox={`0 0 ${L} ${A + 24}`} role="img" aria-label={`Economia acumulada, último ponto ${reais(ultimo.valor)}`}>
      <line x1={0} x2={L} y1={zero.toFixed(1)} y2={zero.toFixed(1)} className="curva-zero" />
      <path d={d} className="curva-linha" fill="none" />
      {pts.map((p, i) => <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={2.5} className="curva-ponto" />)}
      {pts.map((p, i) => (
        <text key={`r${i}`} x={p.x.toFixed(1)} y={A + 16} className="curva-rotulo" textAnchor="middle">
          {p.rotulo}{emCompra && i === pts.length - 1 ? ' (em andamento)' : ''}
        </text>
      ))}
      <text x={ultimo.x.toFixed(1)} y={Math.max(10, ultimo.y - 6).toFixed(1)} className="curva-valor" textAnchor="end">{reais(ultimo.valor)}</text>
    </svg>
  )
}

/** Faísca 80×20 do item: o preço do pedido, com o último preço tracejado. */
export function Faisca({ pontos, ultimo }: { pontos: (number | null)[]; ultimo: number | null }) {
  const w = 80
  const h = 20
  const vals = pontos.filter((p): p is number => p != null)
  if (vals.length === 0) return <svg className="faisca" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />
  const todos = ultimo != null ? [...vals, ultimo] : vals
  const max = Math.max(...todos)
  const min = Math.min(...todos)
  const span = max - min || 1
  const y = (v: number) => h - ((v - min) / span) * (h - 2) - 1
  const x = (i: number) => (vals.length === 1 ? w / 2 : (i / (vals.length - 1)) * w)
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="faisca" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {ultimo != null && <line x1={0} x2={w} y1={y(ultimo).toFixed(1)} y2={y(ultimo).toFixed(1)} className="faisca-ultimo" />}
      <path d={d} className="faisca-linha" fill="none" />
    </svg>
  )
}

/** Barras por mês: para cima quando economizou, para baixo quando pagou a mais, com o valor em cada barra. */
export function BarrasMeses({ meses }: { meses: MesPainel[] }) {
  if (meses.length === 0) return null
  const valores = meses.map(economia)
  const teto = Math.max(1, ...valores.map(Math.abs))
  const larguraBarra = Math.min(60, Math.floor(L / meses.length) - 8)
  const meio = A / 2
  return (
    <svg className="barras" viewBox={`0 0 ${L} ${A + 20}`} role="img" aria-label="Economia por mês">
      <line x1={0} x2={L} y1={meio} y2={meio} className="curva-zero" />
      {meses.map((m, i) => {
        const v = valores[i]
        const alt = (Math.abs(v) / teto) * (meio - 6)
        const cx = (i + 0.5) * (L / meses.length)
        const y = v >= 0 ? meio - alt : meio
        return (
          <g key={m.mes}>
            <rect x={(cx - larguraBarra / 2).toFixed(1)} y={y.toFixed(1)} width={larguraBarra} height={Math.max(1, alt).toFixed(1)}
              className={v >= 0 ? 'barra-economizou' : 'barra-pagou'} />
            <text x={cx.toFixed(1)} y={A + 14} className="curva-rotulo" textAnchor="middle">{mesCurto(m.mes)}</text>
          </g>
        )
      })}
    </svg>
  )
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesCurto(mes: string): string {
  const [ano, m] = mes.split('-')
  return `${MESES[Number(m) - 1]}/${ano.slice(2)}`
}

/** Faísca de um item de economia (usa os pontos do painel). */
export function FaiscaItem({ item }: { item: ItemEconomia }) {
  return <Faisca pontos={item.pontos.map((p) => p.preco)} ultimo={item.preco_ultimo} />
}

export { ddmm }
