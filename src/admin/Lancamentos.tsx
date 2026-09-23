import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { ROTULO_STATUS, formatarData, formatarQtd, formatarReais, lerNumero, mensagemDeErro } from '../lib/regras'

export default function Lancamentos() {
  const [fila, setFila] = useState<api.CompraNaFila[] | undefined>()
  const [aberta, setAberta] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<api.LinhaDetalhada[]>([])
  const [erro, setErro] = useState('')
  const [cupomEmbutido, setCupomEmbutido] = useState<Record<string, string>>({})

  useEffect(() => {
    api.filaLancamentos().then(setFila).catch((e) => { setErro(mensagemDeErro(e)); setFila([]) })
  }, [])

  async function acao(f: () => Promise<void>) {
    try { await f(); setErro('') } catch (e) { setErro(mensagemDeErro(e)) }
  }
  const aprovar = (id: string) => acao(async () => {
    await api.aprovarCompra(id)
    setFila((l) => l?.map((c) => (c.id === id ? { ...c, status: 'aprovada' } : c)))
  })
  const lancada = (id: string) => acao(async () => {
    await api.marcarLancada(id)
    setFila((l) => l?.filter((c) => c.id !== id))
  })
  const verItens = (id: string) => acao(async () => {
    if (aberta === id) { setAberta(null); return }
    setLinhas(await api.itensDaCompra(id))
    setAberta(id)
  })
  const corrigir = (l: api.LinhaDetalhada) => acao(async () => {
    const textoQtd = window.prompt(`Quantidade de ${l.produto}`, String(l.qtd).replace('.', ','))
    if (textoQtd === null) return // cancelou: não mexe em nada
    const q = lerNumero(textoQtd)
    if (q === null) return
    const textoPreco = window.prompt('Preço unitário', l.preco_unit == null ? '' : String(l.preco_unit).replace('.', ','))
    if (textoPreco === null) return // cancelou: não apaga o preço já lançado
    const p = textoPreco.trim() ? lerNumero(textoPreco) : null
    await api.corrigirItemCompra(l.id, q, p)
    setLinhas((ls) => ls.map((x) => (x.id === l.id ? { ...x, qtd: q, preco_unit: p } : x)))
  })
  const corrigirTotal = (c: api.CompraNaFila) => acao(async () => {
    const textoNota = window.prompt('Com nota ou sem nota? Digite "com" ou "sem".', c.com_nota ? 'com' : 'sem')
    if (textoNota === null) return // cancelou: não mexe em nada
    const comNota = /^com/i.test(textoNota.trim())
    const textoTotal = window.prompt('Total pago', String(c.total_pago ?? 0).replace('.', ','))
    if (textoTotal === null) return // cancelou
    const total = lerNumero(textoTotal)
    if (total === null) return setErro('Total inválido.')
    await api.corrigirCompra(c.id, comNota, total)
    setFila((l) => l?.map((x) => (x.id === c.id ? { ...x, com_nota: comNota, total_pago: total } : x)))
  })
  const cupom = (c: api.CompraNaFila) => acao(async () => {
    // abre a aba já no clique (senão o Safari/iOS bloqueia por não ser mais "gesto do usuário"
    // depois do await); só depois manda a URL assinada
    const janela = window.open('', '_blank')
    let url: string
    try {
      url = await api.urlCupom(c.foto_cupom!)
    } catch (e) {
      janela?.close() // não deixa a aba em branco aberta; o erro aparece na tela
      throw e
    }
    if (janela) janela.location.href = url
    else setCupomEmbutido((m) => ({ ...m, [c.id]: url })) // aba bloqueada: mostra a foto no próprio cartão
  })

  if (fila === undefined) return <p className="centro">Carregando…</p>
  return (
    <section>
      <div className="cabecalho"><h2>Lançamentos</h2><span className="sub">{fila.length} compras</span></div>
      {erro && <p className="erro">{erro}</p>}
      {fila.length === 0 && <p className="vazio">Nenhuma compra aguardando lançamento.</p>}
      {fila.map((c) => (
        <div key={c.id} className="cartao">
          <div className="nome">{c.loja} · {c.fechada_em ? formatarData(c.fechada_em) : ''} · {c.comprador_nome}</div>
          <div className="sub">
            {c.itens} itens · {formatarReais(Number(c.total_pago ?? 0))} ·{' '}
            <span className="pill">{c.com_nota ? 'Com nota' : 'Sem nota'}</span>{' '}
            <span className={c.status === 'aprovada' ? 'pill ok' : 'pill'}>{ROTULO_STATUS[c.status]}</span>
          </div>
          {c.foto_cupom && <button className="link" onClick={() => cupom(c)}>📷 Ver cupom</button>}
          {cupomEmbutido[c.id] && <img src={cupomEmbutido[c.id]} alt="Foto do cupom fiscal" style={{ maxWidth: '100%', marginTop: 8 }} />}
          {aberta === c.id && (
            <table>
              <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th /></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id}>
                    <td>{l.produto}</td>
                    <td>{l.resultado === 'nao_achei' ? 'não achou' : formatarQtd(Number(l.qtd), l.unidade)}</td>
                    <td>{l.preco_unit == null ? '—' : formatarReais(Number(l.preco_unit))}</td>
                    <td><button className="link" onClick={() => corrigir(l)}>Corrigir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="linha" style={{ marginTop: 8 }}>
            <button className="botao secundario" onClick={() => verItens(c.id)}>{aberta === c.id ? 'Esconder itens' : 'Ver itens'}</button>
            <button className="botao secundario" onClick={() => corrigirTotal(c)}>Corrigir total/nota</button>
            {c.status === 'fechada'
              ? <button className="botao" onClick={() => aprovar(c.id)}>Aprovar</button>
              : <button className="botao" onClick={() => lancada(c.id)}>Marcar como lançada no SisChef</button>}
          </div>
        </div>
      ))}
    </section>
  )
}
