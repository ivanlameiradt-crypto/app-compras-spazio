import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { Usuario } from '../lib/tipos'
import AvisoFila from './AvisoFila'
import AvisoNovaVersao from './AvisoNovaVersao'
import { conferirVersao, recarregarPagina } from '../lib/atualizacao'
import { LogoComprar } from './marca/Comprar'
import { Icone, type NomeIcone } from './Icones'
import { SlotDoTitulo } from './TituloDaTela'

// As 5 abas da barra (admin; "Compras avulsas" desde 10/10/2026, "Lançamentos" desde 12/11/2026). "Compra" guarda o fluxo da compra num menu em
// grade de 4 telas (Lista, Pedidos, Receber, Resultados) mais o link "Ajustes" (Cadastros); Lançamentos (a fila de compras esperando lançamento),
// Cupom e Fiscal (a nota da SEFAZ) e Compras avulsas são cada um sua tela.
type ChaveAba = 'compra' | 'lancamentos' | 'cupom' | 'sefaz' | 'avulsa'
const ABAS: readonly { chave: ChaveAba; to: string; rotulo: string; ic: NomeIcone }[] = [
  { chave: 'compra', to: '/compra', rotulo: 'Compra', ic: 'carrinho' },
  { chave: 'lancamentos', to: '/lancamentos', rotulo: 'Lançamentos', ic: 'lancamentos' },
  { chave: 'cupom', to: '/cupom', rotulo: 'Lançamento de cupom', ic: 'cupom' },
  { chave: 'sefaz', to: '/nota-sefaz', rotulo: 'Lançamento fiscal', ic: 'fiscal' },
  { chave: 'avulsa', to: '/compra-avulsa', rotulo: 'Compras avulsas', ic: 'sacola' },
]

/** Quem só compra e recebe (perfil comprador) vê duas telas na barra. A tela "Comprar" passou a se chamar "Fazer compra" (o app inteiro é o "Comprar"). */
const ABAS_COMPRADOR: readonly { to: string; rotulo: string; ic: NomeIcone }[] = [
  { to: '/comprar', rotulo: 'Fazer compra', ic: 'carrinho' },
  { to: '/receber', rotulo: 'Receber', ic: 'receber' },
]

/** Qual aba fica acesa para a rota atual: Lançamentos, Cupom, Nota SEFAZ e Compras avulsas só nas suas; todo o resto é Compra. */
function abaAtual(pathname: string): ChaveAba {
  if (pathname.startsWith('/lancamentos')) return 'lancamentos'
  if (pathname.startsWith('/cupom')) return 'cupom'
  if (pathname.startsWith('/compra-avulsa')) return 'avulsa'
  if (pathname.startsWith('/nota-sefaz')) return 'sefaz'
  return 'compra'
}

export default function Layout({ usuario, offline = false, children }: { usuario: Usuario; offline?: boolean; children: ReactNode }) {
  const [aguardando, setAguardando] = useState(0)
  const [atualizando, setAtualizando] = useState(false)
  const [slotTitulo, setSlotTitulo] = useState<HTMLElement | null>(null)
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
        <div className="barra-titulo" ref={setSlotTitulo} />
        {admin ? (
          <nav className="barra-abas" aria-label="Seções">
            {ABAS.map((a) => {
              // Só a aba Lançamentos tem a bolinha vermelha (quantas compras esperam aprovação). A aba que tem bolinha ganha "com-contador": em tela larga o CSS
              // afasta o nome do ícone (a bolinha passa 14 px do ícone e o espaço normal é 8 px: cobria a 1ª letra). No celular a classe não muda nada.
              const comContador = a.chave === 'lancamentos' && aguardando > 0
              const classes = [aba === a.chave ? 'ativo' : '', comContador ? 'com-contador' : ''].filter(Boolean).join(' ')
              return (
                <Link key={a.chave} to={a.to} className={classes || undefined} aria-current={aba === a.chave ? 'page' : undefined}>
                  <span className="aba-icone">
                    <Icone nome={a.ic} tamanho={26} />
                    {comContador && <span className="contador">{aguardando}</span>}
                  </span>
                  <span>{a.rotulo}</span>
                </Link>
              )
            })}
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
      </header>
      {emSubtelaCompra && <Link to="/compra" className="voltar-menu"><Icone nome="esq" tamanho={20} />Menu Compra</Link>}
      {offline && <p className="faixa">Sem internet — seus itens serão enviados quando voltar.</p>}
      <AvisoNovaVersao />
      <AvisoFila />
      <SlotDoTitulo.Provider value={slotTitulo}>
        <main className="conteudo">{children}</main>
      </SlotDoTitulo.Provider>
    </div>
  )
}
