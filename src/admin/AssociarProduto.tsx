// Caixa de associação de produto (aba "Lançamento fiscal"): para um item da nota que ainda não tem produto no SisChef, o Ivan digita o produto
// (a lista é a de insumos e bebidas que já está no app, com as palavras-chave e os nomes corrigidos que ele escreveu), escolhe, toca em Confirmar
// e o item ganha o ✓ verde de "confirmado".
// ETAPA 1: só GUARDA a escolha (cot_nfe_associar). O robô ainda não a aplica no SisChef, e por isso o Lançar da nota continua travado.
// "Lembrar esta descrição" (marcado de início): ao confirmar, a descrição que veio na nota vira palavra-chave do produto, e da próxima vez a caixa
// já o sugere — é assim que a lista do Ivan aprende sem travar.
import { useMemo, useState } from 'react'
import type { AssociacaoApp, ItemNotaSefaz, ProdutoCatalogo } from '../lib/tipos'
import { buscarProdutos, sugestaoNoCatalogo, sugestaoPorPalavras, unidadesDiferem } from './associacaoRegras'

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
   *  Lança Error com texto claro se falhar. */
  salvar: (n: number, produtoId: number | null, lembrar?: boolean) => Promise<void>
}

const unid = (u: string | null | undefined): string => (u ?? '').trim().toUpperCase()
/** A descrição da nota sem o "CÓD. FOR: 123" do SisChef, e curta para caber na frase da opção "Lembrar". */
const descricaoCurta = (d: string | undefined): string => {
  const t = (d ?? '').replace(/^CÓD\. FOR:\s*\S+\s*/i, '').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 59)}…` : t
}

export default function AssociarProduto({ item, n, catalogo, catalogoFalhou, decisao, salvar }: Props) {
  const [texto, setTexto] = useState('')
  const [escolhido, setEscolhido] = useState<ProdutoCatalogo | null>(null)
  const [trocando, setTrocando] = useState(false) // já havia escolha confirmada e o Ivan quer mudá-la
  const [lembrar, setLembrar] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const lista = useMemo(() => catalogo ?? [], [catalogo])
  const sugestao = useMemo(() => sugestaoNoCatalogo(item, lista), [item, lista])
  const porPalavras = useMemo(() => sugestaoPorPalavras(item, lista), [item, lista])
  const busca = useMemo(() => buscarProdutos(lista, texto), [lista, texto])
  const resumoDaNota = descricaoCurta(item.descricao)

  async function guardar(produtoId: number | null) {
    if (enviando) return
    setEnviando(true); setErro('')
    try {
      await salvar(n, produtoId, produtoId != null && lembrar && resumoDaNota !== '')
      setEscolhido(null); setTexto(''); setTrocando(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui guardar a escolha agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  // Já confirmado: o ✓ e o nome ficam no item (lá em cima); aqui só o aviso de confirmado e o "Trocar".
  if (decisao && !trocando) {
    return (
      <div className="associar-feito" data-testid="associacao-confirmada">
        <span className="confirmado">confirmado no app · cód. {decisao.produto_id}</span>{' '}
        <button type="button" className="link" onClick={() => { setErro(''); setTrocando(true) }}>Trocar</button>
      </div>
    )
  }

  const escolher = (p: ProdutoCatalogo) => { setEscolhido(p); setTexto('') }
  const detalhe = (p: ProdutoCatalogo): string =>
    `cód. ${p.produto_id}${p.unidade ? ` · ${unid(p.unidade)}` : ''}${p.nome_sischef ? ` · no SisChef: ${p.nome_sischef}` : ''}`

  return (
    <div className="associar" data-testid="associar-produto">
      {catalogo === null && !catalogoFalhou && <p className="sub">Carregando a lista de produtos…</p>}
      {catalogoFalhou && <p className="erro" role="alert">Não consegui carregar a lista de produtos. Atualize a página.</p>}

      {catalogo !== null && !escolhido && (
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
              Nada na sua lista de insumos com isso. Tente outra palavra, parte do nome ou o código do SisChef. Se o produto é novo e ainda não está
              na lista, associe-o direto no SisChef.
            </p>
          )}
        </>
      )}

      {escolhido && (
        <>
          <div className="escolhido" data-testid="produto-escolhido">
            <b>{escolhido.nome}</b>{' '}
            <span className="sub">
              {/* só o curto (código e unidade) não quebra; o "no SisChef: nome" é longo e tem de poder quebrar, senão a caixa estoura a tela */}
              <span className="sem-quebra">cód. {escolhido.produto_id}{escolhido.unidade ? ` · ${unid(escolhido.unidade)}` : ''}{escolhido.novo ? ' · novo, ainda fora da lista semanal' : ''}</span>
              {escolhido.nome_sischef && ` · no SisChef: ${escolhido.nome_sischef}`}{' · '}
              <button type="button" className="link" disabled={enviando} onClick={() => setEscolhido(null)}>Escolher outro</button>
            </span>
          </div>
          {unidadesDiferem(item.unidade_sischef, escolhido.unidade) && (
            <div className="amarelo" data-testid="aviso-unidade">
              A nota vem em {unid(item.unidade_sischef)} e este produto é em {unid(escolhido.unidade)}: na etapa do robô vou pedir a conversão
              (quanto vale 1 {unid(item.unidade_sischef)} em {unid(escolhido.unidade)}).
            </div>
          )}
          {resumoDaNota !== '' && (
            <label className="marcar lembrar" data-testid="lembrar-descricao">
              <input type="checkbox" checked={lembrar} disabled={enviando} onChange={(e) => setLembrar(e.target.checked)} />
              Lembrar esta descrição: da próxima vez, “{resumoDaNota}” já sugere este produto
            </label>
          )}
          <div className="acoes">
            <button type="button" className="botao" disabled={enviando} onClick={() => void guardar(escolhido.produto_id)}>
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </button>
          </div>
        </>
      )}

      {decisao && trocando && !escolhido && (
        <div className="associar-feito">
          <button type="button" className="link" disabled={enviando} onClick={() => setTrocando(false)}>Cancelar</button>{' '}
          <button type="button" className="link perigo" disabled={enviando} onClick={() => void guardar(null)}>Desfazer a escolha</button>
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
