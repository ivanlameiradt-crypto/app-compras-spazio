import { LogoComprar } from '../components/marca/Comprar'
import { useState } from 'react'
import { entrarComSenha } from '../lib/api'

function mensagemDeErroLogin(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/invalid login credentials/i.test(msg)) return 'Usuário ou senha incorretos.'
  if (/failed to fetch|network|load failed|timeout/i.test(msg)) return 'Sem internet. Tente de novo.'
  return msg
}

export default function Login() {
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    try {
      await entrarComSenha(login, senha)
    } catch (err) {
      setErro(mensagemDeErroLogin(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="login">
      <h1 className="logo-titulo"><LogoComprar altura={40} /></h1>
      <form onSubmit={entrar} className="coluna">
        <label>
          Usuário ou e-mail
          <input required value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Senha
          <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="botao grande" type="submit" disabled={enviando}>Entrar</button>
      </form>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <p className="login-links"><a className="link sublinhado" href="#/instalar">Instalar o app neste aparelho</a></p>
    </main>
  )
}
