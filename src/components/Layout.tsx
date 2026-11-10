import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { Usuario } from '../lib/tipos'
import AvisoFila from './AvisoFila'
import AvisoNovaVersao from './AvisoNovaVersao'
import { conferirVersao, recarregarPagina } from '../lib/atualizacao'
import { LogoComprar } from './marca/Comprar'
import { Icone, type NomeIcone } from './Icones'

// As 4 abas do topo (admin; "Compras avulsas" desde 10/10/2026). "Compra" guarda todo o fluxo atual (Lista, Cotações, Receber, Lançamentos,
// Resumo, Economia, Cadastros, Comprar) num menu em grade; Cupom e Fiscal (a nota da SEFAZ) são cada um sua tela.
const ABAS: readonly { chave: 'compra' | 'cupom' | 'sefaz' | 'avulsa'; to: string; rotulo: string; ic: NomeIcone }[] = [
  { chave: 'compra', to: '/compra', rotulo: 'Compra', ic: 'carrinho' },
  { chave: 'cupom', to: '/cupom', rotulo: 'Lançamento de cupom', ic: 'cupom' },
  { chave: 'sefaz', to: '/nota-sefaz', rotulo: 'Lançamento fiscal', ic: 'fiscal' },
  { chave: 'avulsa', to: '/compra-avulsa', rotulo: 'Compras avulsas', ic: 'sacola' },
]

/** Quem só compra e recebe (perfil comprador) vê duas telas na barra. A tela "Comprar" passou a se chamar "Fazer compra" (o app inteiro é o "Comprar"). */
const ABAS_COMPRADOR: readonly { to: string; rotulo: string; ic: NomeIcone }[] = [
  { to: '/comprar', rotulo: 'Fazer compra', ic: 'carrinho' },
  { to: '/receber', rotulo: 'Receber', ic: 'receber' },
]

/** Qual aba fica acesa para a rota atual: Cupom e Nota SEFAZ só nas suas; todo o resto é Compra. */
function abaAtual(pathname: string): 'compra' | 'cupom' | 'sefaz' | 'avulsa' {
  if (pathname.startsWith('/cupom')) return 'cupom'
  if (pathname.startsWith('/compra-avulsa')) return 'avulsa'
  if (pathname.startsWith('/nota-sefaz')) return 'sefaz'
  return 'compra'
}

export default function Layout({ usuario, offline = false, children }: { usuario: Usuario; offline?: boolean; children: ReactNode }) {
  const [aguardando, setAguardando] = useState(0)
  const [atualizando, setAtualizando] = useState(false)
  const admin = usuario.papel === 'admin'
  // Botão Atualizar (pedido do Ivan, 07/10): o iPhone instalado não tem "puxar para atualizar" e ele não deve precisar sair do app. Confere a versão no ar:
  // se saiu versão nova, troca já (a tela fica a mesma); se não, recarrega a tela para ler os dados de novo (rascunhos como as parcelas ficam guardados no aparelho).
  async function atualizar() {
    if (atualizando) return
    setAtualizando(true)
    const r = await conferirVersao('manual')
    if (r !== 'aplicando') recarregarPagina()
  }
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
      <header className="barra-topo">
        <div className="barra-linha">
          <LogoComprar altura={30} cor="#FFFFFF" />
          <button type="button" className="fantasma" disabled={atualizando} onClick={() => void atualizar()}>
            <Icone nome="atualizar" tamanho={18} />
            {atualizando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
        <div className="barra-links">
          <NavLink to="/senha" className="link-claro">Trocar minha senha</NavLink>
          <button type="button" className="link-claro" onClick={() => api.sair()}>Sair</button>
        </div>
      </header>
      {admin ? (
        <nav className="barra-abas" aria-label="Seções">
          {ABAS.map((a) => (
            <Link key={a.chave} to={a.to} className={aba === a.chave ? 'ativo' : undefined} aria-current={aba === a.chave ? 'page' : undefined}>
              <span className="aba-icone">
                <Icone nome={a.ic} tamanho={26} />
                {a.chave === 'compra' && aguardando > 0 && <span className="contador">{aguardando}</span>}
              </span>
              <span>{a.rotulo}</span>
            </Link>
          ))}
        </nav>
      ) : (
        <nav className="barra-abas duas" aria-label="Seções">
          {ABAS_COMPRADOR.map((a) => (
            <NavLink key={a.to} to={a.to} className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
              <span className="aba-icone"><Icone nome={a.ic} tamanho={26} /></span>
              <span>{a.rotulo}</span>
            </NavLink>
          ))}
        </nav>
      )}
      {emSubtelaCompra && <Link to="/compra" className="voltar-menu"><Icone nome="esq" tamanho={20} />Menu Compra</Link>}
      {offline && <p className="faixa">Sem internet — seus itens serão enviados quando voltar.</p>}
      <AvisoNovaVersao />
      <AvisoFila />
      <main className="conteudo">{children}</main>
    </div>
  )
}
