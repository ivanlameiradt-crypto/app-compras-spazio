import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icone } from './Icones'

/**
 * Aviso de erro do manual visual (§6): quando uma tela quebra ao ser desenhada, em vez de ficar tudo branco aparece a faixa vermelha com desenho,
 * uma frase simples e o botão "Tentar de novo", que recarrega a tela. Revisão final de 25/11/2026.
 * Só aparência: não muda o que tela nenhuma faz; se nada quebra, esta peça não aparece.
 * `chave` (a rota atual): trocar de tela pelo menu limpa o aviso, para as outras telas continuarem abrindo.
 */
export default class BarreiraDeErro extends Component<{ chave?: string; children: ReactNode }, { quebrou: boolean; chave?: string }> {
  state: { quebrou: boolean; chave?: string } = { quebrou: false, chave: this.props.chave }

  static getDerivedStateFromError() {
    return { quebrou: true }
  }

  static getDerivedStateFromProps(props: { chave?: string }, state: { quebrou: boolean; chave?: string }) {
    return props.chave !== state.chave ? { quebrou: false, chave: props.chave } : null
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // fica no console para quem for investigar; a pessoa só vê a frase simples
    console.error('Uma tela quebrou ao abrir:', erro, info.componentStack)
  }

  render() {
    if (!this.state.quebrou) return this.props.children
    return (
      <div className="aviso-erro" role="alert">
        <Icone nome="alerta" tamanho={28} />
        <div>
          <p className="aviso-erro-titulo">Não consegui abrir esta tela.</p>
          <p>Toque em “Tentar de novo”. Se continuar assim, avise o Ivan.</p>
        </div>
        <button type="button" className="botao" onClick={() => window.location.reload()}>Tentar de novo</button>
      </div>
    )
  }
}
