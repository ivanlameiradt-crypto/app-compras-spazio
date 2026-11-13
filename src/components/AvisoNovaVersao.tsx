import { aplicarNovaVersao, useNovaVersao } from '../lib/atualizacao'

/**
 * Faixa discreta "Tem uma versão nova do app." + botão Atualizar. Regra do dono (13/11/2026): o app NUNCA recarrega sozinho com a pessoa trabalhando
 * (ela pode estar digitando, lançando ou comprando): ele só avisa — ao voltar do fundo, com o app em uso e quando a internet volta — e a troca só acontece
 * quando a pessoa CLICA em Atualizar (a tela em que ela está se mantém). A única troca sem clique é na abertura do app (lib/atualizacao.ts), antes de digitar algo.
 * role="status": o leitor de tela avisa sem tirar a pessoa do lugar onde está.
 */
export default function AvisoNovaVersao() {
  const nova = useNovaVersao()
  if (!nova) return null
  return (
    <p className="faixa nova-versao" role="status" data-testid="aviso-nova-versao">
      <span>Tem uma versão nova do app.</span>
      <button type="button" className="link" onClick={() => void aplicarNovaVersao(nova)}>Atualizar</button>
    </p>
  )
}
