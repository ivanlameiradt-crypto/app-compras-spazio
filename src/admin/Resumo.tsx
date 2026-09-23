import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { ItemSemana, LinhaCompra, Semana } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarQtd, formatarReais, mensagemDeErro, quantidadeComprada, resumirSemana, situacaoDoItem,
} from '../lib/regras'

export default function Resumo() {
  const [semanas, setSemanas] = useState<Semana[] | undefined>()
  const [id, setId] = useState<number | null>(null)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [linhas, setLinhas] = useState<LinhaCompra[]>([])
  const [abertas, setAbertas] = useState<api.CompraAbertaResumo[]>([])
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.listarSemanas().then((ss) => {
      setSemanas(ss)
      const atual = ss.find((s) => s.status === 'em_compra') ?? ss[0]
      setId(atual ? atual.id : null)
    }).catch((e) => { setErro(mensagemDeErro(e)); setSemanas([]) })
  }, [])

  useEffect(() => {
    if (id == null) return
    Promise.all([api.itensDaSemana(id), api.linhasDaSemana(id)])
      .then(([i, l]) => { setItens(i); setLinhas(l) })
      .catch((e) => setErro(mensagemDeErro(e)))
    // I2: só enquanto a semana está em compra é que pode haver compra aberta pra listar/cancelar
    if (semanas?.find((s) => s.id === id)?.status === 'em_compra') {
      api.comprasAbertas(id).then(setAbertas).catch(() => undefined)
    } else {
      setAbertas([])
    }
  }, [id, semanas])

  if (semanas === undefined) return <p className="centro">Carregando…</p>
  if (semanas.length === 0 || id == null) return <p className="vazio">{erro || 'Ainda não há semanas.'}</p>
  const semana = semanas.find((s) => s.id === id)!
  const r = resumirSemana(itens, linhas)
  const faltou = itens.filter((i) => i.incluido && ['parcial', 'nao_achei'].includes(situacaoDoItem(i, linhas)))

  async function encerrar() {
    if (!window.confirm('Encerrar a semana? Os compradores deixam de ver esta lista.')) return
    try {
      await api.encerrarSemana(semana.id)
      setSemanas((ss) => ss?.map((s) => (s.id === semana.id ? { ...s, status: 'encerrada' } : s)))
      setErro('')
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
  }

  async function cancelarAberta(id: string) {
    if (!window.confirm('Cancelar esta compra em aberto?')) return
    try {
      await api.cancelarCompra(id)
      setAbertas((as) => as.filter((a) => a.id !== id))
      setErro('')
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
  }

  return (
    <section>
      <div className="cabecalho">
        <label>Semana
          <select aria-label="Semana" value={id} onChange={(e) => setId(Number(e.target.value))}>
            {semanas.map((s) => <option key={s.id} value={s.id}>{formatarData(s.data_referencia)} — {ROTULO_STATUS[s.status]}</option>)}
          </select>
        </label>
      </div>
      {erro && <p className="erro">{erro}</p>}
      <div className="kpis">
        <div className="kpi"><span className="sub">Comprados</span><b>{r.completos} de {r.pedidos}</b></div>
        <div className="kpi"><span className="sub">Pago × estimado</span><b>{formatarReais(r.pago)}</b><span className="sub">de {formatarReais(r.estimado)}</span></div>
        <div className="kpi"><span className="sub">Não achados</span><b className="erro">{r.naoAchados}</b></div>
        <div className="kpi"><span className="sub">Achados em parte</span><b>{r.parciais}</b></div>
      </div>
      <p className="sub">Ainda sem marcação: {r.pendentes}</p>

      {faltou.length > 0 && <div className="grupo">Faltou</div>}
      {faltou.map((i) => (
        <div key={i.id} className="cartao">
          <div className="nome">{i.produto}</div>
          <div className="sub">Comprado {formatarQtd(quantidadeComprada(i.id, linhas), i.unidade)} de {formatarQtd(i.qtd_aprovada, i.unidade)}</div>
        </div>
      ))}

      {r.alertas.length > 0 && <div className="grupo">Preço mais de 10% acima do último</div>}
      {r.alertas.map((a) => (
        <div key={a.linha.id} className="cartao">
          <div className="nome">{a.item.produto}</div>
          <div className="sub">Pago {formatarReais(Number(a.linha.preco_unit))} · última {formatarReais(Number(a.item.preco_estimado))} (+{Math.round(a.variacao * 100)}%)</div>
        </div>
      ))}

      {semana.status === 'em_compra' && abertas.length > 0 && (
        <>
          <div className="grupo">Compras em aberto</div>
          {abertas.map((a) => (
            <div key={a.id} className="cartao">
              <div className="nome">{a.loja} · {a.comprador_nome}</div>
              <div className="sub">desde {formatarData(a.aberta_em)}</div>
              <button className="link perigo" onClick={() => cancelarAberta(a.id)}>Cancelar</button>
            </div>
          ))}
        </>
      )}

      {semana.status === 'em_compra' && (
        <button className="botao secundario" style={{ marginTop: 16 }} onClick={encerrar}>Encerrar semana</button>
      )}
    </section>
  )
}
