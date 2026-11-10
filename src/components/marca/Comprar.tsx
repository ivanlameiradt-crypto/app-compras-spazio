// Marca do Comprar (aprovada pelo Ivan em 10/11/2026): a etiqueta com o bico da Spazio, o carrinho dentro e o nome
// desenhado em traço único de ponta redonda (mesma régua do "Tiquei"). Cores do manual da Spazio: amarelo #FFD201 e preto #231F20.
// O nome é desenho (não depende de fonte instalada).
export const AMARELO = '#FFD201'
export const PRETO = '#231F20'

const ETIQUETA = 'M8 42 Q8 32 16.9 27.5 L51.1 10.5 Q60 6 68.9 10.5 L103.1 27.5 Q112 32 112 42 V108 Q112 124 96 124 H24 Q8 124 8 108 Z M66.5 30 a6.5 6.5 0 1 0 -13 0 a6.5 6.5 0 1 0 13 0 Z'
const CARRINHO = 'M26 57 H37 L45 93 H81 L89 68 H40'
const LETRAS = [
  'M95 105 a34 34 0 0 0 -34 -34 h-16 a34 34 0 0 0 -34 34 v50 a34 34 0 0 0 34 34 h16 a34 34 0 0 0 34 -34', // C
  'M199 139 a28 28 0 0 0 -28 -28 h-8 a28 28 0 0 0 -28 28 v22 a28 28 0 0 0 28 28 h8 a28 28 0 0 0 28 -28 Z', // o
  'M239 111 V189 M239 137 a26 26 0 0 1 26 -26 a26 26 0 0 1 26 26 V189 M291 137 a26 26 0 0 1 26 -26 a26 26 0 0 1 26 26 V189', // m
  'M383 111 V240 M383 139 a28 28 0 0 1 28 -28 h8 a28 28 0 0 1 28 28 v22 a28 28 0 0 1 -28 28 h-8 a28 28 0 0 1 -28 -28', // p
  'M487 111 V189 M487 145 a34 34 0 0 1 34 -34 h6', // r
  'M631 139 a28 28 0 0 0 -28 -28 h-8 a28 28 0 0 0 -28 28 v22 a28 28 0 0 0 28 28 h8 a28 28 0 0 0 28 -28 M631 111 V189', // a
  'M671 111 V189 M671 145 a34 34 0 0 1 34 -34 h6', // r
]

function Etiqueta({ etiqueta, sinal }: { etiqueta: string; sinal: string }) {
  return (
    <>
      <path fill={etiqueta} fillRule="evenodd" d={ETIQUETA} />
      <path fill="none" stroke={sinal} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" d={CARRINHO} />
      <circle cx="52" cy="106" r="7" fill={sinal} />
      <circle cx="76" cy="106" r="7" fill={sinal} />
    </>
  )
}

function Letras({ cor }: { cor: string }) {
  return (
    <g fill="none" stroke={cor} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
      {LETRAS.map((d) => <path key={d} d={d} />)}
    </g>
  )
}

/** Só o símbolo (a etiqueta com o carrinho). Enfeite: quem lê a tela ouve o nome ao lado. `tamanho` é a altura. */
export function SimboloComprar({ tamanho = 32, etiqueta = AMARELO, sinal = PRETO }: { tamanho?: number; etiqueta?: string; sinal?: string }) {
  return (
    <svg width={(tamanho * 120) / 132} height={tamanho} viewBox="0 0 120 132" aria-hidden="true" focusable="false" className="marca-svg">
      <Etiqueta etiqueta={etiqueta} sinal={sinal} />
    </svg>
  )
}

/** Só o nome "Comprar". */
export function NomeComprar({ altura = 22, cor = PRETO }: { altura?: number; cor?: string }) {
  return (
    <svg width={(altura * 722) / 212} height={altura} viewBox="0 48 722 212" role="img" aria-label="Comprar" focusable="false" className="marca-svg">
      <Letras cor={cor} />
    </svg>
  )
}

/** Símbolo e nome lado a lado. Em fundo preto: `cor="#FFFFFF"`. */
export function LogoComprar({ altura = 40, cor = PRETO, etiqueta = AMARELO, sinal = PRETO }: { altura?: number; cor?: string; etiqueta?: string; sinal?: string }) {
  return (
    <svg width={(altura * 923) / 235} height={altura} viewBox="0 30 923 235" role="img" aria-label="Comprar" focusable="false" className="marca-svg">
      <g transform="translate(0 37.9) scale(1.356)"><Etiqueta etiqueta={etiqueta} sinal={sinal} /></g>
      <g transform="translate(201 0)"><Letras cor={cor} /></g>
    </svg>
  )
}
