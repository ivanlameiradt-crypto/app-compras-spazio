import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { ItemEconomia, PainelEconomia } from '../lib/tipos'
import { mensagemDeErro } from '../lib/regras'
import { type Periodo, datasDoPeriodo, ddmm, economia, ordenarItens, reais, textoEconomia, textoPct } from '../lib/contas'
import { BarrasMeses, Curva, FaiscaItem } from './Graficos'
import HistoricoItem from './HistoricoItem'

// Fase 2, Bloco E1 (DESIGN-fase-2.md E.6): tela Economia (só admin). Números somados pelo banco
// (cot_painel_economia), com a mesma regra de "comparável" da cot_economia.

const CHIPS: { p: Periodo; rotulo: string }[] = [
  { p: 'desde_inicio', rotulo: 'Desde o piloto' },
  { p: 'este_mes', rotulo: 'Este mês' },
  { p: 'mes_passado', rotulo: 'Mês passado' },
  { p: 'tres_meses', rotulo: '3 meses' },
]
const reaisComSinal = (v: number) => (v < 0 ? `−${reais(-v)}` : reais(v))
const pctComSinal = (pct: number | null) => (pct == null ? '' : `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${textoPct(pct)}`)

export default function Economia() {
  const [periodo, setPeriodo] = useState<Periodo>('desde_inicio')
  const [painel, setPainel] = useState<PainelEconomia | null | undefined>()
  const [erro, setErro] = useState('')
  const [verNumeros, setVerNumeros] = useState(false)
  const [verSemComparacao, setVerSemComparacao] = useState(false)
  const [ordem, setOrdem] = useState<'economia' | 'acima' | 'nome'>('economia')
  const [busca, setBusca] = useState('')
  const [item, setItem] = useState<{ id: number; nome: string } | null>(null)

  function carregar(p: Periodo) {
    setErro('')
    setPainel(undefined)
    const { de, ate } = datasDoPeriodo(p, new Date())
    api.painelEconomia(de, ate)
      .then(setPainel)
      .catch((e) => { setErro(mensagemDeErro(e)); setPainel(null) })
  }
  useEffect(() => { carregar(periodo) }, [periodo])

  const itensOrdenados = useMemo<ItemEconomia[]>(() => {
    if (!painel) return []
    const filtrados = busca.trim()
      ? painel.itens.filter((i) => i.produto.toLowerCase().includes(busca.trim().toLowerCase()))
      : painel.itens
    return ordenarItens(filtrados, ordem)
  }, [painel, ordem, busca])

  if (item) return <HistoricoItem produtoId={item.id} nome={item.nome} onFechar={() => setItem(null)} />

  return (
    <section className="economia">
      <div className="chips" role="tablist">
        {CHIPS.map((c) => (
          <button key={c.p} role="tab" aria-selected={periodo === c.p}
            className={`chip${periodo === c.p ? ' ativo' : ''}`} onClick={() => setPeriodo(c.p)}>{c.rotulo}</button>
        ))}
      </div>

      {erro && (
        <>
          <p className="erro">Não consegui abrir o painel: {erro}</p>
          <button className="botao secundario" onClick={() => carregar(periodo)}>Tentar de novo</button>
        </>
      )}
      {!erro && painel === undefined && <p className="centro">Somando os pedidos…</p>}
      {!erro && painel === null && <p className="vazio">O painel ainda não foi instalado no banco.</p>}

      {!erro && painel && (() => {
        const p = painel
        const t = p.total
        const semPedido = t.pedidos === 0
        return (
          <>
            {semPedido
              ? <p className="vazio">Ainda não há pedido confirmado pelas cotações neste período. O painel começa no primeiro pedido.</p>
              : (
                <div className="cartao principal">
                  <div className="sub">{tituloCartao(periodo, p)}</div>
                  <b className={`valor ${economia(t) >= 0 ? 'bom' : 'ruim'}`} data-testid="economia-valor">{reaisComSinal(economia(t))}</b>
                  <div className="sub" data-testid="economia-texto">{textoEconomia(t)}</div>
                  <div className="sub">
                    Pedidos {reais(t.total_pedido)} · pelo último preço seriam {reais(t.total_ultimo)} · {t.comparados} itens comparados
                    {' · '}{t.sem_comparacao} sem comparação
                    {t.sem_comparacao > 0 && <button className="link" onClick={() => setVerSemComparacao((v) => !v)}>[ver]</button>}
                  </div>
                  {verSemComparacao && p.sem_comparacao.length > 0 && (
                    <ul className="sem-comparacao">
                      {p.sem_comparacao.map((s) => <li key={s.produto_id}>{s.produto} · {s.linhas} · {rotuloMotivo(s.motivo)}</li>)}
                    </ul>
                  )}
                </div>
              )}

            {!semPedido && (
              <>
                <div className="grupo">Economia acumulada, semana a semana</div>
                <Curva semanas={p.semanas} />
                <button className="link" data-testid="ver-numeros" onClick={() => setVerNumeros((v) => !v)}>
                  {verNumeros ? 'Ocultar números' : 'Ver números'}
                </button>
                {verNumeros && (
                  <table className="tabela" data-testid="tabela-semanas">
                    <thead><tr><th>Semana</th><th>Pedido</th><th>Pelo último</th><th>Economia</th><th>Acumulado</th></tr></thead>
                    <tbody>
                      {p.semanas.map((s) => (
                        <tr key={s.semana_id}>
                          <td>{ddmm(s.data_referencia)}</td><td>{reais(s.total_pedido)}</td><td>{reais(s.total_ultimo)}</td>
                          <td>{reaisComSinal(economia(s))}</td><td>{reaisComSinal(-s.acumulado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="grupo">Por mês</div>
                <BarrasMeses meses={p.meses} />
                <table className="tabela">
                  <thead><tr><th>Mês</th><th>Pedidos</th><th>Pelo último</th><th>Economia</th><th>%</th></tr></thead>
                  <tbody>
                    {p.meses.map((m) => (
                      <tr key={m.mes}>
                        <td>{m.mes}</td><td>{m.pedidos}</td><td>{reais(m.total_ultimo)}</td>
                        <td>{reaisComSinal(economia(m))}</td><td>{pctComSinal(m.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grupo">Por vendedor</div>
                <table className="tabela">
                  <thead><tr><th>Vendedor</th><th>Semanas</th><th>Comprado</th><th>Economia</th><th>%</th><th>Acima</th></tr></thead>
                  <tbody>
                    {p.vendedores.map((v) => (
                      <tr key={v.vendedor_id}>
                        <td>{v.rotulo}</td><td>{v.semanas}</td><td>{reais(v.total_pedido)}</td>
                        <td>{reaisComSinal(economia(v))}</td><td>{pctComSinal(v.pct)}</td><td>{v.acima} de {v.comparados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grupo">Por categoria</div>
                <table className="tabela">
                  <thead><tr><th>Categoria</th><th>Pedidos</th><th>Comprado</th><th>Economia</th><th>%</th></tr></thead>
                  <tbody>
                    {p.categorias.map((c) => (
                      <tr key={c.categoria}>
                        <td>{c.categoria}</td><td>{c.pedidos}</td><td>{reais(c.total_pedido)}</td>
                        <td>{reaisComSinal(economia(c))}</td><td>{pctComSinal(c.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grupo">Itens</div>
                <div className="chips">
                  <button className={`chip${ordem === 'economia' ? ' ativo' : ''}`} onClick={() => setOrdem('economia')}>Mais economia</button>
                  <button className={`chip${ordem === 'acima' ? ' ativo' : ''}`} onClick={() => setOrdem('acima')}>Mais caros que o último</button>
                  <button className={`chip${ordem === 'nome' ? ' ativo' : ''}`} onClick={() => setOrdem('nome')}>A–Z</button>
                </div>
                <input className="busca" aria-label="Buscar item" placeholder="Buscar item…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {itensOrdenados.map((i) => (
                  <button key={i.produto_id} className="cartao item" onClick={() => setItem({ id: i.produto_id, nome: i.produto })}>
                    <div className="nome">{i.produto}</div>
                    <div className="sub">
                      {i.pedidos} {i.pedidos === 1 ? 'pedido' : 'pedidos'} · {pctComSinal(i.variacao)}
                      {i.preco_primeiro != null && i.preco_ultimo != null && ` · ${reais(i.preco_primeiro)} → ${reais(i.preco_ultimo)}`}
                    </div>
                    <FaiscaItem item={i} />
                  </button>
                ))}
              </>
            )}

            <div className="grupo">Preço no SisChef (todas as compras)</div>
            <div className="sub">Maiores altas</div>
            {p.sischef.altas.length === 0 ? <p className="sub">—</p> : (
              <ul className="sischef">
                {p.sischef.altas.map((a) => (
                  <li key={`alta${a.produto_id}`} data-testid="sischef-alta">
                    {a.produto} · {reais(a.primeiro.preco)} ({ddmm(a.primeiro.data)}) → {reais(a.ultimo.preco)} ({ddmm(a.ultimo.data)}) · +{textoPct(a.variacao)}
                  </li>
                ))}
              </ul>
            )}
            <div className="sub">Maiores quedas</div>
            {p.sischef.quedas.length === 0 ? <p className="sub">—</p> : (
              <ul className="sischef">
                {p.sischef.quedas.map((a) => (
                  <li key={`queda${a.produto_id}`} data-testid="sischef-queda">
                    {a.produto} · {reais(a.primeiro.preco)} ({ddmm(a.primeiro.data)}) → {reais(a.ultimo.preco)} ({ddmm(a.ultimo.data)}) · −{textoPct(a.variacao)}
                  </li>
                ))}
              </ul>
            )}

            <p className="rodape">
              Comparação só nos itens com último preço confiável (compra de até 90 dias e perto do custo médio).
              Itens em litro sem conversão, com último preço antigo ou sem referência ficam fora das somas.
              Mês = mês da segunda-feira da semana. Por vendedor e por categoria, a soma pode diferir do total em centavos.
            </p>
          </>
        )
      })()}
    </section>
  )
}

function tituloCartao(periodo: Periodo, p: PainelEconomia): string {
  if (periodo === 'desde_inicio') return p.inicio ? `Economia desde ${ddmm(p.inicio)}` : 'Economia no período'
  if (periodo === 'este_mes') return 'Economia neste mês'
  if (periodo === 'mes_passado') return 'Economia no mês passado'
  return `Economia de ${ddmm(p.de)} a ${ddmm(p.ate)}`
}

const MOTIVOS: Record<string, string> = {
  sem_conversao: 'litro sem conversão',
  ultimo_preco_antigo: 'último preço antigo',
  sem_referencia: 'sem referência',
}
const rotuloMotivo = (m: string) => MOTIVOS[m] ?? m
