import { useEffect, useState } from 'react'
import type { HistoricoItem, ProdutoCadastro, TipoEmbalagem, Vendedor } from '../../lib/tipos'
import { mensagemDeErro } from '../../lib/regras'
import * as api from '../../lib/api'
import * as cad from '../../cadastros/api'
import { textoFator } from '../../cadastros/regras'
import { kgPorLitro as textoKg, soltarVendedor as textoSoltar } from '../../cadastros/textos'

/** "R$" ou número com vírgula: o mesmo aviso da 1B (8.2) — o vendedor nunca vê preço. */
const pareceValor = (t: string) => /r\$|\d\s*,\s*\d/i.test(t)
const rotuloDe = (empresa: string) => empresa.split('(')[0].trim()

export default function ProdutoDetalhe({ produto, vendedores, aoVoltar, aoMudar }: {
  produto: ProdutoCadastro; vendedores: Vendedor[]; aoVoltar: () => void; aoMudar: () => Promise<void>
}) {
  const [erro, setErro] = useState('')
  const [nome, setNome] = useState(produto.nome_para_vendedor ?? '')
  const [nota, setNota] = useState(produto.nota_vendedor ?? '')
  const [emb, setEmb] = useState<TipoEmbalagem>((produto.embalagem as TipoEmbalagem) ?? 'fardo')
  const [fator, setFator] = useState(produto.fator != null ? String(produto.fator) : '')
  const [historico, setHistorico] = useState<HistoricoItem | null>(null)
  const rotulo = (id: number | null) => { const v = vendedores.find((x) => x.id === id); return v ? rotuloDe(v.empresa) : '' }

  useEffect(() => { api.historicoItem(produto.produto_id, null, null).then(setHistorico).catch(() => undefined) }, [produto.produto_id])

  const proteger = async (fn: () => Promise<void>) => { try { setErro(''); await fn(); await aoMudar() } catch (e) { setErro(mensagemDeErro(e)) } }

  async function gravarNome() {
    if (nome.trim() && pareceValor(nome) && !window.confirm('O nome tem "R$" ou vírgula — o vendedor não pode ver preço. Gravar assim mesmo?')) return
    await proteger(() => cad.definirNome(produto.produto_id, nome.trim() || null))
  }
  async function gravarNota() {
    if (nota.trim() && pareceValor(nota) && !window.confirm('A nota tem "R$" ou vírgula — o vendedor não pode ver preço. Gravar assim mesmo?')) return
    await proteger(() => api.definirNota(produto.produto_id, nota.trim() || null))
  }
  async function definirFator() {
    const f = Number(fator.replace(',', '.'))
    if (!Number.isFinite(f) || f <= 0) { setErro('informe o fator'); return }
    if (produto.unidade === 'un' && !Number.isInteger(f)) { setErro('em item por unidade o fator é um número inteiro, ex.: 12'); return }
    const v = produto.vendedor_id ?? produto.vendedor_motivo_id
    if (v == null) { setErro('escolha o vendedor do produto antes'); return }
    await proteger(() => cad.confirmarFator(produto.produto_id, v, emb, f, 'ivan').then(() => undefined))
  }

  return (
    <div className="coluna">
      <button className="link" onClick={aoVoltar}>← Voltar</button>
      <h3>{produto.produto}</h3>
      {erro && <p className="erro">{erro}</p>}

      <div className="cartao coluna">
        <strong>Vendedor</strong>
        <p className="sub">{produto.vendedor_id != null ? `${rotulo(produto.vendedor_id)} (${produto.via === 'catalogo' ? 'fixo' : 'pela última compra'})` : 'Sem vendedor'}</p>
        <select aria-label="Trocar vendedor" defaultValue="" onChange={(e) => e.target.value && proteger(() => api.definirVendedor(produto.produto_id, Number(e.target.value)))}>
          <option value="" disabled>Trocar vendedor…</option>
          {vendedores.filter((v) => v.ativo).map((v) => <option key={v.id} value={v.id}>{rotuloDe(v.empresa)}</option>)}
        </select>
        {produto.vendedor_id != null && (
          <button className="link" onClick={() => { if (window.confirm(textoSoltar(rotulo(produto.vendedor_id)))) proteger(() => cad.soltarVendedor(produto.produto_id)) }}>
            Voltar a seguir a última compra
          </button>
        )}
      </div>

      <div className="cartao coluna">
        <strong>Nome para o vendedor</strong>
        <input aria-label="Nome para o vendedor" placeholder={produto.nome_limpo} value={nome} onChange={(e) => setNome(e.target.value)} />
        <button className="botao" onClick={gravarNome}>Gravar</button>
      </div>

      <div className="cartao coluna">
        <strong>Nota ao vendedor</strong>
        <input aria-label="Nota ao vendedor" value={nota} onChange={(e) => setNota(e.target.value)} />
        <button className="botao" onClick={gravarNota}>Gravar</button>
      </div>

      <div className="cartao coluna">
        <strong>Embalagem padrão</strong>
        <p className="sub">{produto.fator != null && produto.embalagem
          ? `${textoFator(produto.embalagem, Number(produto.fator), produto.unidade)}${produto.fator_confirmado_em ? ' · confirmado' : ''}`
          : 'sem embalagem padrão'}</p>
        <div className="linha">
          <select aria-label="Tipo de embalagem" value={emb} onChange={(e) => setEmb(e.target.value as TipoEmbalagem)}>
            {(['fardo', 'caixa', 'pacote', 'saco'] as TipoEmbalagem[]).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input aria-label="Fator" value={fator} onChange={(e) => setFator(e.target.value)} placeholder="ex.: 12" />
          <button className="botao" onClick={definirFator}>Definir</button>
          {produto.fator != null && <button className="link" onClick={() => proteger(() => cad.tirarFator(produto.produto_id))}>Tirar</button>}
        </div>
      </div>

      {produto.unidade === 'kg' && (
        <div className="cartao coluna">
          <strong>Líquido</strong>
          <label><input type="checkbox" aria-label="Vendido por litro" checked={produto.vende_por_litro}
            onChange={(e) => proteger(() => cad.definirLitro(produto.produto_id, e.target.checked))} /> Vendido por litro</label>
          {produto.vende_por_litro && (
            <div className="linha">
              <span>1 L = {produto.kg_por_litro != null ? `${produto.kg_por_litro} kg` : '? kg'}</span>
              <button className="botao" onClick={() => { if (window.confirm(textoKg(produto.produto, 1))) proteger(() => cad.confirmarKgPorLitro(produto.produto_id, 1)) }}>1 L = 1 kg</button>
              {produto.kg_por_litro != null && <button className="link" onClick={() => proteger(() => cad.confirmarKgPorLitro(produto.produto_id, null))}>Tirar</button>}
            </div>
          )}
        </div>
      )}

      {(produto.descricao_fornecedor || produto.codigo_fornecedor) && (
        <div className="cartao coluna">
          <strong>Descrição e código do fornecedor</strong>
          <p className="sub">{produto.descricao_fornecedor}{produto.codigo_fornecedor ? ` · cód. ${produto.codigo_fornecedor}` : ''}</p>
        </div>
      )}

      <div className="cartao coluna">
        <strong>Últimas cotações</strong>
        {historico == null || historico.pedidos.length === 0
          ? <p className="sub">sem pedidos ainda</p>
          : historico.pedidos.slice(0, 8).map((p, i) => (
            <p key={i} className="sub">{p.data_referencia} · {p.vendedor} · {p.preco != null ? `R$ ${p.preco}` : '—'}
              {p.ultimo != null ? ` · último R$ ${p.ultimo}` : ''}</p>
          ))}
      </div>
    </div>
  )
}
