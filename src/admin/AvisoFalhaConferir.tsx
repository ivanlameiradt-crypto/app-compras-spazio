// O aviso "Conferência de compra repetida" (E5, ajuste 2 da revisão do código, 05/11/2026): o robô NÃO conseguiu conferir se esta compra já foi lançada (falha passageira do banco; nada foi feito no SisChef).
// Um botão só, "Tentar de novo": o servidor confere DE NOVO e, não achando compra igual, solta o cupom para o robô lançar. Achando, o cartão passa a mostrar o aviso "Parece repetida" com os dois botões de
// sempre, e a decisão é do Ivan. O botão NUNCA lança sem conferir: se a conferência falha de novo, o servidor recusa e o texto dele aparece aqui. O Excluir de sempre continua no cartão.
import { useState } from 'react'
import * as api from '../lib/api'
import type { RespostaConfirmacaoCupom } from '../lib/tipos'
import { REPETIDA_PREFIXO, ehErroRepetida } from './cupomRegras'

export interface PropsAvisoFalhaConferir {
  id: string
  /** A frase do robô SEM o prefixo ("não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef)."). */
  texto: string
  /** O servidor conferiu de novo, não achou compra igual e soltou o cupom: a tela de cima avisa e recarrega a lista. */
  aoSoltar: (r: RespostaConfirmacaoCupom) => void
  /** O servidor achou compra igual e gravou o aviso no cartão: a tela de cima relê a lista. */
  aoRecarregar: () => void
}

const capitalizar = (t: string): string => (t === '' ? t : t.charAt(0).toUpperCase() + t.slice(1))

export default function AvisoFalhaConferir({ id, texto, aoSoltar, aoRecarregar }: PropsAvisoFalhaConferir) {
  const [tentando, setTentando] = useState(false)
  const [erro, setErro] = useState('')

  async function tentarDeNovo() {
    if (tentando) return
    setTentando(true); setErro('')
    try {
      aoSoltar(await api.tentarConferirDeNovo(id))
    } catch (e) {
      if (ehErroRepetida(e)) {
        // achou compra igual: o servidor grava o aviso no cartão (a lista recarregada o mostra); se a gravação falhou, a frase fica aqui e outro toque tenta gravar de novo
        setErro(`Esta compra parece repetida. ${capitalizar(e.message.slice(REPETIDA_PREFIXO.length).trim())} Toque em “Tentar de novo” para eu mostrar os botões de decisão.`)
        aoRecarregar()
      } else {
        setErro(e instanceof Error && e.message ? e.message : 'Não consegui tentar agora. Confira a internet e tente de novo.')
      }
    } finally {
      setTentando(false)
    }
  }

  return (
    <div className="amarelo aviso-falha-conferir" data-testid="aviso-falha-conferir" role="group" aria-label="Não consegui conferir">
      <p><b>Conferência de compra repetida.</b> {capitalizar(texto)}</p>
      <p className="sub">Toque em “Tentar de novo”: eu confiro de novo e, se não houver compra igual, o robô lança. Se você sabe que é a mesma compra, exclua este envio (dá para desfazer).</p>
      <div className="acoes">
        <button type="button" className="botao" disabled={tentando} onClick={() => void tentarDeNovo()}>{tentando ? 'Conferindo…' : 'Tentar de novo'}</button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
