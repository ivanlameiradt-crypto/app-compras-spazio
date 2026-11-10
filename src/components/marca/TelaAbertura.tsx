import { NomeComprar, SimboloComprar, AMARELO, PRETO } from './Comprar'

/** Tela de abertura (amarela, com o selo da Spazio em baixo). Aparece enquanto o app confere o acesso.
 *  A mesma tela existe sem programa em index.html, para aparecer na hora, antes de o app carregar. */
export default function TelaAbertura({ mensagem = 'Carregando…' }: { mensagem?: string }) {
  return (
    <div className="abertura" role="status" aria-live="polite">
      <div className="abertura-centro">
        <SimboloComprar tamanho={148} etiqueta={PRETO} sinal={AMARELO} />
        <NomeComprar altura={98} cor={PRETO} />
        <p className="abertura-mensagem">{mensagem}</p>
      </div>
      <div className="abertura-rodape">
        <p>Spazio Gourmet e Kūkan Sushi</p>
        <p>Lançamento de compra e estoque</p>
      </div>
    </div>
  )
}
