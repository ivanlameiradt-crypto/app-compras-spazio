// Campo de número digitado em português para a tela Receber (item 4 da análise de 07/11/2026).
//
// O campo antigo mostrava `String(número)`: ao digitar "2," o número continuava 2 e o campo era redesenhado como "2", a vírgula sumia e o resultado
// era 25 (ou 75 para "7,5"). Aqui o TEXTO digitado fica guardado à parte do número: a pessoa vê exatamente o que digitou; o número vai para a tela
// pai a cada tecla que forma um número (vazio vale 0; "2," vale 2 até chegar o resto).
//  - texto que não é número ("20x"): o campo fica marcado (aria-invalid) e o valor de antes continua valendo; ao sair do campo, volta ao último valor bom;
//  - ao sair do campo, o texto é refeito a partir do valor ("" vira "0");
//  - se o valor mudar por outro motivo (botão "Não veio"), o texto acompanha; se ele só reflete o que a pessoa digitou, o texto não é tocado.
import { useEffect, useState } from 'react'
import { lerNumeroBrDigitando } from '../lib/numeroBr'

const formatar = (v: number): string => String(v).replace('.', ',')

/** O valor de fora passa por conversão e arredondamento (fardos ↔ unidades, 3 e 4 casas): diferença menor que isto é só arredondamento, não mudança. */
const TOLERANCIA = 0.0006

export default function CampoNumero({ valor, onMudar }: { valor: number; onMudar: (n: number) => void }) {
  const [texto, setTexto] = useState(() => formatar(valor))
  const lido = lerNumeroBrDigitando(texto)

  useEffect(() => {
    const atual = lerNumeroBrDigitando(texto)
    if (atual == null || Math.abs(atual - valor) > TOLERANCIA) setTexto(formatar(valor))
    // só quando o valor de fora muda: o texto é lido na hora, sem entrar na lista (senão cada tecla refaria o texto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <input type="text" inputMode="decimal" value={texto} aria-invalid={lido == null ? true : undefined}
      onChange={(e) => {
        const t = e.target.value
        setTexto(t)
        const n = lerNumeroBrDigitando(t)
        if (n != null) onMudar(n)
      }}
      onBlur={() => setTexto(formatar(valor))} />
  )
}
