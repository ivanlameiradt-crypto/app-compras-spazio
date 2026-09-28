// "Confirmar pedido" como mapa por item (spec 8.2, item 7; ajuste Foozi 1; contrato 8.3, D44 e D45): preço cotado ×
// último preço, Δ% e a chave "No pedido / Comprar na loja" por item. O App sugere deixar para a loja o que subiu mais de
// 10% (o Ivan aceita com um toque e pode voltar qualquer item), confere o pedido mínimo sobre a mercadoria (sem o frete,
// com segundo toque, sem bloquear) e grava só os itens "No pedido" (cot_gravar_pedido). O WhatsApp com o pedido (10.3) é
// um segundo toque, num link de verdade: nada de janela aberta depois de await.
// O vendedor pode corrigir a resposta até o fechamento, e a releitura de 30 s traz a correção com o mapa aberto. Item
// que mudou de rev depois que o Ivan o viu: a quantidade é refeita na base nova (senão "104" un viraria 104 fardos),
// aparece o aviso "O vendedor mudou o item N…" e o Confirmar pede um segundo toque até o Ivan mexer no item.
// Os avisos do item aparecem no próprio mapa (D64): as pílulas da tabela na linha de cada item; o item parcial começa no
// que o vendedor tem, com "O vendedor disse que tem só X"; o preço que só vale a partir de Y avisa enquanto a quantidade
// está abaixo; unidade suspeita (Δ < −40% ou > +60%) não sai verde, entra em "Confira" e pede o mesmo segundo toque do
// item mudado (o preço da lata digitado como fardo daria −92% e entraria na economia); validade vencida, aviso vermelho.
// Quantidade acima de 1,5 vez a esperada ("90" fardos no lugar de "9"; D67): "Confira a quantidade" na linha e no topo,
// e o mesmo segundo toque, que vale para o número que está na tela (mudou o número, pede de novo).
import { useMemo, useState } from 'react'
import * as api from '../../lib/api'
import { lerNumero } from '../../lib/regras'
import type { Cotacao, ItemCotacao, ItemPedidoEntrada, Vendedor } from '../../lib/tipos'
import { arred } from '../../cotacao/conversao'
import { ddmm, numeroBr, reais, rotuloVendedor } from '../../cotacao/mensagens'
import {
  faltaParaMinimo, montarPedido, parcial, quantidadeAlta, sugestaoLoja, totalPedido, unidadeSuspeita, valorLinha,
} from '../../cotacao/pedido'
import { chaveCot, useCotacoes } from './contexto'
import { cotadoSisChef, delta, referencia, textoAvisoIvan, textoAvisoVendedor } from './formato'

const virgula = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))
const PLURAL = { fardo: 'fardos', caixa: 'caixas', pacote: 'pacotes', saco: 'sacos' } as const
/** A quantidade que o campo começa mostrando: embalagens na base embalagem, senão a quantidade na unidade do SisChef. */
const qtdInicial = (l: ItemPedidoEntrada) => (l.base === 'embalagem' ? virgula(l.embalagens) : virgula(l.qtd))

/** Linha em cinza: "tem", mas sem comparação confiável com o último preço (antiga, sem referência ou sem conversão). */
const cinza = (i: ItemCotacao) =>
  i.estado === 'tem' && (i.ref_situacao !== 'ok' || i.preco_convertido == null || i.ref_preco == null)
/** As pílulas do item, com os mesmos textos da tabela do cartão. */
const avisosDe = (i: ItemCotacao) => [
  ...(i.avisos_ivan ?? []).map((a) => textoAvisoIvan(a, i)), ...(i.avisos_vendedor ?? []).map(textoAvisoVendedor),
]

export default function ConfirmarPedido({ c, v, onFechar }: { c: Cotacao; v: Vendedor; onFechar: () => void }) {
  const ctx = useCotacoes()
  const itens = useMemo(() => ctx.itensDe(c.id).filter((i) => i.incluido && i.numero != null)
    .sort((a, b) => (a.numero as number) - (b.numero as number)), [ctx, c.id])
  const base = useMemo(() => new Map(montarPedido(itens).map((l) => [l.numero, l])), [itens])
  const sugeridos = useMemo(() => sugestaoLoja(itens), [itens])
  const suspeitos = useMemo(() => unidadeSuspeita(itens), [itens])
  const rotulo = rotuloVendedor(v.empresa)

  // começa com todo item "tem" no pedido; "não tem" e sem resposta ficam fixos em "Comprar na loja"
  const [noPedido, setNoPedido] = useState<Set<number>>(() => new Set(base.keys()))
  const [qtds, setQtds] = useState<Record<number, string>>(() => Object.fromEntries([...base.values()].map((l) => [l.numero, qtdInicial(l)])))
  const [entrega, setEntrega] = useState(c.entrega ?? '')
  const [segundoToque, setSegundoToque] = useState(false)
  const [aviso, setAviso] = useState('')
  // o rev de cada item como o Ivan o viu, os itens que o vendedor mudou depois disso e se o Ivan já viu o aviso
  const [revs, setRevs] = useState(() => new Map(itens.map((i) => [i.numero as number, i.rev])))
  const [mudados, setMudados] = useState<number[]>([])
  // itens que o Ivan já mexeu (ou confirmou com o segundo toque) depois de ver o aviso de "Confira"
  const [conferidos, setConferidos] = useState<Set<number>>(() => new Set())
  const [conferiu, setConferiu] = useState(false)
  // quantidade alta que o Ivan já confirmou com o segundo toque: o número (como está no campo) de cada item
  const [qtdConferida, setQtdConferida] = useState<Record<number, string>>({})

  // releitura com item de rev novo: ajusta o estado já neste render (a tela nunca mostra a quantidade velha na base nova)
  const novos = itens.filter((i) => revs.get(i.numero as number) !== i.rev).map((i) => i.numero as number)
  if (novos.length > 0) {
    setRevs(new Map(itens.map((i) => [i.numero as number, i.rev])))
    setQtds((q) => {
      const r = { ...q }
      for (const n of novos) {
        const l = base.get(n)
        if (l) r[n] = qtdInicial(l)
        else delete r[n]
      }
      return r
    })
    setMudados((ms) => [...new Set([...ms, ...novos])].sort((a, b) => a - b))
    // a resposta nova precisa ser conferida de novo (a quantidade alta também)
    setConferidos((s) => new Set([...s].filter((n) => !novos.includes(n))))
    setQtdConferida((q) => Object.fromEntries(Object.entries(q).filter(([n]) => !novos.includes(Number(n)))))
    setConferiu(false)
    setSegundoToque(false)
  }
  /** O Ivan mexeu no item: ele já está olhando para a resposta nova (e para o aviso de "Confira"). */
  const tocou = (n: number) => {
    setMudados((ms) => (ms.includes(n) ? ms.filter((x) => x !== n) : ms))
    setConferidos((s) => (s.has(n) ? s : new Set([...s, n])))
  }

  const itemDe = (n: number) => itens.find((i) => i.numero === n) as ItemCotacao
  const alternar = (n: number) => {
    setNoPedido((s) => {
      const novo = new Set(s)
      if (novo.has(n)) novo.delete(n)
      else novo.add(n)
      return novo
    })
    tocou(n)
    setSegundoToque(false)
  }
  const aceitarSugestao = () => {
    setNoPedido((s) => new Set([...s].filter((n) => !sugeridos.includes(n))))
    setSegundoToque(false)
  }

  /** O que está no campo de quantidade do item (item que passou a ter preço depois da abertura: a do montarPedido). */
  const valorNaTela = (n: number) => qtds[n] ?? qtdInicial(base.get(n) as ItemPedidoEntrada)

  /** A linha como vai ao banco, com a quantidade da tela, ou o motivo de não poder ir. */
  function linhaDaTela(n: number): ItemPedidoEntrada | string {
    const l = base.get(n) as ItemPedidoEntrada
    const q = lerNumero(valorNaTela(n))
    if (l.base === 'embalagem') {
      if (q === null || q < 1 || !Number.isInteger(q)) return `item ${n}: diga quantas embalagens (número inteiro)`
      // com fator (un ou kg por embalagem) a quantidade acompanha as embalagens; sem ele fica a do montarPedido (a
      // aprovada, ou o que o vendedor tem no item parcial; D44, D64)
      return { ...l, embalagens: q, qtd: l.fator != null ? arred(q * l.fator, 4) : l.qtd }
    }
    if (q === null || q <= 0) return `item ${n}: quantidade inválida`
    return { ...l, qtd: q }
  }

  const escolhidos = [...noPedido].filter((n) => base.has(n)).sort((a, b) => a - b)
  const linhas = escolhidos.map((n) => ({ n, l: linhaDaTela(n) }))
  const erros = linhas.filter((x): x is { n: number; l: string } => typeof x.l === 'string').map((x) => x.l)
  const validas = linhas.filter((x): x is { n: number; l: ItemPedidoEntrada } => typeof x.l !== 'string').map((x) => x.l)
  const t = totalPedido(validas.map((l) => ({ ...l, preco_convertido: itemDe(l.numero).preco_convertido })), c.frete)
  // linha com a quantidade ainda por digitar (ex.: caixas em ml sem kg por litro) também fica "sem total"
  const semTotal = [...t.semTotal, ...linhas.filter((x) => typeof x.l === 'string').map((x) => x.n)].sort((a, b) => a - b)
  const falta = faltaParaMinimo(t.itens, c.pedido_minimo)
  const sugeridosNoPedido = sugeridos.filter((n) => noPedido.has(n))
  const naoCotados = itens.filter((i) => i.estado !== 'tem')
  /** "Preço só a partir de Y": a quantidade na tela está abaixo de Y (o vendedor cobraria outro preço). */
  const abaixoDoMinimoDoPreco = (n: number) => {
    const i = itemDe(n)
    const m = linhaDaTela(n)
    return i.a_partir_de != null && typeof m !== 'string' && m.qtd < Number(i.a_partir_de)
  }
  // "Confira": itens no pedido com unidade suspeita ou abaixo do "a partir de", que o Ivan ainda não mexeu depois do aviso
  const confira = escolhidos.filter((n) => (suspeitos.includes(n) || abaixoDoMinimoDoPreco(n)) && !conferidos.has(n))
  const motivoConfira = (n: number) => {
    const i = itemDe(n)
    const motivos: string[] = []
    if (suspeitos.includes(n)) motivos.push(`${delta(i).texto}, ${textoAvisoIvan('unidade_suspeita', i)}`)
    if (abaixoDoMinimoDoPreco(n)) motivos.push(`preço só a partir de ${numeroBr(Number(i.a_partir_de))} ${i.unidade}`)
    return `${i.nome} (${motivos.join('; ')})`
  }
  /** A quantidade na tela passa de 1,5 × a esperada (D67): 90 fardos no lugar de 9. */
  const qtdAlta = (n: number) => {
    const m = linhaDaTela(n)
    return typeof m !== 'string' && quantidadeAlta(m.qtd, itemDe(n), (base.get(n) as ItemPedidoEntrada).qtd)
  }
  // as de quantidade alta que o Ivan ainda não confirmou com este número no campo
  const altas = escolhidos.filter((n) => qtdAlta(n) && qtdConferida[n] !== valorNaTela(n))
  const motivoAlta = (n: number) => {
    const i = itemDe(n)
    const m = linhaDaTela(n) as ItemPedidoEntrada
    return `${i.nome} (${numeroBr(m.qtd)} ${i.unidade} no pedido × ${numeroBr(i.qtd)} aprovados)`
  }
  const vencido = c.validade != null && c.validade < ctx.hoje
  // segundo toque (D57, D64, D67): item que o vendedor mudou, item de "Confira" e quantidade alta
  const pendentes = mudados.length > 0 || confira.length > 0 || altas.length > 0

  async function confirmar() {
    if (erros.length > 0) { setAviso(erros.join('; ')); return }
    if (validas.length === 0) return
    if (pendentes) {
      if (!conferiu) { setConferiu(true); return }
      setMudados([])
      setConferidos((s) => new Set([...s, ...confira]))
      setQtdConferida((q) => ({ ...q, ...Object.fromEntries(altas.map((n) => [n, valorNaTela(n)])) }))
    }
    if (falta != null && !segundoToque) { setSegundoToque(true); return }
    setAviso('')
    await ctx.acao(chaveCot(c), async () => {
      const gravado = await api.gravarPedido(c.id, validas)
      ctx.mudarSessao(c.id, { pedido: gravado, entrega })
      onFechar()
    })
  }

  const motivoSemTotal = (n: number) => {
    const b = base.get(n)?.base
    return b === 'litro' ? 'preço por litro sem conversão' : b === 'embalagem' ? 'falta dizer quantas embalagens' : 'quantidade inválida'
  }

  return (
    <div className="formulario" data-testid="confirmar-pedido">
      <div className="nome">Pedido com {v.nome} — v{c.versao}</div>
      {vencido && (
        <p className="erro" data-testid="preco-vencido">
          Preço vencido em {ddmm(c.validade as string)}: confirme com o vendedor se os preços ainda valem antes de fechar
        </p>
      )}
      {mudados.map((n) => (
        <p key={n} className="amarelo" data-testid={`mudou-${n}`}>O vendedor mudou o item {n} depois que você abriu o pedido: confira</p>
      ))}
      {(sugeridosNoPedido.length > 0 || confira.length > 0 || altas.length > 0) && (
        <div className="amarelo" data-testid="sugestao">
          {sugeridosNoPedido.length > 0 && (
            <div>
              Sugestão: deixar {sugeridosNoPedido.length} {sugeridosNoPedido.length === 1 ? 'item' : 'itens'} para a loja (
              {sugeridosNoPedido.map((n) => `${itemDe(n).nome} ${delta(itemDe(n)).texto}`).join(', ')})
            </div>
          )}
          {confira.length > 0 && (
            <div data-testid="confira">Confira antes de confirmar: {confira.map(motivoConfira).join(' · ')}</div>
          )}
          {altas.length > 0 && (
            <div data-testid="confira-quantidade">Confira a quantidade: {altas.map(motivoAlta).join(' · ')}</div>
          )}
          {naoCotados.length > 0 && (
            <div className="sub">{naoCotados.map((i) => `${i.nome}: ${i.estado === 'nao_tem' ? 'não tem' : 'sem resposta'}`).join(' · ')}</div>
          )}
          {sugeridosNoPedido.length > 0 && <button className="botao secundario" onClick={aceitarSugestao}>Aceitar sugestão</button>}
        </div>
      )}
      <div className="rolagem">
        <table className="tabela-cot mapa-pedido">
          <thead>
            <tr><th>nº</th><th>Item</th><th>Marca</th><th>Cotado R$</th><th>Último R$</th><th>Δ%</th><th>Pedido</th></tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const n = i.numero as number
              const dl = delta(i)
              const tem = base.has(n)
              const dentro = noPedido.has(n)
              const avisos = avisosDe(i)
              return (
                <tr key={i.id} data-testid={`mapa-${n}`} className={cinza(i) ? 'cinza' : undefined}>
                  <td>{n}</td>
                  <td>
                    {i.nome}
                    {avisos.length > 0 && (
                      <div data-testid={`avisos-${n}`}>{avisos.map((a) => <span key={a} className="pill">{a}</span>)}</div>
                    )}
                  </td>
                  <td>{i.marca_informada ?? ''}</td>
                  <td>{cotadoSisChef(i)}</td>
                  <td className={i.ref_situacao === 'antiga' ? 'delta antiga' : undefined}>
                    {i.ref_situacao === 'sem_referencia' || i.ref_preco == null ? '—' : referencia(i)}
                  </td>
                  {/* unidade suspeita nunca sai verde: −92% é quase sempre o preço da unidade digitado como embalagem */}
                  <td className={suspeitos.includes(n) ? 'delta suspeita' : dl.classe}>{dl.texto}</td>
                  <td>
                    {tem ? (
                      <button className={dentro ? 'chave on' : 'chave'} aria-pressed={dentro} aria-label={`Item ${n}: ${dentro ? 'No pedido' : 'Comprar na loja'}`}
                        onClick={() => alternar(n)}>
                        {dentro ? 'No pedido' : 'Comprar na loja'}
                      </button>
                    ) : (
                      <span className="sub">Comprar na loja ({i.estado === 'nao_tem' ? 'não tem' : 'sem resposta'})</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {escolhidos.map((n) => {
        const i = itemDe(n)
        const l = base.get(n) as ItemPedidoEntrada
        const m = linhaDaTela(n)
        const emb = l.base === 'embalagem'
        const nomeEmb = i.embalagem ? PLURAL[i.embalagem] : 'embalagens'
        const valor = typeof m === 'string' ? null : valorLinha({ ...m, preco_convertido: i.preco_convertido })
        return (
          <div key={n} className="linha-form" role="group" aria-label={`Pedido item ${n}`}>
            <div><b>{n}.</b> {i.nome}</div>
            <div className="campos">
              <label>{emb ? `${nomeEmb}${l.fator != null ? ` (${i.unidade === 'un' ? `c/${numeroBr(l.fator)}` : `${numeroBr(l.fator)} kg`})` : ''}` : `Quantidade (${i.unidade})`}
                {/* um número novo no campo volta a pedir o segundo toque (o "Confirmar mesmo assim" era para o de antes) */}
                <input aria-label={`Quantidade do item ${n}`} inputMode="decimal" value={valorNaTela(n)}
                  onChange={(e) => { setQtds((q) => ({ ...q, [n]: e.target.value })); tocou(n); setSegundoToque(false); setConferiu(false) }} />
              </label>
            </div>
            <div className="sub">
              {typeof m === 'string'
                ? <span className="erro">{m}</span>
                : `${numeroBr(m.qtd)} ${i.unidade} no pedido × ${numeroBr(i.qtd)} aprovados${valor != null ? ` · ${reais(valor)}` : ''}`}
            </div>
            {typeof m !== 'string' && qtdAlta(n) && (
              <div className="amarelo" data-testid={`qtd-alta-${n}`}>
                Confira a quantidade: mais de 1,5 vez o aprovado{emb ? ` (${numeroBr(m.embalagens ?? 0)} ${nomeEmb})` : ''}
              </div>
            )}
            {parcial(i) && (
              <div className="amarelo" data-testid={`parcial-${n}`}>
                O vendedor disse que tem só {numeroBr(Number(i.tenho_so))} {i.unidade} (de {numeroBr(i.qtd)} aprovados): o pedido começa aí
              </div>
            )}
            {abaixoDoMinimoDoPreco(n) && (
              <div className="amarelo" data-testid={`a-partir-${n}`}>
                Preço só a partir de {numeroBr(Number(i.a_partir_de))} {i.unidade}: abaixo disso o vendedor pode cobrar outro preço
              </div>
            )}
          </div>
        )
      })}

      <p className="nome" data-testid="total-pedido">
        Itens {reais(t.itens)} · {c.frete == null ? 'Frete não informado' : Number(c.frete) === 0 ? 'Frete grátis' : `Frete ${reais(t.frete)}`}
        {' · '}Total com frete {reais(t.total)}
      </p>
      {semTotal.map((n) => <p key={n} className="sub">+ item {n} sem total ({motivoSemTotal(n)})</p>)}
      {falta != null && (
        <p className="erro" data-testid="aviso-minimo">
          Abaixo do mínimo do {rotulo} ({reais(Number(c.pedido_minimo))}): faltam {reais(falta)}
        </p>
      )}
      <label className="campo-entrega">Entrega
        <input aria-label="Entrega" value={entrega} placeholder="a combinar" onChange={(e) => setEntrega(e.target.value)} />
      </label>
      {aviso && <p className="erro">{aviso}</p>}
      <div className="acoes">
        {validas.length === 0 && erros.length === 0 ? (
          <button className="botao" disabled>Nenhum item no pedido: use Obrigado, desta vez não</button>
        ) : (
          <button className="botao" disabled={ctx.ocupado} onClick={confirmar}>
            {pendentes
              ? (!conferiu ? 'Confirmar pedido' : mudados.length > 0 ? 'Confirmar com as mudanças do vendedor' : 'Confirmar mesmo assim')
              : falta != null && segundoToque ? 'Confirmar mesmo abaixo do mínimo' : 'Confirmar pedido'}
          </button>
        )}
        <button className="botao secundario" onClick={onFechar}>Fechar</button>
      </div>
    </div>
  )
}
