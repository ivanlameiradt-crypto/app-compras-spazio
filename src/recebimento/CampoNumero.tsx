// Campo de quantidade digitada em português para a tela Receber (item 4 da análise de 07/11/2026; correção de 08/11/2026).
//
// O TEXTO digitado fica guardado à parte do número: a pessoa vê exatamente o que digitou; o número vai para a tela pai a cada tecla que forma
// um número (vazio vale 0; "2," vale 2 até chegar o resto). É quantidade, então sem vírgula o ponto é decimal ("2.500" da balança = 2,5 kg;
// ver lib/quantidade).
//  - texto que não é número ("20x"): o campo fica marcado (aria-invalid), mostra o aviso e a tela NÃO deixa registrar até a pessoa corrigir
//    (antes voltava ao último valor bom em silêncio, e o registro saía com o valor antigo);
//  - ao sair do campo, só o vazio volta a "0": o resto do texto fica como foi digitado ("2," continua "2,");
//  - se o valor mudar por outro motivo (botão "Não veio"), o texto acompanha; se ele só reflete o que a pessoa digitou, o texto não é tocado.
import { useEffect, useId, useState } from 'react'
import { lerQuantidadeBrDigitando } from '../lib/quantidade'

const formatar = (v: number): string => String(v).replace('.', ',')

/** O valor de fora passa por conversão e arredondamento (fardos ↔ unidades, 3 e 4 casas): diferença menor que isto é só arredondamento, não mudança. */
const TOLERANCIA = 0.0006

export default function CampoNumero({ valor, onMudar, onInvalido, unidade }: {
  valor: number; onMudar: (n: number) => void; onInvalido?: (invalido: boolean) => void; unidade?: string
}) {
  const [texto, setTexto] = useState(() => formatar(valor))
  const lido = lerQuantidadeBrDigitando(texto, unidade)
  const idAviso = useId()

  useEffect(() => {
    const atual = lerQuantidadeBrDigitando(texto, unidade)
    if (atual == null || Math.abs(atual - valor) > TOLERANCIA) setTexto(formatar(valor))
    // só quando o valor de fora muda: o texto é lido na hora, sem entrar na lista (senão cada tecla refaria o texto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  // a tela Receber bloqueia o Registrar enquanto algum campo não for número; ao desmontar (ex.: fechar a avaria), libera
  useEffect(() => {
    onInvalido?.(lido == null)
    return () => onInvalido?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lido])

  // ao sair, só o campo vazio volta a "0": texto que não é número continua marcado (e bloqueia o Registrar) até a pessoa corrigir
  const aoSair = () => { if (texto.trim() === '') setTexto('0') }

  return (
    <>
      <input type="text" inputMode="decimal" value={texto} aria-invalid={lido == null ? true : undefined}
        aria-describedby={lido == null ? idAviso : undefined}
        onChange={(e) => {
          const t = e.target.value
          setTexto(t)
          const n = lerQuantidadeBrDigitando(t, unidade)
          if (n != null) onMudar(n)
        }}
        onBlur={aoSair} />
      {lido == null && (
        <span id={idAviso} className="erro-campo" role="alert">Não entendi este número: use só números, vírgula ou ponto (ex.: 2,5)</span>
      )}
    </>
  )
}
