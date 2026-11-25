import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { Usuario } from '../lib/tipos'
import AvisoFila from './AvisoFila'
import AvisoNovaVersao from './AvisoNovaVersao'
import { LogoComprar } from './marca/Comprar'
import { Icone, type NomeIcone } from './Icones'
import { SlotDoTitulo } from './TituloDaTela'
import { podeSair } from '../lib/naoEnviado'

// As 5 abas da barra (admin; "Compras avulsas" desde 10/10/2026, "Lançamentos" desde 12/11/2026). "Compra" guarda o fluxo da compra num menu em
// grade de 4 telas (Lista, Pedidos, Receber, Resultados) mais o link "Ajustes" (Cadastros); Lançamentos (a fila de compras esperando lançamento),
// Cupom e Fiscal (a nota da SEFAZ) e Compras avulsas são cada um sua tela.
type ChaveAba = 'compra' | 'lancamentos' | 'cupom' | 'sefaz' | 'avulsa'
// "curto" é o nome que aparece na barra de baixo do celular (5 destinos de 78 px cada, sem "Mais"); o nome inteiro continua no HTML e no menu lateral do computador.
const ABAS: readonly { chave: ChaveAba; to: string; rotulo: string; curto: string; ic: NomeIcone }[] = [
  { chave: 'compra', to: '/compra', rotulo: 'Compra', curto: 'Compra', ic: 'carrinho' },
  { chave: 'lancamentos', to: '/lancamentos', rotulo: 'Lançamentos', curto: 'Lançar', ic: 'lancamentos' },
  { chave: 'cupom', to: '/cupom', rotulo: 'Lançamento de cupom', curto: 'Cupom', ic: 'cupom' },
  { chave: 'sefaz', to: '/nota-sefaz', rotulo: 'Lançamento fiscal', curto: 'Fiscal', ic: 'fiscal' },
  { chave: 'avulsa', to: '/compra-avulsa', rotulo: 'Compras avulsas', curto: 'Avulsa', ic: 'sacola' },
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

/** As iniciais do nome para o avatar do cabeçalho: primeira letra do primeiro e do último nome ("Ana Souza" = "AS"). */
function iniciais(nome: string): string {
  const p = (nome || '').trim().split(/\s+/).filter(Boolean)
  return p.length === 0 ? '?' : (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

export default function Layout({ usuario, offline = false, children }: { usuario: Usuario; offline?: boolean; children: ReactNode }) {
  const [aguardando, setAguardando] = useState(0)
  const [slotTitulo, setSlotTitulo] = useState<HTMLElement | null>(null)
  // Menu da pessoa (Trocar minha senha, Sair) e "Mais" da barra de baixo (padrão visual único, 23/11/2026): abrem e fecham por aqui; as opções ficam sempre no HTML.
  const [menuPessoa, setMenuPessoa] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
  // Menu lateral do computador (a partir de 1024 px): 256 px, ou 76 px só com os ícones. A escolha fica guardada no aparelho (se o navegador não deixar, vale o padrão).
  const [recolhido, setRecolhido] = useState(() => { try { return window.localStorage.getItem('comprar-menu-recolhido') === '1' } catch { return false } })
  const alternarMenu = () => setRecolhido((v) => { const n = !v; try { window.localStorage.setItem('comprar-menu-recolhido', n ? '1' : '0') } catch { /* sem armazenamento: vale só nesta visita */ } return n })
  const botaoRecolher = (
    <button type="button" className="recolher-menu" aria-label={recolhido ? 'Abrir menu' : 'Recolher menu'} aria-expanded={!recolhido} onClick={alternarMenu}>
      <Icone nome={recolhido ? 'dir' : 'esq'} tamanho={24} />
      <span>Recolher menu</span>
    </button>
  )
  const admin = usuario.papel === 'admin'
  // O botão "Atualizar" do topo saiu em 24/11/2026 (pedido do Ivan): a janela obrigatória "Tem uma versão nova do app." já pede a atualização.
  const loc = useLocation()
  const aba = abaAtual(loc.pathname)
  // trocar de tela fecha os dois menus; Esc também
  useEffect(() => { setMenuPessoa(false); setMaisAberto(false) }, [loc.pathname])
  useEffect(() => {
    if (!menuPessoa && !maisAberto) return
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuPessoa(false); setMaisAberto(false) } }
    const aoTocarFora = (e: Event) => {
      const alvo = e.target as HTMLElement | null
      if (!alvo?.closest('.menu-pessoa, .aba-mais, .mais-destinos')) { setMenuPessoa(false); setMaisAberto(false) }
    }
    document.addEventListener('keydown', aoTeclar)
    document.addEventListener('pointerdown', aoTocarFora)
    return () => { document.removeEventListener('keydown', aoTeclar); document.removeEventListener('pointerdown', aoTocarFora) }
  }, [menuPessoa, maisAberto])
  // Trocar de aba desmonta a tela e o que foi digitado some: com dados não enviados a aba pergunta antes (13/11/2026). A aba da própria tela não sai dela: não pergunta.
  // "Trocar minha senha" e "Sair" (topo) usam a mesma pergunta: os dois também jogam fora o que estava em preenchimento.
  // "Trocar minha senha" e "Sair" (topo) usam a mesma pergunta: os dois também jogam fora o que estava em preenchimento.
  const aoTrocarDeAba = (e: MouseEvent, destino: string) => { if (destino !== loc.pathname && !podeSair()) e.preventDefault() }
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
  // Um destino da barra (admin). Só a aba Lançamentos tem a bolinha vermelha (quantas compras esperam aprovação). A aba que tem bolinha ganha "com-contador": em tela larga o CSS
  // afasta o nome do ícone (a bolinha passa 14 px do ícone e o espaço normal é 8 px: cobria a 1ª letra). No celular a classe não muda nada.
  const destino = (a: (typeof ABAS)[number]) => {
    const comContador = a.chave === 'lancamentos' && aguardando > 0
    const classes = [aba === a.chave ? 'ativo' : '', comContador ? 'com-contador' : ''].filter(Boolean).join(' ')
    return (
      <Link key={a.chave} to={a.to} className={classes || undefined} aria-current={aba === a.chave ? 'page' : undefined} onClick={(e) => aoTrocarDeAba(e, a.to)}>
        <span className="aba-icone">
          <Icone nome={a.ic} tamanho={26} />
          {comContador && <span className="contador">{aguardando}</span>}
        </span>
        <span className="aba-nome" data-curto={a.curto}>{a.rotulo}</span>
      </Link>
    )
  }
  return (
    <div className={recolhido ? 'app com-menu recolhido' : 'app com-menu'}>
      <header className="cabecalho-app">
        <div className="barra-topo">
        <div className="barra-linha">
          <LogoComprar altura={30} cor="#FFFFFF" />
          {admin && aguardando > 0 && (
            <Link to="/lancamentos" className="sino" aria-label={`${aguardando} ${aguardando === 1 ? 'compra esperando' : 'compras esperando'} aprovação`} onClick={(e) => aoTrocarDeAba(e, '/lancamentos')}>
              <Icone nome="sino" tamanho={26} />
              <span className="contador" aria-hidden="true">{aguardando}</span>
            </Link>
          )}
          <div className={menuPessoa ? 'menu-pessoa aberto' : 'menu-pessoa'}>
            <button type="button" className="menu-pessoa-botao" aria-expanded={menuPessoa} aria-label={`Minha conta: ${usuario.nome}`} onClick={() => setMenuPessoa((v) => !v)}>
              <span className="avatar" aria-hidden="true">{iniciais(usuario.nome)}</span>
              <span className="menu-pessoa-nome">{(usuario.nome || '').split(' ')[0]}</span>
            </button>
            <div className="menu-pessoa-lista">
              <NavLink to="/senha" className="link-claro" onClick={(e) => aoTrocarDeAba(e, '/senha')}>Trocar minha senha</NavLink>
              <button type="button" className="link-claro" onClick={() => { if (podeSair()) api.sair() }}>Sair</button>
            </div>
          </div>
        </div>
        </div>
        <div className="barra-titulo" ref={setSlotTitulo} />
        {admin ? (
          <nav className={maisAberto ? 'barra-abas mais-aberto' : 'barra-abas'} aria-label="Seções">
            {/* Os cinco destinos ficam sempre à vista (pedido do Ivan, 24/11/2026): no celular com nome curto, sem "Mais". */}
            {ABAS.map(destino)}
            {botaoRecolher}
          </nav>
        ) : (
          <nav className="barra-abas duas" aria-label="Seções">
            {ABAS_COMPRADOR.map((a) => (
              <NavLink key={a.to} to={a.to} className={({ isActive }) => (isActive ? 'ativo' : undefined)} onClick={(e) => aoTrocarDeAba(e, a.to)}>
                <span className="aba-icone"><Icone nome={a.ic} tamanho={26} /></span>
                <span>{a.rotulo}</span>
              </NavLink>
            ))}
            {botaoRecolher}
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
