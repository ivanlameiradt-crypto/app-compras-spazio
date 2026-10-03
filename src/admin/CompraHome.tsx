// Aba "Compra": menu em grade (no lugar da antiga barra de rolagem lateral). Cada botão abre uma das telas
// de compra que já existem; o Layout mostra "← Menu Compra" para voltar aqui.
import { Link } from 'react-router-dom'

const TELAS: { to: string; rotulo: string; ic: string }[] = [
  { to: '/lista', rotulo: 'Lista', ic: '📋' },
  { to: '/cotacoes', rotulo: 'Cotações', ic: '🏷️' },
  { to: '/receber', rotulo: 'Receber', ic: '📦' },
  { to: '/lancamentos', rotulo: 'Lançamentos', ic: '✍️' },
  { to: '/resumo', rotulo: 'Resumo', ic: '📊' },
  { to: '/economia', rotulo: 'Economia', ic: '💹' },
  { to: '/cadastros', rotulo: 'Cadastros', ic: '🗂️' },
  { to: '/comprar', rotulo: 'Comprar', ic: '🛒' },
]

export default function CompraHome() {
  return (
    <section className="coluna">
      <h2>Compra</h2>
      <nav className="grade" aria-label="Telas de compra">
        {TELAS.map((t) => (
          <Link key={t.to} to={t.to}>
            <span className="ic" aria-hidden="true">{t.ic}</span>
            {t.rotulo}
          </Link>
        ))}
      </nav>
    </section>
  )
}
