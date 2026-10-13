// "Cadastrar produto novo" dentro do app (pedido do Ivan, 13/10/2026): o produto do cupom, da nota fiscal ou da compra avulsa não existe na lista do app nem no SisChef.
// O Ivan confere o nome, escolhe o GRUPO e a UNIDADE (sem chute: ele decide) e toca em "Cadastrar no SisChef e no app"; o robô cria o produto no SisChef (Produtos/Taxas ›
// Produtos › Novo, com os mesmos parâmetros dos insumos: controla estoque, de terceiros, NCM 00, preços zerados, código de barras gerado pelo SisChef), o app guarda o código
// novo na planilha de produtos e o produto passa a aparecer na lista. Pronto o cadastro, o Ivan toca em "Usar este produto": o app NUNCA escolhe sozinho.
// As ações (rede) entram por `acoes`, para a tela ser testada e mostrada sem servidor.
import { useEffect, useRef, useState } from 'react'
import type { ProdutoCatalogo } from '../lib/tipos'
import {
  GRUPOS_DE_INSUMO, PRODUTO_PRONTO, UNIDADES, nomeNoSischef, palavrasSugeridas, problemaDoProduto, sugerirUnidade, type EstadoProduto,
} from './produtoRegras'

export interface PedidoProduto { descricao: string; grupo: string; unidade: string; palavras: string }
export interface AcoesProduto {
  cadastrar(pedido: PedidoProduto): Promise<void>
  /** O pedido de cadastro mais recente deste nome (null = nunca pedido). `produto_id` vem quando o robô terminou. */
  status(descricao: string): Promise<{ estado: EstadoProduto; produto_id: number | null; motivo: string | null } | null>
}

interface Props {
  /** O texto do item como veio (a descrição do cupom ou da nota): ponto de partida do nome e da unidade. */
  descricaoDoItem: string
  acoes: AcoesProduto
  /** O Ivan tocou em "Usar este produto": quem chamou escolhe o produto recém-cadastrado. */
  aoUsar: (produto: ProdutoCatalogo) => void
  /** Intervalo entre as conferências do cadastro (ms); os testes usam um bem curto. */
  intervaloMs?: number
}

const mensagem = (e: unknown, padrao: string): string => (e instanceof Error && e.message ? e.message : padrao)

/** O aviso "Produto não cadastrado" + o botão que abre o formulário. Fica fechado até o toque. */
export function ProdutoNaoCadastrado({ descricaoDoItem, acoes, aoUsar }: Omit<Props, 'intervaloMs'>) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="produto-nao-cadastrado" data-testid="produto-nao-cadastrado">
      {!aberto ? (
        <>
          <p className="amarelo" data-testid="aviso-nao-cadastrado">Não achei este produto na sua lista nem no SisChef. Se ele é novo, precisa ser cadastrado.</p>
          <button type="button" className="botao secundario" onClick={() => setAberto(true)} data-testid="abrir-cadastro-produto">Cadastrar produto novo</button>
        </>
      ) : (
        <CadastrarProduto descricaoDoItem={descricaoDoItem} acoes={acoes} aoUsar={aoUsar} />
      )}
    </div>
  )
}

export default function CadastrarProduto({ descricaoDoItem, acoes, aoUsar, intervaloMs = 5000 }: Props) {
  const [nome, setNome] = useState(nomeNoSischef(descricaoDoItem))
  const [grupo, setGrupo] = useState('')
  const [unidade, setUnidade] = useState(sugerirUnidade(descricaoDoItem))
  const [palavras, setPalavras] = useState(palavrasSugeridas(descricaoDoItem))
  const [estado, setEstado] = useState<EstadoProduto | null>(null)
  const [produtoId, setProdutoId] = useState<number | null>(null)
  const [motivoRobo, setMotivoRobo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  const cadastrando = estado === 'PENDENTE' || estado === 'PROCESSANDO'
  const pronto = PRODUTO_PRONTO(estado)
  const travado = enviando || cadastrando || pronto
  const problema = problemaDoProduto({ nome, grupo, unidade, palavras })
  const nomeFinal = nomeNoSischef(nome)

  // Enquanto o robô cadastra, olha o andamento a cada poucos segundos.
  useEffect(() => {
    if (!cadastrando) return
    const t = setInterval(() => {
      acoes.status(nomeFinal).then((s) => {
        if (!montado.current || !s) return
        setEstado(s.estado); setProdutoId(s.produto_id); setMotivoRobo(s.motivo)
      }).catch(() => undefined)
    }, intervaloMs)
    return () => clearInterval(t)
  }, [cadastrando, nomeFinal, acoes, intervaloMs])

  async function cadastrar() {
    if (problema) { setErro(problema); return }
    setErro(''); setEnviando(true)
    try {
      await acoes.cadastrar({ descricao: nomeFinal, grupo, unidade, palavras: palavras.trim() })
      setEstado('PENDENTE'); setMotivoRobo(null); setProdutoId(null)
    } catch (e) {
      setErro(mensagem(e, 'Não consegui pedir o cadastro agora. Tente de novo.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="associar cadastrar-produto" data-testid="cadastrar-produto">
      <div className="grupo">Produto novo: cadastrar no SisChef e no app</div>
      <p className="sub">O robô cria o produto no SisChef só quando você tocar em “Cadastrar no SisChef e no app”. Confira o nome, escolha o grupo e a unidade.</p>

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
          {UNIDADES.map((u) => <option key={u.sigla} value={u.sigla}>{u.rotulo}</option>)}
        </select>
      </label>
      {unidade === sugerirUnidade(descricaoDoItem) && !travado && <p className="sub" data-testid="unidade-sugerida">Sugerida pelo nome do item: confirme se é essa mesmo.</p>}
      <label>Palavras-chave para achar o produto (opcional)
        <input type="text" autoComplete="off" value={palavras} disabled={travado} onChange={(e) => setPalavras(e.target.value)} data-testid="palavras-produto" />
      </label>

      <div className="previa-cadastro" data-testid="previa-cadastro">
        <p className="sub"><b>Como vai ficar no SisChef:</b></p>
        <ul className="sub">
          <li>Nome: <b>{nomeFinal || '—'}</b></li>
          <li>Grupo: <b>{grupo || '— (escolha acima)'}</b></li>
          <li>Unidade: <b>{unidade}</b> · controla estoque · de terceiros (revenda)</li>
          <li>NCM 00 · preço de compra e de venda zerados (o custo vem das compras) · código de barras gerado pelo SisChef</li>
        </ul>
      </div>

      {!travado && (
        <div className="acoes">
          <button type="button" className="botao" disabled={enviando || problema !== null} onClick={() => void cadastrar()} data-testid="cadastrar-produto-botao">
            {enviando ? 'Enviando…' : 'Cadastrar no SisChef e no app'}
          </button>
        </div>
      )}
      {problema !== null && !travado && <p className="sub" data-testid="falta-produto">{problema}</p>}

      {cadastrando && <p className="ok" role="status" data-testid="cadastrando-produto">Cadastrando no SisChef… o robô leva uns 2 minutos. Pode deixar esta tela aberta.</p>}
      {estado === 'REVISAR' && (
        <p className="erro" role="alert" data-testid="produto-revisar">
          O robô não conseguiu cadastrar{motivoRobo ? `: ${motivoRobo}` : '.'} Nada foi cadastrado errado; confira no SisChef ou fale com o Claude.
        </p>
      )}
      {pronto && produtoId !== null && (
        <>
          <p className="ok" role="status" data-testid="produto-pronto">
            {estado === 'JA_EXISTIA' ? `✓ Esse produto já existia no SisChef (cód. ${produtoId}): entrou na sua lista.` : `✓ Produto cadastrado no SisChef (cód. ${produtoId}) e na sua lista.`}
          </p>
          <div className="acoes">
            <button type="button" className="botao" onClick={() => aoUsar({ produto_id: produtoId, nome: nomeFinal, unidade: unidade.toLowerCase() })} data-testid="usar-produto-novo">Usar este produto</button>
          </div>
        </>
      )}
      {erro && <p className="erro" role="alert" data-testid="erro-produto">{erro}</p>}
    </div>
  )
}
