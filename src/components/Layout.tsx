import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import * as api from '../lib/api'
import type { Usuario } from '../lib/tipos'
import AvisoFila from './AvisoFila'

export default function Layout({ usuario, offline = false, children }: { usuario: Usuario; offline?: boolean; children: ReactNode }) {
  const [aguardando, setAguardando] = useState(0)
  const admin = usuario.papel === 'admin'
  useEffect(() => {
    if (!admin) return
    let vivo = true
    const contar = () => api.contarAguardando().then((n) => { if (vivo) setAguardando(n ?? 0) }).catch(() => undefined)
    contar()
    const t = setInterval(contar, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [admin])
  return (
    <div className="app">
      <header className="topo">
        <strong>Compras Spazio</strong>
        <NavLink to="/senha" className="link">Trocar minha senha</NavLink>
        <button className="link" onClick={() => api.sair()}>Sair</button>
      </header>
      {admin ? (
        <nav className="menu">
          <NavLink to="/lista">Lista</NavLink>
          <NavLink to="/cotacoes">Cotações</NavLink>
          <NavLink to="/receber">Receber</NavLink>
          <NavLink to="/lancamentos">Lançamentos{aguardando > 0 && <span className="contador">{aguardando}</span>}</NavLink>
          <NavLink to="/resumo">Resumo</NavLink>
          <NavLink to="/economia">Economia</NavLink>
          <NavLink to="/cadastros">Cadastros</NavLink>
          <NavLink to="/comprar">Comprar</NavLink>
        </nav>
      ) : (
        <nav className="menu">
          <NavLink to="/comprar">Comprar</NavLink>
          <NavLink to="/receber">Receber</NavLink>
        </nav>
      )}
      {offline && <p className="faixa">Sem internet — seus itens serão enviados quando voltar.</p>}
      <AvisoFila />
      <main className="conteudo">{children}</main>
    </div>
  )
}
