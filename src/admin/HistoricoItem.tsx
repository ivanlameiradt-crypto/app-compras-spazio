import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { HistoricoItem as Historico } from '../lib/tipos'
import { mensagemDeErro } from '../lib/regras'
import { ddmm, reais, textoPct } from '../lib/contas'

// Fase 2, Bloco E1 (DESIGN-fase-2.md E.6, "Histórico do item"): compras no SisChef, cotações e pedidos de um
// produto. Abre do painel de Economia (ao tocar um item) e, na C1, do detalhe do produto em Cadastros.

export default function HistoricoItem(
  { produtoId, nome, de = null, ate = null, onFechar }:
  { produtoId: number; nome?: string; de?: string | null; ate?: string | null; onFechar?: () => void },
) {
  const [h, setH] = useState<Historico | null | undefined>()
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    setErro('')
    setH(undefined)
    api.historicoItem(produtoId, de, ate)
      .then((r) => { if (vivo) setH(r) })
      .catch((e) => { if (vivo) setErro(mensagemDeErro(e)) })
    return () => { vivo = false }
  }, [produtoId, de, ate])

  const titulo = h?.produto ? `${h.produto} (${h.unidade ?? '—'})` : (nome ?? `Produto ${produtoId}`)
  return (
    <section className="historico-item" role="dialog" aria-label={`Histórico de ${titulo}`}>
      <div className="cabecalho">
        <h2>{titulo}</h2>
        {onFechar && <button className="link" onClick={onFechar}>Fechar</button>}
      </div>
      {erro && (
        <>
          <p className="erro">{erro}</p>
          <button className="botao secundario" onClick={() => { setErro(''); setH(undefined); api.historicoItem(produtoId, de, ate).then(setH).catch((e) => setErro(mensagemDeErro(e))) }}>Tentar de novo</button>
        </>
      )}
      {!erro && h === undefined && <p className="centro">Carregando…</p>}
      {!erro && h === null && <p className="vazio">O histórico ainda não foi instalado no banco.</p>}
      {!erro && h && (
        <>
          {h.compras_sischef.length > 0 && (
            <>
              <div className="grupo">Compras no SisChef</div>
              <table className="tabela">
                <thead><tr><th>Data</th><th>Fornecedor</th><th>Preço</th><th /></tr></thead>
                <tbody>
                  {h.compras_sischef.map((c, i) => (
                    <tr key={`c${i}`}>
                      <td>{ddmm(c.data)}</td><td>{c.fornecedor ?? '—'}</td><td>{reais(c.preco)}</td>
                      <td>{c.conferir && <span className="selo" data-testid="conferir">conferir</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {h.cotacoes.length > 0 && (
            <>
              <div className="grupo">Cotações</div>
              <table className="tabela">
                <thead><tr><th>Data</th><th>Vendedor</th><th>Preço</th><th>vs último</th><th>Marca</th></tr></thead>
                <tbody>
                  {h.cotacoes.map((c, i) => (
                    <tr key={`q${i}`} className={c.no_pedido ? 'no-pedido' : undefined}>
                      <td>{ddmm(c.data_referencia)}</td>
                      <td>{c.vendedor} v{c.versao}</td>
                      <td>{c.preco == null ? 'sem conversão' : reais(c.preco)}</td>
                      <td>{c.delta == null ? '—' : `${c.delta > 0 ? '+' : c.delta < 0 ? '−' : ''}${textoPct(c.delta)}`}</td>
                      <td>{c.marca ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {h.pedidos.length > 0 && (
            <>
              <div className="grupo">Pedidos</div>
              <table className="tabela">
                <thead><tr><th>Data</th><th>Vendedor</th><th>Qtd</th><th>Preço</th><th>vs último</th><th>Marca</th></tr></thead>
                <tbody>
                  {h.pedidos.map((p, i) => (
                    <tr key={`p${i}`}>
                      <td>{ddmm(p.data_referencia)}</td><td>{p.vendedor}</td><td>{p.qtd}</td>
                      <td>{p.preco == null ? 'sem conversão' : reais(p.preco)}</td>
                      <td>{p.comparavel && p.ultimo != null && p.preco != null
                        ? `${p.preco > p.ultimo ? '+' : p.preco < p.ultimo ? '−' : ''}${textoPct(p.preco / p.ultimo - 1)}`
                        : '—'}</td>
                      <td>{p.marca ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {h.compras_sischef.length === 0 && h.cotacoes.length === 0 && h.pedidos.length === 0 && (
            <p className="vazio">Ainda não há histórico deste produto no período.</p>
          )}
        </>
      )}
    </section>
  )
}
