import { lerQuantidadeBr } from '../lib/quantidade'
import { useState } from 'react'
import type { ItemSemana, Resultado } from '../lib/tipos'
import { formatarQtd, lerNumero } from '../lib/regras'
import { ehMilharAmbiguo, lerPrecoUnitario } from '../lib/dinheiro'
import type { Marcacao } from './marcacoes'

const virgula = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))

export default function QuadroItem({ item, marcacao, jaCompradoPorOutros, etiqueta, cobertoPelaCotacao = 0, onConfirmar, onDesmarcar, onCancelar }: {
  item: ItemSemana
  /** Fase 1B: "Em cotação com MATEUS — não comprar na loja" (só informa) */
  etiqueta?: string
  /** Fase 1B (D63): o que o pedido ou o "só tenho" do vendedor cobre quando é só parte do item; sai da sugestão */
  cobertoPelaCotacao?: number
  marcacao?: Marcacao
  jaCompradoPorOutros: number
  onConfirmar: (qtd: number, preco: number | null, resultado: Resultado) => void
  onDesmarcar: () => void
  onCancelar: () => void
}) {
  const sugerida = Math.max(+(item.qtd_aprovada - jaCompradoPorOutros - cobertoPelaCotacao).toFixed(3), 0)
  const [qtd, setQtd] = useState(virgula(marcacao && marcacao.resultado !== 'nao_achei' ? marcacao.qtd : sugerida))
  const [preco, setPreco] = useState(virgula(marcacao?.preco ?? item.preco_estimado))
  const [erro, setErro] = useState('')

  function confirmar(resultado: Resultado) {
    if (resultado === 'nao_achei') return onConfirmar(0, null, 'nao_achei')
    const q = lerQuantidadeBr(qtd, item.unidade)
    if (q === null || q <= 0) return setErro('Informe a quantidade comprada.')
    const p = preco.trim() ? lerPrecoUnitario(preco) : null
    if (preco.trim() && p === null) return setErro(ehMilharAmbiguo(preco) ? 'Preço: use a vírgula nos centavos (ex.: 1,516).' : 'Preço inválido.')
    onConfirmar(q, p, resultado)
  }

  return (
    <div className="quadro" role="group" aria-label={item.produto}>
      <div className="nome">{item.produto}</div>
      <div className="sub">Pedido: {formatarQtd(item.qtd_aprovada, item.unidade)}</div>
      {etiqueta && <div className="etiqueta-cotacao">{etiqueta}</div>}
      <div className="duas">
        <label>Quantidade<input aria-label="Quantidade" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
        <label>Preço unitário<input aria-label="Preço unitário" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
      </div>
      {erro && <p className="erro">{erro}</p>}
      <button className="botao" onClick={() => confirmar('comprado')}>Comprei</button>
      {/* Padrão visual único (23/11/2026): as quatro ações são botões de 48 px, em grade de 2 colunas (empilham no aparelho estreito), e não links de 40 px colados. */}
      <div className="acoes-item">
        <button className="botao secundario" onClick={() => confirmar('parcial')}>Achei só parte</button>
        <button className="botao secundario perigo-contorno" onClick={() => confirmar('nao_achei')}>Não achei</button>
        {marcacao && <button className="botao secundario" onClick={onDesmarcar}>Desmarcar</button>}
        <button className="botao secundario" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
