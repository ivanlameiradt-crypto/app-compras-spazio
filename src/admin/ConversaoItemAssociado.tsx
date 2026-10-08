import { useState } from 'react'
import { CONVERSAO_CASAS, CONVERSAO_MAXIMA, formatarConversao, parseConversao, rotuloUnidade } from './associacaoRegras'
import type { ItemNotaSefaz } from '../lib/tipos'

/**
 * Conversão de unidade de um item que JÁ vem associado no SisChef mas com "UN DIFERE" (a nota em UN, o cadastro em KG, sem conversão registrada).
 * Só aparece quando há o que informar: o robô parou pedindo (`pede`) ou o Ivan já informou uma (`atual`). O número fica na nota (cot_nfe_converter_item)
 * e o robô o registra no modal do SisChef ao lançar — mesma régua da caixa de associação: maior que zero, até 10000, 4 casas, vírgula ou ponto.
 * Item sem produto no SisChef não passa por aqui: lá é a caixa de associação (AssociarProduto) que pede a conversão junto com o produto.
 */
export function ConversaoItemAssociado({ item, atual, pede, desabilitado, salvar }: {
  item: ItemNotaSefaz & { n: number }
  /** A conversão que o Ivan já informou (decisão com origem "sischef"), ou null. */
  atual: number | null
  /** O robô parou nesta nota dizendo que ESTE item está com UN DIFERE sem conversão. */
  pede: boolean
  desabilitado: boolean
  salvar: (n: number, conversao: number | null) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState(false)
  const [salvo, setSalvo] = useState<number | null | undefined>(undefined) // o que acabou de gravar (vale até a releitura trazer o do servidor)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const valorAtual = salvo !== undefined ? salvo : atual
  const unidade = rotuloUnidade(item.unidade_sischef)
  const conversao = texto.trim() !== '' ? parseConversao(texto) : null
  const invalida = texto.trim() !== '' && conversao == null
  const mostrarCampo = (pede && valorAtual == null) || editando

  if (!pede && valorAtual == null) return null

  async function guardar(valor: number | null) {
    if (enviando) return
    setEnviando(true); setErro('')
    try {
      await salvar(item.n, valor)
      setSalvo(valor); setEditando(false); setTexto('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui guardar a conversão agora. Confira a internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!mostrarCampo) {
    return (
      <p className="sub" data-testid="conversao-item-informada">
        Conversão informada: 1 unidade da nota = {formatarConversao(valorAtual as number)}{unidade ? ` ${unidade}` : ''}. O robô registra no SisChef ao lançar.{' '}
        <button type="button" className="link" disabled={desabilitado || enviando}
          onClick={() => { setTexto(formatarConversao(valorAtual as number)); setEditando(true) }}>Trocar</button>
      </p>
    )
  }
  return (
    <div className="amarelo pedir-conversao" data-testid="conversao-item-pendente">
      <p className="sub">
        O SisChef marcou <b>UN DIFERE</b> neste item: a unidade da nota é diferente da do cadastro{unidade ? ` (${unidade})` : ''} e a conversão não está registrada.
      </p>
      <label>Quanto vale 1 unidade da nota{unidade ? ` em ${unidade}` : ' na unidade do produto no SisChef'}?
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0,000" value={texto} disabled={desabilitado || enviando}
          onChange={(e) => { setTexto(e.target.value); setErro('') }} />
      </label>
      <p className="sub">Ex.: 1 UN = 1 KG → digite 1. O robô digita esse número no SisChef ao lançar e confere a quantidade depois.</p>
      {invalida && (
        <p className="erro" data-testid="conversao-item-invalida">
          Número maior que zero, até {formatarConversao(CONVERSAO_MAXIMA)}, com até {CONVERSAO_CASAS} casas (vírgula ou ponto).
        </p>
      )}
      {conversao != null && <p className="sub" data-testid="conversao-item-eco">Vai gravar: 1 unidade da nota = {formatarConversao(conversao)}{unidade ? ` ${unidade}` : ''}</p>}
      <div className="acoes">
        <button type="button" className="botao" disabled={conversao == null || desabilitado || enviando} onClick={() => void guardar(conversao)}>
          {enviando ? 'Confirmando…' : 'Confirmar'}
        </button>
        {editando && <button type="button" className="link" disabled={enviando} onClick={() => { setEditando(false); setTexto('') }}>Cancelar</button>}
        {editando && <button type="button" className="link perigo" disabled={desabilitado || enviando} onClick={() => void guardar(null)}>Desfazer a conversão</button>}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
