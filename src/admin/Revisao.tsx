import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { ItemSemana, PedidoRecente, Semana, Usuario, Vendedor } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarDataHora, formatarQtd, formatarReais, foraDaListaPorRegra, lerNumero,
  mensagemDeErro, normalizar, paraConferir, passo, qtdAoIncluir, separarAbas, totalEstimado,
} from '../lib/regras'
import { ddmm, diaCurto, horaLocal, rotuloVendedor } from '../cotacao/mensagens'
import * as cad from '../cadastros/api'
import { tirarSempre as textoTirarSempre } from '../cadastros/textos'

type Aba = 'conferir' | 'bebidas' | 'insumos' | 'negativos'
/** Outra semana ainda em compra: só uma fica em compra por vez, então ela precisa ser encerrada antes de aprovar esta. */
type SemanaAnterior = { semana: Semana; abertas: api.CompraAbertaResumo[] }

async function semanaAnteriorEmCompra(s: Semana): Promise<SemanaAnterior | null> {
  try {
    const outra = await api.semanaEmCompra()
    if (!outra || outra.id === s.id) return null
    let abertas: api.CompraAbertaResumo[] = []
    try {
      abertas = (await api.comprasAbertas(outra.id)) ?? []
    } catch { /* sem a lista das compras abertas o atalho para o Resumo continua valendo */ }
    return { semana: outra, abertas }
  } catch {
    return null // sem essa leitura fica o "Aprovar lista" de sempre; o banco recusa com o motivo se for o caso
  }
}

/** 00:00 de Brasília (UTC−3, sem horário de verão) de (data − 7 dias), em ISO: o início da janela dos pedidos recentes. */
export function inicioPedidosRecentes(dataReferencia: string): string {
  const [a, m, d] = dataReferencia.split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d - 7)).toISOString().slice(0, 10)
  return `${dia}T03:00:00.000Z`
}

/**
 * Fase 1B (spec 8.1): item que está num pedido confirmado a vendedor nos 7 dias antes da semana (ou depois) ganha a
 * etiqueta informativa "Pedido com MATEUS em qua 21/10: a NF-e já entrou no SisChef?" — o pedido pode ainda estar
 * chegando e o robô leu o estoque antes. Não é selo e não muda `incluido`. Mais de um pedido: vale o mais recente.
 */
export function etiquetasPedidoAnterior(pedidos: PedidoRecente[], vendedores: Vendedor[]): Map<number, string> {
  const r = new Map<number, string>()
  const ordem = [...pedidos].sort((a, b) => b.confirmado_em.localeCompare(a.confirmado_em))
  for (const p of ordem) {
    const v = vendedores.find((x) => x.id === p.vendedor_id)
    const rotulo = v ? rotuloVendedor(v.empresa) : `vendedor ${p.vendedor_id}`
    const dia = horaLocal(p.confirmado_em).data
    for (const l of p.itens) {
      if (!r.has(l.produto_id)) r.set(l.produto_id, `Pedido com ${rotulo} em ${diaCurto(dia)} ${ddmm(dia)}: a NF-e já entrou no SisChef?`)
    }
  }
  return r
}

async function lerPedidosAnteriores(s: Semana): Promise<Map<number, string>> {
  try {
    const pedidos = (await api.pedidosRecentes(s.id, inicioPedidosRecentes(s.data_referencia))) ?? []
    if (pedidos.length === 0) return new Map()
    return etiquetasPedidoAnterior(pedidos, (await api.listarVendedores()) ?? [])
  } catch {
    return new Map() // sem a tabela (App publicado antes da migration) ou sem rede: a Revisão segue sem a etiqueta
  }
}

export default function Revisao({ usuario }: { usuario: Usuario }) {
  const [semana, setSemana] = useState<Semana | null | undefined>(undefined)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [aba, setAba] = useState<Aba>('bebidas')
  const [anterior, setAnterior] = useState<SemanaAnterior | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [pedidosAnteriores, setPedidosAnteriores] = useState<Map<number, string>>(() => new Map())

  useEffect(() => {
    (async () => {
      try {
        const s = await api.semanaParaRevisar()
        if (s) {
          const lista = await api.itensDaSemana(s.id)
          setItens(lista)
          if (paraConferir(lista).length > 0) setAba('conferir') // a aba Conferir, quando existe, é a primeira
          if (s.status === 'rascunho') setAnterior(await semanaAnteriorEmCompra(s))
          void lerPedidosAnteriores(s).then(setPedidosAnteriores)
        }
        setSemana(s)
      } catch (e) {
        setErro(mensagemDeErro(e))
        setSemana(null)
      }
    })()
  }, [])

  const abas = useMemo(() => separarAbas(itens), [itens])
  const conferir = useMemo(() => paraConferir(itens), [itens])
  const fora = useMemo(() => foraDaListaPorRegra(itens), [itens])
  if (semana === undefined) return <p className="centro">Carregando…</p>
  if (!semana) return <p className="vazio">{erro || 'Nenhuma lista nova. A próxima chega segunda às 6h.'}</p>
  const s = semana
  const editavel = s.status === 'rascunho'
  // incluiu o último item da aba Conferir: a aba some e a tela volta para Bebidas
  const abaAtual: Aba = aba === 'conferir' && conferir.length === 0 ? 'bebidas' : aba

  async function ajustar(item: ItemSemana, qtd: number, incluido: boolean) {
    const antes = itens
    setItens((l) => l.map((i) => (i.id === item.id ? { ...i, qtd_aprovada: qtd, incluido: incluido && qtd > 0 } : i)))
    try {
      await api.ajustarItem(item.id, qtd, incluido)
      setErro('')
    } catch (e) {
      setItens(antes)
      setErro(mensagemDeErro(e))
    }
  }

  // C2: "Tirar sempre…" cria a regra de barrar; "Apagar regra" a tira. Só valem no rascunho.
  async function tirarSempre(item: ItemSemana) {
    const motivo = window.prompt(textoTirarSempre(item.produto))
    if (motivo == null || motivo.trim() === '') return
    try {
      await cad.listaRegraSalvar(item.produto_id, 'barrar', motivo.trim())
      setItens((l) => l.map((i) => (i.id === item.id ? { ...i, regra: 'barrar', regra_motivo: motivo.trim(), incluido: false, qtd_aprovada: 0 } : i)))
      setErro('')
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  async function apagarRegra(item: ItemSemana) {
    try {
      await cad.listaRegraRemover(item.produto_id)
      setItens((l) => l.map((i) => (i.id === item.id ? { ...i, regra: null, regra_motivo: null } : i)))
      setErro('')
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  // C2: o cartão cujo único selo é linha_alta ganha "Incluir sempre": cria a regra de incluir e entra na lista já nesta semana.
  async function incluirSempre(item: ItemSemana) {
    try {
      await cad.listaRegraSalvar(item.produto_id, 'incluir', null)
      setItens((l) => l.map((i) => (i.id === item.id ? { ...i, regra: 'incluir', incluido: true, qtd_aprovada: qtdAoIncluir(i) } : i)))
      setErro('')
    } catch (e) { setErro(mensagemDeErro(e)) }
  }

  async function aprovar() {
    const paraConf = paraConferir(itens)
    const pergunta = paraConf.length > 0
      ? `Ainda há ${paraConf.length} ${paraConf.length === 1 ? 'item' : 'itens'} para conferir fora da lista (${paraConf.map((i) => i.produto).join(', ')}). Aprovar e liberar para os compradores assim mesmo?`
      : 'Aprovar a lista e liberar para os compradores?'
    if (!window.confirm(pergunta)) return
    try {
      await api.aprovarSemana(s.id)
      setSemana({ ...s, status: 'em_compra' })
      setErro('')
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
  }

  const visiveis = abaAtual === 'conferir' ? conferir
    : abaAtual === 'negativos' ? abas.negativos
      : abas[abaAtual].filter((i) => i.incluido)
  const candidatos = busca.trim().length >= 2
    ? itens.filter((i) => !i.incluido && normalizar(i.produto).includes(normalizar(busca.trim()))).slice(0, 20)
    : []

  return (
    <section>
      <div className="cabecalho">
        <h2>Semana {formatarData(s.data_referencia)}</h2>
        <span className={s.status === 'rascunho' ? 'pill' : 'pill ok'}>{ROTULO_STATUS[s.status]}</span>
      </div>
      {!editavel && (
        <div className="aviso">
          Lista aprovada e liberada para os compradores.{' '}
          {/* Fase 1B: depois de aprovar, o próximo passo é montar as cotações com os vendedores */}
          {s.status === 'em_compra' && <a className="link" href="#/cotacoes">Ir para Cotações</a>}
        </div>
      )}
      {erro && <p className="erro">{erro}</p>}

      {editavel && anterior && (
        <div className="cartao" data-testid="semana-anterior">
          <div className="nome">A semana {formatarData(anterior.semana.data_referencia)} ainda está em compra</div>
          <div className="sub">Só uma semana fica em compra por vez: encerre a de {formatarData(anterior.semana.data_referencia)} no Resumo e depois aprove esta.</div>
          {anterior.abertas.map((a) => (
            <div key={a.id} className="selo">
              Compra aberta impede encerrar: {a.loja} · {a.comprador_nome} · aberta em {formatarDataHora(a.aberta_em)}
            </div>
          ))}
          {/* Lançamentos só mostra a compra aberta dos outros; a do próprio admin ele fecha na tela Comprar */}
          {anterior.abertas.some((a) => a.comprador !== usuario.email) && (
            <a className="link" href="#/lancamentos">Fechar pelo comprador ou cancelar em Lançamentos</a>
          )}
          {anterior.abertas.some((a) => a.comprador === usuario.email) && (
            <a className="link" href="#/comprar">A compra aberta é sua: feche-a você mesmo em Comprar</a>
          )}
        </div>
      )}

      <div className="abas">
        {conferir.length > 0 && (
          <button aria-pressed={abaAtual === 'conferir'} onClick={() => setAba('conferir')}>Conferir {conferir.length}</button>
        )}
        <button aria-pressed={abaAtual === 'bebidas'} onClick={() => setAba('bebidas')}>Bebidas {abas.bebidas.filter((i) => i.incluido).length}</button>
        <button aria-pressed={abaAtual === 'insumos'} onClick={() => setAba('insumos')}>Insumos {abas.insumos.filter((i) => i.incluido).length}</button>
        <button aria-pressed={abaAtual === 'negativos'} onClick={() => setAba('negativos')}>Negativos {abas.negativos.length}</button>
      </div>
      {abaAtual === 'conferir' && (
        <p className="aviso">O robô deixou estes itens fora da lista para você conferir. Leia o motivo e, se estiver certo, toque em Incluir.</p>
      )}
      {abaAtual === 'negativos' && (
        <p className="aviso">Insumos com estoque negativo no SisChef: erro de baixa, não compra. Ficam fora da lista, a não ser que você inclua (entra com o estoque mínimo).</p>
      )}

      {visiveis.map((i) => (
        <Cartao key={i.id} item={i} editavel={editavel} onAjustar={ajustar} onTirarSempre={tirarSempre} onIncluirSempre={incluirSempre} pedidoAnterior={pedidosAnteriores.get(i.produto_id)} />
      ))}

      {fora.length > 0 && (
        <details className="cartao" data-testid="fora-por-regra">
          <summary>Fora da lista por regra ({fora.length})</summary>
          {fora.map((i) => (
            <div key={i.id} className="linha" data-produto={i.produto_id}>
              <span>{i.produto}{i.regra_motivo && ` — ${i.regra_motivo}`}{i.incluido && ' · fora por regra, incluído nesta semana'}</span>
              {editavel && !i.incluido && <button className="link" onClick={() => ajustar(i, qtdAoIncluir(i), true)}>Incluir só nesta semana</button>}
              {editavel && <button className="link" onClick={() => apagarRegra(i)}>Apagar regra</button>}
            </div>
          ))}
        </details>
      )}

      {editavel && (
        <div className="cartao">
          <input placeholder="+ Incluir item (digite o nome)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {candidatos.map((i) => (
            <button key={i.id} className="item" onClick={() => { ajustar(i, qtdAoIncluir(i), true); setBusca('') }}>
              {i.produto}
            </button>
          ))}
        </div>
      )}

      <div className="rodape">
        <div>
          <div>
            <div className="sub">Estimado</div>
            <b data-testid="total">{formatarReais(totalEstimado(itens))}</b>
          </div>
          {editavel && (anterior
            ? (
              <a className="botao" href="#/resumo" style={{ textDecoration: 'none', textAlign: 'center' }}>
                Antes, encerre a semana {formatarData(anterior.semana.data_referencia)} (Resumo)
              </a>
            )
            : <button className="botao" onClick={aprovar}>Aprovar lista</button>)}
        </div>
      </div>
    </section>
  )
}

function Cartao({ item, editavel, onAjustar, onTirarSempre, onIncluirSempre, pedidoAnterior }: {
  item: ItemSemana
  editavel: boolean
  /** Fase 1B: "Pedido com MATEUS em qua 21/10: a NF-e já entrou no SisChef?" (só informa) */
  pedidoAnterior?: string
  onAjustar: (item: ItemSemana, qtd: number, incluido: boolean) => void
  onTirarSempre: (item: ItemSemana) => void
  onIncluirSempre: (item: ItemSemana) => void
}) {
  const [texto, setTexto] = useState(String(item.qtd_aprovada).replace('.', ','))
  useEffect(() => { setTexto(String(item.qtd_aprovada).replace('.', ',')) }, [item.qtd_aprovada])
  const p = passo(item.unidade)
  const aConferir = !item.incluido && item.selos.length > 0
  // C2: valor alto de sempre — único selo linha_alta vira "Incluir sempre" (sem pedir conferência de valor alto).
  const soLinhaAlta = aConferir && item.selos.length === 1 && item.selos[0].codigo === 'linha_alta'
  const qtdIncluir = qtdAoIncluir(item)
  const confirmarTexto = () => {
    const v = lerNumero(texto)
    if (v === null) { setTexto(String(item.qtd_aprovada).replace('.', ',')); return }
    if (v !== item.qtd_aprovada) onAjustar(item, v, true)
  }
  return (
    <div className="cartao">
      <div className="nome">{item.produto}</div>
      {aConferir && item.selos.map((selo, n) => <div key={n} className="selo">{selo.texto}</div>)}
      {pedidoAnterior && <div className="etiqueta-cotacao" data-testid={`pedido-anterior-${item.produto_id}`}>{pedidoAnterior}</div>}
      <div className="sub">
        Estoque {formatarQtd(item.estoque, item.unidade)} · Sugerido {formatarQtd(item.qtd_sugerida, item.unidade)}
        {item.preco_estimado != null && <> · Últ. compra {formatarReais(item.preco_estimado)}{item.data_ultima_compra && <> em {formatarData(item.data_ultima_compra)}</>}</>}
      </div>
      {item.fornecedor_ultima && <div className="sub">Fornecedor: {item.fornecedor_ultima}</div>}
      {item.regra === 'incluir' && <div className="etiquetas"><span className="pill">na lista pela sua regra</span></div>}
      {item.incluido && item.selos.length > 0 && (
        <div className="etiquetas">
          {item.selos.map((selo, n) => <span key={n} className="pill">{selo.texto}</span>)}
        </div>
      )}
      <div className="linha" style={{ marginTop: 8 }}>
        {editavel ? (
          item.incluido
            ? (
              <span>
                <button className="link perigo" onClick={() => onAjustar(item, item.qtd_aprovada, false)}>Tirar</button>{' '}
                <button className="link perigo" onClick={() => onTirarSempre(item)}>Tirar sempre…</button>
              </span>
            )
            : (
              <span>
                <button className="link" onClick={() => onAjustar(item, qtdIncluir, true)}>
                  {aConferir ? `Incluir (${formatarQtd(qtdIncluir, item.unidade)})` : 'Incluir'}
                </button>
                {soLinhaAlta && <>{' '}
                  <button className="link" onClick={() => onIncluirSempre(item)}>Incluir sempre (sem pedir conferência de valor alto)</button>
                </>}
              </span>
            )
        ) : <span />}
        {editavel && item.incluido ? (
          <div className="passo">
            <button aria-label="Menos" onClick={() => onAjustar(item, Math.max(0, +(item.qtd_aprovada - p).toFixed(3)), true)}>−</button>
            <input type="text" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={confirmarTexto} />
            <button aria-label="Mais" onClick={() => onAjustar(item, +(item.qtd_aprovada + p).toFixed(3), true)}>+</button>
          </div>
        ) : (
          item.incluido && <b>{formatarQtd(item.qtd_aprovada, item.unidade)}</b>
        )}
      </div>
    </div>
  )
}
