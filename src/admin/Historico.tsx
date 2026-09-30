import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HistoricoItemLinha, HistoricoSemana, Vendedor } from '../lib/tipos'
import { mensagemDeErro } from '../lib/regras'
import * as api from '../lib/api'
import * as cad from '../cadastros/api'

const reais = (n: number) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (p: number | null) => (p == null ? '' : `${(p * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

export default function Historico() {
  const [semanas, setSemanas] = useState<HistoricoSemana[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [erro, setErro] = useState('')
  const [limite, setLimite] = useState(12)
  const [aberta, setAberta] = useState<string | null>(null)
  const [itens, setItens] = useState<HistoricoItemLinha[]>([])

  useEffect(() => {
    Promise.all([cad.historicoSemanas(), api.listarVendedores()])
      .then(([s, v]) => { setSemanas(s); setVendedores(v) })
      .catch((e) => setErro(mensagemDeErro(e)))
  }, [])

  const rotulo = (id: number) => { const v = vendedores.find((x) => x.id === id); return v ? v.empresa.split('(')[0].trim() : `#${id}` }

  // agrupa por semana
  const porSemana = useMemo(() => {
    const m = new Map<number, { data: string; linhas: HistoricoSemana[] }>()
    for (const s of semanas) {
      const g = m.get(s.semana_id) ?? { data: s.data_referencia, linhas: [] }
      g.linhas.push(s); m.set(s.semana_id, g)
    }
    return [...m.values()].slice(0, limite)
  }, [semanas, limite])

  async function abrir(semanaId: number, vendedorId: number) {
    const chave = `${semanaId}-${vendedorId}`
    if (aberta === chave) { setAberta(null); return }
    try { setItens(await cad.historicoItens(semanaId, vendedorId)); setAberta(chave) } catch (e) { setErro(mensagemDeErro(e)) }
  }

  return (
    <section>
      <h2>Histórico de cotações</h2>
      <Link className="link" to="/cadastros">← Cadastros</Link>
      {erro && <p className="erro">{erro}</p>}
      {porSemana.map((g) => (
        <div key={g.data} className="cartao coluna">
          <strong>{g.data}</strong>
          {g.linhas.map((s) => (
            <div key={s.vendedor_id} className="linha-historico">
              <button className="link" onClick={() => abrir(s.semana_id, s.vendedor_id)}>
                {rotulo(s.vendedor_id)} · v{s.versoes} · {s.desfecho}
                {s.desfecho === 'pedido' && ` · pedido ${s.pedido_itens} de ${s.itens} itens`}
                {s.total_ultimo > 0 && <> · <span data-total-pedido>{reais(s.total_pedido)}</span> vs último <span data-total-ultimo>{reais(s.total_ultimo)}</span> ({pct(s.pct)})</>}
              </button>
            </div>
          ))}
        </div>
      ))}
      {aberta != null && (
        <div className="cartao rolagem">
          <table>
            <thead><tr><th>Item</th><th>Qtd</th><th>Cotado</th><th>No pedido</th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.produto_id}>
                  <td>{i.nome}</td><td>{i.qtd}</td>
                  <td>{i.preco_convertido != null ? reais(i.preco_convertido) : '—'}</td>
                  <td>{i.no_pedido ? `${i.qtd_pedido} ${i.unidade}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {semanas.length > limite && <button className="botao" onClick={() => setLimite((l) => l + 12)}>Ver mais</button>}
    </section>
  )
}
