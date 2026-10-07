import { aplicarNovaVersao, useNovaVersao } from '../lib/atualizacao'

/**
 * Faixa "Há uma versão nova do app": aparece quando o app, EM USO, descobre que saiu versão nova (a troca automática só acontece na abertura e ao voltar do
 * fundo, para não apagar o que o Ivan está digitando). Tocar em Atualizar agora troca na hora, mantendo a tela em que ele está.
 */
export default function AvisoNovaVersao() {
  const nova = useNovaVersao()
  if (!nova) return null
  return (
    <p className="faixa nova-versao" role="status" data-testid="aviso-nova-versao">
      Há uma versão nova do app.{' '}
      <button type="button" className="link" onClick={() => void aplicarNovaVersao(nova)}>Atualizar agora</button>
    </p>
  )
}
