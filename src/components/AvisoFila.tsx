import { useEffect, useState } from 'react'
import { errosDaFila, limparErros, ouvir, pendentes, processar, reenfileirarErros, type ErroFila } from '../lib/fila'
import { executarOp } from '../lib/api'

export default function AvisoFila() {
  const [n, setN] = useState(0)
  const [erros, setErros] = useState<ErroFila[]>([])
  useEffect(() => {
    let vivo = true
    const atualizar = async () => {
      const [p, e] = await Promise.all([pendentes(), errosDaFila()])
      if (vivo) { setN(p.length); setErros(e) }
    }
    const tentar = () => { processar(executarOp).catch(() => undefined).finally(atualizar) }
    const parar = ouvir(() => { atualizar() })
    tentar()
    window.addEventListener('online', tentar)
    const t = setInterval(tentar, 30000)
    return () => { vivo = false; parar(); window.removeEventListener('online', tentar); clearInterval(t) }
  }, [])
  if (n === 0 && erros.length === 0) return null
  async function tentarDeNovo() {
    await reenfileirarErros()
    await processar(executarOp).catch(() => undefined)
  }
  return (
    <div className="faixa">
      {n > 0 && <p>{n} {n === 1 ? 'item aguardando' : 'itens aguardando'} envio — sobe sozinho quando a internet voltar.</p>}
      {erros.map((e, i) => <p key={i} className="erro">Não foi possível registrar: {e.mensagem}</p>)}
      {erros.length > 0 && (
        <div className="linha">
          <button className="botao" onClick={tentarDeNovo}>Tentar de novo</button>
          <button className="botao secundario" onClick={() => limparErros()}>OK</button>
        </div>
      )}
    </div>
  )
}
