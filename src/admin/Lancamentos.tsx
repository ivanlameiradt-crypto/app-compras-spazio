import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { Semana, Usuario } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarDataHora, formatarQtd, formatarReais, lerNumero, mensagemDeErro,
} from '../lib/regras'

export default function Lancamentos({ usuario }: { usuario: Usuario }) {
  const [fila, setFila] = useState<api.CompraNaFila[] | undefined>()
  const [abertas, setAbertas] = useState<api.CompraAbertaParaFechar[]>([])
  const [travando, setTravando] = useState<Semana | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<api.LinhaDetalhada[]>([])
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  // falha ao ler o bloco de compras abertas: estado próprio, mostrado no lugar do bloco (acao não apaga)
  const [erroAbertas, setErroAbertas] = useState('')
  const [cupomEmbutido, setCupomEmbutido] = useState<Record<string, string>>({})

  useEffect(() => {
    api.filaLancamentos().then(setFila).catch((e) => { setErro(mensagemDeErro(e)); setFila([]) })
    // compra aberta só aparece aqui quando trava o encerrar: há uma lista nova em rascunho esperando e a semana
    // em compra é outra. Fora disso é compra em curso (o comprador pode estar na loja) e não se mexe nela.
    ;(async () => {
      try {
        const s = await api.semanaTravandoAprovacao()
        if (!s) return
        const l = await api.comprasAbertasParaFechar(s.id)
        setTravando(s)
        setAbertas(l)
      } catch (e) {
        setErroAbertas(mensagemDeErro(e))
      }
    })()
  }, [])

  // o aviso de "já tinha fechado" não é apagado aqui: só no começo de fecharPeloComprador/cancelarAberta ou
  // quando o admin o fecha (senão o "Ver itens" logo depois o apagaria antes de ele ler)
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
    if (total === null) throw new Error('Total inválido.') // setErro aqui seria apagado pelo setErro('') de acao
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

  // Fase 1A: compra aberta de outra pessoa trava o encerrar da semana (com lista nova esperando); o admin fecha
  // (com os itens já marcados) ou cancela.
  // Banco recusou (o comprador marcou item depois que a tela abriu, ou desmarcou tudo): relê as compras abertas
  // antes de a mensagem aparecer, para o cartão passar a mostrar o botão certo (ou sumir, se ela já fechou).
  async function recusadoPeloBanco(e: unknown): Promise<never> {
    if (travando) {
      try {
        setAbertas(await api.comprasAbertasParaFechar(travando.id))
        setErroAbertas('')
      } catch (e2) {
        setErroAbertas(mensagemDeErro(e2))
      }
    }
    // se o comprador já fechou, a compra sai das abertas e entra na fila: relê a fila também
    api.filaLancamentos().then(setFila).catch(() => undefined)
    throw e
  }
  const fecharPeloComprador = (a: api.CompraAbertaParaFechar) => acao(async () => {
    setAviso('')
    const quem = `${a.comprador_nome} (${a.loja}, aberta em ${formatarDataHora(a.aberta_em)})`
    const textoNota = window.prompt(
      `Fechar a compra de ${quem}.\nO comprador pode ainda estar na loja: marcações feitas depois disto serão recusadas.\n` +
      'Foi com nota ou sem nota? Digite "com" ou "sem".',
      '',
    )
    if (textoNota === null) return // cancelou: não mexe em nada
    const comNota = /^com/i.test(textoNota.trim()) ? true : /^sem/i.test(textoNota.trim()) ? false : null
    if (comNota === null) throw new Error('Responda "com" ou "sem" nota. A compra continua aberta.')
    const textoTotal = window.prompt(
      `Total pago — sugerido pela soma dos ${a.itens} ${a.itens === 1 ? 'item marcado' : 'itens marcados'} (corrija se precisar)`,
      a.total_marcado.toFixed(2).replace('.', ','),
    )
    if (textoTotal === null) return // cancelou
    const total = lerNumero(textoTotal)
    if (total === null) throw new Error('Total inválido. A compra continua aberta.')
    const fechou = await api.adminFecharCompra(a.id, comNota, total).catch(recusadoPeloBanco)
    setAbertas((l) => l.filter((x) => x.id !== a.id))
    if (!fechou) {
      // o comprador fechou entre a tela abrir e o admin confirmar: o banco não mexe em nada
      setAviso(`O comprador já tinha fechado esta compra; valores dele mantidos — confira em ${a.loja} · ${a.comprador_nome}, na fila abaixo.`)
    }
    // fechada, ela entra na fila de lançamento como qualquer compra fechada
    api.filaLancamentos().then(setFila).catch(() => undefined)
  })
  const cancelarAberta = (a: api.CompraAbertaParaFechar) => acao(async () => {
    setAviso('')
    if (!window.confirm(`Cancelar a compra de ${a.comprador_nome} (${a.loja})? Ela não tem nenhum item marcado.`)) return
    await api.cancelarCompra(a.id).catch(recusadoPeloBanco)
    setAbertas((l) => l.filter((x) => x.id !== a.id))
  })

  if (fila === undefined) return <p className="centro">Carregando…</p>
  const deOutros = travando ? abertas.filter((a) => a.comprador !== usuario.email) : []
  return (
    <section>
      <div className="cabecalho"><h2>Lançamentos</h2><span className="sub">{fila.length} compras</span></div>
      {erro && <p className="erro">{erro}</p>}
      {aviso && (
        <p className="aviso" data-testid="aviso">
          {aviso}{' '}
          <button className="link" aria-label="Fechar aviso" onClick={() => setAviso('')}>✕</button>
        </p>
      )}
      {erroAbertas && (
        <p className="erro" data-testid="erro-abertas">Não consegui ler as compras abertas: {erroAbertas}</p>
      )}
      {!erroAbertas && deOutros.length > 0 && (
        <>
          <div className="grupo">Compras abertas</div>
          <p className="aviso">
            A lista nova está esperando aprovação, e a semana {formatarData(travando!.data_referencia)} não pode ser
            encerrada enquanto houver compra aberta nela.
          </p>
          {deOutros.map((a) => (
            <div key={a.id} className="cartao" data-testid="compra-aberta">
              <div className="nome">{a.loja} · {a.comprador_nome}</div>
              <div className="sub">
                Aberta em {formatarDataHora(a.aberta_em)} ·{' '}
                {a.itens === 0
                  ? 'nenhum item marcado'
                  : <>{a.itens} {a.itens === 1 ? 'item marcado' : 'itens marcados'} · {formatarReais(a.total_marcado)}</>}
              </div>
              <div className="linha" style={{ marginTop: 8 }}>
                {a.itens > 0
                  ? <button className="botao" onClick={() => fecharPeloComprador(a)}>Fechar pelo comprador</button>
                  : <button className="botao secundario" onClick={() => cancelarAberta(a)}>Cancelar</button>}
              </div>
            </div>
          ))}
        </>
      )}
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
