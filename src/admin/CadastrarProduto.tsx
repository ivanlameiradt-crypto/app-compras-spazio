// "Cadastrar produto novo" dentro do app (pedido do Ivan, 13/10/2026): o produto do cupom, da nota fiscal ou da compra avulsa não está na lista do app.
// O Ivan confere o nome, escolhe o GRUPO e a UNIDADE (sem chute: ele decide; o campo da unidade começa vazio) e toca em "Cadastrar no SisChef e no app"; o robô CONFERE no
// SisChef se o produto já existe e, se não, o cria (Produtos/Taxas › Produtos › Novo, com os mesmos parâmetros dos insumos: controla estoque, de terceiros, NCM 00, preços
// zerados, código de barras gerado pelo SisChef). O app guarda o produto na planilha de produtos e ele passa a aparecer na lista. Pronto o cadastro, o Ivan toca em
// "Usar este produto": o app NUNCA escolhe sozinho. As ações (rede) entram por `acoes`, para a tela ser testada e mostrada sem servidor.
import { useEffect, useRef, useState } from 'react'
import type { ProdutoCatalogo } from '../lib/tipos'
import {
  GRUPOS_DE_INSUMO, PRODUTO_PRONTO, UNIDADES, chaveDoNome, nomeNoSischef, palavrasSugeridas, problemaDoProduto, sugerirUnidade, type EstadoProduto,
} from './produtoRegras'

export interface OrigemProduto { tipo: 'cupom' | 'nota' | 'avulsa'; id?: string; item?: number }
export interface PedidoProduto {
  descricao: string; grupo: string; unidade: 'KG' | 'UN'; palavras: string
  origem: OrigemProduto['tipo']; origem_id?: string; origem_item?: number
  /** "Criar mesmo assim": o robô achou produto parecido e o Ivan disse que não é nenhum deles. */
  forcar?: boolean
  /** "Usar este": o produto já existe no SisChef com este código; o robô só o confere e o traz para a lista do app. */
  existente_id?: number
}
export interface CandidatoProduto { produto_id: number; descricao: string; unidade: string | null }
export interface StatusProduto {
  id: string; estado: EstadoProduto; produto_id: number | null; motivo: string | null; candidatos: CandidatoProduto[]
  /** O que o Ivan pediu (para reabrir a tela no meio do cadastro). Depois de pronto: o nome e a unidade do produto como estão na lista do app. */
  descricao: string; grupo: string; unidade: string
}
export interface RespostaPedido { cadastro_id: string }
export interface AcoesProduto {
  cadastrar(pedido: PedidoProduto): Promise<RespostaPedido>
  /** Um pedido de cadastro, pelo código (`id`) ou o mais recente do nome (`chave`, de `chaveDoNome`); null = nunca pedido. */
  status(q: { id: string } | { chave: string }): Promise<StatusProduto | null>
}

interface Props {
  /** O texto do item como veio (a descrição do cupom ou da nota): ponto de partida do nome e da dica de unidade. */
  descricaoDoItem: string
  acoes: AcoesProduto
  origem: OrigemProduto
  /** O Ivan tocou em "Usar este produto": quem chamou escolhe o produto recém-cadastrado. */
  aoUsar: (produto: ProdutoCatalogo) => void
  /** Um pedido que já existe para este nome (a tela foi aberta de novo no meio do cadastro). */
  inicial?: StatusProduto | null
  /** Intervalo entre as conferências do cadastro (ms); os testes usam um bem curto. */
  intervaloMs?: number
  /** Depois deste tempo sem terminar, a tela avisa que está demorando (ms). */
  demoraMs?: number
}

const mensagem = (e: unknown, padrao: string): string => (e instanceof Error && e.message ? e.message : padrao)
const EM_ANDAMENTO = (e: EstadoProduto | null | undefined): boolean => e === 'PENDENTE' || e === 'PROCESSANDO'
const SEM_CODIGO = 'O cadastro terminou sem o código do produto: confira no SisChef antes de tentar de novo.'

/** O aviso "Produto não cadastrado" + o botão que abre o formulário. Fica fechado até o toque (ou abre sozinho se já há um cadastro deste nome em andamento/feito). */
export function ProdutoNaoCadastrado({ descricaoDoItem, acoes, origem, aoUsar, discreto = false }: Omit<Props, 'intervaloMs' | 'inicial' | 'demoraMs'> & {
  /** O app já sugeriu algo (ou há resultados na busca): sem o aviso amarelo, só o botão discreto, para o Ivan cadastrar quando a sugestão não é o produto certo. */
  discreto?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [inicial, setInicial] = useState<StatusProduto | null>(null)
  const chave = chaveDoNome(nomeNoSischef(descricaoDoItem))

  // Já pediram o cadastro deste nome (esta tela foi fechada no meio, ou outro item da mesma compra): retoma de onde estava. Espera um pouco (a compra avulsa chama isto a cada letra).
  useEffect(() => {
    if (aberto || chave === '') return
    let vivo = true
    const t = setTimeout(() => {
      Promise.resolve(acoes.status({ chave })).then((s) => {
        if (vivo && s && s.estado !== 'REVISAR') { setInicial(s); setAberto(true) }
      }).catch(() => undefined)
    }, 400)
    return () => { vivo = false; clearTimeout(t) }
  }, [aberto, chave, acoes])

  return (
    <div className="produto-nao-cadastrado" data-testid="produto-nao-cadastrado">
      {!aberto ? (
        discreto ? (
          <button type="button" className="link" onClick={() => setAberto(true)} data-testid="abrir-cadastro-produto">Não é nenhum destes? Cadastrar produto novo</button>
        ) : (
          <>
            <p className="amarelo" data-testid="aviso-nao-cadastrado">
              Não identifiquei este item na sua lista pelo nome. Procure acima (pode estar com outro nome, por exemplo o nome do produto em vez da marca). Se ele não existe, cadastre: o robô confere no SisChef antes de criar (se já existir lá, ele só traz para a sua lista).
            </p>
            <button type="button" className="botao secundario" onClick={() => setAberto(true)} data-testid="abrir-cadastro-produto">Cadastrar produto novo</button>
          </>
        )
      ) : (
        <CadastrarProduto descricaoDoItem={descricaoDoItem} acoes={acoes} origem={origem} aoUsar={aoUsar} inicial={inicial} />
      )}
    </div>
  )
}

export default function CadastrarProduto({ descricaoDoItem, acoes, origem, aoUsar, inicial = null, intervaloMs = 5000, demoraMs = 5 * 60_000 }: Props) {
  const [nome, setNome] = useState(inicial ? inicial.descricao : nomeNoSischef(descricaoDoItem))
  const [grupo, setGrupo] = useState(inicial?.grupo ?? '')
  const [unidade, setUnidade] = useState(inicial?.unidade?.toUpperCase() ?? '')
  const [palavras, setPalavras] = useState(palavrasSugeridas(descricaoDoItem))
  const semCodigo = !!inicial && PRODUTO_PRONTO(inicial.estado) && inicial.produto_id === null
  const [estado, setEstado] = useState<EstadoProduto | null>(inicial ? (semCodigo ? 'REVISAR' : inicial.estado) : null)
  const [cadastroId, setCadastroId] = useState<string | null>(inicial?.id ?? null)
  const [produtoId, setProdutoId] = useState<number | null>(inicial?.produto_id ?? null)
  const [nomeDaLista, setNomeDaLista] = useState<string | null>(inicial && PRODUTO_PRONTO(inicial.estado) ? inicial.descricao : null)
  const [motivoRobo, setMotivoRobo] = useState<string | null>(semCodigo ? SEM_CODIGO : (inicial?.motivo ?? null))
  const [candidatos, setCandidatos] = useState<CandidatoProduto[]>(inicial?.candidatos ?? [])
  const [enviando, setEnviando] = useState(false)
  const [demorando, setDemorando] = useState(false)
  const [erro, setErro] = useState('')
  const montado = useRef(true)
  const desde = useRef(Date.now())
  useEffect(() => () => { montado.current = false }, [])

  const cadastrando = EM_ANDAMENTO(estado)
  const pronto = PRODUTO_PRONTO(estado)
  const travado = enviando || cadastrando || pronto
  const problema = problemaDoProduto({ nome, grupo, unidade, palavras })
  const nomeFinal = nomeNoSischef(nome)
  const dica = sugerirUnidade(descricaoDoItem)

  function aplicar(s: StatusProduto) {
    if (!montado.current) return
    const semId = PRODUTO_PRONTO(s.estado) && s.produto_id === null   // nunca "pronto" sem o código do produto
    setEstado(semId ? 'REVISAR' : s.estado); setProdutoId(s.produto_id); setMotivoRobo(semId ? SEM_CODIGO : s.motivo); setCandidatos(s.candidatos ?? [])
    if (PRODUTO_PRONTO(s.estado) && !semId) { setNomeDaLista(s.descricao); if (s.unidade) setUnidade(s.unidade.toUpperCase()) }
  }

  // Enquanto o robô cadastra, olha o andamento a cada poucos segundos (pelo código do pedido) e avisa se passar do prazo.
  useEffect(() => {
    if (!cadastrando || !cadastroId) return
    const id = cadastroId
    const t = setInterval(() => {
      if (Date.now() - desde.current > demoraMs) setDemorando(true)
      Promise.resolve(acoes.status({ id })).then((s) => { if (s) aplicar(s) }).catch(() => undefined)
    }, intervaloMs)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadastrando, cadastroId, acoes, intervaloMs, demoraMs])

  async function pedir(extra: { forcar?: boolean; existente_id?: number } = {}) {
    if (problema) { setErro(problema); return }
    setErro(''); setEnviando(true)
    try {
      const r = await acoes.cadastrar({
        descricao: nomeFinal, grupo, unidade: unidade as 'KG' | 'UN', palavras: palavras.trim(), origem: origem.tipo,
        ...(origem.id ? { origem_id: origem.id } : {}), ...(origem.item !== undefined ? { origem_item: origem.item } : {}), ...extra,
      })
      desde.current = Date.now(); setDemorando(false)
      setCadastroId(r.cadastro_id); setEstado('PENDENTE'); setMotivoRobo(null); setProdutoId(null); setCandidatos([])
      // já pode estar pronto (o nome já tinha sido cadastrado antes): lê o pedido agora em vez de esperar a próxima conferência
      Promise.resolve(acoes.status({ id: r.cadastro_id })).then((s) => { if (s) aplicar(s) }).catch(() => undefined)
    } catch (e) {
      setErro(mensagem(e, 'Não consegui pedir o cadastro agora. Tente de novo.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="associar cadastrar-produto" data-testid="cadastrar-produto">
      <div className="grupo">Produto novo: cadastrar no SisChef e no app</div>
      <p className="sub">O robô só cria o produto no SisChef quando você tocar em “Cadastrar no SisChef e no app”, e antes confere se ele já existe lá. Confira o nome, escolha o grupo e a unidade.</p>

      <label>Nome do produto (como vai ficar no SisChef)
        <input type="text" autoComplete="off" value={nome} disabled={travado} onChange={(e) => setNome(e.target.value)} data-testid="nome-produto" />
      </label>
      <label>Grupo do SisChef
        <select value={grupo} disabled={travado} onChange={(e) => setGrupo(e.target.value)} data-testid="grupo-produto">
          <option value="">-- escolha o grupo --</option>
          {GRUPOS_DE_INSUMO.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label>Unidade (a do estoque no SisChef)
        <select value={unidade} disabled={travado} onChange={(e) => setUnidade(e.target.value)} data-testid="unidade-produto">
          <option value="">-- escolha a unidade --</option>
          {UNIDADES.map((u) => <option key={u.sigla} value={u.sigla}>{u.rotulo}</option>)}
        </select>
      </label>
      {unidade === '' && !travado && <p className="sub" data-testid="unidade-sugerida">Dica pelo nome do item: <b>{dica}</b>. Quem escolhe é você.</p>}
      <label>Palavras-chave para achar o produto (opcional)
        <input type="text" autoComplete="off" value={palavras} disabled={travado} onChange={(e) => setPalavras(e.target.value)} data-testid="palavras-produto" />
      </label>

      <div className="previa-cadastro" data-testid="previa-cadastro">
        <p className="sub"><b>Como vai ficar no SisChef:</b></p>
        <ul className="sub">
          <li>Nome: <b>{nomeFinal || '—'}</b></li>
          <li>Grupo: <b>{grupo || '— (escolha acima)'}</b></li>
          <li>Unidade: <b>{unidade || '— (escolha acima)'}</b> · controla estoque · de terceiros (revenda)</li>
          <li>NCM 00 · preço de compra e de venda zerados (o custo vem das compras) · código de barras gerado pelo SisChef</li>
        </ul>
      </div>

      {!travado && (
        <div className="acoes">
          <button type="button" className="botao" disabled={enviando || problema !== null} onClick={() => void pedir()} data-testid="cadastrar-produto-botao">
            {enviando ? 'Enviando…' : 'Cadastrar no SisChef e no app'}
          </button>
        </div>
      )}
      {problema !== null && !travado && <p className="sub" data-testid="falta-produto">{problema}</p>}

      {cadastrando && <p className="ok" role="status" data-testid="cadastrando-produto">Cadastrando no SisChef… o robô leva uns 2 minutos. Pode deixar esta tela aberta.</p>}
      {cadastrando && demorando && (
        <p className="amarelo" role="status" data-testid="produto-demorando">
          Está demorando mais que o normal. Não toque de novo: espere mais um pouco ou confira no SisChef (Produtos › Produtos) se o produto já aparece.
        </p>
      )}
      {estado === 'REVISAR' && (
        <p className="erro" role="alert" data-testid="produto-revisar">
          O robô parou sem terminar{motivoRobo ? `: ${motivoRobo}` : '.'} Confira no SisChef se o produto já existe antes de tentar de novo.
        </p>
      )}
      {estado === 'REVISAR' && candidatos.length > 0 && (
        <div className="sugestao" data-testid="candidatos-produto">
          <p className="sub">Achei no SisChef {candidatos.length === 1 ? 'um produto parecido' : 'produtos parecidos'}. É {candidatos.length === 1 ? 'este' : 'algum destes'}?</p>
          <ul className="achados">
            {candidatos.map((c) => (
              <li key={c.produto_id}>
                <button type="button" disabled={enviando || problema !== null} onClick={() => void pedir({ existente_id: c.produto_id })} data-testid="usar-candidato">
                  <span>{c.descricao}</span>
                  <span className="sub">cód. {c.produto_id}{c.unidade ? ` · ${c.unidade}` : ''} — usar este</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="acoes">
            <button type="button" className="botao secundario" disabled={enviando || problema !== null} onClick={() => void pedir({ forcar: true })} data-testid="criar-mesmo-assim">
              Não é nenhum destes: criar mesmo assim
            </button>
          </div>
        </div>
      )}
      {pronto && produtoId !== null && (
        <>
          <p className="ok" role="status" data-testid="produto-pronto">
            {estado === 'JA_EXISTIA' ? `✓ Esse produto já existia no SisChef (cód. ${produtoId}): entrou na sua lista.` : `✓ Produto cadastrado no SisChef (cód. ${produtoId}) e na sua lista.`}
          </p>
          <div className="acoes">
            <button type="button" className="botao" onClick={() => aoUsar({ produto_id: produtoId, nome: nomeDaLista ?? nomeFinal, unidade: unidade.toLowerCase() })} data-testid="usar-produto-novo">Usar este produto</button>
          </div>
        </>
      )}
      {erro && <p className="erro" role="alert" data-testid="erro-produto">{erro}</p>}
    </div>
  )
}
