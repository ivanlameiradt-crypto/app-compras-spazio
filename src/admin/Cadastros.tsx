import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type { Usuario } from '../lib/tipos'
import * as cad from '../cadastros/api'
import { FAIXA_VIRADA } from '../cadastros/textos'
import Vendedores from './cadastros/Vendedores'
import Produtos from './cadastros/Produtos'
import AConfirmar, { liquidoSemConversao } from './cadastros/AConfirmar'
import Feriados from './cadastros/Feriados'
import Mudancas from './cadastros/Mudancas'
import Pessoas from './Pessoas'

type Aba = 'vendedores' | 'produtos' | 'confirmar' | 'feriados' | 'pessoas' | 'mudancas'
const ABAS: { id: Aba; nome: string }[] = [
  { id: 'vendedores', nome: 'Vendedores' },
  { id: 'produtos', nome: 'Produtos' },
  { id: 'confirmar', nome: 'A confirmar' },
  { id: 'feriados', nome: 'Feriados' },
  { id: 'pessoas', nome: 'Pessoas' },
  { id: 'mudancas', nome: 'Mudanças' },
]

export default function Cadastros({ usuario }: { usuario: Usuario }) {
  const [params, setParams] = useSearchParams()
  const { id: produtoRota } = useParams() // rota #/cadastros/produto/:id
  const abaParam = params.get('aba') as Aba | null
  const aba: Aba = produtoRota ? 'produtos' : ABAS.some((a) => a.id === abaParam) ? abaParam! : 'vendedores'
  const [nConfirmar, setNConfirmar] = useState(0)

  // O contador N soma as sugestões de fator e os líquidos sem conversão ainda pendentes (C.5).
  const contar = () => Promise.all([cad.fatoresAConfirmar(), cad.produtosCadastro()])
    .then(([f, p]) => setNConfirmar(f.length + (p ?? []).filter(liquidoSemConversao).length))
    .catch(() => undefined)
  useEffect(() => { contar() }, [])

  function irPara(id: Aba) {
    const p = new URLSearchParams(params)
    p.set('aba', id)
    setParams(p, { replace: true })
  }

  return (
    <section>
      <h2>Cadastros</h2>
      <p className="faixa">{FAIXA_VIRADA}</p>
      <nav className="menu subabas">
        {ABAS.map((a) => (
          <button key={a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => irPara(a.id)}>
            {a.nome}{a.id === 'confirmar' && nConfirmar > 0 && <span className="contador">{nConfirmar}</span>}
          </button>
        ))}
      </nav>
      {aba === 'vendedores' && <Vendedores grafiaInicial={params.get('grafia')} />}
      {aba === 'produtos' && <Produtos produtoInicial={produtoRota ?? params.get('produto')} />}
      {aba === 'confirmar' && <AConfirmar produtoInicial={params.get('produto')} aoMudar={() => contar()} />}
      {aba === 'feriados' && <Feriados />}
      {aba === 'pessoas' && <Pessoas usuario={usuario} />}
      {aba === 'mudancas' && <Mudancas />}
    </section>
  )
}
