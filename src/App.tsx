import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useSessao } from './auth/useSessao'
import Login from './auth/Login'
import SemAcesso from './auth/SemAcesso'
import TrocarSenha from './auth/TrocarSenha'
import { trocaSenhaPendente } from './auth/usuarioGuardado'
import Layout from './components/Layout'
import Revisao from './admin/Revisao'
import Cotacoes from './admin/Cotacoes'
import Lancamentos from './admin/Lancamentos'
import Resumo from './admin/Resumo'
import Pessoas from './admin/Pessoas'
import Comprar from './comprador/Comprar'
import { sair } from './lib/api'
import type { Usuario } from './lib/tipos'

export default function App() {
  const s = useSessao()
  if (s.carregando) return <p className="centro">Carregando…</p>
  if (!s.sessao) {
    if (!s.offline) return <Login />
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
        <h1>Compras Spazio</h1>
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

function Rotas({ usuario, offline = false }: { usuario: Usuario; offline?: boolean }) {
  const admin = usuario.papel === 'admin'
  return (
    <Layout usuario={usuario} offline={offline}>
      <Routes>
        {admin && <Route path="/lista" element={<Revisao usuario={usuario} />} />}
        {admin && <Route path="/cotacoes" element={<Cotacoes />} />}
        {admin && <Route path="/lancamentos" element={<Lancamentos usuario={usuario} />} />}
        {admin && <Route path="/resumo" element={<Resumo />} />}
        {admin && <Route path="/pessoas" element={<Pessoas usuario={usuario} />} />}
        <Route path="/comprar" element={<Comprar usuario={usuario} />} />
        <Route path="/senha" element={<TrocarSenha forcada={false} />} />
        <Route path="*" element={<Navigate to={admin ? '/lista' : '/comprar'} replace />} />
      </Routes>
    </Layout>
  )
}
