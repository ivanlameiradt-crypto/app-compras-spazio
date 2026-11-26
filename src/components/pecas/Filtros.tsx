import { useId, type ReactNode } from 'react'
import { Icone } from '../Icones'
import Folha from './Folha'

// Peças de lista e filtros do manual visual v2 (seção 5B), adaptadas das do Tiquei (src/componentes/filtros/*) para o CSS do Comprar (sem Tailwind).

/** Busca (campo de 56 px) + botão "Filtros" com a quantidade de filtros ligados. */
export function BuscaFiltros({ valor, aoMudar, rotulo, placeholder, ligados, aoAbrir }: {
  valor: string; aoMudar: (v: string) => void; rotulo: string; placeholder?: string; ligados: number; aoAbrir: () => void
}) {
  return (
    <div className="busca-linha">
      <label className="busca-campo">
        <span className="so-leitor">{rotulo}</span>
        <Icone nome="busca" tamanho={22} />
        <input type="search" value={valor} placeholder={placeholder ?? rotulo} onChange={(e) => aoMudar(e.target.value)} />
      </label>
      <button type="button" className="botao-filtros" onClick={aoAbrir}>
        <Icone nome="funil" tamanho={22} />
        <span>Filtros</span>
        {ligados > 0 && <b className="filtros-n">{ligados}</b>}
      </button>
    </div>
  )
}

export interface Ficha { chave: string; rotulo: string; aoTirar: () => void }

/** Um filtro ligado = uma ficha com "×" (48 px): tocar tira o filtro. */
export function Fichas({ fichas }: { fichas: Ficha[] }) {
  if (fichas.length === 0) return null
  return (
    <ul className="fichas" aria-label="Filtros ligados">
      {fichas.map((f) => (
        <li key={f.chave}>
          <button type="button" className="ficha" aria-label={`Tirar o filtro ${f.rotulo}`} onClick={f.aoTirar}>
            {f.rotulo}<Icone nome="fechar" tamanho={20} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export interface OpcaoFiltro { valor: string; contagem: number }

/** Um grupo de opções da gaveta: pílulas de 48 px com a contagem; escolhe UMA por vez, tocar de novo na escolhida tira o filtro. Sem itens, a opção fica apagada. */
export function GrupoFiltro({ titulo, opcoes, valor, aoEscolher }: { titulo: string; opcoes: OpcaoFiltro[]; valor: string | null; aoEscolher: (v: string | null) => void }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="grupo-filtro">
      <h3 id={id}>{titulo}{valor && <small>1 escolhido</small>}</h3>
      <div className="grupo-filtro-opcoes">
        {opcoes.map((o) => (
          <button key={o.valor} type="button" className="pilula" aria-pressed={valor === o.valor} disabled={o.contagem === 0 && valor !== o.valor}
            onClick={() => aoEscolher(valor === o.valor ? null : o.valor)}>
            {o.valor} <span className="pilula-n">{o.contagem}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Gaveta de filtros: a Folha com título "Filtros", os grupos e o rodapé fixo "Limpar tudo" + "Ver N itens" (o N muda ao vivo). */
export function GavetaFiltros({ aoFechar, aoLimpar, total, unidade = ['item', 'itens'], children }: {
  aoFechar: () => void; aoLimpar: () => void; total: number; unidade?: [string, string]; children: ReactNode
}) {
  return (
    <Folha titulo="Filtros" aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="botao secundario" onClick={aoLimpar}>Limpar tudo</button>
        <button type="button" className="botao" onClick={aoFechar}>Ver {total} {total === 1 ? unidade[0] : unidade[1]}</button>
      </>}>
      {children}
    </Folha>
  )
}

export interface Situacao { valor: string; nome: string; numero: number; tom: 'erro' | 'atencao' | 'ok' | 'info' | 'neutro' }

/** Cartões de situação: contadores grandes (nome + número de 32 px) que também são filtro; tarja de cor no topo; o escolhido fica amarelo. */
export function CartoesSituacao({ situacoes, valor, aoEscolher }: { situacoes: Situacao[]; valor: string | null; aoEscolher: (v: string | null) => void }) {
  return (
    <div className="situacoes" role="group" aria-label="Situação">
      {situacoes.map((s) => (
        <button key={s.valor} type="button" className={`situacao ${s.tom}`} aria-pressed={valor === s.valor} onClick={() => aoEscolher(valor === s.valor ? null : s.valor)}>
          <span className="situacao-nome">{s.nome}</span>{' '}
          <b>{s.numero}</b>
        </button>
      ))}
    </div>
  )
}
