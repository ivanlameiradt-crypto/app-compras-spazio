import { useState } from 'react'
import {
  CONVERSAO_CASAS, CONVERSAO_MAXIMA, embalagemPeloNome, formatarConversao, formatarQuantidade, parseConversao, quantidadeNoEstoque, rotuloUnidade,
} from './associacaoRegras'
import type { ItemNotaSefaz } from '../lib/tipos'

/**
 * "Editar" de um item que JÁ vem associado no SisChef (pedido do Ivan, 21/10/2026: todo item tem o botão, mesmo o que está certo). O que se edita aqui é a
 * CONVERSÃO: quanto vale 1 unidade da nota em unidades do estoque. Dois jeitos de precisar dela:
 *  - "UN DIFERE" (a nota em UN, o cadastro em KG, lata de 395 g → 0,395): o robô parou pedindo (`pede`) e a caixa já abre vazia;
 *  - a MESMA unidade, mas a "unidade" da nota é uma embalagem (KETCHUP SACHE 168UN: a nota traz 10 UN = 10 caixas de 168 → digite 168 e entram 1.680).
 * O número fica na nota (cot_nfe_converter_item) e o robô o aplica ao lançar: registra no modal do SisChef, ou — quando a unidade é a mesma — troca a
 * quantidade e o unitário da linha do pedido (regras_embalagem). Mesma régua da caixa de associação: maior que zero, até 10000, 4 casas, vírgula ou ponto.
 * A prévia "entram no estoque" é quantidade × conversão, com a quantidade que o SisChef mostra hoje para o item (a da linha de cima).
 * Item sem produto no SisChef não passa por aqui: lá é a caixa de associação (AssociarProduto) que pede a conversão junto com o produto e tem o seu "Editar".
 */
export function ConversaoItemAssociado({ item, atual, pede, desabilitado, salvar }: {
  item: ItemNotaSefaz & { n: number }
  /** A conversão que o Ivan já informou (decisão com origem "sischef"), ou null. */
  atual: number | null
  /** O robô parou nesta nota dizendo que ESTE item está com UN DIFERE sem conversão. */
  pede: boolean
  desabilitado: boolean
  salvar: (n: number, conversao: number | null) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState(false)
  const [salvo, setSalvo] = useState<number | null | undefined>(undefined) // o que acabou de gravar (vale até a releitura trazer o do servidor)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const valorAtual = salvo !== undefined ? salvo : atual
  const unidade = rotuloUnidade(item.unidade_sischef)
  const conversao = texto.trim() !== '' ? parseConversao(texto) : null
  const invalida = texto.trim() !== '' && conversao == null
  const pendente = pede && valorAtual == null // o robô pediu e ainda ninguém informou: a caixa abre sozinha
  const sugestao = embalagemPeloNome(item.descricao, item.unidade_sischef)

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
  function abrir() {
    setErro('')
    setTexto(valorAtual != null ? formatarConversao(valorAtual) : '')
    setEditando(true)
  }
  /** "10 × 168 = 1.680 UN": a conta que o Ivan confere antes de confirmar (e que fica na linha depois). Nada quando falta a quantidade da leitura. */
  const conta = (c: number | null): string | null => {
    const entra = quantidadeNoEstoque(item.qtd, c)
    return c == null || entra == null ? null : `${formatarQuantidade(Number(item.qtd))} × ${formatarConversao(c)} = ${formatarQuantidade(entra)}${unidade ? ` ${unidade}` : ''}`
  }

  if (!pendente && !editando) {
    const feita = valorAtual != null ? conta(valorAtual) : null
    return (
      <div className="editar-linha" data-testid="editar-item-linha">
        {valorAtual != null && (
          <p className="sub" data-testid="conversao-item-informada">
            Conversão informada: 1 unidade da nota = {formatarConversao(valorAtual)}{unidade ? ` ${unidade}` : ''}.
            {feita && <> Entram no estoque: <b>{feita}</b>.</>} O robô aplica ao lançar.
          </p>
        )}
        <button type="button" className="editar-item" disabled={desabilitado || enviando} onClick={abrir}>
          <span aria-hidden="true">✎</span> Editar
        </button>
      </div>
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
