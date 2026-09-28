import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { ItemSemana, Semana, Usuario } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarDataHora, formatarQtd, formatarReais, lerNumero, mensagemDeErro, normalizar,
  paraConferir, passo, qtdAoIncluir, separarAbas, totalEstimado,
} from '../lib/regras'

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

export default function Revisao({ usuario }: { usuario: Usuario }) {
  const [semana, setSemana] = useState<Semana | null | undefined>(undefined)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [aba, setAba] = useState<Aba>('bebidas')
  const [anterior, setAnterior] = useState<SemanaAnterior | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const s = await api.semanaParaRevisar()
        if (s) {
          const lista = await api.itensDaSemana(s.id)
          setItens(lista)
          if (paraConferir(lista).length > 0) setAba('conferir') // a aba Conferir, quando existe, é a primeira
          if (s.status === 'rascunho') setAnterior(await semanaAnteriorEmCompra(s))
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

  async function aprovar() {
    const fora = paraConferir(itens)
    const pergunta = fora.length > 0
      ? `Ainda há ${fora.length} ${fora.length === 1 ? 'item' : 'itens'} para conferir fora da lista (${fora.map((i) => i.produto).join(', ')}). Aprovar e liberar para os compradores assim mesmo?`
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
      {!editavel && <p className="aviso">Lista aprovada e liberada para os compradores.</p>}
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
        <Cartao key={i.id} item={i} editavel={editavel} onAjustar={ajustar} />
      ))}

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

function Cartao({ item, editavel, onAjustar }: {
  item: ItemSemana
  editavel: boolean
  onAjustar: (item: ItemSemana, qtd: number, incluido: boolean) => void
}) {
  const [texto, setTexto] = useState(String(item.qtd_aprovada).replace('.', ','))
  useEffect(() => { setTexto(String(item.qtd_aprovada).replace('.', ',')) }, [item.qtd_aprovada])
  const p = passo(item.unidade)
  const aConferir = !item.incluido && item.selos.length > 0
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
      <div className="sub">
        Estoque {formatarQtd(item.estoque, item.unidade)} · Sugerido {formatarQtd(item.qtd_sugerida, item.unidade)}
        {item.preco_estimado != null && <> · Últ. compra {formatarReais(item.preco_estimado)}{item.data_ultima_compra && <> em {formatarData(item.data_ultima_compra)}</>}</>}
      </div>
      {item.fornecedor_ultima && <div className="sub">Fornecedor: {item.fornecedor_ultima}</div>}
      {item.incluido && item.selos.length > 0 && (
        <div className="etiquetas">
          {item.selos.map((selo, n) => <span key={n} className="pill">{selo.texto}</span>)}
        </div>
      )}
      <div className="linha" style={{ marginTop: 8 }}>
        {editavel ? (
          item.incluido
            ? <button className="link perigo" onClick={() => onAjustar(item, item.qtd_aprovada, false)}>Tirar</button>
            : (
              <button className="link" onClick={() => onAjustar(item, qtdIncluir, true)}>
                {aConferir ? `Incluir (${formatarQtd(qtdIncluir, item.unidade)})` : 'Incluir'}
              </button>
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
