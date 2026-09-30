import { useEffect, useMemo, useState } from 'react'
import type { ProdutoCadastro, Vendedor } from '../../lib/tipos'
import { mensagemDeErro } from '../../lib/regras'
import * as cad from '../../cadastros/api'
import { textoFator } from '../../cadastros/regras'
import ProdutoDetalhe from './ProdutoDetalhe'

type Filtro = 'todos' | 'sem_vendedor' | 'ultima_compra' | 'confirmada' | 'liquidos_sem_conversao' | 'com_nota' | 'com_regra'
const FILTROS: { id: Filtro; nome: string }[] = [
  { id: 'todos', nome: 'Todos' },
  { id: 'sem_vendedor', nome: 'Sem vendedor' },
  { id: 'ultima_compra', nome: 'Pela última compra' },
  { id: 'confirmada', nome: 'Embalagem confirmada' },
  { id: 'liquidos_sem_conversao', nome: 'Líquidos sem conversão' },
  { id: 'com_nota', nome: 'Com nota' },
  { id: 'com_regra', nome: 'Com regra' },
]

function casa(p: ProdutoCadastro, f: Filtro): boolean {
  switch (f) {
    case 'sem_vendedor': return p.vendedor_id == null
    case 'ultima_compra': return p.via === 'ultima_compra'
    case 'confirmada': return p.fator_confirmado_em != null
    case 'liquidos_sem_conversao': return p.vende_por_litro && p.kg_por_litro == null
    case 'com_nota': return p.nota_vendedor != null
    case 'com_regra': return p.regra != null
    default: return true
  }
}

export default function Produtos({ produtoInicial }: { produtoInicial?: string | null }) {
  const [produtos, setProdutos] = useState<ProdutoCadastro[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [selecionado, setSelecionado] = useState<number | null>(produtoInicial ? Number(produtoInicial) : null)

  async function carregar() {
    try {
      const [p, v] = await Promise.all([cad.produtosCadastro(), cad.listarVendedores()])
      setProdutos(p); setVendedores(v)
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  useEffect(() => { carregar() }, [])

  const lista = useMemo(() => produtos.filter((p) => casa(p, filtro) &&
    (busca.trim() === '' || p.produto.toLowerCase().includes(busca.trim().toLowerCase()))), [produtos, filtro, busca])

  const rotulo = (id: number | null) => { const v = vendedores.find((x) => x.id === id); return v ? v.empresa.split('(')[0].trim() : '' }

  const atual = selecionado != null ? produtos.find((p) => p.produto_id === selecionado) : undefined
  if (atual) {
    return <ProdutoDetalhe produto={atual} vendedores={vendedores} aoVoltar={() => setSelecionado(null)}
      aoMudar={async () => { await carregar() }} />
  }

  return (
    <div className="coluna">
      {erro && <p className="erro">{erro}</p>}
      <input aria-label="Buscar produto" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="menu filtros">
        {FILTROS.map((f) => (
          <button key={f.id} className={filtro === f.id ? 'ativa' : ''} onClick={() => setFiltro(f.id)}>{f.nome}</button>
        ))}
      </div>
      {lista.map((p) => (
        <button key={p.produto_id} className="cartao linha-produto" onClick={() => setSelecionado(p.produto_id)}>
          <strong>{p.produto}</strong>
          <div className="sub">
            {p.vendedor_id != null
              ? `${rotulo(p.vendedor_id)}${p.via === 'catalogo' ? ', fixo' : ', pela última compra'}`
              : `Sem vendedor: ${p.motivo === 'nunca_comprado' ? 'nunca comprado' : `fornecedor sem vendedor cadastrado: ${p.fornecedor_ultima ?? ''}`}`}
          </div>
          <div className="pilulas">
            {p.fator != null && p.embalagem && <span className="pilula">{textoFator(p.embalagem, Number(p.fator), p.unidade)}{p.fator_confirmado_em ? ' ✓' : ''}</span>}
            {p.vende_por_litro && <span className="pilula">por litro{p.kg_por_litro != null ? ` · 1 L = ${p.kg_por_litro} kg ✓` : ''}</span>}
            {p.nota_vendedor != null && <span className="pilula">nota</span>}
            {p.regra != null && <span className="pilula">{p.regra === 'barrar' ? 'fora por regra' : 'na lista pela regra'}</span>}
            {p.a_confirmar > 0 && <span className="pilula alerta">a confirmar {p.a_confirmar}</span>}
          </div>
        </button>
      ))}
    </div>
  )
}
