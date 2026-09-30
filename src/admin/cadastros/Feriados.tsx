import { useEffect, useState } from 'react'
import type { Feriado } from '../../lib/tipos'
import { mensagemDeErro } from '../../lib/regras'
import * as cad from '../../cadastros/api'

const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

export default function Feriados() {
  const [feriados, setFeriados] = useState<Feriado[]>([])
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [data, setData] = useState('')
  const [nome, setNome] = useState('')

  const carregar = () => cad.listarFeriados().then(setFeriados).catch((e) => setErro(mensagemDeErro(e)))
  useEffect(() => { carregar() }, [])

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    setErro(''); setAviso('')
    try {
      const r = await cad.salvarFeriado(data, nome.trim())
      if (r.muda_aguardando) setAviso("Esse feriado cai nesta semana: o 'Aguardando cotação' dos vendedores ainda não cotados passa a valer até a nova hora.")
      setData(''); setNome('')
      await carregar()
    } catch (err) { setErro(mensagemDeErro(err)) }
  }
  async function tirar(f: Feriado) {
    try { await cad.removerFeriado(f.data); await carregar() } catch (err) { setErro(mensagemDeErro(err)) }
  }

  return (
    <div className="coluna">
      <p className="sub">Dias em que os vendedores não trabalham: o prazo das cotações pula esses dias.</p>
      {erro && <p className="erro">{erro}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <form className="linha cartao" onSubmit={adicionar}>
        <input aria-label="Data do feriado" type="date" required value={data} onChange={(e) => setData(e.target.value)} />
        <input aria-label="Nome do feriado" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" />
        <button className="botao" type="submit">+ feriado</button>
      </form>
      {feriados.map((f) => (
        <div key={f.data} className="cartao linha">
          <span>{f.data} · {f.nome}</span>
          {f.data >= hoje() && <button className="link" onClick={() => tirar(f)}>tirar</button>}
        </div>
      ))}
    </div>
  )
}
