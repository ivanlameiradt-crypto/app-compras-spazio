import { useState } from 'react'
import type { ItemSemana, Resultado } from '../lib/tipos'
import { formatarQtd, lerNumero } from '../lib/regras'
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
    const q = lerNumero(qtd)
    if (q === null || q <= 0) return setErro('Informe a quantidade comprada.')
    const p = preco.trim() ? lerNumero(preco) : null
    if (preco.trim() && p === null) return setErro('Preço inválido.')
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
      <div className="linha">
        <button className="link" onClick={() => confirmar('parcial')}>Achei só parte</button>
        <button className="link perigo" onClick={() => confirmar('nao_achei')}>Não achei</button>
      </div>
      <div className="linha">
        {marcacao ? <button className="link" onClick={onDesmarcar}>Desmarcar</button> : <span />}
        <button className="link" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
