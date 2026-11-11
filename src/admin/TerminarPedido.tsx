import { useState } from 'react'
import * as api from '../lib/api'
import type { NotaSefazLista } from '../lib/tipos'
import { podeTerminarPedido } from './notaSefazRegras'

/**
 * "Terminar pedido" (11/11/2026): a nota ficou pela metade (o pedido existe no SisChef, a compra não foi finalizada) e o robô sabe
 * continuar dali. Um toque pede ao robô; a nota segue "pela metade" até ele terminar (aí vira lançada) ou explicar por que parou.
 * Só aparece no caso que o robô sabe terminar sozinho (podeTerminarPedido); nos outros a tela continua mandando conferir no SisChef.
 */
export default function TerminarPedido({ nota, ocupado, aoPedir }: { nota: NotaSefazLista; ocupado: boolean; aoPedir: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [pedido, setPedido] = useState(false)
  const [erro, setErro] = useState('')
  if (!podeTerminarPedido(nota)) return null

  async function pedir() {
    if (enviando || pedido) return
    setEnviando(true)
    setErro('')
    try {
      await api.terminarPedidoDaNota(nota.chave)
      setPedido(true)
      aoPedir()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui chamar o robô agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="terminar-pedido" data-testid="terminar-pedido">
      {pedido ? (
        <p className="ok" role="status">
          Pedi ao robô para terminar este pedido. Leva de 2 a 3 minutos: depois toque em Atualizar. Não lance esta nota de novo.
        </p>
      ) : (
        <>
          <p className="sub">O robô consegue continuar de onde parou, sem criar outro pedido. Ele confere o pedido no SisChef antes de mexer.</p>
          <button type="button" className="botao" disabled={enviando || ocupado} onClick={() => void pedir()}>
            {enviando ? 'Chamando o robô…' : 'Terminar pedido'}
          </button>
          {ocupado && <p className="sub">Aguarde o robô terminar a outra nota.</p>}
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
