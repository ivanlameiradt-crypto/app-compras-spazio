import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useSessao } from './auth/useSessao'
import Login from './auth/Login'
import SemAcesso from './auth/SemAcesso'
import TrocarSenha from './auth/TrocarSenha'
import { trocaSenhaPendente } from './auth/usuarioGuardado'
import Layout from './components/Layout'
import Instalar from './auth/Instalar'
import TelaAbertura from './components/marca/TelaAbertura'
import { LogoComprar } from './components/marca/Comprar'
import Revisao from './admin/Revisao'
import ListaSemana from './admin/ListaSemana'
import Cotacoes from './admin/Cotacoes'
import Lancamentos from './admin/Lancamentos'
import Resumo from './admin/Resumo'
import Economia from './admin/Economia'
import Pessoas from './admin/Pessoas'
import Cadastros from './admin/Cadastros'
import Historico from './admin/Historico'
import Cupom from './admin/Cupom'
import CompraAvulsa from './admin/CompraAvulsa'
import CompraHome from './admin/CompraHome'
import NotaSefaz from './admin/NotaSefaz'
import Comprar from './comprador/Comprar'
import Receber from './recebimento/Recebimento'
import { sair } from './lib/api'
import type { Usuario } from './lib/tipos'

export default function App() {
  const s = useSessao()
  if (s.carregando) return <TelaAbertura />
  if (!s.sessao) {
    if (!s.offline) return <TelasPublicas />
    // P3: quem ainda não escolheu a própria senha não pode entrar no app driblando a falta de internet
    if (trocaSenhaPendente(s.usuario.email)) return <TrocarSenha forcada offline onSair={() => sair()} />
    return (
      <HashRouter>
        <Rotas usuario={s.usuario} offline />
      </HashRouter>
    )
  }
  if (s.erro) {
    return (
      <main className="login">
        <h1 className="logo-titulo"><LogoComprar altura={40} /></h1>
        <p>Não foi possível verificar seu acesso. Confira a internet.</p>
        <button className="botao" onClick={() => window.location.reload()}>Tentar de novo</button>
      </main>
    )
  }
  if (!s.usuario) return <SemAcesso email={s.sessao.user.email ?? ''} />
  // P3: senha padrão (123456) ainda não trocada — a tela substitui o app inteiro até isso acontecer
  if (s.sessao.user.user_metadata?.trocar_senha === true) return <TrocarSenha forcada onSair={() => sair()} />
  return (
    <HashRouter>
      <Rotas usuario={s.usuario} />
    </HashRouter>
  )
}

/** Telas de antes do login: entrar e "Instalar o app" (o link fica na tela de entrar). */
function TelasPublicas() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/instalar" element={<Instalar />} />
        <Route path="*" element={<Login />} />
      </Routes>
    </HashRouter>
  )
}

function Rotas({ usuario, offline = false }: { usuario: Usuario; offline?: boolean }) {
  return (
    <Routes>
      <Route path="/instalar" element={<Instalar />} />
      <Route path="*" element={<Layout usuario={usuario} offline={offline}><Telas usuario={usuario} /></Layout>} />
    </Routes>
  )
}

function Telas({ usuario }: { usuario: Usuario }) {
  const admin = usuario.papel === 'admin'
  return (
    <Routes>
      {admin && <Route path="/compra" element={<CompraHome />} />}
      {admin && <Route path="/nota-sefaz" element={<NotaSefaz />} />}
      {admin && <Route path="/lista" element={<Revisao usuario={usuario} />} />}
      {admin && <Route path="/lista-semana" element={<ListaSemana />} />}
      {admin && <Route path="/cotacoes" element={<Cotacoes />} />}
      {admin && <Route path="/lancamentos" element={<Lancamentos usuario={usuario} />} />}
      {admin && <Route path="/resumo" element={<Resumo />} />}
      {admin && <Route path="/economia" element={<Economia />} />}
      {admin && <Route path="/cadastros" element={<Cadastros usuario={usuario} />} />}
      {admin && <Route path="/cadastros/produto/:id" element={<Cadastros usuario={usuario} />} />}
      {admin && <Route path="/historico" element={<Historico />} />}
      {admin && <Route path="/pessoas" element={<Pessoas usuario={usuario} />} />}
      {admin && <Route path="/cupom" element={<Cupom />} />}
      {admin && <Route path="/compra-avulsa" element={<CompraAvulsa />} />}
      <Route path="/comprar" element={<Comprar usuario={usuario} />} />
      <Route path="/receber" element={<Receber usuario={usuario} />} />
      <Route path="/senha" element={<TrocarSenha forcada={false} />} />
      <Route path="*" element={<Navigate to={admin ? '/compra' : '/comprar'} replace />} />
    </Routes>
  )
}
