import type { ReactNode } from 'react'

// Ícones de desenho em traço de ponta redonda (padrão do Tiquei, aprovado em 10/11/2026). Nunca emoji.
// Cada um é desenhado numa grade de 24 x 24 e herda a cor do texto (currentColor).
const CAMINHOS = {
  lista: <><path d="M9 4h6v3H9z" /><path d="M7 5.5H5.5v15h13v-15H17" /><path d="M8.5 12h7M8.5 16h5" /></>,
  cotacoes: <><path d="M4 12.5V5h7.5L20 13.5 13.5 20z" /><circle cx="8.6" cy="8.6" r="1.2" /></>,
  receber: <><path d="M4 8l8-4 8 4v9l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v9" /></>,
  lancamentos: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></>,
  resumo: <path d="M5 20V11M12 20V5M19 20v-6" />,
  economia: <><circle cx="12" cy="12" r="8.5" /><path d="M14.6 9.6c-.5-.9-1.4-1.4-2.6-1.4-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.3 5 3.8 0 1.1-1 1.8-2.6 1.8-1.2 0-2.2-.5-2.7-1.5" /><path d="M12 6.4v1.8M12 15.8v1.8" /></>,
  cadastros: <path d="M4 6.5h6l2 2.5h8V19H4z" />,
  carrinho: <><path d="M3.5 5h2.7l2.2 10.5h9.1L19.5 8H7.2" /><circle cx="10" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  sacola: <><path d="M5.5 8.5h13l-1 11.5h-11z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" /></>,
  cupom: <><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" /><path d="M9 8.5h6M9 12h6" /></>,
  fiscal: <><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /><path d="M10 13h5M10 16.5h5" /></>,
  foto: <><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></>,
  clip: <path d="M20 11.5l-7.6 7.6a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3" />,
  check: <path d="M5 12.5 10 17.5 19 7.5" />,
  relogio: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3 2" /></>,
  alerta: <><path d="M12 4 21 19H3z" /><path d="M12 10v4" /><path d="M12 16.6v.4" /></>,
  esq: <path d="M15 5l-7 7 7 7" />,
  dir: <path d="M9 5l7 7-7 7" />,
  atualizar: <><path d="M20 11a8 8 0 0 0-14.5-4.4L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 14.5 4.4L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>,
  compartilhar: <><path d="M12 15V4M8 7.5 12 3.5l4 4" /><path d="M6 11H5v9h14v-9h-1" /></>,
} satisfies Record<string, ReactNode>

export type NomeIcone = keyof typeof CAMINHOS

/** Enfeite ao lado de uma palavra: quem lê a tela ouve só a palavra. `tamanho` em pixels. */
export function Icone({ nome, tamanho = 24, className }: { nome: NomeIcone; tamanho?: number; className?: string }) {
  return (
    <svg
      className={className ? `icone ${className}` : 'icone'}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icone={nome}
    >
      {CAMINHOS[nome]}
    </svg>
  )
}
