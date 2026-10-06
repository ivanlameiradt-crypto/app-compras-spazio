import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { Usuario } from '../lib/tipos'
import AvisoFila from './AvisoFila'

// As 3 abas do topo (admin). "Compra" guarda todo o fluxo atual (Lista, Cotações, Receber, Lançamentos,
// Resumo, Economia, Cadastros, Comprar) num menu em grade; Cupom e Fiscal (a nota da SEFAZ) são cada um sua tela.
const ABAS = [
  { chave: 'compra', to: '/compra', rotulo: 'Compra', ic: '🛒' },
  { chave: 'cupom', to: '/cupom', rotulo: 'Lançamento de cupom', ic: '🧾' },
  { chave: 'sefaz', to: '/nota-sefaz', rotulo: 'Lançamento fiscal', ic: '📄' },
] as const

/** Qual aba fica acesa para a rota atual: Cupom e Nota SEFAZ só nas suas; todo o resto é Compra. */
function abaAtual(pathname: string): 'compra' | 'cupom' | 'sefaz' {
  if (pathname.startsWith('/cupom')) return 'cupom'
  if (pathname.startsWith('/nota-sefaz')) return 'sefaz'
  return 'compra'
}

export default function Layout({ usuario, offline = false, children }: { usuario: Usuario; offline?: boolean; children: ReactNode }) {
  const [aguardando, setAguardando] = useState(0)
  const admin = usuario.papel === 'admin'
  const loc = useLocation()
  const aba = abaAtual(loc.pathname)
  // numa tela de Compra que não é o próprio menu em grade → oferece voltar para o menu
  const emSubtelaCompra = admin && aba === 'compra' && loc.pathname !== '/compra'
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
        <nav className="abas-topo" aria-label="Seções">
          {ABAS.map((a) => (
            <Link key={a.chave} to={a.to} className={aba === a.chave ? 'ativo' : undefined} aria-current={aba === a.chave ? 'page' : undefined}>
              <span className="ic" aria-hidden="true">{a.ic}</span>
              <span>{a.rotulo}{a.chave === 'compra' && aguardando > 0 && <span className="contador">{aguardando}</span>}</span>
            </Link>
          ))}
        </nav>
      ) : (
        <nav className="menu">
          <NavLink to="/comprar">Comprar</NavLink>
          <NavLink to="/receber">Receber</NavLink>
        </nav>
      )}
      {emSubtelaCompra && <Link to="/compra" className="voltar-menu">← Menu Compra</Link>}
      {offline && <p className="faixa">Sem internet — seus itens serão enviados quando voltar.</p>}
      <AvisoFila />
      <main className="conteudo">{children}</main>
    </div>
  )
}
