// Aba "Compra": menu em grade (no lugar da antiga barra de rolagem lateral). Cada botão abre uma das telas
// de compra; o Layout mostra "← Menu Compra" para voltar aqui.
// Etapa 5 do redesenho (12/11/2026): de 8 telas para 4 (Lista · Pedidos · Receber · Resultados). Saíram da grade: Lançamentos (virou aba própria da
// barra de baixo), Resumo e Economia (viraram as duas abas de "Resultados"), Cadastros (virou o link "Ajustes", abaixo da grade) e Fazer compra
// (o cartão "Fazer esta compra agora", em Pedidos, leva a ela; a rota /comprar e a barra do comprador continuam).
import { Link } from 'react-router-dom'
import { Icone, type NomeIcone } from '../components/Icones'
import TituloDaTela from '../components/TituloDaTela'

const TELAS: { to: string; rotulo: string; ic: NomeIcone }[] = [
  { to: '/lista-semana', rotulo: 'Lista', ic: 'lista' },
  { to: '/pedidos', rotulo: 'Pedidos', ic: 'cotacoes' },
  { to: '/receber', rotulo: 'Receber', ic: 'receber' },
  { to: '/resultados', rotulo: 'Resultados', ic: 'resumo' },
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
      <Link to="/cadastros" className="ajustes">
        <Icone nome="engrenagem" tamanho={20} />
        Ajustes (produtos, vendedores, feriados)
      </Link>
    </section>
  )
}
