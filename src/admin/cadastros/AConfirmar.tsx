import { useEffect, useState } from 'react'
import type { FatorAConfirmar, ProdutoCadastro, TipoEmbalagem, Vendedor } from '../../lib/tipos'
import { mensagemDeErro } from '../../lib/regras'
import * as cad from '../../cadastros/api'
import { textoFator } from '../../cadastros/regras'

const rotuloDe = (empresa: string) => empresa.split('(')[0].trim()

function CartaoFator({ f, rotulo, aoConfirmar, aoDescartar }: {
  f: FatorAConfirmar; rotulo: string
  aoConfirmar: (f: FatorAConfirmar, emb: string) => void; aoDescartar: (f: FatorAConfirmar) => void
}) {
  const [emb, setEmb] = useState<TipoEmbalagem>((f.embalagem_sugerida as TipoEmbalagem) ?? 'fardo')
  const texto = textoFator(emb, Number(f.fator), f.unidade)
  return (
    <div className="cartao coluna" data-produto={f.produto_id}>
      <strong>{f.produto} · {rotulo}</strong>
      <p className="sub">
        {f.origem === 'nfe'
          ? `a NF-e ${f.ref} do ${rotulo} trouxe esse fator`
          : `o ${rotulo} cotou em ${texto}${f.vezes > 1 ? ` (${f.vezes} semanas)` : ''}`}
      </p>
      {f.conflito
        ? <p className="sub alerta">Padrão atual: {f.padrao_embalagem} c/{f.padrao_fator} (confirmado). O {rotulo} cotou {texto}.</p>
        : <p className="sub">Hoje: sem embalagem padrão.</p>}
      <div className="linha">
        <select aria-label={`Tipo para ${f.produto}`} value={emb} onChange={(e) => setEmb(e.target.value as TipoEmbalagem)}>
          {(['fardo', 'caixa', 'pacote', 'saco'] as TipoEmbalagem[]).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="botao" onClick={() => aoConfirmar(f, emb)}>
          {f.conflito ? `Trocar o padrão para ${texto}` : `Usar ${texto} como padrão`}
        </button>
        <button className="link" onClick={() => aoDescartar(f)}>Não usar</button>
      </div>
    </div>
  )
}

/** C.5: os líquidos em kg ainda sem "1 L = ? kg" — o mesmo predicado do filtro "Líquidos sem conversão" (Produtos). */
export const liquidoSemConversao = (p: ProdutoCadastro) => p.vende_por_litro && p.kg_por_litro == null

export default function AConfirmar({ produtoInicial, aoMudar }: { produtoInicial?: string | null; aoMudar?: () => void }) {
  const [fatores, setFatores] = useState<FatorAConfirmar[]>([])
  const [liquidos, setLiquidos] = useState<ProdutoCadastro[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [erro, setErro] = useState('')

  async function carregar() {
    try {
      const [f, v, p] = await Promise.all([cad.fatoresAConfirmar(), cad.listarVendedores(), cad.produtosCadastro()])
      setFatores(f); setVendedores(v); setLiquidos((p ?? []).filter(liquidoSemConversao))
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  useEffect(() => { carregar() }, [])
  const rotulo = (id: number) => { const v = vendedores.find((x) => x.id === id); return v ? rotuloDe(v.empresa) : '' }

  async function confirmar(f: FatorAConfirmar, emb: string) {
    if (f.conflito && !window.confirm(`Trocar o padrão de ${f.produto} para ${textoFator(emb, Number(f.fator), f.unidade)}?`)) return
    try {
      setErro('')
      await cad.confirmarFator(f.produto_id, f.vendedor_id, emb, Number(f.fator), f.origem, f.ref)
      await carregar(); aoMudar?.()
    } catch (e) { setErro(mensagemDeErro(e)) }
  }
  async function descartar(f: FatorAConfirmar) {
    try { setErro(''); await cad.descartarFator(f.produto_id, f.vendedor_id, Number(f.fator)); await carregar(); aoMudar?.() }
    catch (e) { setErro(mensagemDeErro(e)) }
  }
  async function gravarKg(p: ProdutoCadastro, kg: number) {
    try { setErro(''); await cad.confirmarKgPorLitro(p.produto_id, kg); await carregar(); aoMudar?.() }
    catch (e) { setErro(mensagemDeErro(e)) }
  }
  async function outroValor(p: ProdutoCadastro) {
    const t = window.prompt(`Quanto 1 L de ${p.produto} vale em kg no SisChef?`)
    if (t == null) return
    const kg = Number(t.replace(',', '.'))
    if (!Number.isFinite(kg) || kg <= 0) { setErro('informe quantos kg tem 1 L (ex.: 0,92)'); return }
    await gravarKg(p, kg)
  }

  const lista = produtoInicial ? fatores.filter((f) => f.produto_id === Number(produtoInicial)) : fatores
  const listaLiquidos = produtoInicial ? liquidos.filter((p) => p.produto_id === Number(produtoInicial)) : liquidos
  return (
    <div className="coluna">
      {erro && <p className="erro">{erro}</p>}
      {lista.length === 0 && listaLiquidos.length === 0 && <p className="sub">Nada a confirmar.</p>}
      {lista.map((f) => (
        <CartaoFator key={`${f.produto_id}-${f.vendedor_id}-${f.fator}`} f={f} rotulo={rotulo(f.vendedor_id)} aoConfirmar={confirmar} aoDescartar={descartar} />
      ))}
      {/* No fim, os líquidos sem conversão (C.5): "quanto 1 L vale em kg no SisChef?" */}
      {listaLiquidos.map((p) => (
        <div key={`liq-${p.produto_id}`} className="cartao coluna" data-liquido={p.produto_id}>
          <strong>{p.produto}</strong>
          <p className="sub">quanto 1 L vale em kg no SisChef?</p>
          <div className="linha">
            <button className="botao" onClick={() => gravarKg(p, 1)}>1 L = 1 kg</button>
            <button className="link" onClick={() => outroValor(p)}>Outro valor…</button>
          </div>
        </div>
      ))}
    </div>
  )
}
