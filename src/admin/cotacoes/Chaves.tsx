// "Ligar e desligar" a leitura com IA (B.8). Nasce aqui (com o E2 adiado). O Ivan liga/desliga; ligar só funciona
// depois que a avaliação com respostas reais passou (liberada_em gravado por SQL, com o OK do Ivan). O banco não guarda
// a chave da Anthropic; este cartão não diz nada sobre ela.
import { useCallback, useEffect, useState } from 'react'
import * as api from '../../lib/api'
import { mensagemDeErro } from '../../lib/regras'
import type { IaStatus } from '../../lib/tipos'

export default function Chaves() {
  const [status, setStatus] = useState<IaStatus | null | undefined>(undefined) // undefined = carregando; null = função não existe
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try { setStatus(await api.iaStatus()) } catch (e) { setErro(mensagemDeErro(e)) }
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  async function ligar(ligada: boolean) {
    setOcupado(true); setErro('')
    try { setStatus(await api.iaLigar(ligada)) } catch (e) { setErro(mensagemDeErro(e)) } finally { setOcupado(false) }
  }

  if (status === undefined || status === null) return null // sem a migration da IA no banco, o cartão não aparece

  const u = status.uso
  const linha = !status.liberada
    ? 'Ainda não liberada (falta a avaliação com respostas reais)'
    : status.ligada
      ? `Ligada · hoje ${u.hoje} de ${u.limite_dia} · mês ${u.mes} de ${u.limite_mes} · ≈ US$ ${u.custo_mes_usd.toFixed(2)}`
      : 'Desligada'

  return (
    <div className="cartao chaves-ia" data-testid="chaves-ia">
      <div className="nome">Leitura com IA</div>
      <div className="sub" data-testid="chaves-linha">{linha}</div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes">
        {status.ligada
          ? <button className="botao secundario" disabled={ocupado} onClick={() => void ligar(false)}>Desligar</button>
          : <button className="botao secundario" disabled={ocupado || !status.liberada} onClick={() => void ligar(true)}>Ligar</button>}
      </div>
    </div>
  )
}
