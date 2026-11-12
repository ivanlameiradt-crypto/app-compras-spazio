// Aba "Compra": menu em grade (no lugar da antiga barra de rolagem lateral). Cada botão abre uma das telas
// de compra que já existem; o Layout mostra "← Menu Compra" para voltar aqui.
import { Link } from 'react-router-dom'
import { Icone, type NomeIcone } from '../components/Icones'
import TituloDaTela from '../components/TituloDaTela'

// "Fazer compra" é a tela de antes chamada "Comprar" (rota /comprar): o app inteiro passou a se chamar "Comprar" (nome dado pelo Ivan em 10/11/2026).
const TELAS: { to: string; rotulo: string; ic: NomeIcone }[] = [
  { to: '/lista-semana', rotulo: 'Lista', ic: 'lista' },
  { to: '/pedidos', rotulo: 'Pedidos', ic: 'cotacoes' },
  { to: '/receber', rotulo: 'Receber', ic: 'receber' },
  { to: '/lancamentos', rotulo: 'Lançamentos', ic: 'lancamentos' },
  { to: '/resumo', rotulo: 'Resumo', ic: 'resumo' },
  { to: '/economia', rotulo: 'Economia', ic: 'economia' },
  { to: '/cadastros', rotulo: 'Cadastros', ic: 'cadastros' },
  { to: '/comprar', rotulo: 'Fazer compra', ic: 'carrinho' },
]

export default function CompraHome() {
  return (
    <section className="coluna">
      <TituloDaTela>Compra</TituloDaTela>
      <nav className="grade" aria-label="Telas de compra">
        {TELAS.map((t) => (
          <Link key={t.to} to={t.to}>
            <Icone nome={t.ic} tamanho={34} />
            {t.rotulo}
          </Link>
        ))}
      </nav>
    </section>
  )
}
