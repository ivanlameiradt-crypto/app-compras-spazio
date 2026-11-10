import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LogoComprar } from '../components/marca/Comprar'
import { Icone } from '../components/Icones'
import { aparelhoAtual, useInstalacao, type Aparelho } from '../lib/instalar'

type Chave = 'iphone' | 'android' | 'computador'

const CARTOES: { chave: Chave; titulo: string; passos: ReactNode[] }[] = [
  {
    chave: 'iphone',
    titulo: 'iPhone ou iPad',
    passos: [
      <>Abra este endereço no <b>Safari</b>.</>,
      <>Toque em <b>Compartilhar</b> (um quadrado com uma seta para cima).</>,
      <>Escolha <b>Adicionar à Tela de Início</b>.</>,
      <>Toque em <b>Adicionar</b>. O Comprar ganha um ícone no aparelho.</>,
    ],
  },
  {
    chave: 'android',
    titulo: 'Android',
    passos: [
      <>Abra este endereço no <b>Chrome</b>.</>,
      <>Toque nos <b>três pontinhos</b>, no canto de cima da tela.</>,
      <>Toque em <b>Instalar app</b> (em alguns aparelhos aparece como <b>Adicionar à tela inicial</b>).</>,
      <>Toque em <b>Instalar</b>. O Comprar ganha um ícone no aparelho.</>,
    ],
  },
  {
    chave: 'computador',
    titulo: 'Computador ou notebook',
    passos: [
      <>Abra este endereço no <b>Chrome</b> ou no <b>Edge</b>.</>,
      <>Clique no <b>ícone de instalar</b>, no fim da barra do endereço (um monitor com uma seta).</>,
      <>Clique em <b>Instalar</b>. O Comprar abre numa janela própria e ganha um atalho.</>,
      <>Se o ícone não aparecer, abra o menu dos três pontinhos e procure <b>Instalar Comprar</b>.</>,
    ],
  },
]

/** Endereço do app sem a parte depois do "#" (o que o aparelho precisa abrir para instalar). */
const enderecoDoApp = () => (typeof window === 'undefined' ? '' : window.location.href.split('#')[0])

/** Tela "Instalar o app": aberta antes do login (link na tela de entrar) e depois dele. `aparelho` e `endereco` existem para os testes. */
export default function Instalar({ aparelho = aparelhoAtual(), endereco = enderecoDoApp() }: { aparelho?: Aparelho; endereco?: string }) {
  const { podeInstalar, instalar } = useInstalacao()
  const destaque: Chave | null = aparelho === 'iphone' || aparelho === 'android' || aparelho === 'computador' ? aparelho : null
  return (
    <main className="instalar">
      <LogoComprar altura={40} />
      <h1>Instalar o app</h1>
      <p className="instalar-intro">
        O Comprar funciona em celular, tablet, notebook e computador. Instalado, ele abre pelo ícone, como qualquer aplicativo.
      </p>

      {aparelho === 'instalado' && (
        <p className="selo-aviso ok" role="status"><Icone nome="check" tamanho={20} /> O Comprar já está instalado neste aparelho.</p>
      )}
      {aparelho === 'dentro_de_outro_app' && (
        <p className="selo-aviso atencao" role="status">
          <Icone nome="alerta" tamanho={20} />
          <span>
            Você abriu este link dentro de outro aplicativo (WhatsApp, Instagram…), que não instala. Toque nos três pontinhos e
            escolha <b>Abrir no navegador</b>. Depois, siga os passos abaixo.
          </span>
        </p>
      )}
      {podeInstalar && <button type="button" className="botao grande" onClick={() => void instalar()}>Instalar agora</button>}

      {CARTOES.map((c) => (
        <details key={c.chave} className="instalar-cartao" open={c.chave === destaque} aria-label={c.titulo}>
          <summary>
            <span className="instalar-titulo">{c.titulo}</span>
            {c.chave === destaque && <span className="pill ok">Este aparelho</span>}
          </summary>
          <ol className="passos">
            {c.passos.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        </details>
      ))}

      <section className="instalar-cartao" aria-label="Endereço do app">
        <h2>Endereço do app</h2>
        <p className="endereco">{endereco}</p>
      </section>

      <Link to="/" className="link sublinhado">Voltar</Link>
    </main>
  )
}
