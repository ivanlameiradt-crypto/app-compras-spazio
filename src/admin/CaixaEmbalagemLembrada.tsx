import { useState } from 'react'
import { formatarConversao, formatarQuantidade, rotuloUnidade } from './associacaoRegras'
import { entraComALembrada, textoVisto, type SituacaoDaMemoria } from './embalagemLembrada'
import type { ItemNotaSefaz, NfeAprendizado } from '../lib/tipos'

/**
 * O que o robô LEMBRA para um item que já vem associado do SisChef (memória de embalagem das notas fiscais, pedido do Ivan, 29/10/2026). O robô aprende sozinho, depois de uma nota lançada,
 * quantas unidades do produto vêm em 1 unidade da nota (ex.: "6 UN" na nota = 6 fardos de 6 latas, produto em lata) e aplica sozinho na nota seguinte. Aqui o Ivan VÊ isso antes de lançar e
 * pode corrigir ou esquecer. Três jeitos, escolhidos por `situacaoDaMemoria` (regras puras em embalagemLembrada.ts):
 *  - 'aplica'           : "O robô lembra: 1 UN da nota = 12 UN no estoque (…). Ao lançar ele aplica sozinho: entram 120 UN." com Corrigir (abre o Editar já com o número) e Esquecer (pergunta no
 *                         próprio lugar, sem confirm() do navegador);
 *  - 'outro-produto'    : aviso amarelo — o item está ligado a OUTRO produto e o robô vai parar e mandar conferir (não há botão de usar o número);
 *  - 'vale-o-informado' : o Ivan informou outro número nesta nota; só uma linha pequena, porque o número dele vence a memória.
 * Quem grava a decisão do Ivan é a caixa Editar (ConversaoItemAssociado); aqui só se mostra, se corrige (aoCorrigir) e se esquece (esquecer, que lança Error com texto claro se falhar).
 */
export function EmbalagemLembradaDoItem({ item, lembrada, situacao, desabilitado, aoCorrigir, esquecer }: {
  item: ItemNotaSefaz
  lembrada: NfeAprendizado
  situacao: SituacaoDaMemoria
  /** O robô está lançando a nota (ou ela ficou pela metade): o Editar também fica apagado, e aqui Corrigir e Esquecer acompanham. */
  desabilitado: boolean
  /** Corrigir: abre o Editar já com o número lembrado. */
  aoCorrigir: (fator: number) => void
  /** Esquecer: apaga a linha lembrada. Sem esta função o botão não aparece. */
  esquecer?: (linha: NfeAprendizado) => Promise<void>
}) {
  const [confirmando, setConfirmando] = useState(false) // aberta a pergunta "Esquecer este número?"
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const u = rotuloUnidade(item.unidade_sischef)
  const numero = formatarConversao(lembrada.fator)

  if (situacao === 'vale-o-informado') {
    return <p className="sub embalagem-aviso" data-testid="embalagem-lembrada-vale-o-seu">Nesta nota vale o número que você informou.</p>
  }
  if (situacao === 'outro-produto') {
    const nome = (lembrada.produto_nome ?? '').trim() || `produto ${lembrada.produto_id}`
    return (
      <div className="amarelo embalagem-aviso" role="status" data-testid="embalagem-lembrada-outro-produto">
        {`Eu lembrava este código como ${nome} (1 ${u} = ${numero}). Este item está ligado a outro produto: o robô vai parar e pedir para você conferir.`}
      </div>
    )
  }

  const entra = entraComALembrada(item, lembrada)
  async function esquecerAgora() {
    if (enviando || !esquecer) return
    setEnviando(true); setErro('')
    try {
      await esquecer(lembrada)
      setConfirmando(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui esquecer agora. Confira a internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="embalagem-lembrada" role="group" aria-label="O que o robô lembra deste item" data-testid="embalagem-lembrada">
      <p>
        {`O robô lembra: 1 ${u} da nota = ${numero} ${u} no estoque (${textoVisto(lembrada)}). Ao lançar ele aplica sozinho`}
        {entra != null ? <>: entram <b>{`${formatarQuantidade(entra)} ${u}`}</b></> : null}.
      </p>
      {confirmando ? (
        <div className="embalagem-confirmar" role="group" aria-label="Esquecer o que o robô lembra" data-testid="embalagem-esquecer-confirmar">
          <p>Esquecer este número? O robô volta a não multiplicar este código.</p>
          <div className="acoes">
            <button type="button" className="botao perigo" disabled={enviando} onClick={() => void esquecerAgora()}>{enviando ? 'Esquecendo…' : 'Sim, esquecer'}</button>
            <button type="button" className="botao secundario" disabled={enviando} onClick={() => { setConfirmando(false); setErro('') }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="acoes">
          <button type="button" className="editar-item" disabled={desabilitado} onClick={() => aoCorrigir(lembrada.fator)}>Corrigir</button>
          {esquecer && <button type="button" className="editar-item" disabled={desabilitado} onClick={() => { setErro(''); setConfirmando(true) }}>Esquecer</button>}
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
