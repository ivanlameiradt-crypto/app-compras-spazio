// Aba "Compras avulsas" (pedido do Ivan, 10/10/2026): compra feita SEM cupom e SEM nota fiscal. Passos: (1) como foi pago (as mesmas 4 formas do cupom),
// (2) fornecedor no SisChef, (3) os itens: produto (da lista do app/planilha), quantidade e preço. PRÉVIA: a tela já funciona, mas ainda NÃO lança nada.
import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { formatarReais } from '../lib/regras'
import { CONTAS_PIX, FORMAS } from '../cupom/formasPagamento'
import type { FormaCupom, ProdutoCatalogo } from '../lib/tipos'
import { buscarProdutos, rotuloUnidade } from './associacaoRegras'
import { faltaNaLinha, problemaDaCompra, totalDaLinha, totalGeral, type LinhaAvulsa } from './compraAvulsaRegras'

interface Linha extends LinhaAvulsa { chave: number; busca: string }

const linhaVazia = (chave: number): Linha => ({ chave, produtoId: null, quantidade: '', preco: '', busca: '' })

export default function CompraAvulsa() {
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [forma, setForma] = useState<FormaCupom | null>(null)
  const [contaPix, setContaPix] = useState<string | null>(null)
  const [fornecedor, setFornecedor] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia(1)])
  const [proxima, setProxima] = useState(2)
  const [previa, setPrevia] = useState(false)

  useEffect(() => {
    let vivo = true
    api.catalogoProdutos().then((c) => { if (vivo) setCatalogo(c) }).catch(() => { if (vivo) setCatalogo([]) })
    return () => { vivo = false }
  }, [])

  const formaCompleta = forma !== null && (forma !== 'pix' || contaPix !== null)
  const problema = useMemo(() => problemaDaCompra(linhas), [linhas])
  const total = totalGeral(linhas)
  const produtoDe = (id: number | null) => (id === null ? null : catalogo?.find((p) => p.produto_id === id) ?? null)

  function mudar(chave: number, parte: Partial<Linha>) {
    setPrevia(false)
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...parte } : l)))
  }
  function adicionar() { setLinhas((ls) => [...ls, linhaVazia(proxima)]); setProxima((n) => n + 1) }
  function remover(chave: number) { setPrevia(false); setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l.chave !== chave) : [linhaVazia(chave)])) }

  return (
    <section className="coluna cupom compra-avulsa" data-testid="compra-avulsa">
      <h2>Compras avulsas</h2>
      <p className="sub">Compra feita <b>sem cupom fiscal e sem nota fiscal</b>. Você digita o produto, a quantidade e o preço; o robô lança no SisChef como um pedido de compra: entra no estoque e, conforme a forma de pagamento, no financeiro.</p>

      <div className="etapa">
        <div className="grupo">1 · Como foi pago</div>
        <div className="chips" role="group" aria-label="Forma de pagamento">
          {FORMAS.map((f) => (
            <button key={f.forma} type="button" className={`chip${forma === f.forma ? ' ativo' : ''}`} aria-pressed={forma === f.forma}
              onClick={() => { setForma(f.forma); setContaPix(null); setPrevia(false) }}>{f.rotulo}</button>
          ))}
        </div>
        {forma === 'pix' && (
          <>
            <p className="sub">Banco e empresa do PIX</p>
            <div className="chips" role="group" aria-label="Banco e empresa do PIX">
              {CONTAS_PIX.map((c) => (
                <button key={c.conta} type="button" className={`chip${contaPix === c.conta ? ' ativo' : ''}`} aria-pressed={contaPix === c.conta}
                  onClick={() => { setContaPix(c.conta); setPrevia(false) }}>{c.rotulo}</button>
              ))}
            </div>
          </>
        )}
        {forma === 'sem_cartao' && <p className="sub" data-testid="aviso-sem-financeiro">Só dá entrada no estoque: nada vai para o financeiro do SisChef.</p>}
        {(forma === 'dinheiro' || forma === 'tesouraria' || forma === 'pix') && <p className="sub" data-testid="aviso-com-financeiro">Entra no estoque e no financeiro, pago à vista hoje.</p>}
      </div>

      <div className="etapa">
        <div className="grupo">2 · Fornecedor no SisChef</div>
        <label>De quem foi comprado
          <input type="text" value={fornecedor} placeholder="ex.: COMPRA AVULSA" autoComplete="off" onChange={(e) => { setFornecedor(e.target.value); setPrevia(false) }} data-testid="fornecedor-avulsa" />
        </label>
        <p className="sub">O SisChef exige um fornecedor em todo pedido de compra.</p>
      </div>

      <div className="etapa">
        <div className="grupo">3 · Itens</div>
        <ul className="itens-avulsa">
          {linhas.map((l, i) => {
            const p = produtoDe(l.produtoId)
            const un = p?.unidade ? rotuloUnidade(p.unidade) : ''
            const achados = l.produtoId === null && catalogo ? buscarProdutos(catalogo, l.busca).itens : []
            const t = totalDaLinha(l)
            const falta = faltaNaLinha(l)
            return (
              <li key={l.chave} data-testid="linha-avulsa">
                <div className="linha-topo"><b>Item {i + 1}</b>
                  <button type="button" className="link" onClick={() => remover(l.chave)} aria-label={`Tirar o item ${i + 1}`}>Tirar</button>
                </div>
                {l.produtoId === null ? (
                  <>
                    <label>Produto
                      <input type="text" value={l.busca} placeholder="Digite o nome do produto" autoComplete="off" onChange={(e) => mudar(l.chave, { busca: e.target.value })} data-testid="busca-produto" />
                    </label>
                    {l.busca.trim() !== '' && (
                      achados.length > 0 ? (
                        <ul className="achados" data-testid="achados">
                          {achados.map((a) => (
                            <li key={a.produto_id}>
                              <button type="button" onClick={() => mudar(l.chave, { produtoId: a.produto_id, busca: '' })}>{a.nome}{a.unidade ? ` · ${rotuloUnidade(a.unidade)}` : ''}</button>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="sub">{catalogo === null ? 'Carregando a lista de produtos…' : 'Nenhum produto com esse nome na lista.'}</p>
                    )}
                  </>
                ) : (
                  <p className="escolhido" data-testid="produto-escolhido"><b>{p?.nome ?? `Produto ${l.produtoId}`}</b>{un && <span className="un"> · entra em {un}</span>}{' '}
                    <button type="button" className="link" onClick={() => mudar(l.chave, { produtoId: null })}>Trocar</button></p>
                )}
                {l.produtoId !== null && (
                  <div className="par">
                    <label>Quantidade{un ? ` (em ${un})` : ''}
                      <input type="text" inputMode="decimal" placeholder="0" value={l.quantidade} autoComplete="off" onChange={(e) => mudar(l.chave, { quantidade: e.target.value })} data-testid="quantidade-avulsa" />
                    </label>
                    <label>Preço{un ? ` por ${un} (R$)` : ' (R$)'}
                      <input type="text" inputMode="decimal" placeholder="0,00" value={l.preco} autoComplete="off" onChange={(e) => mudar(l.chave, { preco: e.target.value })} data-testid="preco-avulsa" />
                    </label>
                  </div>
                )}
                {l.produtoId !== null && (
                  <p className="sub" data-testid="total-linha">{t !== null && falta === '' ? <>Total do item: <b>{formatarReais(t)}</b></> : `Falta: ${falta}.`}</p>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="botao secundario" onClick={adicionar} data-testid="adicionar-item">+ Adicionar outro item</button>
      </div>

      <div className="etapa resumo-avulsa">
        <p data-testid="total-geral"><b>Total da compra: {formatarReais(total)}</b></p>
        {!formaCompleta && <p className="amarelo" data-testid="falta-forma">Escolha como foi pago{forma === 'pix' ? ' (banco e empresa do PIX)' : ''}.</p>}
        {fornecedor.trim() === '' && <p className="amarelo" data-testid="falta-fornecedor">Informe o fornecedor.</p>}
        {problema !== '' && <p className="amarelo" data-testid="problema-avulsa">{problema}</p>}
        <button type="button" className="botao" disabled={!formaCompleta || fornecedor.trim() === '' || problema !== ''} onClick={() => setPrevia(true)} data-testid="lancar-avulsa">Lançar compra</button>
        {previa && <p className="ok" role="status" data-testid="aviso-previa">Prévia: a tela está pronta, mas o envio ao robô ainda não foi ligado. Nada foi lançado no SisChef.</p>}
      </div>
    </section>
  )
}
