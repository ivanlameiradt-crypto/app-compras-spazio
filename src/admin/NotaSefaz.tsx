// Aba "Lançamento de nota SEFAZ" (Fase 3). Lista as notas da fila da SEFAZ (cot_nfe, situacao 'na_fila'): por nota, "Como pagar"
// + botão Lançar (dois toques: Lançar → Confirmar) e o estado do robô; e os últimos lançamentos, com o detalhe clicável — o MESMO
// componente do cupom (DetalheLancamento). A segurança real é a RLS + a Edge Function lancar-nfe (admin, reserva da nota).
import { useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { formatarReais } from '../lib/regras'
import type { ItemNotaSefaz, NotaSefazLista } from '../lib/tipos'
import DetalheLancamento, { type LinhaDetalhe } from '../components/DetalheLancamento'
import {
  OPCOES_ANTES_DO_PIX, OPCOES_DEPOIS_DO_PIX, OPCOES_PIX, bloqueiosDaNota, formaInicial, lembrarForma, rotuloForma, textoDoEstado,
  traduzirMotivo,
} from './notaSefazRegras'

/** Enquanto alguma nota está 'lancando', a lista é recarregada neste intervalo (ms). */
const INTERVALO_ATUALIZAR = 15_000

/** Converte um item da NF para a linha genérica do detalhe (descrição · quantidade + unidade). */
const linhaDoItem = (it: ItemNotaSefaz): LinhaDetalhe =>
  ({ descricao: it.descricao ?? 'item', quantidade: it.qtd, unidade: it.unidade_sischef, valor: null })

/** emissao vem como AAAA-MM-DD; mostra dd/mm. */
const ddmm = (iso: string): string => { const p = iso.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso }

/** Uma nota a lançar: "Como pagar", estado do robô, avisos de bloqueio e o botão Lançar em dois toques. */
function NotaALancar({ nota, aoLancar }: { nota: NotaSefazLista; aoLancar: () => Promise<void> }) {
  // Só a escolha do usuário fica aqui; sem escolha, vale a forma gravada na nota / lembrada do fornecedor / Boleto.
  const [escolha, setEscolha] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const trancado = useRef(false) // trava síncrona contra duplo toque (o `enviando` só vale depois do próximo desenho)

  const forma = escolha ?? formaInicial(nota)
  const estado = nota.lancamento_estado ?? null
  const bloqueios = bloqueiosDaNota(nota)
  const estadoTexto = textoDoEstado(estado, nota.lancamento_motivo)
  // 'erro' = pedido pela metade (nunca lançar de novo); 'lancando' = o robô já está nela.
  const travada = estado === 'erro' || estado === 'lancando' || bloqueios.length > 0
  const podeLancar = !travada && forma !== '' && !enviando

  function escolher(nova: string) {
    setEscolha(nova); setConfirmando(false); setErro('')
    lembrarForma(nota.emitente, nova)
  }

  async function confirmar() {
    if (!podeLancar || trancado.current) return
    trancado.current = true
    setEnviando(true); setErro('')
    try {
      await api.lancarNota(nota.chave, forma)
      lembrarForma(nota.emitente, forma)
      setConfirmando(false)
      await aoLancar() // recarrega: a nota passa a aparecer como "lançando"
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui lançar agora. Tente de novo.')
      setConfirmando(false)
    } finally {
      trancado.current = false
      setEnviando(false)
    }
  }

  return (
    <li data-testid="nota-a-lancar" className="nota-lancar">
      <div className="recente-linha">
        <span><b>{nota.emitente}</b> · NF {nota.numero} · {ddmm(nota.emissao)}{nota.valor_nf != null && ` · ${formatarReais(nota.valor_nf)}`}</span>
      </div>

      {estadoTexto && (
        <div className={estado === 'erro' ? 'erro' : estado === 'ensaio_ok' ? 'ok' : 'amarelo'} data-testid="status-nota">{estadoTexto}</div>
      )}
      {estado === 'erro' && nota.lancamento_motivo && <div className="sub">{traduzirMotivo(nota.lancamento_motivo)}</div>}
      {bloqueios.map((b) => <div key={b} className="erro" data-testid="bloqueio-nota">{b}</div>)}

      <label>Como pagar
        <select value={forma} disabled={travada || enviando} onChange={(e) => escolher(e.target.value)}>
          {forma === '' && <option value="" disabled>Escolha como pagar…</option>}
          {OPCOES_ANTES_DO_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          <optgroup label="PIX">
            {OPCOES_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </optgroup>
          {OPCOES_DEPOIS_DO_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      </label>

      {confirmando ? (
        <div className="bloco-envio">
          <p>Vai lançar a NF {nota.numero} de {nota.emitente} — pagamento: {rotuloForma(forma)}. Confirmar?</p>
          <div className="acoes">
            <button type="button" className="botao" disabled={!podeLancar} onClick={() => void confirmar()}>
              {enviando ? 'Enviando…' : 'Confirmar'}
            </button>
            <button type="button" className="botao secundario" disabled={enviando} onClick={() => setConfirmando(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="acoes">
          <button type="button" className="botao" disabled={!podeLancar} onClick={() => { setErro(''); setConfirmando(true) }}>Lançar</button>
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </li>
  )
}

export default function NotaSefaz() {
  const [aLancar, setALancar] = useState<NotaSefazLista[]>([])
  const [lancadas, setLancadas] = useState<NotaSefazLista[]>([])
  const [falha, setFalha] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null) // qual lançada está aberta mostrando o detalhe

  // Devolve a promessa para o "Lançar" esperar a lista nova (a nota passa a 'lancando') antes de liberar o botão.
  // `silencioso` (releitura automática / depois do Lançar): uma falha passageira não esconde a lista que já está na tela.
  function carregar(silencioso = false): Promise<void> {
    if (!silencioso) setCarregando(true)
    return Promise.all([api.notasALancar(), api.notasLancadas()])
      .then(([a, l]) => { setALancar(a); setLancadas(l); setFalha(false) })
      .catch(() => { if (!silencioso) setFalha(true) })
      .finally(() => setCarregando(false))
  }
  useEffect(() => { void carregar() }, [])

  // Enquanto o robô trabalha em alguma nota, olha de novo a cada ~15 s (e para quando nenhuma estiver 'lancando').
  const algumaLancando = aLancar.some((n) => n.lancamento_estado === 'lancando')
  useEffect(() => {
    if (!algumaLancando) return
    const id = setInterval(() => { void carregar(true) }, INTERVALO_ATUALIZAR)
    return () => clearInterval(id)
  }, [algumaLancando])

  return (
    <section className="coluna cupom">
      <h2>Lançamento de nota SEFAZ</h2>
      <p className="sub">Modo: eu disparo — você confere e manda lançar (o automático vem depois).</p>

      <div className="grupo">Notas a lançar</div>
      {falha && <p className="erro" role="alert">Não consegui carregar as notas.</p>}
      {!falha && (aLancar.length === 0
        ? <p className="sub">{carregando ? 'Carregando…' : 'Nenhuma nota pendente da SEFAZ agora.'}</p>
        : (
          <>
            <ul className="recentes">
              {aLancar.map((n) => <NotaALancar key={n.chave} nota={n} aoLancar={() => carregar(true)} />)}
            </ul>
            <p className="sub">Confira, escolha como pagar e toque em “Lançar”: o robô faz o resto no SisChef.</p>
          </>
        ))}

      <div className="grupo">Últimos lançamentos</div>
      {!falha && (lancadas.length === 0
        ? <p className="sub">{carregando ? '' : 'Nenhuma nota lançada ainda.'}</p>
        : (
          <ul className="recentes">
            {lancadas.map((n) => {
              const aberto = expandido === n.chave
              return (
                <li key={n.chave} data-testid="nota-lancada">
                  <button type="button" className="recente-linha" aria-expanded={aberto}
                    onClick={() => setExpandido(aberto ? null : n.chave)}>
                    <span><b>lançada ✓</b> · {n.emitente} · NF {n.numero}{n.valor_nf != null && ` · ${formatarReais(n.valor_nf)}`}</span>
                    <span className="seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                  </button>
                  {aberto && <DetalheLancamento rotulo="NF no SisChef" pedido={n.nf_sischef} itens={n.itens.map(linhaDoItem)} />}
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
