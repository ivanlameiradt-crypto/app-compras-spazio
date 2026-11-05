// O aviso "Parece repetida" (E5, pedido do Ivan de 04/11/2026): já existe compra do mesmo fornecedor com o mesmo total (cupom, compra avulsa ou nota fiscal). O app SÓ avisa; quem decide é o Ivan, em
// dois botões: "É o mesmo: excluir este envio" (o Excluir que já existe, com o motivo "Repetido"; dá para desfazer) e "É outra compra" (o servidor grava a decisão e tira o aviso; se o aviso era o
// único motivo, o cupom vai para a fila e o robô lança; se sobra motivo, só anota e o Ivan segue pelos botões de sempre). O texto vem do servidor/robô, já em português simples.
import { useState } from 'react'
import * as api from '../lib/api'
import type { RespostaConfirmacaoCupom } from '../lib/tipos'
import ExcluirCupom from './ExcluirCupom'

export interface PropsAvisoRepetida {
  id: string
  /** A frase do aviso SEM o prefixo ("já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido N)."). */
  texto: string
  /** Há outro motivo além do aviso (itens sem produto, CONFIRMAR:): "É outra compra" só anota e o cupom segue pelos botões de sempre. */
  sobraMotivo: boolean
  rotulo: 'cupom' | 'compra avulsa'
  nome: string
  /** O servidor aceitou a decisão: a tela de cima recarrega a lista e conta o que aconteceu (foi para a fila, ou só anotou). */
  aoDecidir: (r: RespostaConfirmacaoCupom) => void
  /** Depois de excluir: a tela relê as listas. */
  aoExcluir: () => void
}

const capitalizar = (t: string): string => (t === '' ? t : t.charAt(0).toUpperCase() + t.slice(1))

export default function AvisoRepetida({ id, texto, sobraMotivo, rotulo, nome, aoDecidir, aoExcluir }: PropsAvisoRepetida) {
  const [decidindo, setDecidindo] = useState(false)
  const [erro, setErro] = useState('')

  async function outraCompra() {
    if (decidindo) return
    setDecidindo(true); setErro('')
    try {
      aoDecidir(await api.confirmarOutraCompra(id))
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não consegui anotar agora. Confira a internet e tente de novo.')
    } finally {
      setDecidindo(false)
    }
  }

  return (
    <div className="amarelo aviso-repetida" data-testid="aviso-repetida" role="group" aria-label="Parece repetida">
      <p><b>Parece repetida.</b> {capitalizar(texto)}</p>
      <p className="sub">Se é a MESMA compra, exclua este envio (dá para desfazer). Se é OUTRA compra de verdade, diga que é outra compra.</p>
      <div className="acoes">
        <ExcluirCupom id={id} nome={nome} rotulo={rotulo} aoExcluir={aoExcluir} rotuloAbrir="É o mesmo: excluir este envio" motivoInicial="Repetido" />
        <button type="button" className="botao" disabled={decidindo} onClick={() => void outraCompra()}>
          {decidindo ? 'Anotando…' : sobraMotivo ? 'É outra compra: seguir com o cupom' : 'É outra compra: lançar mesmo assim'}
        </button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
