import { lerQuantidadeBr } from '../lib/quantidade'
import { useEffect, useRef, useState } from 'react'
import { ehMilharAmbiguo, lerPrecoUnitario } from '../lib/dinheiro'
import * as api from '../lib/api'
import { Icone } from '../components/Icones'
import type { Semana, Usuario } from '../lib/tipos'
import {
  ROTULO_STATUS, formatarData, formatarDataHora, formatarQtd, formatarReais, lerNumero, mensagemDeErro,
} from '../lib/regras'
import TituloDaTela from '../components/TituloDaTela'

/** Prazo de uma gravação do cartão: sem resposta até aqui, a trava do cartão é solta com um aviso (revisão do PR 91). */
const PRAZO_DA_ACAO_MS = 20_000
/** Qual botão do cartão está rodando: é ele que mostra "Gravando…" (os outros só ficam desabilitados). */
type AcaoDoCartao = 'itens' | 'total' | 'aprovar' | 'lancada'

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
  // item 1 da análise de 07/11/2026: a releitura da fila depois de uma ação falhou (a lista pode estar velha); antes ficava calado
  const [erroFila, setErroFila] = useState('')
  const [cupomEmbutido, setCupomEmbutido] = useState<Record<string, string>>({})
  // A1 (13/11/2026): cartões com uma ação gravando. Os botões do cartão ficam travados até a resposta chegar, senão o segundo toque no
  // mesmo lugar (o "Aprovar" vira "Marcar como lançada no SisChef") tirava a compra da fila sem querer.
  const [ocupados, setOcupados] = useState<ReadonlyMap<string, AcaoDoCartao>>(new Map())
  const ocupadosAgora = useRef(new Map<string, AcaoDoCartao>()) // a trava vale já no clique, antes de a tela redesenhar

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
  /** Como `acao`, mas trava os botões do cartão da compra `id` enquanto roda (o botão `qual` mostra que está gravando); toque repetido no meio é ignorado. */
  async function acaoNoCartao(id: string, qual: AcaoDoCartao, f: () => Promise<void>) {
    if (ocupadosAgora.current.has(id)) return
    ocupadosAgora.current.set(id, qual)
    setOcupados(new Map(ocupadosAgora.current))
    try { await acao(f) } finally {
      ocupadosAgora.current.delete(id)
      setOcupados(new Map(ocupadosAgora.current))
    }
  }
  /**
   * Espera a gravação até o prazo; sem resposta, desiste com um aviso e a trava do cartão é solta (senão o cartão ficava travado para sempre com a rede pendurada).
   * O prazo conta só a chamada ao servidor: o tempo que a pessoa leva nas perguntas (confirmar, digitar o total) fica de fora. Como o servidor pode ter gravado
   * mesmo sem a resposta chegar, o aviso manda conferir a lista, e a fila é relida.
   */
  function comPrazo<T>(chamada: Promise<T>): Promise<T> {
    let relogio: ReturnType<typeof setTimeout> | undefined
    const prazo = new Promise<never>((_ok, ko) => {
      relogio = setTimeout(() => { void relerFila(); ko(new Error('Sem resposta. Confira a lista antes de tocar de novo.')) }, PRAZO_DA_ACAO_MS)
    })
    return Promise.race([chamada, prazo]).finally(() => clearTimeout(relogio))
  }
  // relê a fila depois de uma ação (a compra fechada entra nela); se falhar, avisa em vez de deixar a lista velha em silêncio (item 1, 07/11/2026)
  const relerFila = () => api.filaLancamentos().then((f) => { setFila(f); setErroFila('') }).catch((e) => setErroFila(mensagemDeErro(e)))
  const aprovar = (id: string) => acaoNoCartao(id, 'aprovar', async () => {
    await comPrazo(api.aprovarCompra(id))
    setFila((l) => l?.map((c) => (c.id === id ? { ...c, status: 'aprovada' } : c)))
  })
  const lancada = (id: string) => acaoNoCartao(id, 'lancada', async () => {
    // sair da fila não tem "desfazer" na tela: pergunta antes de gravar (A1, 13/11/2026)
    if (!window.confirm('Esta compra já foi lançada no SisChef? Depois de marcar, ela sai desta lista.')) return
    await comPrazo(api.marcarLancada(id))
    setFila((l) => l?.filter((c) => c.id !== id))
  })
  const verItens = (id: string) => acaoNoCartao(id, 'itens', async () => {
    if (aberta === id) { setAberta(null); return }
    setLinhas(await comPrazo(api.itensDaCompra(id)))
    setAberta(id)
  })
  const corrigir = (l: api.LinhaDetalhada) => acao(async () => {
    const textoQtd = window.prompt(`Quantidade de ${l.produto}`, String(l.qtd).replace('.', ','))
    if (textoQtd === null) return // cancelou: não mexe em nada
    const q = lerQuantidadeBr(textoQtd, l.unidade)
    if (q === null) throw new Error('Quantidade inválida. Nada foi alterado.')
    const textoPreco = window.prompt('Preço unitário', l.preco_unit == null ? '' : String(l.preco_unit).replace('.', ','))
    if (textoPreco === null) return // cancelou: não apaga o preço já lançado
    const p = textoPreco.trim() ? lerPrecoUnitario(textoPreco) : null
    // preço que não é número não pode apagar o preço já lançado: para antes de gravar (correção de 08/11/2026)
    if (textoPreco.trim() && p === null) throw new Error(ehMilharAmbiguo(textoPreco) ? 'Preço: use a vírgula nos centavos (ex.: 1,516).' : 'Preço inválido. Nada foi alterado.')
    await api.corrigirItemCompra(l.id, q, p)
    setLinhas((ls) => ls.map((x) => (x.id === l.id ? { ...x, qtd: q, preco_unit: p } : x)))
  })
  const corrigirTotal = (c: api.CompraNaFila) => acaoNoCartao(c.id, 'total', async () => {
    const textoNota = window.prompt('Com nota ou sem nota? Digite "com" ou "sem".', c.com_nota ? 'com' : 'sem')
    if (textoNota === null) return // cancelou: não mexe em nada
    // a mesma regra do "Fechar pelo comprador": só "com" ou "sem"; outra coisa não pode virar "Sem nota" calado (A2, 13/11/2026)
    const comNota = /^com/i.test(textoNota.trim()) ? true : /^sem/i.test(textoNota.trim()) ? false : null
    if (comNota === null) throw new Error('Responda "com" ou "sem" nota. Nada foi alterado.')
    const textoTotal = window.prompt('Total pago', String(c.total_pago ?? 0).replace('.', ','))
    if (textoTotal === null) return // cancelou
    const total = lerNumero(textoTotal)
    if (total === null) throw new Error('Total inválido.') // setErro aqui seria apagado pelo setErro('') de acao
    await comPrazo(api.corrigirCompra(c.id, comNota, total))
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
    void relerFila()
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
    void relerFila()
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
      <TituloDaTela>Lançamentos</TituloDaTela>
      <p className="sub">{fila.length} compras</p>
      {erro && <p className="erro">{erro}</p>}
      {erroFila && (
        <p className="erro" data-testid="erro-fila">
          Não consegui atualizar a lista de compras ({erroFila}): ela pode estar desatualizada.{' '}
          <button className="link" onClick={() => { void relerFila() }}>Tentar de novo</button>
        </p>
      )}
      {aviso && (
        <p className="aviso" data-testid="aviso">
          {aviso}{' '}
          <button className="link" aria-label="Fechar aviso" onClick={() => setAviso('')}><Icone nome="fechar" tamanho={20} /></button>
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
            <span className="pill neutro">{c.com_nota ? 'Com nota' : 'Sem nota'}</span>{' '}
            <span className={c.status === 'aprovada' ? 'pill ok' : 'pill atencao'}>{ROTULO_STATUS[c.status]}</span>
          </div>
          {c.foto_cupom && <button className="link" onClick={() => cupom(c)}><Icone nome="foto" tamanho={22} /> Ver cupom</button>}
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
            <button className="botao secundario" disabled={ocupados.has(c.id)} onClick={() => verItens(c.id)}>{ocupados.get(c.id) === 'itens' ? 'Carregando…' : aberta === c.id ? 'Esconder itens' : 'Ver itens'}</button>
            <button className="botao secundario" disabled={ocupados.has(c.id)} onClick={() => corrigirTotal(c)}>{ocupados.get(c.id) === 'total' ? 'Gravando…' : 'Corrigir total/nota'}</button>
            {c.status === 'fechada'
              ? <button className="botao" disabled={ocupados.has(c.id)} onClick={() => aprovar(c.id)}>{ocupados.get(c.id) === 'aprovar' ? 'Gravando…' : 'Aprovar'}</button>
              : <button className="botao" disabled={ocupados.has(c.id)} onClick={() => lancada(c.id)}>{ocupados.get(c.id) === 'lancada' ? 'Gravando…' : 'Marcar como lançada no SisChef'}</button>}
          </div>
        </div>
      ))}
    </section>
  )
}
