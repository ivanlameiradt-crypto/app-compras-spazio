// Caixa de associação de produto (aba "Lançamento fiscal"): para um item da nota que ainda não tem produto no SisChef, o Ivan digita o produto
// (a lista é a de insumos e bebidas que já está no app), escolhe, toca em Confirmar e o item ganha o ✓ verde de "confirmado".
// ETAPA 1: só GUARDA a escolha (cot_nfe_associar). O robô ainda não a aplica no SisChef, e por isso o Lançar da nota continua travado.
import { useMemo, useState } from 'react'
import type { AssociacaoApp, ItemNotaSefaz, ProdutoCatalogo } from '../lib/tipos'
import { buscarProdutos, sugestaoNoCatalogo, unidadesDiferem } from './associacaoRegras'

interface Props {
  item: ItemNotaSefaz
  /** Número do item na NF (a chave da decisão no banco). */
  n: number
  /** A lista de insumos do app; null = ainda carregando. */
  catalogo: ProdutoCatalogo[] | null
  catalogoFalhou: boolean
  /** O que o Ivan já confirmou para este item, ou null. */
  decisao: AssociacaoApp | null
  /** Guarda a escolha (`produtoId`) ou a desfaz (null); recarrega a nota. Lança Error com texto claro se falhar. */
  salvar: (n: number, produtoId: number | null) => Promise<void>
}

const unid = (u: string | null | undefined): string => (u ?? '').trim().toUpperCase()

export default function AssociarProduto({ item, n, catalogo, catalogoFalhou, decisao, salvar }: Props) {
  const [texto, setTexto] = useState('')
  const [escolhido, setEscolhido] = useState<ProdutoCatalogo | null>(null)
  const [trocando, setTrocando] = useState(false) // já havia escolha confirmada e o Ivan quer mudá-la
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const lista = useMemo(() => catalogo ?? [], [catalogo])
  const sugestao = useMemo(() => sugestaoNoCatalogo(item, lista), [item, lista])
  const busca = useMemo(() => buscarProdutos(lista, texto), [lista, texto])

  async function guardar(produtoId: number | null) {
    if (enviando) return
    setEnviando(true); setErro('')
    try {
      await salvar(n, produtoId)
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

  return (
    <div className="associar" data-testid="associar-produto">
      {catalogo === null && !catalogoFalhou && <p className="sub">Carregando a lista de produtos…</p>}
      {catalogoFalhou && <p className="erro" role="alert">Não consegui carregar a lista de produtos. Atualize a página.</p>}

      {catalogo !== null && !escolhido && (
        <>
          <label>Produto do SisChef
            <input type="text" autoComplete="off" placeholder="Digite o nome ou o código do produto" value={texto} disabled={enviando}
              onChange={(e) => { setTexto(e.target.value); setErro('') }} />
          </label>
          {sugestao && (
            <p className="sub" data-testid="sugestao-robo">
              Sugestão do robô:{' '}
              <button type="button" className="link" disabled={enviando} onClick={() => { setEscolhido(sugestao); setTexto('') }}>{sugestao.nome}</button>
              {sugestao.novo && <> <span className="sem-quebra">· produto novo no SisChef</span></>}
            </p>
          )}
          {busca.itens.length > 0 && (
            <ul className="achados" aria-label="Produtos encontrados" data-testid="achados">
              {busca.itens.map((p) => (
                <li key={p.produto_id}>
                  <button type="button" disabled={enviando} onClick={() => { setEscolhido(p); setTexto('') }}>
                    <span>{p.nome}</span>
                    <span className="sub">cód. {p.produto_id}{p.unidade ? ` · ${unid(p.unidade)}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca.total > busca.itens.length && <p className="sub">Mostrando {busca.itens.length} de {busca.total}: digite mais letras para afinar.</p>}
          {texto.trim() !== '' && busca.total === 0 && (
            <p className="sub" data-testid="sem-resultado">
              Nenhum produto da sua lista de insumos tem isso. Se o produto ainda não existe, cadastre-o no SisChef primeiro.
            </p>
          )}
        </>
      )}

      {escolhido && (
        <>
          <div className="escolhido" data-testid="produto-escolhido">
            <b>{escolhido.nome}</b>{' '}
            <span className="sub">
              <span className="sem-quebra">cód. {escolhido.produto_id}{escolhido.unidade ? ` · ${unid(escolhido.unidade)}` : ''}{escolhido.novo ? ' · novo, ainda fora da lista semanal' : ''}</span>{' · '}
              <button type="button" className="link" disabled={enviando} onClick={() => setEscolhido(null)}>Escolher outro</button>
            </span>
          </div>
          {unidadesDiferem(item.unidade_sischef, escolhido.unidade) && (
            <div className="amarelo" data-testid="aviso-unidade">
              A nota vem em {unid(item.unidade_sischef)} e este produto é em {unid(escolhido.unidade)}: na etapa do robô vou pedir a conversão
              (quanto vale 1 {unid(item.unidade_sischef)} em {unid(escolhido.unidade)}).
            </div>
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
