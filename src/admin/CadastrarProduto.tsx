// "Cadastrar produto novo" dentro do app (pedido do Ivan, 13/10/2026): o produto do cupom, da nota fiscal ou da compra avulsa não está na lista do app.
// O Ivan confere o nome, escolhe o GRUPO e a UNIDADE (sem chute: ele decide; o campo da unidade começa vazio) e toca em "Cadastrar no SisChef e no app"; o robô CONFERE no
// SisChef se o produto já existe e, se não, o cria (Produtos/Taxas › Produtos › Novo, com os mesmos parâmetros dos insumos: controla estoque, de terceiros, NCM 00, preços
// zerados, código de barras gerado pelo SisChef). O app guarda o produto na planilha de produtos e ele passa a aparecer na lista. Pronto o cadastro, o Ivan toca em
// "Usar este produto": o app NUNCA escolhe sozinho. As ações (rede) entram por `acoes`, para a tela ser testada e mostrada sem servidor.
// Revisão 2 (14/10): nenhum estado deixa a tela sem saída. A demora conta pela hora do PEDIDO (atualizado_em); passados 5 min, "Chamar o robô de novo"
// (o servidor só chama de novo o pedido que ainda não começou); passados 20 min, "Tentar de novo" (o servidor dá o pedido preso por perdido e abre outro).
// Depois de um toque nesses botões, eles travam 3 min ("Aguarde alguns minutos…"): cada disparo entra na fila que os robôs do SisChef dividem.
import { useEffect, useId, useRef, useState } from 'react'
import type { ProdutoCatalogo } from '../lib/tipos'
import {
  GRUPOS_DE_INSUMO, MINUTOS_SEM_RESPOSTA, PRODUTO_PRONTO, UNIDADES, chaveDoNome, idadeDoPedido, mensagemDoRevisar, nomeNoSischef, palavrasSugeridas, problemaDoProduto,
  sugerirUnidade, type EstadoProduto,
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
  /** A hora do pedido no servidor (ISO). `atualizado_em` muda a cada troca de estado (o robô pegar o pedido também): é por ela que a tela conta a demora. */
  criado_em: string; atualizado_em: string
  /** O resto do que foi pedido, para "Chamar o robô de novo" / "Tentar de novo" repetirem o MESMO pedido também quando a tela foi reaberta. */
  palavras?: string | null; forcar?: boolean; existente_id?: number | null
}
/** `reenviado`: a função chamou o robô de novo para o MESMO pedido (ainda PENDENTE, parado); false = ele já tinha pegado o pedido. */
export interface RespostaPedido { cadastro_id: string; reenviado?: boolean }
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
  /** Depois deste tempo sem terminar (pela hora do pedido), a tela avisa que está demorando e oferece "Chamar o robô de novo" (ms). */
  demoraMs?: number
  /** Depois deste tempo sem terminar, o pedido é dado por perdido: "Tentar de novo" (ms; o servidor usa os mesmos 20 min). */
  limiteMs?: number
  /** O Ivan abriu o formulário agora, pelo toque: o cursor já vai para o nome. Retomado sozinho, não (a tela não pula). */
  focarNome?: boolean
}

type Extra = { forcar?: boolean; existente_id?: number }

const mensagem = (e: unknown, padrao: string): string => (e instanceof Error && e.message ? e.message : padrao)
const EM_ANDAMENTO = (e: EstadoProduto | null | undefined): boolean => e === 'PENDENTE' || e === 'PROCESSANDO'
const SEM_CODIGO = 'o cadastro terminou sem o código do produto'
const CHAMEI = 'Chamei o robô de novo. Ele leva uns 2 minutos.'
const JA_ESTA_COM_ELE = 'O robô já está com este pedido. Espere mais um pouco.'
const AINDA_EM_ANDAMENTO = 'O pedido ainda está em andamento. Espere alguns minutos e toque de novo.'
const AGUARDE = 'Aguarde alguns minutos…'
// Cada disparo do robô entra na fila compartilhada do GitHub (sischef-session: só 1 run espera por grupo) e pode cancelar o run de OUTRO robô que
// esperava. Depois de um toque em "Chamar o robô de novo" ou "Tentar de novo", os dois botões travam por este tempo (relógio do aparelho, não a hora
// do servidor) e reabilitam sozinhos; um pedido retomado já atrasado abre destravado (nenhum toque foi dado nesta tela).
const ESPERA_ENTRE_CHAMADAS_MS = 3 * 60_000
/** O que o pedido teve além do formulário ("Criar mesmo assim" ou "Usar este"): repetir o pedido é repetir isto também. */
const extraDe = (s: StatusProduto | null): Extra => (s?.forcar ? { forcar: true } : s?.existente_id ? { existente_id: s.existente_id } : {})

/** O aviso "Produto não cadastrado" + o botão que abre o formulário. Fica fechado até o toque (ou abre sozinho se já há um cadastro deste nome em andamento/feito). */
export function ProdutoNaoCadastrado({ descricaoDoItem, acoes, origem, aoUsar, discreto = false }: Omit<Props, 'intervaloMs' | 'inicial' | 'demoraMs' | 'limiteMs' | 'focarNome'> & {
  /** O app já sugeriu algo (ou há resultados na busca): sem o aviso amarelo, só o botão discreto, para o Ivan cadastrar quando a sugestão não é o produto certo. */
  discreto?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [peloToque, setPeloToque] = useState(false)
  const [inicial, setInicial] = useState<StatusProduto | null>(null)
  const chave = chaveDoNome(nomeNoSischef(descricaoDoItem))
  const abrir = () => { setPeloToque(true); setAberto(true) }

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
          <button type="button" className="link" onClick={abrir} data-testid="abrir-cadastro-produto">Não é nenhum destes? Cadastrar produto novo</button>
        ) : (
          <>
            <p className="amarelo" role="status" data-testid="aviso-nao-cadastrado">
              Não identifiquei este item na sua lista pelo nome. Procure acima (pode estar com outro nome, por exemplo o nome do produto em vez da marca). Se ele não existe, cadastre: o robô confere no SisChef antes de criar (se já existir lá, ele só traz para a sua lista).
            </p>
            <button type="button" className="botao secundario" onClick={abrir} data-testid="abrir-cadastro-produto">Cadastrar produto novo</button>
          </>
        )
      ) : (
        <CadastrarProduto descricaoDoItem={descricaoDoItem} acoes={acoes} origem={origem} aoUsar={aoUsar} inicial={inicial} focarNome={peloToque} />
      )}
    </div>
  )
}

export default function CadastrarProduto({
  descricaoDoItem, acoes, origem, aoUsar, inicial = null, intervaloMs = 5000, demoraMs = 5 * 60_000, limiteMs = MINUTOS_SEM_RESPOSTA * 60_000, focarNome = false,
}: Props) {
  const [nome, setNome] = useState(inicial ? inicial.descricao : nomeNoSischef(descricaoDoItem))
  const [grupo, setGrupo] = useState(inicial?.grupo ?? '')
  const [unidade, setUnidade] = useState(inicial?.unidade?.toUpperCase() ?? '')
  // retomado: as palavras do PEDIDO (o Ivan pode tê-las mudado); senão, as sugeridas pelo nome do item
  const [palavras, setPalavras] = useState(inicial && inicial.palavras !== undefined ? (inicial.palavras ?? '') : palavrasSugeridas(descricaoDoItem))
  const semCodigo = !!inicial && PRODUTO_PRONTO(inicial.estado) && inicial.produto_id === null
  const [estado, setEstado] = useState<EstadoProduto | null>(inicial ? (semCodigo ? 'REVISAR' : inicial.estado) : null)
  const [cadastroId, setCadastroId] = useState<string | null>(inicial?.id ?? null)
  const [produtoId, setProdutoId] = useState<number | null>(inicial?.produto_id ?? null)
  const [nomeDaLista, setNomeDaLista] = useState<string | null>(inicial && PRODUTO_PRONTO(inicial.estado) ? inicial.descricao : null)
  const [motivoRobo, setMotivoRobo] = useState<string | null>(semCodigo ? SEM_CODIGO : (inicial?.motivo ?? null))
  const [candidatos, setCandidatos] = useState<CandidatoProduto[]>(inicial?.candidatos ?? [])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  // A hora do pedido no servidor e quando a tela a viu pela 1ª vez (ver idadeDoPedido); `agora` anda a cada conferência.
  const [hora, setHora] = useState<{ pedido: string | null; visto: number }>(() => ({ pedido: inicial?.atualizado_em ?? null, visto: Date.now() }))
  const [agora, setAgora] = useState(() => Date.now())
  const [aguardarAte, setAguardarAte] = useState<number | null>(null)   // até quando "Chamar o robô de novo" / "Tentar de novo" ficam travados
  const [aviso, setAviso] = useState<{ acao: 'chamar' | 'tentar'; texto: string } | null>(null)
  const ultimoExtra = useRef<Extra>(extraDe(inicial))
  const montado = useRef(true)
  const campoNome = useRef<HTMLInputElement>(null)
  const idFalta = useId()
  useEffect(() => () => { montado.current = false }, [])
  useEffect(() => { if (focarNome) campoNome.current?.focus() }, [focarNome])

  const cadastrando = EM_ANDAMENTO(estado)
  const pronto = PRODUTO_PRONTO(estado)
  const comCandidatos = estado === 'REVISAR' && candidatos.length > 0
  // REVISAR com o código: o robô pode ter criado o produto. O formulário fica como foi pedido e a saída é "Tentar de novo", que pede ESTE produto (existente_id): não cria outro.
  const comCodigo = estado === 'REVISAR' && produtoId !== null && !comCandidatos
  const travado = enviando || cadastrando || pronto || comCodigo
  const problema = problemaDoProduto({ nome, grupo, unidade, palavras })
  const nomeFinal = nomeNoSischef(nome)
  const dica = sugerirUnidade(descricaoDoItem)
  const idade = cadastrando ? idadeDoPedido(hora.pedido, hora.visto, agora) : 0
  const semResposta = cadastrando && idade >= limiteMs
  const demorando = cadastrando && idade >= demoraMs && !semResposta
  const aguardando = aguardarAte !== null && agora < aguardarAte
  const descreveFalta = problema !== null ? idFalta : undefined

  // a trava dos 3 minutos acaba sozinha, sem depender da conferência (que só roda com o pedido em andamento)
  useEffect(() => {
    if (aguardarAte === null) return
    const t = setTimeout(() => setAgora(Date.now()), Math.max(0, aguardarAte - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [aguardarAte])

  function aplicar(s: StatusProduto) {
    if (!montado.current) return
    const semId = PRODUTO_PRONTO(s.estado) && s.produto_id === null   // nunca "pronto" sem o código do produto
    setEstado(semId ? 'REVISAR' : s.estado); setProdutoId(s.produto_id); setMotivoRobo(semId ? SEM_CODIGO : s.motivo); setCandidatos(s.candidatos ?? [])
    if (PRODUTO_PRONTO(s.estado) && !semId) { setNomeDaLista(s.descricao); if (s.unidade) setUnidade(s.unidade.toUpperCase()) }
    // a hora do pedido mudou (o robô o pegou, por exemplo): a contagem recomeça dela
    const h = s.atualizado_em ?? null
    setHora((v) => (v.pedido === h ? v : { pedido: h, visto: Date.now() }))
    setAgora(Date.now())
  }

  // Enquanto o robô cadastra, olha o andamento a cada poucos segundos (pelo código do pedido); o relógio da tela anda junto (avisos de demora e de 20 min).
  useEffect(() => {
    if (!cadastrando || !cadastroId) return
    const id = cadastroId
    const t = setInterval(() => {
      setAgora(Date.now())
      Promise.resolve(acoes.status({ id })).then((s) => { if (s) aplicar(s) }).catch(() => undefined)
    }, intervaloMs)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadastrando, cadastroId, acoes, intervaloMs])

  /** Pede o cadastro. `chamar`/`tentar` repetem o pedido com os MESMOS dados (o servidor decide: chama o robô de novo, devolve o mesmo pedido ou,
   *  passado o prazo, abre outro) e travam os dois botões por 3 minutos desde o toque, dê certo ou não (o disparo pode ter saído). */
  async function pedir(extra: Extra = {}, acao: 'pedir' | 'chamar' | 'tentar' = 'pedir') {
    if (problema) { setErro(problema); return }
    if (acao !== 'pedir') { if (aguardando) return; setAguardarAte(Date.now() + ESPERA_ENTRE_CHAMADAS_MS); setAgora(Date.now()) }
    setErro(''); setEnviando(true)
    try {
      const r = await acoes.cadastrar({
        descricao: nomeFinal, grupo, unidade: unidade as 'KG' | 'UN', palavras: palavras.trim(), origem: origem.tipo,
        ...(origem.id ? { origem_id: origem.id } : {}), ...(origem.item !== undefined ? { origem_item: origem.item } : {}), ...extra,
      })
      ultimoExtra.current = extra
      if (acao !== 'pedir' && r.cadastro_id === cadastroId) {
        // o MESMO pedido, ainda em andamento: a contagem continua; o Ivan fica sabendo o que o servidor fez
        setAviso({ acao, texto: acao === 'chamar' ? (r.reenviado ? CHAMEI : JA_ESTA_COM_ELE) : AINDA_EM_ANDAMENTO })
      } else {
        setHora({ pedido: null, visto: Date.now() }); setAgora(Date.now()); setAviso(null)
        setCadastroId(r.cadastro_id); setEstado('PENDENTE'); setMotivoRobo(null); setProdutoId(null); setCandidatos([])
      }
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
        <input ref={campoNome} type="text" autoComplete="off" value={nome} disabled={travado} onChange={(e) => setNome(e.target.value)} data-testid="nome-produto" />
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
          <li>Unidade: <b>{unidade || '— (escolha acima)'}</b> · controla estoque</li>
          <li>O resto fica como nos outros insumos do SisChef: preços zerados (o custo vem das compras) e código de barras gerado pelo SisChef</li>
        </ul>
      </div>

      {/* Com candidatos, o botão de sempre pediria de novo e o robô repetiria o mesmo REVISAR: ficam só "usar este" e "criar mesmo assim" */}
      {!travado && !comCandidatos && (
        <div className="acoes">
          <button type="button" className="botao" disabled={enviando || problema !== null} aria-describedby={descreveFalta} onClick={() => void pedir()} data-testid="cadastrar-produto-botao">
            {enviando ? 'Enviando…' : 'Cadastrar no SisChef e no app'}
          </button>
        </div>
      )}
      {problema !== null && !travado && <p className="sub" id={idFalta} data-testid="falta-produto">{problema}</p>}

      {cadastrando && !semResposta && <p className="ok" role="status" data-testid="cadastrando-produto">Cadastrando no SisChef… o robô leva uns 2 minutos. Pode deixar esta tela aberta.</p>}
      {demorando && (
        <div className="amarelo" role="status" data-testid="produto-demorando">
          <p>Está demorando mais que o normal. Você pode chamar o robô de novo: isso não cria outro pedido.</p>
          <button type="button" className="botao secundario" disabled={enviando || aguardando} onClick={() => void pedir(ultimoExtra.current, 'chamar')} data-testid="chamar-robo">
            {enviando ? 'Chamando…' : aguardando ? AGUARDE : 'Chamar o robô de novo'}
          </button>
          {aviso?.acao === 'chamar' && <p data-testid="aviso-robo">{aviso.texto}</p>}
        </div>
      )}
      {semResposta && (
        <div className="amarelo" role="status" data-testid="produto-sem-resposta">
          <p>O robô não respondeu em {MINUTOS_SEM_RESPOSTA} minutos. Confira no SisChef (Produtos) se o produto já foi criado; se não foi, toque em “Tentar de novo”.</p>
          <button type="button" className="botao" disabled={enviando || aguardando} onClick={() => void pedir(ultimoExtra.current, 'tentar')} data-testid="tentar-de-novo">
            {enviando ? 'Enviando…' : aguardando ? AGUARDE : 'Tentar de novo'}
          </button>
          {aviso?.acao === 'tentar' && <p data-testid="aviso-robo">{aviso.texto}</p>}
        </div>
      )}
      {estado === 'REVISAR' && !comCandidatos && (
        <p className="erro" role="alert" data-testid="produto-revisar">{mensagemDoRevisar(motivoRobo, produtoId)}</p>
      )}
      {comCodigo && produtoId !== null && (
        <div className="acoes">
          <button type="button" className="botao" disabled={enviando || aguardando} onClick={() => void pedir({ existente_id: produtoId }, 'tentar')} data-testid="tentar-de-novo">
            {enviando ? 'Enviando…' : aguardando ? AGUARDE : 'Tentar de novo'}
          </button>
        </div>
      )}
      {comCandidatos && (
        <div className="sugestao" data-testid="candidatos-produto">
          <p className="sub" role="alert" data-testid="produto-revisar">
            Achei no SisChef {candidatos.length === 1 ? 'um produto parecido' : 'produtos parecidos'}. É {candidatos.length === 1 ? 'este' : 'algum destes'}?
          </p>
          <ul className="achados">
            {candidatos.map((c) => (
              <li key={c.produto_id}>
                <button type="button" disabled={enviando || problema !== null} aria-describedby={descreveFalta} onClick={() => void pedir({ existente_id: c.produto_id })} data-testid="usar-candidato">
                  <span>{c.descricao}</span>
                  <span className="sub">cód. {c.produto_id}{c.unidade ? ` · ${c.unidade}` : ''} — usar este</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="acoes">
            <button type="button" className="botao secundario" disabled={enviando || problema !== null} aria-describedby={descreveFalta} onClick={() => void pedir({ forcar: true })} data-testid="criar-mesmo-assim">
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
