// Corrigir, DENTRO do app, um cupom parado em "precisa de você" por item sem produto confirmado (pedido do Ivan, 07/10): para cada item
// pendente ele escolhe o produto do SisChef (a proposta do sistema ou a busca na lista de insumos), digita a quantidade que está impressa no
// cupom, vê a conferência da soma e toca em "Reenviar para lançar". Até aí NADA sai do aparelho: a soma e as linhas que aparecem aqui são só um
// espelho da conta que a Edge Function confirmar-cupom refaz do zero (mesma fórmula e mesma tolerância do robô). O botão só habilita quando a
// soma bate porque o servidor recusaria de qualquer jeito — é melhor o Ivan ver a diferença e corrigir o peso agora do que receber um erro depois.
import { useMemo, useState } from 'react'
import * as api from '../lib/api'
import { formatarReais } from '../lib/regras'
import type { ConfirmacaoItemCupom, CupomRecente, ItemCupomRecente, ProdutoCatalogo, RespostaConfirmacaoCupom } from '../lib/tipos'
import { buscarProdutos } from './associacaoRegras'
import { ehPeso, itensPendentes, lerQuantidade, linhaConfirmada, podeLembrar, precisaConversao, somaDoCupom, type Confirmada } from './cupomCorrigirRegras'
import { MAX_KG_POR_UNIDADE, entradaEmKg, kgPorUnidadeAbsurdo } from './regraQuilos'

interface Props {
  cupom: CupomRecente
  /** A lista de insumos do app; null = ainda carregando. */
  catalogo: ProdutoCatalogo[] | null
  catalogoFalhou: boolean
  /** O servidor aceitou: o cupom voltou à fila (quem mostra a mensagem e recarrega os "Últimos envios" é a tela de cima). */
  aoReenviar: (r: RespostaConfirmacaoCupom) => void
}

/** O que o Ivan já decidiu sobre UM item pendente. As quantidades ficam como TEXTO (do jeito que ele digitou) até a hora de montar o envio. */
interface EstadoItem {
  produto: ProdutoCatalogo | null
  /** A quantidade impressa no cupom, na unidade do cupom. */
  quantidade: string
  /** Quanto entra no estoque, na unidade do produto — só quando a unidade do cupom é outra (cupom em UN, produto em KG). */
  entrada: string
  /** Quanto vale 1 unidade do cupom na unidade do produto (peso em kg de 1 un, ou unidades em 1 pacote) — o jeito do Ivan pensar; a entrada é quantidade × isto. */
  peso: string
  /** O Ivan viu o aviso de número absurdo (mais de 50 kg por unidade) e disse que é isso mesmo. */
  forcar: boolean
  lembrar: boolean
  confirmado: boolean
}

/** Como a caixa pede o que entra no estoque quando a unidade do cupom é outra (regras do Ivan, 08/10):
 *  'auto' = cupom em gramas e produto em kg: o app divide por 1.000 e não pergunta; 'por_unidade' = cupom em unidade/pacote/maço: pergunta quanto vale
 *  1 unidade (peso em kg, ou unidades por pacote) e o app multiplica; 'total' = qualquer outro par de unidades: o Ivan diz o total (como sempre foi). */
type ModoEntrada = 'nenhum' | 'auto' | 'por_unidade' | 'total'
function modoDaEntrada(it: ItemCupomRecente, produto: ProdutoCatalogo | null): ModoEntrada {
  if (!produto || !precisaConversao(it.unidade_cupom, produto.unidade)) return 'nenhum'
  const destino = minusc(produto.unidade)
  if (destino === 'kg' && /^(g|gr|grs)$/i.test(unid(it.unidade_cupom))) return 'auto'
  if ((destino === 'kg' || destino === 'un') && !ehPeso(it.unidade_cupom)) return 'por_unidade'
  return 'total'
}
const arred3 = (v: number): number => Math.round(v * 1000) / 1000

const unid = (u: string | null | undefined): string => (u ?? '').trim().toUpperCase()
const minusc = (u: string | null | undefined): string => (u ?? '').trim().toLowerCase()
const qtd = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
/** A quantidade que o robô leu no cupom, pronta para o campo (com vírgula): o Ivan só confere, em vez de digitar de novo. */
const quantidadeLida = (it: ItemCupomRecente): string => (it.quantidade_cupom != null && Number(it.quantidade_cupom) > 0 ? qtd(Number(it.quantidade_cupom)) : '')
const estadoInicial = (it: ItemCupomRecente): EstadoItem => ({ produto: null, quantidade: quantidadeLida(it), entrada: '', peso: '', forcar: false, lembrar: true, confirmado: false })

/** A confirmação válida deste item (quantidades lidas e, com conversão, a entrada também), ou null enquanto falta algo. */
function confirmacaoDe(it: ItemCupomRecente, e: EstadoItem): Confirmada | null {
  if (!e.produto) return null
  const quantidade = lerQuantidade(e.quantidade)
  if (quantidade == null) return null
  const modo = modoDaEntrada(it, e.produto)
  if (modo === 'nenhum') return { quantidade, entrada: null }
  if (modo === 'auto') {
    const r = entradaEmKg(it.descricao_cupom, it.unidade_cupom, quantidade)
    return r == null ? null : { quantidade, entrada: r.kg }
  }
  if (modo === 'por_unidade') {
    const peso = lerQuantidade(e.peso)
    if (peso == null) return null
    const entrada = arred3(quantidade * peso)
    if (!(entrada > 0)) return null
    if (minusc(e.produto.unidade) === 'kg' && kgPorUnidadeAbsurdo(entrada, quantidade) && !e.forcar) return null // número absurdo: só com o "é isso mesmo"
    return { quantidade, entrada }
  }
  const entrada = lerQuantidade(e.entrada)
  return entrada == null ? null : { quantidade, entrada }
}

/** A caixa de UM item pendente: escolher o produto → quantidade(s) → "Confirmar este item"; confirmado vira uma linha com ✓ e "Trocar". */
function CaixaItem({ cupom, it, catalogo, catalogoFalhou, estado, mudar, travado }: {
  cupom: CupomRecente; it: ItemCupomRecente; catalogo: ProdutoCatalogo[] | null; catalogoFalhou: boolean
  estado: EstadoItem; mudar: (e: Partial<EstadoItem>) => void
  /** Reenvio em curso: nada pode mudar por baixo do que está sendo mandado. */
  travado: boolean
}) {
  const [texto, setTexto] = useState('')
  const lista = useMemo(() => catalogo ?? [], [catalogo])
  const busca = useMemo(() => buscarProdutos(lista, texto), [lista, texto])
  // a proposta do sistema só vira botão se o produto está na lista de insumos (e não é escondido): fora dela o servidor a recusaria
  const proposta = useMemo(() => {
    const id = Number(it.proposta?.insumo_id)
    if (!Number.isInteger(id) || id <= 0) return null
    const p = lista.find((x) => x.produto_id === id)
    return p && !p.oculto ? p : null
  }, [it.proposta, lista])
  const descricao = (it.descricao_cupom ?? '').replace(/\s+/g, ' ').trim() || 'item'
  const unCupom = minusc(it.unidade_cupom)
  const conf = confirmacaoDe(it, estado)
  const linha = conf ? linhaConfirmada(it, conf) : null
  const converte = estado.produto != null && precisaConversao(it.unidade_cupom, estado.produto.unidade)
  const modo = modoDaEntrada(it, estado.produto)
  const destinoKg = minusc(estado.produto?.unidade) === 'kg'
  const qCupom = lerQuantidade(estado.quantidade)
  const pesoDigitado = lerQuantidade(estado.peso)
  const totalPorPeso = qCupom != null && pesoDigitado != null ? arred3(qCupom * pesoDigitado) : null
  const absurdo = modo === 'por_unidade' && destinoKg && qCupom != null && totalPorPeso != null && kgPorUnidadeAbsurdo(totalPorPeso, qCupom)
  const lembravel = podeLembrar(cupom, it)

  if (estado.confirmado && estado.produto && conf && linha) {
    return (
      <div className="associar-feito">
        <span className="confirmado">✓ {estado.produto.nome} · {qtd(conf.quantidade)} {unCupom} → {formatarReais(linha.valor)}</span>{' '}
        <button type="button" className="link" disabled={travado} onClick={() => mudar({ confirmado: false })}>Trocar</button>
      </div>
    )
  }

  // Com conversão de unidade o "Lembrar" começa DESMARCADO: o que fica guardado é também o fator (1 UN = x KG), e num produto de peso variável
  // (uma peça de queijo) o fator desta compra lançaria a próxima com o peso errado sem ninguém ver. Pacote de peso fixo (lata de 395 g): ele marca.
  // Regras do Ivan (08/10): o peso da embalagem no NOME do cupom ("850g") já vem como sugestão do peso de 1 unidade; cupom em gramas e produto em kg o app
  // converte sozinho. Com a conta vinda do próprio cupom o "Lembrar" já começa marcado (o servidor refaz a conta a cada compra).
  const escolher = (p: ProdutoCatalogo) => {
    const m = modoDaEntrada(it, p)
    const regra = qCupom != null && minusc(p.unidade) === 'kg' ? entradaEmKg(it.descricao_cupom, it.unidade_cupom, qCupom) : null
    const sugerido = m === 'por_unidade' && regra?.regra === 1 && qCupom ? qtd(regra.kg / qCupom) : ''
    mudar({ produto: p, entrada: '', peso: sugerido, forcar: false, lembrar: !precisaConversao(it.unidade_cupom, p.unidade) || m === 'auto' || sugerido !== '' })
    setTexto('')
  }

  return (
    <div className="associar">
      {catalogo === null && !catalogoFalhou && <p className="sub">Carregando a lista de produtos…</p>}
      {catalogoFalhou && <p className="erro" role="alert">Não consegui carregar a lista de produtos. Atualize a página.</p>}

      {catalogo !== null && !estado.produto && (
        <>
          <label>Produto do SisChef
            <input type="text" autoComplete="off" placeholder="Nome, palavra-chave ou código" value={texto} disabled={travado}
              onChange={(e) => setTexto(e.target.value)} />
          </label>
          {proposta && (
            <p className="sub">Proposta do sistema:{' '}
              <button type="button" className="link" disabled={travado} onClick={() => escolher(proposta)}>{proposta.nome}</button>
            </p>
          )}
          {!proposta && it.proposta && (
            <p className="sub">
              Proposta do sistema: {(it.proposta.insumo_nome ?? '').trim() || 'produto'} (cód. {it.proposta.insumo_id}) — não está na sua lista: procure abaixo
            </p>
          )}
          {busca.parcial && (
            <p className="sub">Nenhum produto tem todas essas palavras. Estes têm alguma delas (os mais parecidos primeiro):</p>
          )}
          {busca.itens.length > 0 && (
            <ul className="achados" aria-label="Produtos encontrados" data-testid="achados">
              {busca.itens.map((p) => (
                <li key={p.produto_id}>
                  <button type="button" disabled={travado} onClick={() => escolher(p)}>
                    <span>{p.nome}</span>
                    <span className="sub">
                      cód. {p.produto_id}{p.unidade ? ` · ${unid(p.unidade)}` : ''}{p.nome_sischef ? ` · no SisChef: ${p.nome_sischef}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca.total > busca.itens.length && <p className="sub">Mostrando {busca.itens.length} de {busca.total}: digite mais letras para afinar.</p>}
          {texto.trim() !== '' && busca.total === 0 && (
            <p className="sub">Nada na sua lista de insumos com isso. Tente outra palavra, parte do nome ou o código do SisChef.</p>
          )}
        </>
      )}

      {estado.produto && (
        <>
          <div className="escolhido">
            <b>{estado.produto.nome}</b>{' '}
            <span className="sub">
              <span className="sem-quebra">cód. {estado.produto.produto_id}{estado.produto.unidade ? ` · ${unid(estado.produto.unidade)}` : ''}</span>
              {' · '}
              <button type="button" className="link" disabled={travado} onClick={() => mudar({ produto: null, entrada: '', peso: '', forcar: false })}>Escolher outro</button>
            </span>
          </div>
          <label>{ehPeso(it.unidade_cupom) ? 'Peso' : 'Quantidade'}{unCupom !== '' ? ` (${unCupom})` : ''} que está no cupom
            <input type="text" inputMode="decimal" placeholder={ehPeso(it.unidade_cupom) ? '0,000' : '0'} value={estado.quantidade} disabled={travado}
              onChange={(e) => mudar({ quantidade: e.target.value })} />
          </label>
          {converte && modo === 'auto' && (
            <div className="ok" data-testid="entrada-automatica">
              {conf?.entrada != null
                ? <>O cupom está em {unid(it.unidade_cupom)} e o produto é em KG: entram <b>{qtd(conf.entrada)} kg</b> ({qtd(conf.quantidade)} g ÷ 1.000). Você não precisa digitar nada.</>
                : <>O cupom está em {unid(it.unidade_cupom)} e o produto é em KG: digite a quantidade acima que eu converto para kg.</>}
            </div>
          )}
          {converte && modo === 'por_unidade' && (
            <>
              <div className="amarelo" data-testid="duvida-unidade">
                {destinoKg
                  ? <>O produto é controlado em KG no SisChef e o cupom está em {unid(it.unidade_cupom) || 'unidade'}. <b>Quanto pesa 1 {unid(it.unidade_cupom) || 'unidade'}, em kg?</b></>
                  : <>O cupom está em {unid(it.unidade_cupom)} e o produto é em UN. <b>Quantas unidades vêm em 1 {unid(it.unidade_cupom)}?</b></>}
              </div>
              <label>{destinoKg ? `Peso de 1 ${unid(it.unidade_cupom) || 'unidade'} (kg)` : `Unidades em 1 ${unid(it.unidade_cupom)}`}
                <input type="text" inputMode="decimal" placeholder={destinoKg ? 'ex.: 0,600' : 'ex.: 12'} value={estado.peso} disabled={travado}
                  onChange={(e) => mudar({ peso: e.target.value, forcar: false })} />
              </label>
              {destinoKg && estado.peso !== '' && estado.lembrar && qCupom != null && entradaEmKg(it.descricao_cupom, it.unidade_cupom, qCupom)?.regra === 1 && (
                <p className="sub" data-testid="peso-do-nome">Peso tirado do nome do cupom. Confira na embalagem e corrija se precisar.</p>
              )}
              {absurdo && !estado.forcar && pesoDigitado != null && totalPorPeso != null && (
                <div className="erro" role="alert" data-testid="numero-absurdo">
                  {qtd(pesoDigitado)} kg por {unid(it.unidade_cupom) || 'unidade'} parece errado (mais de {MAX_KG_POR_UNIDADE} kg): entrariam {qtd(totalPorPeso)} kg no estoque.
                  Você quis dizer {qtd(pesoDigitado / 1000)} kg?{' '}
                  <button type="button" className="link" disabled={travado} onClick={() => mudar({ peso: qtd(pesoDigitado / 1000), forcar: false })}>Usar {qtd(pesoDigitado / 1000)}</button>{' '}
                  <button type="button" className="link" disabled={travado} onClick={() => mudar({ forcar: true })}>Não, é isso mesmo</button>
                </div>
              )}
              {qCupom != null && pesoDigitado != null && totalPorPeso != null && !(absurdo && !estado.forcar) && (
                <p className="sub" data-testid="vai-entrar">
                  Vai entrar no estoque: {qtd(qCupom)} {unCupom} × {qtd(pesoDigitado)} {minusc(estado.produto.unidade)} = <b>{qtd(totalPorPeso)} {minusc(estado.produto.unidade)}</b>
                </p>
              )}
            </>
          )}
          {converte && modo === 'total' && (
            <>
              <div className="amarelo">
                O cupom está em {unid(it.unidade_cupom)} e este produto é em {unid(estado.produto.unidade)}: diga quanto entra no estoque (o TOTAL, não o de 1 unidade)
              </div>
              <label>Quanto entra no estoque ({unid(estado.produto.unidade)})
                <input type="text" inputMode="decimal" placeholder="0,000" value={estado.entrada} disabled={travado}
                  onChange={(e) => mudar({ entrada: e.target.value })} />
              </label>
            </>
          )}
          {conf && linha && (
            <p className="sub">
              Linha: {qtd(conf.quantidade)} {unCupom} × {formatarReais(Number(it.valor_unitario))} = <b>{formatarReais(linha.valor)}</b>
              {converte && conf.entrada != null && <> · entra {qtd(linha.entrada)} {minusc(estado.produto.unidade)} no estoque</>}
            </p>
          )}
          {lembravel ? (
            <label className="marcar lembrar">
              <input type="checkbox" checked={estado.lembrar} disabled={travado} onChange={(e) => mudar({ lembrar: e.target.checked })} />
              {converte
                ? <>Lembrar também a conversão{conf?.entrada != null && <> (1 {unid(it.unidade_cupom)} = {qtd(linhaConfirmada(it, conf).entrada / conf.quantidade)} {unid(estado.produto.unidade)})</>}:
                  só marque se “{descricao}” vem sempre com o mesmo peso ou embalagem</>
                : <>Lembrar: da próxima vez, “{descricao}” deste fornecedor já passa direto</>}
            </label>
          ) : (
            <p className="sub">Não dá para lembrar este item (o cupom não trouxe o CNPJ do emitente nem um código de barras válido).</p>
          )}
          <div className="acoes">
            <button type="button" className="botao" disabled={travado || !conf} onClick={() => mudar({ confirmado: true })}>Confirmar este item</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function CorrigirCupom({ cupom, catalogo, catalogoFalhou, aoReenviar }: Props) {
  const [estados, setEstados] = useState<Record<number, EstadoItem>>({})
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const pendentes = useMemo(() => itensPendentes(cupom), [cupom])
  const estadoDe = (i: number): EstadoItem => estados[i] ?? estadoInicial(cupom.itens[i])
  const mudar = (i: number, e: Partial<EstadoItem>) => {
    setErro('') // mexer em qualquer item apaga o erro do último reenvio: ele já não descreve o que está na tela
    setEstados((atual) => ({ ...atual, [i]: { ...(atual[i] ?? estadoInicial(cupom.itens[i])), ...e } }))
  }

  // só o que está CONFIRMADO entra na soma: um peso digitado pela metade não pode fazer a conferência oscilar
  const confirmadas = useMemo(() => {
    const m = new Map<number, Confirmada>()
    for (const i of pendentes) {
      const e = estados[i]
      if (!e?.confirmado) continue
      const c = confirmacaoDe(cupom.itens[i], e)
      if (c) m.set(i, c)
    }
    return m
  }, [cupom, pendentes, estados])
  const soma = useMemo(() => somaDoCupom(cupom, confirmadas), [cupom, confirmadas])
  const completo = soma.faltam.length === 0
  const podeReenviar = completo && soma.bate && !enviando

  async function reenviar() {
    if (!podeReenviar) return
    const itens: ConfirmacaoItemCupom[] = []
    for (const i of pendentes) {
      const e = estadoDe(i)
      const c = confirmadas.get(i)
      if (!e.produto || !c) return // não acontece com o botão habilitado; defesa contra um estado velho
      // sem chave para guardar (CNPJ do emitente ou código de barras válido) o servidor não teria como lembrar: manda false, para que o
      // `nao_lembrados` da resposta só conte falha de verdade (e a tela de cima possa avisar dela)
      const lembrar = e.lembrar && podeLembrar(cupom, cupom.itens[i])
      const item: ConfirmacaoItemCupom = { indice: i, insumo_id: String(e.produto.produto_id), quantidade: c.quantidade, lembrar }
      if (c.entrada != null) item.entrada = c.entrada // só com conversão: ausente = fator 1 (contrato do servidor)
      itens.push(item)
    }
    setEnviando(true); setErro('')
    try {
      aoReenviar(await api.confirmarCupom(cupom.id, itens))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui reenviar agora. Tente de novo.') // o que ele digitou fica: é só tocar de novo
    } finally {
      setEnviando(false)
    }
  }

  // o total nulo não acontece aqui (a caixa só aparece com o total lido), mas a regra pura devolve null e a tela não pode quebrar por isso
  const classeSoma = !completo ? 'sub' : soma.bate ? 'ok' : 'erro'
  const textoSoma = !completo
    ? ' · falta confirmar os itens acima'
    : soma.bate ? ' · bate'
      : soma.diferenca == null ? ' · o total do cupom não foi lido'
        : ` · diferença de ${formatarReais(Math.abs(soma.diferenca))}: confira os pesos`

  return (
    <div className="associar corrigir-cupom" data-testid="corrigir-cupom">
      <div className="grupo">Confirmar os itens deste cupom</div>
      {pendentes.map((i) => {
        const it = cupom.itens[i]
        return (
          <div key={i} className="corrigir-item" data-testid="corrigir-item">
            <p>
              <b>{(it.descricao_cupom ?? '').trim() || 'item'}</b>{' '}
              {it.valor_unitario != null && Number.isFinite(Number(it.valor_unitario)) && (
                <span className="sub">· {formatarReais(Number(it.valor_unitario))}{unid(it.unidade_cupom) !== '' && ` por ${unid(it.unidade_cupom)}`}</span>
              )}
            </p>
            <CaixaItem cupom={cupom} it={it} catalogo={catalogo} catalogoFalhou={catalogoFalhou} estado={estadoDe(i)} mudar={(e) => mudar(i, e)}
              travado={enviando} />
          </div>
        )
      })}

      <div className="grupo">Conferência da soma</div>
      <ul className="conferir-itens soma-itens" data-testid="corrigir-conferencia">
        {soma.linhas.map((l) => {
          const it = cupom.itens[l.indice]
          const jaConfirmado = !pendentes.includes(l.indice)
          return (
            <li key={l.indice}>
              <span>{(it?.descricao_cupom ?? '').trim() || 'item'}{jaConfirmado ? ' (já confirmado)' : ''}</span>
              <b>{l.valor == null ? 'falta confirmar' : formatarReais(l.valor)}</b>
            </li>
          )
        })}
      </ul>
      <p className={classeSoma} data-testid="corrigir-soma">
        Soma {formatarReais(soma.soma)} · cupom {soma.total == null ? 'sem total lido' : formatarReais(soma.total)}{textoSoma}
      </p>

      <div className="acoes">
        <button type="button" className="botao" data-testid="reenviar" disabled={!podeReenviar} onClick={() => void reenviar()}>
          {enviando ? 'Reenviando…' : 'Reenviar para lançar'}
        </button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
