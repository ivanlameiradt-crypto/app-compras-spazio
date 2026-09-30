// Fase 2, Bloco D: tela Receber (DESIGN-fase-2.md, D.7.1). Todo usuário ativo registra a entrega.
// NENHUM preço aparece nesta tela, para ninguém. Na D1 (com o piloto) só grava com internet.
import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { ItemAReceber, PedidoAReceber, Recebimento, Resto, Usuario } from '../lib/tipos'
import { diaCurto, ddmm, numeroBr, mensagemFaltaAvaria } from '../cotacao/mensagens'
import {
  descricaoPedido, embParaUn, faltaChegar, itensComFalta, linhasFaltaAvaria, montarItens, porEmbalagem,
  prontoParaGravar, resumoRecebido, tudoQueFalta, unParaEmb, type EntradaItem,
} from './receber'

const novoId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export default function Receber({ usuario }: { usuario: Usuario }) {
  const [pedidos, setPedidos] = useState<PedidoAReceber[] | null>(null)
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState<PedidoAReceber | null>(null)

  const carregar = () => {
    setErro('')
    api.pedidosAReceber().then(setPedidos).catch((e) => setErro(e.message))
  }
  useEffect(carregar, [])

  if (sel) return <Cartao pedido={sel} admin={usuario.papel === 'admin'} onVoltar={() => { setSel(null); carregar() }} />

  if (erro) return <p className="erro">{erro}</p>
  if (!pedidos) return <p>Carregando…</p>
  if (pedidos.length === 0) return <p>Nenhum pedido esperando entrega.</p>
  const hoje = new Date().toISOString().slice(0, 10)
  return (
    <div className="receber">
      <h2>Pedidos a receber</h2>
      <ul className="lista-pedidos">
        {pedidos.map((p) => {
          const atrasado = p.entrega_prevista != null && p.entrega_prevista < hoje && p.recebimento === 'aguardando'
          const parcial = p.recebimento === 'parcial' ? p.entregas[p.entregas.length - 1] : null
          return (
            <li key={p.cotacao_id}>
              <button className="botao-linha" onClick={() => setSel(p)}>
                <b>{p.vendedor}</b> · pedido de {diaCurto(p.confirmado_local.slice(0, 10))} {ddmm(p.confirmado_local.slice(0, 10))}
                {' '}· {p.itens.length} itens
                {p.entrega_prevista && <> · entrega prevista {diaCurto(p.entrega_prevista)} {ddmm(p.entrega_prevista)}</>}
                {atrasado && <span className="atrasado"> · atrasado</span>}
                {parcial && <span> · chegou parte em {ddmm(parcial.recebido_local.slice(0, 10))} ({parcial.quem})</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Cartao({ pedido, admin, onVoltar }: { pedido: PedidoAReceber; admin: boolean; onVoltar: () => void }) {
  const [entradas, setEntradas] = useState<Record<number, EntradaItem>>({})
  const [mexeu, setMexeu] = useState(false)
  const [restoTodos, setRestoTodos] = useState<Resto | null>(null)
  const [perguntar, setPerguntar] = useState(false)
  const [antes, setAntes] = useState(false)          // "Chegou antes?" abre data e hora
  const [quando, setQuando] = useState('')
  const [resultado, setResultado] = useState<Recebimento | null>(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  const setChegouUn = (it: ItemAReceber, un: number) => {
    setMexeu(true)
    setEntradas((e) => ({ ...e, [it.numero]: { ...e[it.numero], numero: it.numero, chegou_un: un } }))
  }
  const setAvaria = (it: ItemAReceber, un: number) =>
    setEntradas((e) => ({ ...e, [it.numero]: { ...e[it.numero], numero: it.numero, chegou_un: e[it.numero]?.chegou_un ?? faltaChegar(it), avaria_un: un } }))
  const setResto = (numero: number, r: Resto) => setEntradas((e) => ({ ...e, [numero]: { ...e[numero], numero, chegou_un: e[numero]?.chegou_un ?? 0, resto: r } }))

  const efetivas = (): Record<number, EntradaItem> => {
    if (!mexeu) return Object.fromEntries(tudoQueFalta(pedido).map((i) => [i.numero, { numero: i.numero, chegou_un: i.chegou }]))
    return entradas
  }
  const faltando = itensComFalta(pedido, efetivas())

  const gravar = async () => {
    setErro('')
    const usar = efetivas()
    if (faltando.length > 0 && !perguntar) { setPerguntar(true); return }
    if (faltando.length > 0 && !prontoParaGravar(pedido, usar, restoTodos)) {
      setErro('Responda, em cada item que faltou, se ainda vem ou não vem mais.')
      return
    }
    setEnviando(true)
    try {
      const itens = montarItens(pedido, usar)
      const r = await api.registrarRecebimento(
        pedido.cotacao_id, novoId(), antes && quando ? new Date(quando).toISOString() : null,
        itens, restoTodos, null,
      )
      setResultado(r)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    // unidade e fator reais de cada item (do pedido), para a mensagem não sair com tudo em "un" (D.8)
    const linhasMsg = linhasFaltaAvaria(pedido, resultado)
    return (
      <div className="receber">
        <button className="link" onClick={onVoltar}>← Voltar</button>
        <p className="ok">{resumoRecebido(resultado)}</p>
        {admin && (resultado.faltas.length > 0 || resultado.avarias.length > 0) && (
          <button className="botao" onClick={() => navigator.clipboard?.writeText(
            mensagemFaltaAvaria(pedido.vendedor, pedido.confirmado_local.slice(0, 10), linhasMsg))}>
            Copiar mensagem para o {pedido.vendedor}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="receber">
      <button className="link" onClick={onVoltar}>← Voltar</button>
      <h2>{pedido.vendedor}</h2>
      {pedido.itens.map((it) => (
        <ItemLinha key={it.numero} item={it} entrada={entradas[it.numero]}
          onChegouUn={(un) => setChegouUn(it, un)} onAvaria={(un) => setAvaria(it, un)} onNaoVeio={() => setChegouUn(it, 0)} />
      ))}
      <div className="acoes">
        <label className="chegou-antes">
          <input type="checkbox" checked={antes} onChange={(e) => setAntes(e.target.checked)} /> Chegou antes?
        </label>
        {antes && <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />}
      </div>
      {perguntar && faltando.length > 0 && (
        <div className="resto">
          <div className="resto-todos">Todos:
            <button className={restoTodos === 'vem_depois' ? 'sel' : ''} onClick={() => setRestoTodos('vem_depois')}>Ainda vem</button>
            <button className={restoTodos === 'nao_vem' ? 'sel' : ''} onClick={() => setRestoTodos('nao_vem')}>Não vem mais</button>
          </div>
          {faltando.map((it) => {
            const usar = efetivas()
            const chegou = usar[it.numero]?.chegou_un ?? 0
            const falta = +(it.qtd - it.chegou - chegou).toFixed(3)
            const r = entradas[it.numero]?.resto ?? restoTodos
            return (
              <div key={it.numero} className="resto-item">
                {it.nome}: faltaram {numeroBr(falta)} {it.unidade}
                <button className={r === 'vem_depois' ? 'sel' : ''} onClick={() => setResto(it.numero, 'vem_depois')}>Ainda vem</button>
                <button className={r === 'nao_vem' ? 'sel' : ''} onClick={() => setResto(it.numero, 'nao_vem')}>Não vem mais</button>
              </div>
            )
          })}
        </div>
      )}
      {erro && <p className="erro">{erro}</p>}
      {!online && <p className="faixa">Sem internet: registre quando a internet voltar.</p>}
      <button className="botao verde" disabled={!online || enviando} onClick={gravar}>
        {mexeu ? 'Registrar com as diferenças' : 'Chegou tudo certo'}
      </button>
    </div>
  )
}

function ItemLinha({ item, entrada, onChegouUn, onAvaria, onNaoVeio }: {
  item: ItemAReceber; entrada?: EntradaItem
  onChegouUn: (un: number) => void; onAvaria: (un: number) => void; onNaoVeio: () => void
}) {
  const [mais, setMais] = useState(false)
  const emb = porEmbalagem(item)
  const fator = Number(item.fator)
  const chegouUn = entrada?.chegou_un ?? faltaChegar(item)
  const valorCampo = emb ? unParaEmb(chegouUn, fator) : chegouUn
  return (
    <div className="item-receber">
      <div className="nome">{item.nome}{item.marca && <span className="marca"> · marca: {item.marca}</span>}</div>
      <div className="pedido-linha">Pedido: {descricaoPedido(item)}</div>
      <label>
        Chegaram{' '}
        <input type="text" inputMode="decimal" value={String(valorCampo).replace('.', ',')}
          onChange={(e) => {
            const v = Number(e.target.value.replace(',', '.')) || 0
            onChegouUn(emb ? embParaUn(v, fator) : v)
          }} />
        {emb ? ` ${item.embalagem}s c/${numeroBr(fator)} = ${numeroBr(chegouUn)} ${item.unidade}` : ` ${item.unidade}`}
      </label>
      <button className="link" onClick={onNaoVeio}>Não veio</button>
      <button className="link" onClick={() => setMais((m) => !m)}>Mais</button>
      {mais && (
        <label className="avaria">Avaria ({item.unidade}):{' '}
          <input type="text" inputMode="decimal" value={String(entrada?.avaria_un ?? 0).replace('.', ',')}
            onChange={(e) => onAvaria(Number(e.target.value.replace(',', '.')) || 0)} />
        </label>
      )}
    </div>
  )
}
