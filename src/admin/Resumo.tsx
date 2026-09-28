import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { Cotacao, EconomiaSemana, ItemSemana, LinhaCompra, MarcaItem, Semana, Vendedor } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarQtd, formatarReais, mensagemDeErro, quantidadeComprada, resumirSemana, situacaoDoItem,
} from '../lib/regras'
import { ddmm, diaCurto, horaBr, horaLocal, reais, restoDaEtiqueta, rotuloVendedor } from '../cotacao/mensagens'
import { comSinalDeEnvio, ehAberta } from './cotacoes/estado'

const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)
/** −5,6% · +3,0% (uma casa, sinal de menos de verdade). */
const percentual = (v: number) => {
  const t = Math.abs(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${v < 0 && t !== '0,0' ? '−' : v > 0 && t !== '0,0' ? '+' : ''}${t}%`
}
/** −R$ 410,00 · +R$ 120,00 · R$ 0,00 */
const reaisComSinal = (v: number) => (v < 0 ? `−${reais(-v)}` : v > 0 ? `+${reais(v)}` : reais(0))

/**
 * Fase 1B (ajuste Foozi 2): a economia dos pedidos da semana contra o último preço, e o acumulado desde a primeira semana
 * com pedido (a do piloto). null quando a semana não tem pedido (ou a view ainda não existe).
 */
export function linhaEconomia(economia: EconomiaSemana[], semanaId: number): string | null {
  const ordem = [...economia].sort((a, b) => a.data_referencia.localeCompare(b.data_referencia))
  const e = ordem.find((x) => x.semana_id === semanaId)
  if (!e) return null
  const n = Number(e.itens_com_referencia)
  const pct = Number(e.total_ultimo) > 0 ? ` (${percentual(Number(e.total_pedido) / Number(e.total_ultimo) - 1)})` : ''
  const acumulado = ordem.filter((x) => x.data_referencia <= e.data_referencia).reduce((s, x) => s + Number(x.diferenca), 0)
  let texto = `Cotações da semana: pedidos ${reais(Number(e.total_pedido))} em ${n} ${n === 1 ? 'item' : 'itens'} com referência; ` +
    `pelo último preço seriam ${reais(Number(e.total_ultimo))}${pct}. ` +
    `Desde ${ddmm(ordem[0].data_referencia)}: ${reaisComSinal(Math.round(acumulado * 100) / 100)}.`
  const sem = Number(e.itens_sem_comparacao)
  if (sem > 0) texto += ` · ${sem} ${sem === 1 ? 'item sem comparação' : 'itens sem comparação'}`
  return texto
}

/**
 * Fase 1B (spec 8.3): antes de encerrar, o App avisa só o que ele sabe — cotação ainda com o vendedor (os itens dela
 * seguem "Em cotação" na semana nova) e pedido confirmado (só entra no estoque com a NF-e). O banco não muda.
 */
export function avisosEncerrar(cotacoes: Cotacao[], vendedores: Vendedor[], agora: Date): string[] {
  const rotulo = (id: number) => {
    const v = vendedores.find((x) => x.id === id)
    return v ? rotuloVendedor(v.empresa) : `vendedor ${id}`
  }
  const avisos: string[] = []
  const abertas = cotacoes.filter((c) => ehAberta(c) && comSinalDeEnvio(c, [], cotacoes) && !!c.fechamento && new Date(c.fechamento) > agora)
  if (abertas.length > 0) {
    const quais = abertas.map((c) => {
      const f = horaLocal(c.fechamento as string)
      return `${rotulo(c.vendedor_id)} (fecha ${diaCurto(f.data)} ${ddmm(f.data)} às ${horaBr(f)})`
    })
    avisos.push(abertas.length === 1
      ? `Há cotação aberta com ${quais[0]}: na semana nova os itens dela continuam 'Em cotação' até você decidir.`
      : `Há cotações abertas com ${juntar(quais)}: na semana nova os itens delas continuam 'Em cotação' até você decidir.`)
  }
  const pedidos = [...new Set(cotacoes.filter((c) => c.resultado === 'pedido').map((c) => rotulo(c.vendedor_id)))]
  if (pedidos.length > 0) {
    avisos.push(pedidos.length === 1
      ? `Há pedido com ${pedidos[0]} confirmado nesta semana: ele só entra no estoque quando a NF-e for lançada no SisChef.`
      : `Há pedidos com ${juntar(pedidos)} confirmados nesta semana: eles só entram no estoque quando as NF-e forem lançadas no SisChef.`)
  }
  return avisos
}

export function perguntaEncerrar(avisos: string[]): string {
  if (avisos.length === 0) return 'Encerrar a semana? Os compradores deixam de ver esta lista.'
  return [...avisos, 'Encerrar assim mesmo?'].join('\n\n')
}

/** Cotações e vendedores da semana para o aviso; sem a migration da cotação (ou sem rede), nenhum aviso. */
async function lerAvisosEncerrar(semanaId: number): Promise<string[]> {
  try {
    const [cotacoes, vendedores] = await Promise.all([api.cotacoesDaSemana(semanaId), api.listarVendedores()])
    return avisosEncerrar(cotacoes ?? [], vendedores ?? [], new Date())
  } catch {
    return []
  }
}

export default function Resumo() {
  const [semanas, setSemanas] = useState<Semana[] | undefined>()
  const [id, setId] = useState<number | null>(null)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [linhas, setLinhas] = useState<LinhaCompra[]>([])
  const [abertas, setAbertas] = useState<api.CompraAbertaResumo[]>([])
  const [marcas, setMarcas] = useState<MarcaItem[]>([])
  const [economia, setEconomia] = useState<EconomiaSemana[]>([])
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.listarSemanas().then((ss) => {
      setSemanas(ss)
      const atual = ss.find((s) => s.status === 'em_compra') ?? ss[0]
      setId(atual ? atual.id : null)
    }).catch((e) => { setErro(mensagemDeErro(e)); setSemanas([]) })
    // Fase 1B: linha de economia das cotações; sem a view (ou sem rede), o Resumo segue sem ela
    Promise.resolve().then(() => api.economiaSemanas()).then((e) => setEconomia(e ?? [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (id == null) return
    Promise.all([api.itensDaSemana(id), api.linhasDaSemana(id)])
      .then(([i, l]) => { setItens(i); setLinhas(l) })
      .catch((e) => setErro(mensagemDeErro(e)))
    // Fase 1B: "Pedido com MATEUS" em vez de "faltou"; sem a leitura, o Resumo segue como antes
    setMarcas([])
    Promise.resolve().then(() => api.marcasDaSemana(id)).then((m) => setMarcas(m ?? [])).catch(() => undefined)
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
  const pedidoCom = new Map(marcas.filter((m) => m.estado === 'pedido').map((m) => [m.item_semana_id, m]))
  const comPedido = itens.filter((i) => i.incluido && pedidoCom.has(i.id))
  // pedido que cobre só parte do item (D63): o resto é da loja e, se não foi comprado, é falta
  const restoDoPedido = (i: ItemSemana) => { const m = pedidoCom.get(i.id); return m ? restoDaEtiqueta(m, i.qtd_aprovada) : null }
  const daLoja = (i: ItemSemana): ItemSemana => { const resto = restoDoPedido(i); return resto == null ? i : { ...i, qtd_aprovada: resto } }
  const todoNoPedido = (i: ItemSemana) => pedidoCom.has(i.id) && restoDoPedido(i) == null
  const noPedido = (i: ItemSemana) => formatarQtd(Number(pedidoCom.get(i.id)?.qtd), i.unidade)
  const textoPedido = (i: ItemSemana) => {
    const m = pedidoCom.get(i.id)!
    const resto = restoDoPedido(i)
    return resto == null
      ? `Pedido com ${m.vendedor} · ${formatarQtd(i.qtd_aprovada, i.unidade)}`
      : `Pedido com ${m.vendedor}: ${noPedido(i)} de ${formatarQtd(i.qtd_aprovada, i.unidade)} · o resto (${formatarQtd(resto, i.unidade)}) é da loja`
  }
  const faltou = itens.filter((i) => i.incluido && !todoNoPedido(i) && ['parcial', 'nao_achei'].includes(situacaoDoItem(daLoja(i), linhas)))
  const pendentesSemPedido = r.pendentes - comPedido.filter((i) => todoNoPedido(i) && situacaoDoItem(i, linhas) === 'pendente').length

  const economiaDaSemana = linhaEconomia(economia, semana.id)

  async function encerrar() {
    if (!window.confirm(perguntaEncerrar(await lerAvisosEncerrar(semana.id)))) return
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
      <p className="sub">Ainda sem marcação: {pendentesSemPedido}{comPedido.length > 0 && ` · com pedido a vendedor: ${comPedido.length}`}</p>
      {economiaDaSemana && <p className="aviso" data-testid="economia">{economiaDaSemana}</p>}

      {comPedido.length > 0 && <div className="grupo">Pedidos com vendedores</div>}
      {comPedido.map((i) => (
        <div key={i.id} className="cartao">
          <div className="nome">{i.produto}</div>
          <div className="sub">{textoPedido(i)}</div>
        </div>
      ))}

      {faltou.length > 0 && <div className="grupo">Faltou</div>}
      {faltou.map((i) => (
        <div key={i.id} className="cartao">
          <div className="nome">{i.produto}</div>
          <div className="sub">Comprado {formatarQtd(quantidadeComprada(i.id, linhas), i.unidade)} de {formatarQtd(daLoja(i).qtd_aprovada, i.unidade)}
            {pedidoCom.has(i.id) && ` · ${noPedido(i)} vem no pedido com ${pedidoCom.get(i.id)!.vendedor}`}</div>
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
