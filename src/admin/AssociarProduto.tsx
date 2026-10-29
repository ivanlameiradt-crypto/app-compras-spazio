// Caixa de associação de produto (aba "Lançamento fiscal"): para um item da nota que ainda não tem produto no SisChef, o Ivan confere o produto que o app
// indicou (o do robô, o das palavras-chave ou o que ele já tinha confirmado) e toca em UM botão, Confirmar — ou procura outro produto na lista de insumos e
// bebidas que já está no app (com as palavras-chave e os nomes corrigidos que ele escreveu). Confirmado, o item ganha o ✓ verde.
// 07/10 (pedido do Ivan): ele não deve "Trocar" para confirmar o que já está certo. Por isso, quando há um produto indicado (decisão ainda sem a conversão,
// sugestão do robô ou das palavras-chave), o cartão já abre com ele escolhido: "Na nota" (a descrição fica em cima, no painel) e "Produto que eu indiquei no
// SisChef", a conversão no mesmo cartão quando precisa (já preenchida com o peso do nome da nota, quando dá) e Confirmar. "Não é este produto? Escolher outro" abre a
// busca. Item já confirmado por completo continua como "confirmado no app … Editar" (21/10: o antigo "Trocar" virou "Editar", o mesmo botão que todo item da nota
// tem; ele reabre o cartão do mesmo produto, com a conversão para editar, e "Escolher outro" troca o produto).
// ETAPA 1 só GUARDAVA a escolha (cot_nfe_associar) e o Lançar continuava travado. ETAPA 2 ("confirmou no app → pode lançar"): ao lançar, o robô
// aplica a escolha na tela de importação do SisChef. Como o de-para que ele grava lá é PERMANENTE para o código do fornecedor, a decisão tem de
// estar COMPLETA antes: quando a unidade da nota é diferente da unidade do produto (UN × KG), o SisChef abre um modal de conversão e pergunta
// quanto vale 1 unidade da nota em unidades do produto — e quem sabe isso é o Ivan (lata de 395 g → 0,395). Por isso a caixa PEDE o valor, em vez
// de adivinhar (uma peça de peso variável, por exemplo, não deve ter conversão fixa: aí o certo é escolher outro produto ou associar no SisChef).
// MAS a unidade que a lista do app conhece é um palpite pelo nome ("kg" só com "(KG)" no nome; "un" para todo o resto; nada para produto novo), e
// quem confere de verdade é o robô, no cadastro vivo do SisChef, antes de gravar. Então o campo da conversão tem três jeitos (situacaoConversao):
// OBRIGATÓRIO quando é certo que o SisChef vai pedir (nota em UN, produto "(KG)", ou produto em CT/PCT, desde 22/10/2026); OPCIONAL quando o app só desconfia (produto "un" ou novo) — aí
// o Ivan informa se souber, e se deixar vazio o robô para a nota pedindo, caso precise; ESCONDIDO quando as unidades batem — com um link para
// abrir, para o caso raro de o produto estar em outra unidade no SisChef apesar do nome.
// "Lembrar esta descrição" (marcado de início): ao confirmar, a descrição que veio na nota vira palavra-chave do produto, e da próxima vez a caixa
// já o sugere — é assim que a lista do Ivan aprende sem travar.
import { useMemo, useState } from 'react'
import type { AssociacaoApp, ItemNotaSefaz, NfeAprendizado, ProdutoCatalogo } from '../lib/tipos'
import {
  CONVERSAO_CASAS, CONVERSAO_MAXIMA, buscarProdutos, conversaoDaDecisao, fardoPeloNome, formatarConversao, formatarQuantidade, nomeParaMostrar, parseConversao, pesoPeloNome,
  quantidadeNoEstoque, rotuloUnidade, situacaoConversao, sugestaoNoCatalogo, sugestaoPorPalavras, textoConversao,
} from './associacaoRegras'
import { ProdutoNaoCadastrado, type OrigemProduto } from './CadastrarProduto'
import { ACOES_PRODUTO } from './acoesProduto'
import { ehEmbalagemContada } from '../lib/unidadesDaLista'

interface Props {
  item: ItemNotaSefaz
  /** Número do item na NF (a chave da decisão no banco). */
  n: number
  /** A lista de insumos do app; null = ainda carregando. */
  catalogo: ProdutoCatalogo[] | null
  catalogoFalhou: boolean
  /** O que o Ivan já confirmou para este item, ou null. */
  decisao: AssociacaoApp | null
  /** Guarda a escolha (`produtoId`) ou a desfaz (null); recarrega a nota. `lembrar` = deixar a descrição da nota como palavra-chave do produto.
   *  `conversao` = quanto vale 1 unidade da nota em unidades do produto no SisChef (null = o Ivan não informou: ou as unidades batem, ou ele deixou
   *  para o robô conferir no cadastro vivo). Lança Error com texto claro se falhar. */
  salvar: (n: number, produtoId: number | null, lembrar?: boolean, conversao?: number | null) => Promise<void>
  /** A chave da nota: vai como origem do pedido de "Cadastrar produto novo" (com o número do item), para o pedido dizer de onde veio. */
  notaChave?: string
  /** Memória de embalagem (29/10/2026): a linha que o robô lembra para o código deste item (CNPJ + CÓD. FOR + unidade), ou nada. Com ela e sem decisão do Ivan, a caixa oferece "Usar o lembrado". */
  lembrada?: NfeAprendizado | null
}

// As regras puras da conversão (parseConversao, formatarConversao, textoConversao, conversaoDaDecisao, pesoPeloNome) moram em associacaoRegras.ts, com
// teste unitário; aqui fica só a tela.

/** A descrição da nota sem o "CÓD. FOR: 123" do SisChef, e curta para caber na frase da opção "Lembrar". */
const descricaoCurta = (d: string | undefined): string => {
  const t = (d ?? '').replace(/^CÓD\. FOR:\s*\S+\s*/i, '').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 59)}…` : t
}

export default function AssociarProduto({ item, n, catalogo, catalogoFalhou, decisao, salvar, notaChave, lembrada }: Props) {
  const [texto, setTexto] = useState('')
  const [escolhido, setEscolhido] = useState<ProdutoCatalogo | null>(null) // produto que o Ivan PROCUROU na lista (o indicado vem em `proposta`)
  const [dispensou, setDispensou] = useState(false) // "Não é este produto? Escolher outro": para de propor o produto indicado
  const [trocando, setTrocando] = useState(false) // já havia escolha confirmada e o Ivan quer mudá-la
  const [lembrar, setLembrar] = useState(true)
  // O que o Ivan digitou no campo da conversão; null = ainda não mexeu (vale o valor que já estava gravado ou a sugestão do nome da nota)
  const [conversaoTexto, setConversaoTexto] = useState<string | null>(null)
  const [conversaoAberta, setConversaoAberta] = useState(false) // o Ivan abriu o campo pelo link, no caso em que ele fica escondido (unidades iguais)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const [novos, setNovos] = useState<ProdutoCatalogo[]>([]) // produtos que o Ivan acabou de cadastrar pelo app: entram na busca desta caixa na hora
  const lista = useMemo(() => [...(catalogo ?? []), ...novos.filter((n) => !(catalogo ?? []).some((p) => p.produto_id === n.produto_id))], [catalogo, novos])
  const sugestao = useMemo(() => sugestaoNoCatalogo(item, lista), [item, lista])
  const porPalavras = useMemo(() => sugestaoPorPalavras(item, lista), [item, lista])
  const busca = useMemo(() => buscarProdutos(lista, texto), [lista, texto])
  const resumoDaNota = descricaoCurta(item.descricao)

  // A decisão já gravada, como produto da lista (ou, sem a lista, com o que ficou guardado nela).
  const daDecisao = useMemo<ProdutoCatalogo | null>(() => {
    if (!decisao) return null
    return lista.find((p) => p.produto_id === decisao.produto_id) ?? { produto_id: decisao.produto_id, nome: decisao.produto_nome, unidade: decisao.unidade }
  }, [decisao, lista])
  // O nome da nota diz que cada unidade é um FARDO ("SIX PACK" = 6): com UN × UN o SisChef não pede conversão e o fardo entraria como 1 unidade (NF 90049, 28/10/2026).
  // Então o número é pedido sempre (já vem preenchido pelo nome); "1" diz que o produto do SisChef já é o fardo inteiro.
  const fardoDoNome = fardoPeloNome(item.descricao, item.unidade_sischef)
  // Decisão que ainda NÃO vale: é certo que o SisChef vai pedir a conversão (nota em UN, produto "(KG)") ou o nome diz que é fardo, e ela não foi informada. Fica no cartão, para confirmar.
  const pendente = decisao != null && (situacaoConversao(item.unidade_sischef, decisao.unidade) === 'obrigatoria' || fardoDoNome != null) && conversaoDaDecisao(decisao) == null
  // O produto que o app INDICA para o Ivan só confirmar: o da decisão (se falta a conversão ou ele quer editar) ou, sem decisão, o do robô / das palavras-chave.
  // Só depois que a lista de produtos carrega (ou falha): antes disso o nome e a unidade do produto ainda não são os da lista, e o Ivan poderia confirmar com o palpite cru.
  const listaPronta = catalogo !== null || catalogoFalhou
  const proposta: ProdutoCatalogo | null = dispensou || !listaPronta ? null
    : decisao ? (pendente || trocando ? daDecisao : null)
    : sugestao ?? porPalavras?.produto ?? null
  const atual = escolhido ?? proposta
  const eProposta = escolhido == null && proposta != null

  // Como fica o campo da conversão para o produto escolhido (ver o cabeçalho e associacaoRegras.situacaoConversao):
  // "obrigatoria" = campo aberto e o Confirmar espera um número; "opcional" = campo aberto, pode ficar vazio; "oculta" = sem campo, só um link para abrir.
  const situacao = atual != null ? situacaoConversao(item.unidade_sischef, atual.unidade) : 'oculta'
  // Fardo pelo nome só vale para o campo quando o número não é obrigatório por outro motivo (nota em UN × produto em KG/CT/PCT já tem a sua conta e o seu exemplo)
  const fardo = atual != null && situacao !== 'obrigatoria' ? fardoDoNome : null
  const campoVisivel = atual != null && (situacao !== 'oculta' || conversaoAberta || fardo != null)
  // Valor que o campo mostra enquanto o Ivan não digita: a conversão já gravada para ESTE produto; senão, quando é obrigatória, o peso tirado do nome da nota.
  const gravada = atual != null && decisao?.produto_id === atual.produto_id ? conversaoDaDecisao(decisao) : null
  // O peso do nome ("395G" → 0,395) só serve a produto em KG. Produto em CT/PCT também tem conversão obrigatória (22/10/2026), mas "3KG" no nome de um saco é a capacidade, não quantas unidades vêm no CT.
  const peso = atual != null && situacao === 'obrigatoria' && gravada == null && rotuloUnidade(atual.unidade) === 'KG' ? pesoPeloNome(item.descricao, item.unidade_sischef) : null
  const padrao = gravada != null ? formatarConversao(gravada) : peso != null ? formatarConversao(peso.kg) : fardo != null ? formatarConversao(fardo.fator) : ''
  const valorConversao = conversaoTexto ?? padrao
  // Em qualquer modo: texto digitado e inválido trava o Confirmar (nunca se grava um palpite); campo vazio só trava quando é obrigatório (ou o nome diz que é fardo).
  const conversao = valorConversao.trim() !== '' ? parseConversao(valorConversao) : null
  const conversaoInvalida = valorConversao.trim() !== '' && conversao == null
  const podeConfirmar = !enviando && !conversaoInvalida && (situacao !== 'obrigatoria' && fardo == null || conversao != null)
  const unidadeNota = rotuloUnidade(item.unidade_sischef)
  // O eco usa o MESMO texto que a linha "confirmado no app" e o bloco "o robô vai associar" (associacaoRegras.textoConversao): só nomeia a unidade do
  // produto quando ela é confiável ("(KG)" no nome); nos outros modos a unidade da lista é um chute, e dizer "= 2 UN" quando no SisChef o produto pode
  // estar em PCT enganaria o Ivan — aí fica "na unidade do produto no SisChef". Antes e depois de confirmar, a tela diz a mesma coisa.
  const ecoConversao = conversao != null && atual != null ? textoConversao(item.unidade_sischef, atual.unidade, conversao) : null

  function limpar() {
    setEscolhido(null); setTexto(''); setConversaoTexto(null); setConversaoAberta(false); setTrocando(false); setDispensou(false)
  }
  async function guardar(produtoId: number | null) {
    if (enviando) return
    setEnviando(true); setErro('')
    try {
      // conversão = o número válido digitado (ou o sugerido que ele confirmou), ou null (campo vazio); desfazer (produtoId nulo) manda null
      await salvar(n, produtoId, produtoId != null && lembrar && resumoDaNota !== '', produtoId != null ? conversao : null)
      limpar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui guardar a escolha agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  // Memória de embalagem (29/10/2026): o robô já viu este código desta loja numa nota lançada. "Usar o lembrado" grava a decisão como se o Ivan a tivesse feito à mão — o produto e a
  // conversão lembrados, pela mesma função `salvar` do Confirmar — e, por já vir com o número, também resolve o aviso do fardo ("SIX PACK" pede o número). Sem "Lembrar esta
  // descrição": a opção nem aparece aqui, e o código do fornecedor já é a chave da memória. Só aparece enquanto não há decisão do Ivan para o item.
  const nomeLembrado = lembrada ? nomeParaMostrar(catalogo, lembrada.produto_id, (lembrada.produto_nome ?? '').trim() || `produto ${lembrada.produto_id}`).nome : ''
  async function usarLembrado() {
    if (enviando || !lembrada) return
    setEnviando(true); setErro('')
    try {
      await salvar(n, lembrada.produto_id, false, lembrada.fator)
      limpar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui guardar a escolha agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  // Já confirmado por completo: o ✓ e o nome ficam no item (lá em cima); aqui só o aviso de confirmado (com a conversão e, quando o app conhece a unidade do
  // produto, a conta do que entra no estoque) e o "Editar" (pedido do Ivan, 21/10: todo item tem o botão; ele reabre o cartão — produto e conversão).
  if (decisao && !trocando && !pendente) {
    const conv = conversaoDaDecisao(decisao)
    const entra = conv != null && decisao.unidade ? quantidadeNoEstoque(item.qtd, conv) : null
    return (
      <div className="associar-feito" data-testid="associacao-confirmada">
        <span className="confirmado">
          confirmado no app · cód. {decisao.produto_id}{conv != null && ` · ${textoConversao(item.unidade_sischef, decisao.unidade, conv)}`}
          {entra != null && conv != null && ` · entram ${formatarQuantidade(Number(item.qtd))} × ${formatarConversao(conv)} = ${formatarQuantidade(entra)} ${rotuloUnidade(decisao.unidade)}`}
        </span>
        <button type="button" className="editar-item" onClick={() => { setErro(''); setConversaoAberta(true); setTrocando(true) }}>
          <span aria-hidden="true">✎</span> Editar
        </button>
      </div>
    )
  }

  // "Escolher outro" na lista de achados: o produto muda, e a conversão volta ao valor-padrão dele (a gravada, se for o mesmo produto; senão a sugestão).
  const escolher = (p: ProdutoCatalogo) => {
    setEscolhido(p); setTexto(''); setConversaoTexto(null)
    // Escolher o MESMO produto da decisão só serve para mexer na conversão — é o caminho que o robô manda quando para a nota. O campo abre SEMPRE nesse caso.
    setConversaoAberta(decisao?.produto_id === p.produto_id)
  }
  const escolherOutro = () => { setEscolhido(null); setDispensou(true); setConversaoTexto(null); setConversaoAberta(false) }
  const detalhe = (p: ProdutoCatalogo): string =>
    `cód. ${p.produto_id}${p.unidade ? ` · ${rotuloUnidade(p.unidade)}` : ''}${p.nome_sischef ? ` · no SisChef: ${p.nome_sischef}` : ''}`
  // "Cadastrar produto novo": o pedido leva a nota e o item; o produto cadastrado entra na busca desta caixa na hora e fica escolhido (falta só o Confirmar)
  const origemDoCadastro: OrigemProduto = { tipo: 'nota', ...(notaChave ? { id: notaChave } : {}), item: n }
  const usarNovo = (p: ProdutoCatalogo) => { setNovos((a) => [...a.filter((x) => x.produto_id !== p.produto_id), p]); escolher(p) }

  return (
    <div className="associar" data-testid="associar-produto">
      {lembrada && !decisao && (
        <div className="embalagem-lembrada" role="group" aria-label="Produto que o robô lembra para este código" data-testid="produto-lembrado">
          <p>{`Da última vez este código foi ${nomeLembrado} (1 ${unidadeNota} = ${formatarConversao(lembrada.fator)}).`}</p>
          <div className="acoes">
            <button type="button" className="botao secundario" disabled={enviando} onClick={() => void usarLembrado()}>Usar o lembrado</button>
          </div>
        </div>
      )}
      {catalogo === null && !catalogoFalhou && <p className="sub">Carregando a lista de produtos…</p>}
      {catalogoFalhou && <p className="erro" role="alert">Não consegui carregar a lista de produtos. Atualize a página.</p>}

      {catalogo !== null && !atual && (
        <>
          <label>Produto do SisChef
            <input type="text" autoComplete="off" placeholder="Nome, palavra-chave ou código" value={texto} disabled={enviando}
              onChange={(e) => { setTexto(e.target.value); setErro('') }} />
          </label>
          {!sugestao && !porPalavras && texto.trim() === '' && (
            <p className="sub" data-testid="sem-sugestao">
              Não achei este produto pelas suas palavras-chave. Digite o nome para procurar na sua lista: ao confirmar, a descrição desta nota fica
              guardada e da próxima vez o app já sugere.
            </p>
          )}
          {sugestao && (
            <p className="sub" data-testid="sugestao-robo">
              Sugestão do robô:{' '}
              <button type="button" className="link" disabled={enviando} onClick={() => escolher(sugestao)}>{sugestao.nome}</button>
              {sugestao.novo && <> <span className="sem-quebra">· produto novo no SisChef</span></>}
              {porPalavras?.produto.produto_id === sugestao.produto_id && <> <span className="sem-quebra">· confere com as suas palavras-chave</span></>}
            </p>
          )}
          {porPalavras && porPalavras.produto.produto_id !== sugestao?.produto_id && (
            <p className="sub" data-testid="sugestao-palavras">
              Pelas suas palavras-chave ({porPalavras.palavras.join(', ')}):{' '}
              <button type="button" className="link" disabled={enviando} onClick={() => escolher(porPalavras.produto)}>{porPalavras.produto.nome}</button>
            </p>
          )}
          {busca.parcial && (
            <p className="sub" data-testid="busca-parcial">Nenhum produto tem todas essas palavras. Estes têm alguma delas (os mais parecidos primeiro):</p>
          )}
          {busca.itens.length > 0 && (
            <ul className="achados" aria-label="Produtos encontrados" data-testid="achados">
              {busca.itens.map((p) => (
                <li key={p.produto_id}>
                  <button type="button" disabled={enviando} onClick={() => escolher(p)}>
                    <span>{p.nome}</span>
                    <span className="sub">{detalhe(p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca.total > busca.itens.length && <p className="sub">Mostrando {busca.itens.length} de {busca.total}: digite mais letras para afinar.</p>}
          {texto.trim() !== '' && busca.total === 0 && (
            <p className="sub" data-testid="sem-resultado">
              Nada na sua lista de insumos com isso. Tente outra palavra, parte do nome ou o código do SisChef.
            </p>
          )}
          {/* Produto que o app não identificou: aviso + botão; com sugestão ou resultados na tela: só o botão discreto, sempre à mão (pedido do Ivan, 13/10) */}
          {!enviando && (
            <ProdutoNaoCadastrado descricaoDoItem={item.descricao ?? ''} acoes={ACOES_PRODUTO} origem={origemDoCadastro}
              discreto={!(busca.total === 0 && (texto.trim() !== '' || (!sugestao && !porPalavras)))} aoUsar={usarNovo} />
          )}
        </>
      )}

      {atual && (
        <>
          <div className="escolhido" data-testid="produto-escolhido">
            <span className="sub rotulo">{eProposta ? 'Produto que eu indiquei no SisChef' : 'Produto escolhido'}</span>
            <div>
              <b>{atual.nome}</b>{' '}
              <span className="sub">
                {/* só o curto (código e unidade) não quebra; o "no SisChef: nome" é longo e tem de poder quebrar, senão a caixa estoura a tela */}
                <span className="sem-quebra">cód. {atual.produto_id}{atual.unidade ? ` · ${rotuloUnidade(atual.unidade)}` : ''}{atual.novo ? ' · novo, ainda fora da lista semanal' : ''}</span>
                {atual.nome_sischef && ` · no SisChef: ${atual.nome_sischef}`}
              </span>
            </div>
          </div>
          {campoVisivel && (
            <div className={`${situacao === 'obrigatoria' ? 'amarelo ' : ''}pedir-conversao`} data-testid="pedir-conversao">
              {situacao === 'obrigatoria' ? (
                <>
                  {/* A nota vem em UN e o produto é em KG: o SisChef vai pedir a conversão no modal "UN DIFERE", e o robô digita o que estiver aqui.
                      Esse de-para fica gravado lá para as próximas notas do fornecedor, por isso é o Ivan quem confirma (não se adivinha). */}
                  <label>Quanto vale 1 {unidadeNota} em {rotuloUnidade(atual.unidade)}?
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0,000" value={valorConversao} disabled={enviando}
                      onChange={(e) => { setConversaoTexto(e.target.value); setErro('') }} />
                  </label>
                  {peso != null && conversaoTexto === null ? (
                    <p className="sub" data-testid="conversao-sugerida">
                      Sugestão tirada do nome da nota ({peso.trecho} = {formatarConversao(peso.kg)}). Confira na embalagem e corrija se precisar. O robô grava essa conversão no SisChef junto com a associação.
                    </p>
                  ) : (
                    <p className="sub" data-testid="conversao-exemplo">
                      {ehEmbalagemContada(atual.unidade)
                        ? `Ex.: se cada ${unidadeNota} da nota traz 10 ${rotuloUnidade(atual.unidade)}, digite 10.`
                        : 'Ex.: lata de 395 g = 0,395.'}{' '}
                      O robô grava essa conversão no SisChef junto com a associação.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* O app não sabe ao certo em que unidade este produto está no SisChef (a unidade da lista é um palpite pelo nome, ou o produto é
                      novo e nem isso tem). Não dá para obrigar um número que talvez nem seja pedido — e não dá para esconder o campo, senão o robô
                      para pedindo a conversão num campo que não existe. Fica opcional: o Ivan informa se souber; vazio = "no SisChef é a mesma unidade". */}
                  <label>Quanto vale 1 {unidadeNota} na unidade do produto no SisChef?{fardo == null ? ' (opcional)' : ''}
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0,000" value={valorConversao} disabled={enviando}
                      onChange={(e) => { setConversaoTexto(e.target.value); setErro('') }} />
                  </label>
                  {fardo != null ? (
                    <p className="amarelo sub" data-testid="conversao-fardo">
                      O nome da nota diz {fardo.trecho}: cada {unidadeNota} da nota é um fardo com {fardo.fator} unidades, então deixei {formatarConversao(fardo.fator)} aqui. Confira e
                      corrija se precisar. Se o produto do SisChef já é o fardo inteiro, digite 1.
                    </p>
                  ) : (
                    <p className="sub">
                      {atual.novo
                        ? 'Produto fora da lista semanal: o app não conhece a unidade dele no SisChef. '
                        : situacao === 'oculta'
                          ? 'Pelo nome, o produto parece estar na mesma unidade da nota no SisChef. '
                          : 'A lista do app não sabe ao certo a unidade deste produto no SisChef. '}
                      Se lá ele também for em {unidadeNota}, deixe vazio. Se o robô parar pedindo a conversão, volte aqui (Editar) e informe.
                      {' '}Se cada {unidadeNota} da nota é uma caixa ou um pacote com várias unidades (ex.: caixa de 168), digite quantas.
                    </p>
                  )}
                </>
              )}
              {conversaoInvalida && (
                <p className="erro" data-testid="conversao-invalida">
                  Número maior que zero, até {formatarConversao(CONVERSAO_MAXIMA)}, com até {CONVERSAO_CASAS} casas (vírgula ou ponto).
                </p>
              )}
              {/* Eco do que foi entendido: "0,395" e "0.395" são a mesma coisa, "1000" é mil — o Ivan vê o número que vai para o SisChef antes de confirmar */}
              {ecoConversao && <p className="sub" data-testid="conversao-eco">Vai gravar: {ecoConversao}</p>}
            </div>
          )}
          {unidadeNota === '' && (
            // A leitura do SisChef não trouxe a unidade deste item na nota. Sem ela nem o app nem o robô sabem se precisa de conversão, e o robô NÃO
            // associa às cegas (o de-para é permanente): ao lançar, ele para a nota antes de gravar. Melhor o Ivan saber disso já, com a saída.
            <p className="sub" data-testid="nota-sem-unidade">
              A leitura do SisChef não trouxe a unidade deste item na nota. A escolha fica guardada, mas ao lançar o robô vai parar antes de associar
              e pedir para atualizar a lista de notas; se a unidade continuar em branco, associe este item no SisChef.
            </p>
          )}
          {situacao === 'oculta' && !conversaoAberta && fardo == null && unidadeNota !== '' && (
            <p className="sub" data-testid="sem-conversao">
              Sem conversão: a nota e o produto estão na mesma unidade ({unidadeNota}).{' '}
              <button type="button" className="link" data-testid="abrir-conversao" disabled={enviando} onClick={() => setConversaoAberta(true)}>
                Cada {unidadeNota} da nota é uma caixa ou pacote com várias unidades? O produto no SisChef está em outra unidade? Informar a conversão
              </button>
            </p>
          )}
          {resumoDaNota !== '' && (
            <label className="marcar lembrar" data-testid="lembrar-descricao">
              <input type="checkbox" checked={lembrar} disabled={enviando} onChange={(e) => setLembrar(e.target.checked)} />
              Lembrar esta descrição: da próxima vez, “{resumoDaNota}” já sugere este produto
            </label>
          )}
          <div className="acoes">
            <button type="button" className="botao" disabled={!podeConfirmar} onClick={() => void guardar(atual.produto_id)}>
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </button>
            <button type="button" className="link" disabled={enviando} onClick={escolherOutro}>Não é este produto? Escolher outro</button>
          </div>
          {/* O app INDICOU o produto (robô, palavras-chave ou decisão sem a conversão) e ele pode estar errado: o botão discreto de cadastrar fica à mão
              também aqui, embaixo do Confirmar (R2; revisão 2, I4). Antes ele só aparecia depois de "Escolher outro". */}
          {eProposta && !enviando && (
            <ProdutoNaoCadastrado descricaoDoItem={item.descricao ?? ''} acoes={ACOES_PRODUTO} origem={origemDoCadastro} discreto aoUsar={usarNovo} />
          )}
        </>
      )}

      {decisao && trocando && !escolhido && (
        <div className="associar-feito">
          <button type="button" className="link" disabled={enviando} onClick={limpar}>Cancelar</button>{' '}
          <button type="button" className="link perigo" disabled={enviando} onClick={() => void guardar(null)}>Desfazer a escolha</button>
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
