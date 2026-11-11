// Lista da semana (tela nova, rota /lista-semana): o admin vê, item por item, quanto precisa ter, o que foi contado na loja,
// quanto comprar e de qual fornecedor, e aprova a lista. As contas ficam em listaSemanaRegras.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { ItemSemana, Semana } from '../lib/tipos'
import { formatarData, formatarReais, mensagemDeErro } from '../lib/regras'
import { lerQuantidadeBr } from '../lib/quantidade'
import { sugerirCompras, type ProdutoHistorico, type SugestaoProduto } from '../lib/sugestaoCompra'
import TituloDaTela from '../components/TituloDaTela'
import {
  abaPrincipais, itensForaDoTotal, itensParaGravar, montarLinhas, nomeNaTela, qtdNaTela, resumoContagem, totalEstimadoLista, type LinhaLista,
} from './listaSemanaRegras'

type Aba = 'principais' | 'todos' | 'conferir'

/** Valor dentro de um campo de digitar: sem ponto de milhar, para o leitor de quantidade não se confundir. */
const num = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',')
const porUnidade = (un: string) => (/^un$/i.test(un) ? 'a unidade' : `o ${un}`)
export function hojeLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ListaSemana() {
  const [estado, setEstado] = useState<'carregando' | 'erro' | 'sem-semana' | 'pronto'>('carregando')
  const [erroLeitura, setErroLeitura] = useState('')
  const [semana, setSemana] = useState<Semana | null>(null)
  const [itens, setItens] = useState<ItemSemana[]>([])
  const [historico, setHistorico] = useState<ProdutoHistorico[] | null>(null)
  const [contagens, setContagens] = useState<Map<number, number>>(() => new Map())
  const [manuais, setManuais] = useState<Record<number, number>>({})
  const [situacao, setSituacao] = useState<Record<number, { salvando?: boolean; erro?: string }>>({})
  const [aba, setAba] = useState<Aba>('principais')
  const [erro, setErro] = useState('')
  const [aprovando, setAprovando] = useState(false)

  const carregar = useCallback(async () => {
    setEstado('carregando')
    setErroLeitura('')
    try {
      const s = await api.semanaParaRevisar()
      if (!s) { setEstado('sem-semana'); return }
      const [lista, cont, hist] = await Promise.all([
        api.itensDaSemana(s.id),
        api.contagemDaSemana(s.id).catch(() => new Map<number, number>()), // sem a tabela ainda: a tela segue sem contagens
        api.historicoDeCompras().catch(() => null), // sem histórico: a tela funciona só com a lista antiga e avisa
      ])
      setSemana(s)
      setItens(lista)
      setContagens(cont)
      setHistorico(hist && hist.length > 0 ? hist : null)
      setEstado('pronto')
    } catch (e) {
      setErroLeitura(mensagemDeErro(e))
      setEstado('erro')
    }
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const sugestoes: SugestaoProduto[] = useMemo(() => (historico ? sugerirCompras(historico, hojeLocal()) : []), [historico])
  const linhas = useMemo(() => montarLinhas(itens, sugestoes, contagens, manuais), [itens, sugestoes, contagens, manuais])
  const principais = useMemo(() => abaPrincipais(linhas, sugestoes), [linhas, sugestoes])
  const conferir = useMemo(() => linhas.filter((l) => l.conferir), [linhas])
  const resumo = useMemo(() => resumoContagem(linhas, sugestoes), [linhas, sugestoes])
  const total = useMemo(() => totalEstimadoLista(linhas), [linhas])
  const foraDoTotal = useMemo(() => itensForaDoTotal(linhas), [linhas])

  if (estado === 'carregando') return <p className="centro">Carregando…</p>
  if (estado === 'erro') {
    return (
      <section className="coluna">
        <TituloDaTela>Lista da semana</TituloDaTela>
        <p className="erro" role="alert">Não consegui ler a lista. {erroLeitura}</p>
        <button className="botao" onClick={() => void carregar()}>Tentar de novo</button>
      </section>
    )
  }
  if (estado === 'sem-semana' || !semana) {
    return (
      <section className="coluna">
        <TituloDaTela>Lista da semana</TituloDaTela>
        <p className="vazio">Nenhuma lista nova. A próxima chega segunda às 6h.</p>
        <a className="link" href="#/lista">Abrir a lista antiga</a>
      </section>
    )
  }
  const s = semana
  const editavel = s.status === 'rascunho'
  // sem histórico não existe "Principais": a tela abre em Todos
  const abaAtual: Aba = !historico && aba === 'principais' ? 'todos' : aba
  const visiveis = abaAtual === 'principais' ? principais : abaAtual === 'conferir' ? conferir : linhas

  async function contar(l: LinhaLista, qtd: number | null) {
    const produto = l.item.produto_id
    setSituacao((x) => ({ ...x, [produto]: { salvando: true } }))
    try {
      await api.salvarContagem(s.id, produto, qtd)
      setContagens((m) => { const n = new Map(m); if (qtd === null) n.delete(produto); else n.set(produto, qtd); return n })
      setSituacao((x) => ({ ...x, [produto]: {} }))
    } catch (e) {
      setSituacao((x) => ({ ...x, [produto]: { erro: `Não consegui guardar a contagem. ${mensagemDeErro(e)}` } }))
    }
  }
  function ajustarManual(l: LinhaLista, qtd: number | null) {
    setManuais((m) => {
      const n = { ...m }
      if (qtd === null || (l.calculado !== null && qtd === l.calculado)) delete n[l.item.id]
      else n[l.item.id] = qtd
      return n
    })
  }

  async function aprovar() {
    const pergunta = resumo.faltam > 0
      ? `Faltam contar ${resumo.faltam} dos principais. Aprovar a lista assim mesmo e liberar para os compradores?`
      : 'Aprovar a lista e liberar para os compradores?'
    if (!window.confirm(pergunta)) return
    setAprovando(true)
    setErro('')
    try {
      for (const g of itensParaGravar(linhas)) {
        const atual = itens.find((i) => i.id === g.id)
        if (atual && atual.qtd_aprovada === g.qtd && atual.incluido === g.incluido) continue
        await api.ajustarItem(g.id, g.qtd, g.incluido)
      }
      await api.aprovarSemana(s.id)
      setSemana({ ...s, status: 'em_compra' })
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setAprovando(false)
    }
  }

  return (
    <section className="coluna lista-semana">
      <TituloDaTela>Lista da semana {formatarData(s.data_referencia)}</TituloDaTela>
      <a className="link" href="#/lista">Abrir a lista antiga</a>
      {!editavel && <div className="aviso">Lista aprovada e liberada para os compradores.</div>}
      {!historico && (
        <p className="aviso" role="status">O histórico de compras ainda não chegou. A lista abaixo usa as quantidades da lista antiga.</p>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}

      {historico && (
        <div className="cartao" data-testid="contagem-rapida">
          <div className="nome">Contagem rápida: {resumo.contados} de {resumo.total} contados</div>
          <progress max={Math.max(resumo.total, 1)} value={resumo.contados} aria-label="Principais contados" style={{ width: '100%' }} />
        </div>
      )}

      <div className="abas">
        {historico && <button aria-pressed={abaAtual === 'principais'} onClick={() => setAba('principais')}>Principais {principais.length}</button>}
        <button aria-pressed={abaAtual === 'todos'} onClick={() => setAba('todos')}>Todos {linhas.length}</button>
        <button aria-pressed={abaAtual === 'conferir'} onClick={() => setAba('conferir')}>Conferir {conferir.length}</button>
      </div>

      {visiveis.map((l) => (
        <Cartao key={l.item.id} l={l} editavel={editavel} situacao={situacao[l.item.produto_id]} onContar={contar} onAjustar={ajustarManual} />
      ))}
      {visiveis.length === 0 && <p className="vazio">Nenhum item aqui.</p>}

      <div style={{ height: 96 }} aria-hidden="true" />
      <div className="rodape">
        <div>
          <div>
            <div className="sub">Compra estimada</div>
            <b data-testid="total">{formatarReais(total)}</b>
            {(foraDoTotal > 0 || (editavel && resumo.faltam > 0)) && (
              <div className="sub" style={{ fontSize: 14 }}>
                {foraDoTotal > 0 && <span aria-label={`${foraDoTotal} ${foraDoTotal === 1 ? 'item fora do total' : 'itens fora do total'}: confira a unidade`}>Fora do total: {foraDoTotal}</span>}
                {foraDoTotal > 0 && editavel && resumo.faltam > 0 && ' · '}
                {editavel && resumo.faltam > 0 && <span aria-label={`Faltam contar ${resumo.faltam} dos principais`}>Faltam contar: {resumo.faltam}</span>}
              </div>
            )}
          </div>
          {editavel && <button className="botao" disabled={aprovando} onClick={() => void aprovar()}>{aprovando ? 'Aprovando…' : 'Aprovar lista'}</button>}
        </div>
      </div>
    </section>
  )
}

function Cartao({ l, editavel, situacao, onContar, onAjustar }: {
  l: LinhaLista
  editavel: boolean
  situacao?: { salvando?: boolean; erro?: string }
  onContar: (l: LinhaLista, qtd: number | null) => void
  onAjustar: (l: LinhaLista, qtd: number | null) => void
}) {
  const { item } = l
  const [contei, setContei] = useState(l.contagem === null ? '' : num(l.contagem))
  const [comprar, setComprar] = useState(l.comprar === null ? '' : num(l.comprar))
  const [erroCampo, setErroCampo] = useState('')
  useEffect(() => { setContei(l.contagem === null ? '' : num(l.contagem)) }, [l.contagem])
  useEffect(() => { setComprar(l.comprar === null ? '' : num(l.comprar)) }, [l.comprar])

  const sairContei = () => {
    if (contei.trim() === '') { if (l.contagem !== null) onContar(l, null); setErroCampo(''); return }
    const v = lerQuantidadeBr(contei, item.unidade)
    if (v === null) { setErroCampo('Digite só o número, por exemplo 2,5.'); return }
    setErroCampo('')
    if (v !== l.contagem) onContar(l, v)
  }
  const sairComprar = () => {
    if (comprar.trim() === '') { onAjustar(l, null); setComprar(l.calculado === null ? '' : num(l.calculado)); return }
    const v = lerQuantidadeBr(comprar, item.unidade)
    if (v === null) { setErroCampo('Digite só o número, por exemplo 2,5.'); return }
    setErroCampo('')
    onAjustar(l, v)
  }
  const un = item.unidade
  return (
    <div className="cartao" data-produto={item.produto_id}>
      <div className="nome">{nomeNaTela(item.produto)}</div>
      {l.avisoEstoque && <div className="selo">{l.avisoEstoque}</div>}
      {l.avisoUnidade && <div className="selo">{l.avisoUnidade}</div>}

      <div className="sub" style={{ marginTop: 6 }}>
        {l.alvo !== null && <>Precisa ter <b>{qtdNaTela(l.alvo, un)}</b> · </>}
        {l.deVezEmQuando && <>Compra de vez em quando · ponto de partida {qtdNaTela(item.qtd_sugerida, un)} · </>}
        Estoque no SisChef {qtdNaTela(item.estoque, un)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 8 }}>
        <label>
          Contei
          <input type="text" inputMode="decimal" value={contei} disabled={!editavel} aria-label={`Contei ${item.produto}`}
            onChange={(e) => setContei(e.target.value)} onBlur={sairContei} style={{ minHeight: 48 }} />
        </label>
        <label>
          Comprar
          <input type="text" inputMode="decimal" value={comprar} disabled={!editavel} aria-label={`Comprar ${item.produto}`}
            placeholder={l.comprar === null ? 'contar' : ''}
            onChange={(e) => setComprar(e.target.value)} onBlur={sairComprar}
            style={{ minHeight: 48, ...(l.comprar !== null && !l.ajustado ? { background: 'var(--marca)', color: 'var(--marca-texto)', fontWeight: 700 } : {}) }} />
        </label>
      </div>
      {situacao?.salvando && <div className="sub" role="status">Guardando a contagem…</div>}
      {(erroCampo || situacao?.erro) && <div className="erro" role="alert">{erroCampo || situacao?.erro}</div>}
      {l.comprar === null && (l.avisoUnidade
        ? <div className="sub">Sem cálculo automático: confira a unidade e digite quanto comprar.</div>
        : <div className="sub">Conte o estoque para saber quanto comprar.</div>)}
      {l.ajustado && (
        <div className="sub">
          Ajustado por você{l.calculado !== null && <> (o cálculo mandava {qtdNaTela(l.calculado, un)})</>}.{' '}
          {editavel && <button className="link" onClick={() => onAjustar(l, null)}>Voltar ao calculado</button>}
        </div>
      )}

      <div className="sub" style={{ marginTop: 6 }}>
        {l.melhor && (
          <div style={{ color: 'var(--texto)' }}>
            {l.melhorPreco && <span className="pill ok">Melhor preço</span>}{' '}
            <b>{l.melhor.fornecedor}</b>: <b>{formatarReais(l.melhor.custo)} {porUnidade(un)}</b> em {formatarData(l.melhor.data)}
          </div>
        )}
        {l.outros.map((o) => (
          <div key={o.fornecedor} style={{ color: 'var(--suave)' }}>
            {o.fornecedor}: {formatarReais(o.custo)} {porUnidade(un)} em {formatarData(o.data)}
            {o.diferencaPct !== null && <> ({o.diferencaPct > 0 ? '+' : ''}{o.diferencaPct}%)</>}
          </div>
        ))}
        {!l.melhor && l.outros.length === 0 && (
          <div>
            {l.fornecedorTexto && <>Fornecedor: {l.fornecedorTexto}</>}
            {item.preco_estimado != null && <>{l.fornecedorTexto ? ' · ' : ''}Últ. compra {formatarReais(item.preco_estimado)}</>}
          </div>
        )}
      </div>
    </div>
  )
}
