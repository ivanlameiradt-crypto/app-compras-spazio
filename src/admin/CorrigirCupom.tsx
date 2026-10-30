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
import { sugerirPorPalavras } from './palavraChave'
import { ProdutoNaoCadastrado } from './CadastrarProduto'
import { ACOES_PRODUTO } from './acoesProduto'
import { ehPeso, itemSempreManual, itensPendentes, lerQuantidade, linhaConfirmada, podeLembrar, precisaConversao, somaDoCupom, type Confirmada } from './cupomCorrigirRegras'
import { MAX_KG_POR_UNIDADE, entradaEmKg, kgPorUnidadeAbsurdo } from './regraQuilos'
import { ehMilheiro, sugestaoPorMilheiro, unidadesNaEmbalagemDoProduto } from './embalagemContada'
import { ehEmbalagemContada } from '../lib/unidadesDaLista'
import AvisoPreco from './AvisoPreco'
import { Origem } from './Origem'
import { precoForaDoNormal } from './precoForaDoNormal'

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
  /** Reaberto pelo "Editar" do resumo (22/10/2026): a caixa abre ali mesmo, na linha do resumo — o item não volta para a lista de pendentes — até o Ivan confirmar de novo. */
  editando: boolean
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
  // CT e PCT (22/10/2026, cupom de sacos): embalagem com várias unidades dentro. Cupom em unidade/caixa/pacote… pergunta quantos CT/PCT vêm em 1 unidade do cupom, e "ML" do cupom
  // de embalagem é MILHEIRO (1.000 unidades), não mililitro: também pergunta (a tela explica e sugere pelo "C/ 100 UND" do nome). Peso e volume de verdade (kg, g, l) seguem no "total".
  if (ehEmbalagemContada(destino) && (!ehPeso(it.unidade_cupom) || ehMilheiro(it.unidade_cupom, destino))) return 'por_unidade'
  return 'total'
}
const arred3 = (v: number): number => Math.round(v * 1000) / 1000

const unid = (u: string | null | undefined): string => (u ?? '').trim().toUpperCase()
const minusc = (u: string | null | undefined): string => (u ?? '').trim().toLowerCase()
const qtd = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
/** A quantidade que o robô leu no cupom, pronta para o campo (com vírgula): o Ivan só confere, em vez de digitar de novo. */
const quantidadeLida = (it: ItemCupomRecente): string => (it.quantidade_cupom != null && Number(it.quantidade_cupom) > 0 ? qtd(Number(it.quantidade_cupom)) : '')
const estadoInicial = (it: ItemCupomRecente): EstadoItem => ({ produto: null, quantidade: quantidadeLida(it), entrada: '', peso: '', forcar: false, lembrar: true, confirmado: false, editando: false })

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

/** A caixa de UM item pendente: escolher o produto → quantidade(s) → "Confirmar este item". Confirmado (22/10/2026), o item SAI desta lista e passa a morar no resumo do fim
 *  ("Conferência da soma"), com o ✓ e o "Editar" (era "Trocar" até 21/10); o "Editar" reabre esta mesma caixa ali, na linha do resumo (estado.editando). */
function CaixaItem({ cupom, it, catalogo, catalogoFalhou, estado, mudar, travado, novos, registrarNovo }: {
  cupom: CupomRecente; it: ItemCupomRecente; catalogo: ProdutoCatalogo[] | null; catalogoFalhou: boolean
  estado: EstadoItem; mudar: (e: Partial<EstadoItem>) => void
  /** Reenvio em curso: nada pode mudar por baixo do que está sendo mandado. */
  travado: boolean
  /** Produtos que o Ivan acabou de cadastrar pelo app: entram na busca de TODAS as caixas na hora. Moram na tela de cima porque a caixa de um item confirmado é desmontada
   *  (o item sai da lista) e remontada no "Editar" — se ficassem aqui, o "Escolher outro" do Editar não acharia o produto recém-criado. */
  novos: ProdutoCatalogo[]; registrarNovo: (p: ProdutoCatalogo) => void
}) {
  const [texto, setTexto] = useState('')
  const lista = useMemo(() => [...(catalogo ?? []), ...novos.filter((n) => !(catalogo ?? []).some((p) => p.produto_id === n.produto_id))], [catalogo, novos])
  const busca = useMemo(() => buscarProdutos(lista, texto), [lista, texto])
  // a proposta do sistema só vira botão se o produto está na lista de insumos (e não é escondido): fora dela o servidor a recusaria
  const proposta = useMemo(() => {
    const id = Number(it.proposta?.insumo_id)
    if (!Number.isInteger(id) || id <= 0) return null
    const p = lista.find((x) => x.produto_id === id)
    return p && !p.oculto ? p : null
  }, [it.proposta, lista])
  // Regra da palavra-chave (Ivan, 08/10): sem proposta do sistema, o app sugere pelas palavras da descrição do SisChef (planilha) — 'forte' = o Ivan só confirma.
  const porPalavras = useMemo(() => (proposta ? null : sugerirPorPalavras(lista, it.descricao_cupom ?? '', it.unidade_cupom)), [proposta, lista, it.descricao_cupom, it.unidade_cupom])
  // A descrição mudou (pedido do Ivan, 08/10): o fornecedor já mandou algo parecido, confirmado, e o app avisa em vez de calar.
  const antes = useMemo(() => {
    for (const k of it.conhecidos_do_fornecedor ?? []) {
      const p = lista.find((x) => String(x.produto_id) === String(k.insumo_id) && !x.oculto)
      if (p) return { descricao_norm: k.descricao_norm, produto: p }
    }
    return null
  }, [it.conhecidos_do_fornecedor, lista])
  const descricaoLida = (it.descricao_cupom ?? '').replace(/\s+/g, ' ').trim()
  const descricao = descricaoLida || 'item'
  const unCupom = minusc(it.unidade_cupom)
  const conf = confirmacaoDe(it, estado)
  const linha = conf ? linhaConfirmada(it, conf) : null
  // Preço fora do normal (29/10/2026): o preço por unidade de ESTOQUE desta linha não se parece com o das últimas compras do produto. Só avisa; some sozinho se o Ivan acertar a conversão.
  const avisoPreco = linha && estado.produto ? precoForaDoNormal(linha.valorUnitario, estado.produto.unidade, estado.produto.compras) : null
  const converte = estado.produto != null && precisaConversao(it.unidade_cupom, estado.produto.unidade)
  const modo = modoDaEntrada(it, estado.produto)
  const destinoKg = minusc(estado.produto?.unidade) === 'kg'
  // CT/PCT (embalagem contada): "ML" no cupom é milheiro; a conta 1.000 ÷ unidades da embalagem sai do nome do produto ("C/ 100 UND")
  const destinoContado = ehEmbalagemContada(estado.produto?.unidade)
  const milheiro = ehMilheiro(it.unidade_cupom, estado.produto?.unidade)
  const rotCupom = milheiro ? 'ML (milheiro)' : unid(it.unidade_cupom)
  const unidadesNaCaixa = estado.produto && destinoContado ? unidadesNaEmbalagemDoProduto(estado.produto) : null
  const qCupom = lerQuantidade(estado.quantidade)
  const pesoDigitado = lerQuantidade(estado.peso)
  const totalPorPeso = qCupom != null && pesoDigitado != null ? arred3(qCupom * pesoDigitado) : null
  const absurdo = modo === 'por_unidade' && destinoKg && qCupom != null && totalPorPeso != null && kgPorUnidadeAbsurdo(totalPorPeso, qCupom)
  const lembravel = podeLembrar(cupom, it)

  // Item confirmado não tem caixa: quem o mostra é o resumo do fim (ItemConfirmadoNoResumo), com o "Editar" que reabre esta caixa na própria linha do resumo.
  if (estado.confirmado) return null

  // Com conversão de unidade o "Lembrar" começa DESMARCADO: o que fica guardado é também o fator (1 UN = x KG), e num produto de peso variável
  // (uma peça de queijo) o fator desta compra lançaria a próxima com o peso errado sem ninguém ver. Pacote de peso fixo (lata de 395 g): ele marca.
  // Regras do Ivan (08/10): o peso da embalagem no NOME do cupom ("850g") já vem como sugestão do peso de 1 unidade; cupom em gramas e produto em kg o app
  // converte sozinho. Com a conta vinda do próprio cupom o "Lembrar" já começa marcado (o servidor refaz a conta a cada compra).
  const escolher = (p: ProdutoCatalogo) => {
    const m = modoDaEntrada(it, p)
    const regra = qCupom != null && minusc(p.unidade) === 'kg' ? entradaEmKg(it.descricao_cupom, it.unidade_cupom, qCupom) : null
    // sugestão do peso de 1 unidade (KG, pelo peso do nome do cupom) ou dos CT/PCT em 1 ML (milheiro, pelo "C/ 100 UND" do nome do produto); o Ivan confere
    const porMilheiro = m === 'por_unidade' ? sugestaoPorMilheiro(it.unidade_cupom, p) : null
    const sugerido = m === 'por_unidade' && regra?.regra === 1 && qCupom ? qtd(regra.kg / qCupom) : porMilheiro != null ? qtd(porMilheiro) : ''
    const novo: Partial<EstadoItem> = { produto: p, entrada: '', peso: sugerido, forcar: false, lembrar: !itemSempreManual(it) && (!precisaConversao(it.unidade_cupom, p.unidade) || m === 'auto' || sugerido !== '') }
    mudar(novo)
    setTexto('')
    return novo
  }
  // "Confirmar" da sugestão: escolhe o produto e, se não falta nenhum número (mesma unidade e quantidade lida), já confirma o item — um toque só.
  // Exceção (revisão independente de 22/10): produto em CT/PCT com conversão (ML = milheiro, UN → PCT…). O fator vem do NOME do produto, não do cupom, e a conferência da soma
  // bate com qualquer fator (o valor da linha é preservado): o item fica aberto para o Ivan ver a pergunta e a conta ("6 ML × 10 ct = 60 ct") e tocar em "Confirmar este item".
  const confirmarSugestao = (p: ProdutoCatalogo) => {
    const novo = escolher(p)
    const fatorDaEmbalagem = ehEmbalagemContada(p.unidade) && modoDaEntrada(it, p) === 'por_unidade'
    if (!fatorDaEmbalagem && confirmacaoDe(it, { ...estado, ...novo }) !== null) mudar({ confirmado: true })
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
          {antes && (
            <div className="sugestao" data-testid="descricao-mudou">
              <p className="sub">
                A descrição mudou: este fornecedor já mandou “{antes.descricao_norm}” e você confirmou como <b>{antes.produto.nome}</b>. É o mesmo produto?
              </p>
              <div className="acoes">
                <button type="button" className="botao" disabled={travado} onClick={() => confirmarSugestao(antes.produto)}>Sim, é este</button>
              </div>
            </div>
          )}
          {porPalavras && (
            <div className="sugestao" data-testid="sugestao-palavras">
              <p className="sub">
                {porPalavras.forca === 'forte' ? 'O app acha que é este (as palavras batem com o SisChef):' : 'Nenhum produto tem todas as palavras. O mais parecido:'}{' '}
                <b>{porPalavras.produto.nome}</b>
              </p>
              <div className="acoes">
                {/* "Confirmar" (as palavras batem) vale o item de uma vez; "Usar este" (o mais parecido, nada bate por inteiro) SÓ ESCOLHE o produto: o item fica aberto
                    e o Ivan toca em "Confirmar este item" — a etapa a mais que ele pediu em 22/10/2026. */}
                <button type="button" className={porPalavras.forca === 'forte' ? 'botao' : 'botao secundario'} disabled={travado}
                  onClick={() => (porPalavras.forca === 'forte' ? confirmarSugestao(porPalavras.produto) : escolher(porPalavras.produto))}>
                  {porPalavras.forca === 'forte' ? 'Confirmar' : 'Usar este'}
                </button>
              </div>
              {porPalavras.alternativas.length > 0 && (
                <p className="sub">Outras opções:{' '}
                  {porPalavras.alternativas.map((a) => (
                    <button key={a.produto_id} type="button" className="link" disabled={travado} onClick={() => escolher(a)}>{a.nome}</button>
                  ))}
                </p>
              )}
            </div>
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
          {/* Produto que o app não identificou (sem proposta, sem sugestão pelas palavras e nada na busca): aviso + botão. Com sugestão ou resultados na tela: só o botão discreto,
              sempre à mão (a sugestão pode estar errada: o Ivan sabe quando o produto é novo). Pedido do Ivan, 13/10. */}
          {/* Item sem descrição no cupom: o nome do produto novo começa VAZIO (o "item" das frases acima viraria "ITEM - INSUMOS"; revisão 2, M13) */}
          {!travado && (
            <ProdutoNaoCadastrado descricaoDoItem={descricaoLida} acoes={ACOES_PRODUTO} origem={{ tipo: 'cupom', id: cupom.id }}
              discreto={!(busca.total === 0 && (texto.trim() !== '' || (!proposta && !it.proposta && !porPalavras && !antes)))}
              aoUsar={(p) => { registrarNovo(p); escolher(p) }} />
          )}
        </>
      )}

      {estado.produto && (
        <>
          <div className="escolhido">
            <span><b>{estado.produto.nome}</b><Origem de="sischef" /></span>{' '}
            <span className="sub">
              <span className="sem-quebra">cód. {estado.produto.produto_id}{estado.produto.unidade ? ` · ${unid(estado.produto.unidade)}` : ''}</span>
              {' · '}
              <button type="button" className="link" disabled={travado} onClick={() => mudar({ produto: null, entrada: '', peso: '', forcar: false })}>Escolher outro</button>
            </span>
          </div>
          <label>{ehPeso(it.unidade_cupom) && !milheiro ? 'Peso' : 'Quantidade'}{unCupom !== '' ? ` (${milheiro ? 'ML = milheiro' : unCupom})` : ''} que está no cupom
            {/* autoFocus só quando o Ivan tocou em "Editar" no resumo (a caixa acabou de abrir naquela linha); na lista de pendentes o cursor não é roubado */}
            <input type="text" inputMode="decimal" placeholder={ehPeso(it.unidade_cupom) && !milheiro ? '0,000' : '0'} value={estado.quantidade} disabled={travado}
              autoFocus={estado.editando} onChange={(e) => mudar({ quantidade: e.target.value })} />
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
                  : destinoContado
                    ? <>O cupom está em {rotCupom} e o produto é em {unid(estado.produto.unidade)}. <b>Quantos {unid(estado.produto.unidade)} vêm em 1 {unid(it.unidade_cupom)}?</b></>
                    : <>O cupom está em {unid(it.unidade_cupom)} e o produto é em UN. <b>Quantas unidades vêm em 1 {unid(it.unidade_cupom)}?</b></>}
              </div>
              {milheiro && (
                <p className="sub" data-testid="dica-milheiro">
                  No cupom, “ML” de saco ou embalagem é <b>milheiro</b> (1.000 unidades), não mililitro.{' '}
                  {unidadesNaCaixa != null
                    ? <>Este produto traz {qtd(unidadesNaCaixa)} unidades em cada {unid(estado.produto.unidade)}: 1 ML = {qtd(1000 / unidadesNaCaixa)} {unid(estado.produto.unidade)}.</>
                    : <>1 ML = 1.000 ÷ (unidades em cada {unid(estado.produto.unidade)}) {unid(estado.produto.unidade)}.</>}
                </p>
              )}
              <label>{destinoKg ? `Peso de 1 ${unid(it.unidade_cupom) || 'unidade'} (kg)` : destinoContado ? `${unid(estado.produto.unidade)} em 1 ${unid(it.unidade_cupom)}` : `Unidades em 1 ${unid(it.unidade_cupom)}`}
                <input type="text" inputMode="decimal" placeholder={destinoKg ? 'ex.: 0,600' : destinoContado ? 'ex.: 10' : 'ex.: 12'} value={estado.peso} disabled={travado}
                  onChange={(e) => mudar({ peso: e.target.value, forcar: false })} />
              </label>
              {destinoKg && estado.peso !== '' && qCupom != null && entradaEmKg(it.descricao_cupom, it.unidade_cupom, qCupom)?.regra === 1 && (
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
                  Vai entrar no estoque: {qtd(qCupom)} {milheiro ? 'ML (milheiro)' : unCupom} × {qtd(pesoDigitado)} {minusc(estado.produto.unidade)} = <b>{qtd(totalPorPeso)} {minusc(estado.produto.unidade)}</b>
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
              Linha: {qtd(conf.quantidade)} {milheiro ? 'ML (milheiro)' : unCupom} × {formatarReais(Number(it.valor_unitario))} = <b>{formatarReais(linha.valor)}</b>
              {converte && conf.entrada != null && <> · entra {qtd(linha.entrada)} {minusc(estado.produto.unidade)} no estoque</>}
            </p>
          )}
          <AvisoPreco aviso={avisoPreco} />   {/* só desenha quando há aviso */}
          {lembravel ? (
            <p className="sub" data-testid="vai-lembrar">
              {converte && conf?.entrada != null
                ? <>Vou lembrar: da próxima vez, “{descricao}” deste fornecedor entra com 1 {unid(it.unidade_cupom)} = {qtd(linhaConfirmada(it, conf).entrada / conf.quantidade)} {unid(estado.produto.unidade)}, sem perguntar.</>
                : <>Vou lembrar: da próxima vez, “{descricao}” deste fornecedor já passa direto, sem perguntar.</>}
            </p>
          ) : itemSempreManual(it) ? (
            <p className="sub" data-testid="sempre-manual">Este item é sempre manual (regra sua): o app não guarda a escolha, você informa o produto a cada compra.</p>
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

/** A linha de um item que o Ivan confirmou AGORA, no resumo do fim: o ✓ com o produto, o que está no cupom e, com conversão, quanto entra no estoque — e o "Editar",
 *  que reabre a caixa do item ali mesmo (pedido do Ivan, 22/10/2026: o item confirmado sai da lista e só aparece no resumo, com todas as informações). */
function ItemConfirmadoNoResumo({ it, produto, conf, travado, aoEditar }: {
  it: ItemCupomRecente; produto: ProdutoCatalogo; conf: Confirmada; travado: boolean; aoEditar: () => void
}) {
  const milheiro = ehMilheiro(it.unidade_cupom, produto.unidade)
  const linha = linhaConfirmada(it, conf)
  return (
    <div className="resumo-detalhe" data-testid="resumo-confirmado">
      <span>
        <span className="confirmado">✓ {produto.nome}<Origem de="sischef" /></span>
        <span className="sub"> · {qtd(conf.quantidade)} {milheiro ? 'ML (milheiro)' : minusc(it.unidade_cupom)}{conf.entrada != null && <> → entram {qtd(linha.entrada)} {minusc(produto.unidade)}</>}</span>
      </span>
      <button type="button" className="editar-item" disabled={travado} onClick={aoEditar}><span aria-hidden="true">✎</span> Editar</button>
      {/* a última chance de ver o preço fora do normal antes de reenviar: o item confirmado sai da lista e só mora aqui */}
      <AvisoPreco aviso={precoForaDoNormal(linha.valorUnitario, produto.unidade, produto.compras)} testid="preco-fora-do-normal-resumo" />
    </div>
  )
}

/** Item que já tinha produto confirmado antes de o Ivan abrir esta tela (o servidor casou sozinho): produto e quanto entra no estoque, só para ele conferir. */
function ItemConhecidoNoResumo({ it, catalogo }: { it: ItemCupomRecente; catalogo: ProdutoCatalogo[] | null }) {
  const produto = (catalogo ?? []).find((p) => String(p.produto_id) === String(it.sugestao_produto?.id))
  // o valor unitário de um item que já tem produto é o preço por unidade de ESTOQUE (entrada × preço − desconto = a linha); sem a quantidade que entra não há como julgar
  const aviso = produto && it.entrada_estoque != null ? precoForaDoNormal(Number(it.valor_unitario), produto.unidade, produto.compras) : null
  return (
    <div className="resumo-detalhe" data-testid="item-conhecido">
      <span>
        <span className="confirmado">✓ {produto ? produto.nome : `produto cód. ${it.sugestao_produto?.id ?? '?'}`}<Origem de="sischef" /></span>
        {it.entrada_estoque != null && <span className="sub"> · entra {qtd(Number(it.entrada_estoque))} {produto?.unidade ? minusc(produto.unidade) : ''} no estoque</span>}
      </span>
      <AvisoPreco aviso={aviso} testid="preco-fora-do-normal-resumo" />
    </div>
  )
}

export default function CorrigirCupom({ cupom, catalogo, catalogoFalhou, aoReenviar }: Props) {
  const [estados, setEstados] = useState<Record<number, EstadoItem>>({})
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [novos, setNovos] = useState<ProdutoCatalogo[]>([]) // produtos cadastrados agora pelo app (de qualquer item): valem na busca de todas as caixas
  const registrarNovo = (p: ProdutoCatalogo) => setNovos((a) => [...a.filter((x) => x.produto_id !== p.produto_id), p])

  const pendentes = useMemo(() => itensPendentes(cupom), [cupom])
  const estadoDe = (i: number): EstadoItem => estados[i] ?? estadoInicial(cupom.itens[i])
  const mudar = (i: number, e: Partial<EstadoItem>) => {
    setErro('') // mexer em qualquer item apaga o erro do último reenvio: ele já não descreve o que está na tela
    // confirmar de novo encerra a edição: a caixa fecha e a linha volta a mostrar só o resumo do item
    setEstados((atual) => ({ ...atual, [i]: { ...(atual[i] ?? estadoInicial(cupom.itens[i])), ...e, ...(e.confirmado ? { editando: false } : {}) } }))
  }
  // Os que ainda faltam confirmar (inclui o que o Ivan reabriu pelo "Editar") e, destes, os que moram na LISTA: o item reaberto fica na linha do resumo, não volta para a lista.
  const semConfirmar = pendentes.filter((i) => !estadoDe(i).confirmado)
  const naLista = semConfirmar.filter((i) => !estadoDe(i).editando)

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
  // Todos os itens já vieram conhecidos: nada a escolher, só conferir e confirmar o cupom inteiro (pedido do Ivan, 08/10)
  const soConfirmar = pendentes.length === 0

  async function reenviar() {
    if (!podeReenviar) return
    if (soConfirmar) {
      setEnviando(true); setErro('')
      try {
        aoReenviar(await api.confirmarCupom(cupom.id, [], true))
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não consegui confirmar agora. Tente de novo.')
      } finally {
        setEnviando(false)
      }
      return
    }
    const itens: ConfirmacaoItemCupom[] = []
    for (const i of pendentes) {
      const e = estadoDe(i)
      const c = confirmadas.get(i)
      if (!e.produto || !c) return // não acontece com o botão habilitado; defesa contra um estado velho
      // sem chave para guardar (CNPJ do emitente ou código de barras válido) o servidor não teria como lembrar: manda false, para que o
      // `nao_lembrados` da resposta só conte falha de verdade (e a tela de cima possa avisar dela)
      const lembrar = podeLembrar(cupom, cupom.itens[i])
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

  // Quantos faltam, para o Ivan saber onde está sem rolar a tela (os confirmados saem da lista e moram no resumo do fim)
  const progresso = pendentes.length === 0 ? null
    : semConfirmar.length === 0
      ? `✓ ${pendentes.length === 1 ? 'O item está confirmado' : `Os ${pendentes.length} itens estão confirmados`}. Confira a soma abaixo e reenvie.`
      : `${semConfirmar.length === 1 ? 'Falta' : 'Faltam'} confirmar ${semConfirmar.length} de ${pendentes.length} ${pendentes.length === 1 ? 'item' : 'itens'}.`

  return (
    <div className="associar corrigir-cupom" data-testid="corrigir-cupom">
      <div className="grupo">{soConfirmar ? 'Confira os itens e confirme' : 'Confirmar os itens deste cupom'}</div>
      {progresso && <p className={semConfirmar.length === 0 ? 'ok' : 'sub'} role="status" aria-live="polite" data-testid="corrigir-progresso">{progresso}</p>}
      {/* Só os itens que faltam: confirmado, o item sai daqui e passa para o resumo do fim (pedido do Ivan, 22/10/2026) */}
      {naLista.map((i) => {
        const it = cupom.itens[i]
        return (
          <div key={i} className="corrigir-item" data-testid="corrigir-item">
            <p>
              <b>{(it.descricao_cupom ?? '').trim() || 'item'}</b>{' '}
              {it.valor_unitario != null && Number.isFinite(Number(it.valor_unitario)) && (
                <span className="sub">· {formatarReais(Number(it.valor_unitario))}{unid(it.unidade_cupom) !== '' && ` por ${unid(it.unidade_cupom)}`}</span>
              )}
              <Origem de="cupom" />
            </p>
            <CaixaItem cupom={cupom} it={it} catalogo={catalogo} catalogoFalhou={catalogoFalhou} estado={estadoDe(i)} mudar={(e) => mudar(i, e)}
              travado={enviando} novos={novos} registrarNovo={registrarNovo} />
          </div>
        )
      })}

      {/* O resumo do fim: uma linha por item do cupom com a descrição e o valor; o item confirmado ganha embaixo o produto, a quantidade, o que entra no estoque e o
          "Editar" (abre a caixa do item aqui mesmo); o que já veio conhecido do servidor mostra o produto; o que falta diz "falta confirmar". */}
      {!soConfirmar && <div className="grupo">Conferência da soma</div>}
      <ul className="conferir-itens soma-itens" data-testid="corrigir-conferencia">
        {soma.linhas.map((l) => {
          const it = cupom.itens[l.indice]
          const pendente = pendentes.includes(l.indice)
          const e = pendente ? estadoDe(l.indice) : null
          const conf = pendente ? confirmadas.get(l.indice) : undefined
          return (
            <li key={l.indice} data-testid="resumo-item">
              <span>{(it?.descricao_cupom ?? '').trim() || 'item'}{pendente ? '' : ' (já confirmado)'}<Origem de="cupom" /></span>
              <b>{l.valor == null ? 'falta confirmar' : formatarReais(l.valor)}</b>
              {!pendente && it && <ItemConhecidoNoResumo it={it} catalogo={catalogo} />}
              {e?.confirmado && conf && e.produto && (
                <ItemConfirmadoNoResumo it={it} produto={e.produto} conf={conf} travado={enviando} aoEditar={() => mudar(l.indice, { confirmado: false, editando: true })} />
              )}
              {e?.editando && !e.confirmado && (
                <div className="resumo-edicao" data-testid="resumo-edicao">
                  <CaixaItem cupom={cupom} it={it} catalogo={catalogo} catalogoFalhou={catalogoFalhou} estado={e} mudar={(x) => mudar(l.indice, x)} travado={enviando}
                    novos={novos} registrarNovo={registrarNovo} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className={classeSoma} data-testid="corrigir-soma">
        Soma {formatarReais(soma.soma)} · cupom {soma.total == null ? 'sem total lido' : formatarReais(soma.total)}{textoSoma}
      </p>

      <div className="acoes">
        <button type="button" className="botao" data-testid="reenviar" disabled={!podeReenviar} onClick={() => void reenviar()}>
          {enviando ? (soConfirmar ? 'Confirmando…' : 'Reenviando…') : soConfirmar ? 'Confirmar e lançar' : 'Reenviar para lançar'}
        </button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
