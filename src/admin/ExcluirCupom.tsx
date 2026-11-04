// "Excluir" de um envio do cupom ou da compra avulsa (pedido do Ivan, 03/11/2026: tirar da lista o que ele não quer lançar — devolvido, repetido, enviado por engano).
// Dois toques, como o da nota: o 1º só pergunta (e deixa escrever o motivo); o 2º manda ao banco (cupom_excluir). O envio sai da lista e o robô nunca o lança; NADA muda no SisChef;
// dá para desfazer na lista de excluídos. Quem decide se o botão aparece é `podeExcluirCupom` (cupomRegras); o banco confere tudo de novo.
import { useState } from 'react'
import * as api from '../lib/api'
import { motivoEscrito } from './cupomRegras'

const TEXTOS = {
  cupom: {
    abrir: 'Excluir cupom',
    pergunta: 'Excluir este cupom',
    sub: 'Ele sai de “Últimos envios” e o robô não o lança. Não muda nada no SisChef. Dá para desfazer em “Cupons excluídos”.',
  },
  'compra avulsa': {
    abrir: 'Excluir compra',
    pergunta: 'Excluir esta compra avulsa',
    sub: 'Ela sai de “Últimas compras avulsas” e o robô não a lança. Não muda nada no SisChef. Dá para desfazer em “Compras excluídas”.',
  },
} as const

export interface PropsExcluirCupom {
  id: string
  /** Nome do fornecedor para a pergunta ("Excluir este cupom de ATACADAO?"); vazio = sem "de …". */
  nome: string
  rotulo: 'cupom' | 'compra avulsa'
  /** Depois de excluir: a tela relê as listas. */
  aoExcluir: () => void
}

export default function ExcluirCupom({ id, nome, rotulo, aoExcluir }: PropsExcluirCupom) {
  const t = TEXTOS[rotulo]
  const [perguntando, setPerguntando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState('')

  async function excluir() {
    if (excluindo) return
    setExcluindo(true); setErro('')
    try {
      await api.excluirCupom(id, motivoEscrito(motivo))
      aoExcluir()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui excluir agora. Tente de novo.')
      setPerguntando(false) // o texto escrito fica para tentar de novo; só o "Cancelar" o limpa
    } finally {
      setExcluindo(false)
    }
  }

  if (!perguntando) {
    return (
      <div>
        <button type="button" className="link perigo" data-testid="excluir-cupom" onClick={() => { setErro(''); setPerguntando(true) }}>{t.abrir}</button>
        {erro && <p className="erro" role="alert">{erro}</p>}
      </div>
    )
  }
  return (
    <div className="bloco-envio" data-testid="confirmar-exclusao-cupom">
      <p>{t.pergunta}{nome && ` de ${nome}`}?</p>
      <p className="sub">{t.sub}</p>
      <label>Motivo (opcional)
        <input type="text" value={motivo} maxLength={200} placeholder="ex.: devolvido" disabled={excluindo}
          data-testid="motivo-exclusao-cupom" onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <div className="acoes">
        <button type="button" className="botao perigo" disabled={excluindo} onClick={() => void excluir()}>
          {excluindo ? 'Excluindo…' : 'Excluir'}
        </button>
        <button type="button" className="botao secundario" disabled={excluindo} onClick={() => { setPerguntando(false); setMotivo('') }}>Cancelar</button>
      </div>
    </div>
  )
}
