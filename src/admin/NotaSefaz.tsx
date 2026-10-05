// Aba "Lançamento de nota SEFAZ" (Fase 3). Primeiro passo visível: lista as notas da fila da SEFAZ (cot_nfe,
// situacao 'na_fila') e os últimos lançamentos, com o detalhe clicável — o MESMO componente do cupom
// (DetalheLancamento). Só leitura; o botão "Lançar" é ligado no passo seguinte da construção.
import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { formatarReais } from '../lib/regras'
import type { ItemNotaSefaz, NotaSefazLista } from '../lib/tipos'
import DetalheLancamento, { type LinhaDetalhe } from '../components/DetalheLancamento'

/** Converte um item da NF para a linha genérica do detalhe (descrição · quantidade + unidade). */
const linhaDoItem = (it: ItemNotaSefaz): LinhaDetalhe =>
  ({ descricao: it.descricao ?? 'item', quantidade: it.qtd, unidade: it.unidade_sischef, valor: null })

/** emissao vem como AAAA-MM-DD; mostra dd/mm. */
const ddmm = (iso: string): string => { const p = iso.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso }

export default function NotaSefaz() {
  const [aLancar, setALancar] = useState<NotaSefazLista[]>([])
  const [lancadas, setLancadas] = useState<NotaSefazLista[]>([])
  const [falha, setFalha] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null) // qual lançada está aberta mostrando o detalhe

  function carregar() {
    setCarregando(true)
    Promise.all([api.notasALancar(), api.notasLancadas()])
      .then(([a, l]) => { setALancar(a); setLancadas(l); setFalha(false) })
      .catch(() => setFalha(true))
      .finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [])

  return (
    <section className="coluna cupom">
      <h2>Lançamento de nota SEFAZ</h2>
      <p className="sub">Modo: eu disparo — você confere e manda lançar (o automático vem depois).</p>

      <div className="grupo">Notas a lançar</div>
      {falha && <p className="erro" role="alert">Não consegui carregar as notas.</p>}
      {!falha && (aLancar.length === 0
        ? <p className="sub">{carregando ? 'Carregando…' : 'Nenhuma nota pendente da SEFAZ agora.'}</p>
        : (
          <>
            <ul className="recentes">
              {aLancar.map((n) => (
                <li key={n.chave} data-testid="nota-a-lancar">
                  <div className="recente-linha">
                    <span><b>{n.emitente}</b> · NF {n.numero} · {ddmm(n.emissao)}{n.valor_nf != null && ` · ${formatarReais(n.valor_nf)}`}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="sub">O botão “Lançar” entra no próximo passo da construção.</p>
          </>
        ))}

      <div className="grupo">Últimos lançamentos</div>
      {!falha && (lancadas.length === 0
        ? <p className="sub">{carregando ? '' : 'Nenhuma nota lançada ainda.'}</p>
        : (
          <ul className="recentes">
            {lancadas.map((n) => {
              const aberto = expandido === n.chave
              return (
                <li key={n.chave} data-testid="nota-lancada">
                  <button type="button" className="recente-linha" aria-expanded={aberto}
                    onClick={() => setExpandido(aberto ? null : n.chave)}>
                    <span><b>lançada ✓</b> · {n.emitente} · NF {n.numero}{n.valor_nf != null && ` · ${formatarReais(n.valor_nf)}`}</span>
                    <span className="seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                  </button>
                  {aberto && <DetalheLancamento rotulo="NF no SisChef" pedido={n.nf_sischef} itens={n.itens.map(linhaDoItem)} />}
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
