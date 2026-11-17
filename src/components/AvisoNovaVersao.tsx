import { useEffect, useState, type KeyboardEvent } from 'react'
import { aplicarNovaVersao, useNovaVersao } from '../lib/atualizacao'
import { useTemNaoEnviado } from '../lib/naoEnviado'

/**
 * Janela NO MEIO DA TELA, OBRIGATÓRIA: "Tem uma versão nova do app." com o botão "Atualizar agora". Pedido do Ivan (16/11/2026), no mesmo formato do app Delivery
 * (commit 19a5209, 14/11) e do Tiquei: os apps ficam abertos o dia todo nos computadores da loja e da produção e a faixa do topo passava despercebida; agora a
 * pessoa só continua depois de tocar em Atualizar. Cobre a tela inteira com fundo escuro e não tem como fechar: sem "Depois", Esc não fecha, Tab não sai do botão,
 * clicar fora não faz nada e a página de trás não rola.
 *
 * Regra do dono (13/11/2026) que continua valendo: o app NUNCA recarrega sozinho. Só o toque em "Atualizar agora" troca a versão (lib/atualizacao.ts), e a tela
 * em que a pessoa está se mantém. A única troca sem toque é a da abertura do app, como antes.
 *
 * Única diferença do modelo: com dados digitados e ainda não enviados (compra avulsa, correção de cupom: lib/naoEnviado.ts) a janela ESPERA e aparece sozinha
 * assim que a pessoa envia ou limpa, porque Atualizar joga fora o que foi digitado e, sem "Depois", ela não teria como terminar.
 */
export default function AvisoNovaVersao() {
  const nova = useNovaVersao()
  const digitando = useTemNaoEnviado()
  const [atualizando, setAtualizando] = useState(false)
  const visivel = nova !== null && !digitando

  // Enquanto a janela está na tela, a página de trás não rola.
  useEffect(() => {
    if (!visivel) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = antes }
  }, [visivel])

  if (nova === null || digitando) return null

  // Só existe um botão: Tab fica nele e Esc não fecha nada.
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' || e.key === 'Escape') e.preventDefault()
  }
  const atualizar = () => {
    if (atualizando) return
    setAtualizando(true)
    void aplicarNovaVersao(nova)
  }

  return (
    <div className="aviso-versao" data-testid="aviso-nova-versao" onMouseDown={(e) => e.preventDefault()}>
      <div
        className="aviso-versao-cartao"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aviso-versao-titulo"
        aria-describedby="aviso-versao-texto"
        onKeyDown={aoTeclar}
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="aviso-versao-icone">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
        <h2 id="aviso-versao-titulo">Tem uma versão nova do app.</h2>
        <p id="aviso-versao-texto">Toque em Atualizar para continuar usando.</p>
        <button type="button" className="botao" autoFocus disabled={atualizando} onClick={atualizar}>
          {atualizando ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      </div>
    </div>
  )
}
