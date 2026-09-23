import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { ItemSemana, Semana } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarQtd, formatarReais, lerNumero, mensagemDeErro, normalizar, passo,
  separarAbas, totalEstimado,
} from '../lib/regras'

type Aba = 'bebidas' | 'insumos' | 'negativos'

export default function Revisao() {
  const [semana, setSemana] = useState<Semana | null | undefined>(undefined)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [aba, setAba] = useState<Aba>('bebidas')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const s = await api.semanaParaRevisar()
        if (s) setItens(await api.itensDaSemana(s.id))
        setSemana(s)
      } catch (e) {
        setErro(mensagemDeErro(e))
        setSemana(null)
      }
    })()
  }, [])

  const abas = useMemo(() => separarAbas(itens), [itens])
  if (semana === undefined) return <p className="centro">Carregando…</p>
  if (!semana) return <p className="vazio">{erro || 'Nenhuma lista nova. A próxima chega segunda às 6h.'}</p>
  const s = semana
  const editavel = s.status === 'rascunho'

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
    if (!window.confirm('Aprovar a lista e liberar para os compradores?')) return
    try {
      await api.aprovarSemana(s.id)
      setSemana({ ...s, status: 'em_compra' })
      setErro('')
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
  }

  const visiveis = aba === 'negativos' ? abas.negativos : abas[aba].filter((i) => i.incluido)
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

      <div className="abas">
        <button aria-pressed={aba === 'bebidas'} onClick={() => setAba('bebidas')}>Bebidas {abas.bebidas.filter((i) => i.incluido).length}</button>
        <button aria-pressed={aba === 'insumos'} onClick={() => setAba('insumos')}>Insumos {abas.insumos.filter((i) => i.incluido).length}</button>
        <button aria-pressed={aba === 'negativos'} onClick={() => setAba('negativos')}>Negativos {abas.negativos.length}</button>
      </div>
      {aba === 'negativos' && (
        <p className="aviso">Insumos com estoque negativo no SisChef: erro de baixa, não compra. Ficam fora da lista, a não ser que você inclua.</p>
      )}

      {visiveis.map((i) => (
        <Cartao key={i.id} item={i} editavel={editavel} onAjustar={ajustar} />
      ))}

      {editavel && (
        <div className="cartao">
          <input placeholder="+ Incluir item (digite o nome)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {candidatos.map((i) => (
            <button key={i.id} className="item" onClick={() => { ajustar(i, i.qtd_sugerida > 0 ? i.qtd_sugerida : 1, true); setBusca('') }}>
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
          {editavel && <button className="botao" onClick={aprovar}>Aprovar lista</button>}
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
  const confirmarTexto = () => {
    const v = lerNumero(texto)
    if (v === null) { setTexto(String(item.qtd_aprovada).replace('.', ',')); return }
    if (v !== item.qtd_aprovada) onAjustar(item, v, true)
  }
  return (
    <div className="cartao">
      <div className="nome">{item.produto}</div>
      <div className="sub">
        Estoque {formatarQtd(item.estoque, item.unidade)} · Sugerido {formatarQtd(item.qtd_sugerida, item.unidade)}
        {item.preco_estimado != null && <> · Últ. compra {formatarReais(item.preco_estimado)}{item.data_ultima_compra && <> em {formatarData(item.data_ultima_compra)}</>}</>}
      </div>
      {item.fornecedor_ultima && <div className="sub">Fornecedor: {item.fornecedor_ultima}</div>}
      <div className="linha" style={{ marginTop: 8 }}>
        {editavel ? (
          item.incluido
            ? <button className="link perigo" onClick={() => onAjustar(item, item.qtd_aprovada, false)}>Tirar</button>
            : <button className="link" onClick={() => onAjustar(item, item.qtd_sugerida > 0 ? item.qtd_sugerida : 1, true)}>Incluir</button>
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
