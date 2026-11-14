// "Tentar de novo" do cupom parado por falha PASSAGEIRA do robô (etapa 8 do inventário de 14/11/2026): o próprio texto do robô prova que nada foi criado no SisChef (ver motivoPassageiroDoCupom).
// Um botão só. O servidor (confirmar-cupom) é quem manda: ele confere de novo se o cupom está parado por esse motivo, se a soma fecha e se a compra não é repetida, e só então solta o cupom para o robô.
// Se ele recusa, o texto dele aparece aqui e nada muda. O Excluir de sempre continua no cartão.
import { useState } from 'react'
import type { RespostaConfirmacaoCupom } from '../lib/tipos'

export interface AcoesTentarDeNovo {
  tentar: (cupomId: string) => Promise<RespostaConfirmacaoCupom>
}

export interface PropsTentarDeNovoCupom {
  id: string
  acoes: AcoesTentarDeNovo
  /** O servidor aceitou e soltou o cupom: a tela de cima avisa e recarrega a lista. */
  aoSoltar: (r: RespostaConfirmacaoCupom) => void
}

export default function TentarDeNovoCupom({ id, acoes, aoSoltar }: PropsTentarDeNovoCupom) {
  const [tentando, setTentando] = useState(false)
  const [erro, setErro] = useState('')

  async function tentarDeNovo() {
    if (tentando) return
    setTentando(true); setErro('')
    try {
      aoSoltar(await acoes.tentar(id))
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não consegui tentar agora. Confira a internet e tente de novo.')
    } finally {
      setTentando(false)
    }
  }

  return (
    <div className="tentar-de-novo-cupom" data-testid="tentar-de-novo-cupom">
      <div className="acoes">
        <button type="button" className="botao" disabled={tentando} onClick={() => void tentarDeNovo()}>{tentando ? 'Enviando…' : 'Tentar de novo'}</button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
