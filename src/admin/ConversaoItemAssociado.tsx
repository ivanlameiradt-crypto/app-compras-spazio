import { useEffect, useState } from 'react'
import {
  CONVERSAO_CASAS, CONVERSAO_MAXIMA, embalagemPeloNome, formatarConversao, formatarQuantidade, parseConversao, quantidadeNoEstoque, rotuloUnidade,
} from './associacaoRegras'
import type { ItemNotaSefaz, NfeAprendizado } from '../lib/tipos'
import { ehEmbalagemContada } from '../lib/unidadesDaLista'
import { EmbalagemLembradaDoItem } from './CaixaEmbalagemLembrada'
import { situacaoDaMemoria } from './embalagemLembrada'

/**
 * "Editar" de um item que JÁ vem associado no SisChef (pedido do Ivan, 21/10/2026: todo item tem o botão, mesmo o que está certo). O que se edita aqui é a
 * CONVERSÃO: quanto vale 1 unidade da nota em unidades do estoque. Dois jeitos de precisar dela:
 *  - "UN DIFERE" (a nota em UN, o cadastro em KG, lata de 395 g → 0,395): o robô parou pedindo (`pede`) e a caixa já abre vazia;
 *  - a MESMA unidade, mas a "unidade" da nota é uma embalagem (KETCHUP SACHE 168UN: a nota traz 10 UN = 10 caixas de 168 → digite 168 e entram 1.680).
 * O número fica na nota (cot_nfe_converter_item) e o robô o aplica ao lançar: registra no modal do SisChef, ou — quando a unidade é a mesma — troca a
 * quantidade e o unitário da linha do pedido (regras_embalagem). Mesma régua da caixa de associação: maior que zero, até 10000, 4 casas, vírgula ou ponto.
 * A prévia "entram no estoque" é quantidade × conversão, com a quantidade que o SisChef mostra hoje para o item (a da linha de cima).
 * Item sem produto no SisChef não passa por aqui: lá é a caixa de associação (AssociarProduto) que pede a conversão junto com o produto e tem o seu "Editar".
 * Memória de embalagem (29/10/2026): quando o robô já aprendeu a embalagem deste código (`lembrada`), a caixa mostra o que ele lembra e deixa Corrigir (abre o Editar já com o
 * número) ou Esquecer (CaixaEmbalagemLembrada); o número que o Ivan informa nesta nota sempre vence a memória.
 */
export function ConversaoItemAssociado({ item, atual, pede, desabilitado, salvar, buscarUnidade, lembrada, esquecer }: {
  item: ItemNotaSefaz & { n: number }
  /** A conversão que o Ivan já informou (decisão com origem "sischef"), ou null. */
  atual: number | null
  /** O robô parou nesta nota dizendo que ESTE item está com UN DIFERE sem conversão. */
  pede: boolean
  desabilitado: boolean
  salvar: (n: number, conversao: number | null) => Promise<void>
  /** A linha que o robô lembra para este item (CNPJ + CÓD. FOR + unidade), ou nada. */
  lembrada?: NfeAprendizado | null
  /** Esquecer a linha lembrada (lança Error com texto claro se falhar). Sem ela, a caixa não oferece o botão Esquecer. */
  esquecer?: (linha: NfeAprendizado) => Promise<void>
  /** Lê a unidade do produto na lista do app (kg, un, ct, pct; null = não sabe). Produto em CT/PCT NÃO recebe a sugestão do nome ("C/ 100 UND" → 100): o 100 conta unidades e o
   *  estoque é em CT (revisão independente de 22/10). Sem esta função (ou sem resposta) a sugestão segue como sempre. Enquanto lê, a sugestão fica escondida. */
  buscarUnidade?: (produtoId: number | string) => Promise<string | null | undefined>
}) {
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState(false)
  const [salvo, setSalvo] = useState<number | null | undefined>(undefined) // o que acabou de gravar (vale até a releitura trazer o do servidor)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [esqueceu, setEsqueceu] = useState(false) // o Ivan acabou de mandar o robô esquecer o número lembrado: fica o aviso "Pronto" no lugar da caixa, até ele mexer no item
  const [lida, setLida] = useState<{ produto: string; unidade: string | null } | null>(null) // a última unidade lida e DE QUAL produto (a caixa pode trocar de item)

  const valorAtual = salvo !== undefined ? salvo : atual
  const unidade = rotuloUnidade(item.unidade_sischef)
  const conversao = texto.trim() !== '' ? parseConversao(texto) : null
  const invalida = texto.trim() !== '' && conversao == null
  const pendente = pede && valorAtual == null // o robô pediu e ainda ninguém informou: a caixa abre sozinha
  const aberta = pendente || editando
  const codigoDoProduto = item.produto_id != null && String(item.produto_id).trim() !== '' ? String(item.produto_id).trim() : null
  useEffect(() => {
    if (!aberta || !buscarUnidade || codigoDoProduto == null) return
    let vivo = true
    Promise.resolve()
      .then(() => buscarUnidade(codigoDoProduto))
      .then((u) => { if (vivo) setLida({ produto: codigoDoProduto, unidade: u ?? null }) })
      .catch(() => { if (vivo) setLida({ produto: codigoDoProduto, unidade: null }) })
    return () => { vivo = false }
  }, [aberta, buscarUnidade, codigoDoProduto])
  // a unidade só vale para o produto de que foi lida: se a caixa passa a outro produto, volta a "ainda não li" (a sugestão fica escondida até a nova leitura)
  const unidadeDoProduto = lida != null && lida.produto === codigoDoProduto ? lida.unidade : undefined
  const lendoUnidade = aberta && !!buscarUnidade && codigoDoProduto != null && unidadeDoProduto === undefined
  const sugestao = lendoUnidade || ehEmbalagemContada(unidadeDoProduto) ? null : embalagemPeloNome(item.descricao, item.unidade_sischef)

  async function guardar(valor: number | null) {
    if (enviando) return
    setEnviando(true); setErro('')
    try {
      await salvar(item.n, valor)
      setSalvo(valor); setEditando(false); setTexto('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui guardar a conversão agora. Confira a internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }
  /** Abre o Editar. `inicial` = um número para já vir no campo (o "Corrigir" da memória usa o que o robô lembra); sem ele, o que o Ivan já informou, ou vazio. */
  function abrir(inicial?: number) {
    setErro(''); setEsqueceu(false)
    setTexto(inicial != null ? formatarConversao(inicial) : valorAtual != null ? formatarConversao(valorAtual) : '')
    setEditando(true)
  }
  /** "Esquecer" da memória: a função de fora lança Error se falhar (a caixa mostra); se der certo, fica o aviso de que o robô esqueceu. */
  async function esquecerLembrada(linha: NfeAprendizado) {
    if (!esquecer) return
    await esquecer(linha)
    setEsqueceu(true)
  }
  /** "10 × 168 = 1.680 UN": a conta que o Ivan confere antes de confirmar (e que fica na linha depois). Nada quando falta a quantidade da leitura. */
  const conta = (c: number | null): string | null => {
    const entra = quantidadeNoEstoque(item.qtd, c)
    return c == null || entra == null ? null : `${formatarQuantidade(Number(item.qtd))} × ${formatarConversao(c)} = ${formatarQuantidade(entra)}${unidade ? ` ${unidade}` : ''}`
  }

  if (!pendente && !editando) {
    const feita = valorAtual != null ? conta(valorAtual) : null
    const situacao = situacaoDaMemoria(item, lembrada, valorAtual, pede)
    return (
      <>
        <div className="editar-linha" data-testid="editar-item-linha">
          {valorAtual != null && (
            <p className="sub" data-testid="conversao-item-informada">
              Conversão informada: 1 unidade da nota = {formatarConversao(valorAtual)}{unidade ? ` ${unidade}` : ''}.
              {feita && <> Entram no estoque: <b>{feita}</b>.</>} O robô aplica ao lançar.
            </p>
          )}
          <button type="button" className="editar-item" disabled={desabilitado || enviando} onClick={() => abrir()}>
            <span aria-hidden="true">✎</span> Editar
          </button>
        </div>
        {/* Memória de embalagem: o que o robô lembra para este código (ou o aviso de que o Ivan acabou de mandá-lo esquecer). Fica fora do .editar-linha de propósito: a linha compacta dos itens confirmados é uma grade de 2 colunas. */}
        {lembrada && situacao && (
          <EmbalagemLembradaDoItem item={item} lembrada={lembrada} situacao={situacao} desabilitado={desabilitado || enviando} aoCorrigir={(fator) => abrir(fator)} esquecer={esquecer ? esquecerLembrada : undefined} />
        )}
        {esqueceu && !lembrada && <p className="sub embalagem-aviso" role="status" data-testid="embalagem-esquecida">Pronto: o robô esqueceu este número.</p>}
      </>
    )
  }
  const previa = conta(conversao)
  return (
    <div className={`${pendente ? 'amarelo ' : ''}pedir-conversao editar-caixa`} data-testid={pendente ? 'conversao-item-pendente' : 'editar-item-caixa'} role="group" aria-label="Editar este item">
      {pendente && (
        <p className="sub">
          O SisChef marcou <b>UN DIFERE</b> neste item: a unidade da nota é diferente da do cadastro{unidade ? ` (${unidade})` : ''} e a conversão não está registrada.
        </p>
      )}
      <label>Quanto vale 1 unidade da nota{unidade ? ` em ${unidade}` : ' na unidade do produto no SisChef'}?
        {/* autoFocus só quando o Ivan tocou em Editar (o campo acabou de abrir e o teclado do celular já aparece); a caixa que o robô pediu e abre sozinha não rouba o cursor */}
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0,000" value={texto} disabled={desabilitado || enviando} autoFocus={editando}
          onChange={(e) => { setTexto(e.target.value); setErro('') }} />
      </label>
      <p className="sub">
        Ex.: a nota traz 10 UN e cada UN é uma caixa com 168 sachês → <b>168</b> (entram 1.680). Lata de 395 g, estoque em KG → <b>0,395</b>.
      </p>
      {sugestao && texto.trim() === '' && (
        <p className="sub" data-testid="conversao-item-sugestao">
          Sugestão tirada do nome da nota ({sugestao.trecho}):{' '}
          <button type="button" className="link" disabled={desabilitado || enviando} onClick={() => setTexto(formatarConversao(sugestao.fator))}>usar {formatarConversao(sugestao.fator)}</button>
          {' '}— confira antes de confirmar.
        </p>
      )}
      {invalida && (
        <p className="erro" data-testid="conversao-item-invalida">
          Número maior que zero, até {formatarConversao(CONVERSAO_MAXIMA)}, com até {CONVERSAO_CASAS} casas (vírgula ou ponto).
        </p>
      )}
      {conversao != null && (
        <p className="sub" data-testid="conversao-item-eco">
          Vai gravar: 1 unidade da nota = {formatarConversao(conversao)}{unidade ? ` ${unidade}` : ''}.
          {previa && <> Entram no estoque: <b data-testid="conversao-item-previa">{previa}</b>.</>}
        </p>
      )}
      {conversao != null && previa && (
        <p className="sub" data-testid="conversao-item-aviso-conta">
          A conta usa a quantidade que o SisChef mostra hoje ({formatarQuantidade(Number(item.qtd))}). Ao lançar, o robô aplica e confere a quantidade antes de gerar a compra; se o SisChef já converteu esta linha sozinho, ou algo não bater, ele para e avisa, sem lançar.
        </p>
      )}
      <div className="acoes">
        <button type="button" className="botao" disabled={conversao == null || desabilitado || enviando} onClick={() => void guardar(conversao)}>
          {enviando ? 'Confirmando…' : 'Confirmar'}
        </button>
        {editando && <button type="button" className="link" disabled={enviando} onClick={() => { setEditando(false); setTexto(''); setErro('') }}>Cancelar</button>}
        {editando && valorAtual != null && (
          <button type="button" className="link perigo" disabled={desabilitado || enviando} onClick={() => void guardar(null)}>Desfazer a conversão</button>
        )}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
