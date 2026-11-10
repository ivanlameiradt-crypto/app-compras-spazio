import { LogoComprar } from '../components/marca/Comprar'
import { sair } from '../lib/api'

export default function SemAcesso({ email }: { email: string }) {
  return (
    <main className="login">
      <h1 className="logo-titulo"><LogoComprar altura={40} /></h1>
      <p>Você entrou como <b>{email}</b>, mas esse e-mail ainda não tem acesso.</p>
      <p>Peça acesso ao administrador.</p>
      <button className="botao secundario" onClick={() => sair()}>Sair</button>
    </main>
  )
}
