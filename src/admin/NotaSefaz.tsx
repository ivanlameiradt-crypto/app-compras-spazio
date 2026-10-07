// Aba "Lançamento fiscal" (Fase 3; até 06/10/2026 chamava-se "Lançamento de nota SEFAZ"). Lista as notas da fila da SEFAZ (cot_nfe, situacao 'na_fila'): por nota, "Como pagar"
// + botão Lançar (dois toques: Lançar → Confirmar) e o estado do robô; e os últimos lançamentos, com o detalhe clicável — o MESMO
// componente do cupom (DetalheLancamento). A segurança real é a RLS + a Edge Function lancar-nfe (admin, reserva da nota).
// ETAPA 2 da associação pelo app ("confirmou no app → pode lançar"): item sem produto no SisChef não trava mais o Lançar quando a decisão do app
// para ele está completa (produto e, quando é CERTO que as unidades diferem — nota em UN, produto "(KG)" —, a conversão) — ao lançar, o robô aplica a
// decisão na tela do SisChef, e a tela avisa embaixo do botão o que ele vai associar (fica gravado lá para as próximas notas do fornecedor). Quando o
// app só desconfia da unidade (produto "un" ou novo) e o Ivan não informou a conversão, a linha do item avisa que o robô confere no SisChef e pode parar.
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { formatarDataHora, formatarReais } from '../lib/regras'
import type { ItemNotaSefaz, NotaSefazLista, ProdutoCatalogo } from '../lib/tipos'
import DetalheLancamento, { type LinhaDetalhe } from '../components/DetalheLancamento'
import AssociarProduto from './AssociarProduto'
import { conversaoDaDecisao, nomeParaMostrar, rotuloUnidade, textoConversao } from './associacaoRegras'
import {
  AVISO_FALTA_CONVERSAO, AVISO_FORMA_NAO_PROVADA, AVISO_PRESA, OPCOES_ANTES_DO_PIX, OPCOES_DEPOIS_DO_PIX, OPCOES_PIX, associacoesPeloRobo, bloqueiosDaNota,
  formaInicial, formaNaoProvada, FORNECEDORES_XML_SEM_PAGAMENTO, bloqueioDeProduto, decisaoDoItem, descartadaVoltouComItens, guardarRascunhoDasParcelas,
  limparRascunhoDasParcelas, rascunhoDasParcelas, formaPadraoDoFornecedor, formatarValorBr, fornecedorAprendido, itemAssociado, lancandoPresa, lembrarForma,
  linhasIniciais, motivoDoDescarte, parseValorBr, pendenciasParaLancar, podeDescartar, precisaDigitarParcelas, prontidaoDaNota, resumoFinanceiro, rotuloForma,
  textoDoEstado, traduzirMotivo, validarParcelasDigitadas, ehPagamentoSemanal, planoSemanal,
  type LinhaParcela, type PlanoSemanal, type ResultadoParcelas,
} from './notaSefazRegras'

/** Enquanto alguma nota está 'lancando', a lista é recarregada neste intervalo (ms). */
const INTERVALO_ATUALIZAR = 15_000

/** emissao vem como AAAA-MM-DD; mostra dd/mm. */
const ddmm = (iso: string): string => { const p = iso.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso }

/** Uma nota a lançar: "Como pagar", estado do robô, avisos de bloqueio e o botão Lançar em dois toques. */
/** emissao e vencimento vêm como AAAA-MM-DD; mostra dd/mm/aaaa (sem data = traço). */
const dataBr = (iso: string | null): string => { const p = (iso ?? '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '—' }
/** Tira o prefixo "CÓD. FOR: 123456 " que o SisChef põe na descrição, para o painel de conferir ficar legível. */
const semCodFor = (d: string): string => d.replace(/^CÓD\. FOR:\s*\S+\s*/i, '').trim() || d
/** Item de uma nota JÁ LANÇADA para o detalhe de "Últimos lançamentos": na frente da descrição vai o número do produto associado no SisChef
 *  (Cód. Interno, o `produto_id`), no lugar do "CÓD. FOR" do fornecedor (pedido do Ivan, 06/10); depois a quantidade e a unidade. */
const linhaDoItem = (it: ItemNotaSefaz): LinhaDetalhe => {
  const codigo = it.produto_id != null && String(it.produto_id).trim() !== '' ? String(it.produto_id).trim() : null
  return { codigo, descricao: semCodFor(it.descricao ?? 'item'), quantidade: it.qtd, unidade: it.unidade_sischef, valor: null }
}
/** Quantidade no jeito brasileiro: 19,918 (e não 19.918, que no Brasil lê-se como dezenove mil) e 1.000,5; sem quantidade, "?". */
const qtdBr = (q: number | null | undefined): string =>
  q == null || !Number.isFinite(Number(q)) ? '?' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const nomeDoProduto = (it: ItemNotaSefaz): string =>
  it.produto_nome?.trim() || (it.produto_id != null && String(it.produto_id).trim() !== '' ? `produto ${it.produto_id}` : 'sem produto')

/** O "ticket" verde de produto associado: bolinha verde com ✓ (desenhada em SVG, igual em qualquer aparelho; leitor de tela lê o rótulo).
 *  Duas leituras: produto que já está associado no SisChef (padrão) e produto que o Ivan CONFIRMOU no app ("confirmado"). */
function TickOk({ rotulo = 'produto associado no SisChef', testid = 'item-ok' }: { rotulo?: string; testid?: string }) {
  return (
    <svg className="tick-ok" viewBox="0 0 20 20" width="18" height="18" role="img" aria-label={rotulo} data-testid={testid}>
      <circle cx="10" cy="10" r="10" />
      <path d="M5.5 10.4l3 3 6-6.6" fill="none" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Conferir": o que foi associado a cada item e o financeiro (boletos contra o valor da nota), para o Ivan abrir e checar. */
function PainelConferir({ nota, catalogo, catalogoFalhou, podeAssociar, salvarAssociacao }: {
  nota: NotaSefazLista
  /** Lista de insumos do app (null = carregando) e se a leitura dela falhou. */
  catalogo: ProdutoCatalogo[] | null
  catalogoFalhou: boolean
  /** Dá para escolher produto agora? Não, se o robô está lançando a nota ou ela ficou pela metade (o banco também recusa). */
  podeAssociar: boolean
  salvarAssociacao: (n: number, produtoId: number | null, lembrar?: boolean, conversao?: number | null) => Promise<void>
}) {
  const f = resumoFinanceiro(nota)
  const quartaDaMaues = ehPagamentoSemanal(nota) ? planoSemanal(nota, [])?.quarta ?? null : null
  // Abre sozinho enquanto falta o Ivan escolher o produto de algum item (é lá que fica o campo para procurar e confirmar); depois o estado é dele.
  const [aberto, setAberto] = useState(() => nota.itens.some((it) => !itemAssociado(it) && decisaoDoItem(nota, it) == null))
  return (
    <details className="conferir" data-testid="conferir" open={aberto} onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Conferir itens e financeiro</summary>
      <div className="grupo">Itens e produtos associados</div>
      {nota.itens.length === 0 && <p className="sub" data-testid="conferir-sem-itens">Nenhum item lido: no SisChef esta nota costuma aparecer como “XML resumido” (só o resumo da nota, sem os itens).</p>}
      <ul className="conferir-itens">
        {nota.itens.map((it, i) => {
          const ok = itemAssociado(it)
          const decisao = decisaoDoItem(nota, it) // o que o Ivan confirmou NO APP para este item (só existe se ele ainda não tem produto no SisChef)
          const conversao = conversaoDaDecisao(decisao) // o que o robô vai digitar no modal de conversão do SisChef (null = nada)
          // o rótulo do ✓ de confirmado também lê a conversão (leitor de tela), já que o texto dela fica na linha "confirmado no app" embaixo
          const rotuloConfirmado = conversao != null && decisao
            ? `produto confirmado no app, ${textoConversao(it.unidade_sischef, decisao.unidade, conversao)}`
            : 'produto confirmado no app'
          return (
            <li key={i} data-testid="conferir-item">
              <span>{semCodFor(it.descricao)} · {qtdBr(it.qtd)} {it.unidade_sischef ?? ''}</span>
              {/* ✓ verde na frente do nome: produto já associado no SisChef (sem texto embaixo) ou produto CONFIRMADO no app ("confirmado no app"
                  embaixo, com a conversão quando houver). Sem ✓ = falta associar: o aviso fica escrito e, embaixo, a caixa para escolher o produto. */}
              <b className="produto">
                {ok && <TickOk />}
                {decisao && <TickOk rotulo={rotuloConfirmado} testid="item-confirmado" />}
                <span>{decisao ? nomeParaMostrar(catalogo, decisao.produto_id, decisao.produto_nome).nome : nomeDoProduto(it)}</span>
              </b>
              {!ok && !decisao && <span className="sub">{(it.associacao ?? '').trim().toLowerCase() === 'painel' ? 'decidido no app (ainda não está no SisChef)' : 'sem associação'}</span>}
              {!ok && it.n != null && (decisao != null || podeAssociar) && (
                <AssociarProduto item={it} n={it.n} catalogo={catalogo} catalogoFalhou={catalogoFalhou} decisao={decisao} salvar={salvarAssociacao} />
              )}
            </li>
          )
        })}
      </ul>
      <div className="grupo">Financeiro</div>
      {/* Regra do Ivan (07/10): com o XML por ler, o que ele determinar no app vale — não fica esperando a próxima leitura. */}
      {!f.lido ? <p className="sub" data-testid="fin-nao-lido">O XML ainda não foi lido. Escolha a forma de pagamento; se for boleto, digite as parcelas abaixo: o que você digitar vale para o lançamento.</p>
        : f.parcelas.length === 0 ? <p className="sub" data-testid="fin-sem-boleto">O XML da nota não traz boletos (duplicatas). Digite as parcelas do boleto ou escolha outra forma de pagamento.</p>
        : (
          <>
            <ul className="conferir-itens">
              {f.parcelas.map((p, i) => (
                <li key={i} data-testid="conferir-parcela">
                  {/* MAUES paga a compra da semana numa quarta: o vencimento que vale é a quarta da regra, não a data do boleto do XML */}
                  <span>Parcela {p.numero ?? i + 1} · vence {dataBr(quartaDaMaues ?? p.vencimento)}{quartaDaMaues && ` (o XML trouxe ${dataBr(p.vencimento)})`}</span>
                  <b>{formatarReais(p.valor)}</b>
                </li>
              ))}
            </ul>
            <p className={f.bate ? 'ok' : 'erro'} data-testid="fin-total">
              Soma dos boletos {formatarReais(f.soma)} · valor da nota {f.total == null ? '?' : formatarReais(f.total)} ·{' '}
              {f.bate ? 'bate' : `diferença de ${formatarReais(Math.abs(f.diferenca ?? 0))}`}
            </p>
          </>
        )}
    </details>
  )
}

/**
 * Editor das parcelas do boleto quando o XML não traz as duplicatas (falha do fornecedor, ex.: MATEUS) ou ainda nem foi lido (regra do Ivan,
 * 07/10: "o que eu determinar dentro do app prevalece"): o Ivan digita o vencimento e o valor de cada parcela e o robô as aplica no SisChef.
 * O Lançar só destrava quando a soma fecha com o valor da nota.
 */
function EditorParcelas({ nota, linhas, resultado, desabilitado, aguardandoProduto, onChange }: {
  nota: NotaSefazLista; linhas: LinhaParcela[]; resultado: ResultadoParcelas; desabilitado: boolean
  /** A nota ainda espera produto ser associado no SisChef: dá para digitar já, mas o Lançar só libera depois. */
  aguardandoProduto: boolean
  onChange: (l: LinhaParcela[]) => void
}) {
  const fornecedor = nota.cnpj_emitente ? FORNECEDORES_XML_SEM_PAGAMENTO[nota.cnpj_emitente] : undefined
  const xmlNaoLido = nota.parcelas == null // null = a leitura do SisChef ainda não abriu o XML desta nota ([] = leu e não há boletos)
  const mudar = (i: number, campo: keyof LinhaParcela, valor: string) => onChange(linhas.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  const completar = () => {
    if (resultado.falta == null || resultado.falta <= 0 || linhas.length === 0) return
    const ult = linhas.length - 1
    const atual = parseValorBr(linhas[ult].valor) ?? 0 // o que a última já tem (0 se vazia ou ilegível: aí não entrou na soma)
    onChange(linhas.map((l, j) => (j === ult ? { ...l, valor: formatarValorBr(Math.round((atual + (resultado.falta ?? 0)) * 100) / 100) } : l)))
  }
  return (
    <div className="editor-parcelas" data-testid="editor-parcelas">
      <div className="amarelo">
        {fornecedor
          ? `O XML da ${fornecedor} não traz a forma de pagamento nem os boletos (falha do fornecedor).`
          : xmlNaoLido ? 'A nota não veio informando os boletos.' : 'O XML desta nota não traz os boletos.'} Digite as parcelas do boleto: o robô as aplica no SisChef. Podem ser iguais ou diferentes; o que vale é a soma ser igual ao valor da nota.
      </div>
      {xmlNaoLido && (
        <p className="sub" data-testid="parcelas-xml-nao-lido">
          O XML desta nota ainda não foi lido: as parcelas que você digitar valem. Se a leitura trouxer boletos diferentes, o robô para e avisa.
        </p>
      )}
      {aguardandoProduto && (
        <p className="sub" data-testid="parcelas-aguardando">
          Pode digitar as parcelas já: elas ficam guardadas neste aparelho. O Lançar só libera quando todo item tiver produto (associado no SisChef ou
          confirmado aqui no app, com a conversão de unidade se precisar).
        </p>
      )}
      {linhas.map((l, i) => (
        <div key={i} className="linha-parcela" data-testid="linha-parcela">
          <label>Vencimento da parcela {i + 1}
            <input type="date" value={l.vencimento} disabled={desabilitado} onChange={(e) => mudar(i, 'vencimento', e.target.value)} />
          </label>
          <label>Valor da parcela {i + 1}
            <input type="text" inputMode="decimal" placeholder="0,00" value={l.valor} disabled={desabilitado} onChange={(e) => mudar(i, 'valor', e.target.value)} />
          </label>
          {linhas.length > 1 && (
            <button type="button" className="link" disabled={desabilitado} onClick={() => onChange(linhas.filter((_, j) => j !== i))}>
              Remover parcela {i + 1}
            </button>
          )}
        </div>
      ))}
      <div className="acoes">
        <button type="button" className="botao secundario" disabled={desabilitado || linhas.length >= 60} onClick={() => onChange([...linhas, { vencimento: '', valor: '' }])}>
          Adicionar parcela
        </button>
        {resultado.falta != null && resultado.falta > 0 && (
          <button type="button" className="botao secundario" disabled={desabilitado} onClick={completar}>Preencher o que falta na última</button>
        )}
      </div>
      <p className={resultado.ok ? 'ok' : 'sub'} data-testid="resumo-parcelas">
        Soma {formatarReais(resultado.soma)} · nota {nota.valor_nf == null ? '?' : formatarReais(nota.valor_nf)}
        {resultado.ok ? ' · bate' : resultado.motivo ? ` · ${resultado.motivo}` : ''}
      </p>
    </div>
  )
}

/**
 * MAUES paga a compra da semana (domingo a sábado) numa única quarta-feira, a seguinte ao sábado (regra do Ivan, 30/09). O XML traz outra data de
 * boleto, e o robô lança a quarta; por isso a tela mostra aqui a data que vai valer, já calculada, e deixa o Ivan EDITAR (pedido de 07/10). Com
 * boletos no XML só a data muda: quantidade e valores são os do XML (a Edge Function e o robô conferem de novo).
 */
function PagamentoSemanal({ plano, editando, desabilitado, onEditar, onMudar, onUsarQuarta }: {
  plano: PlanoSemanal; editando: boolean; desabilitado: boolean
  onEditar: () => void
  onMudar: (i: number, iso: string) => void
  onUsarQuarta: () => void
}) {
  const algumaEditada = plano.parcelas.some((p) => p.editada)
  const doXml = plano.parcelas.map((p) => dataBr(p.vencimentoXml)).filter((d, i, a) => a.indexOf(d) === i).join(', ')
  return (
    <div className="pagamento-semanal" data-testid="pagamento-semanal">
      <div className="grupo">Vencimento do boleto (MAUES paga na quarta)</div>
      <ul className="conferir-itens">
        {plano.parcelas.map((p, i) => (
          <li key={i}>
            <span>
              Parcela {i + 1} · vence {p.editada ? dataBr(p.vencimento) : `quarta, ${dataBr(p.vencimento)}`}{p.editada && ' · data alterada por você'}
            </span>
            <b>{formatarReais(p.valor)}</b>
          </li>
        ))}
      </ul>
      <p className="sub">
        Regra da MAUES: a compra da semana de {ddmm(plano.semana.inicio)} a {ddmm(plano.semana.fim)} é paga na quarta seguinte ao sábado.{' '}
        {algumaEditada
          ? `A quarta da regra é ${dataBr(plano.quarta)}. A data que você escolheu é a que o robô lança.`
          : `O XML trouxe ${doXml}; vale a quarta.`}
      </p>
      {editando && plano.parcelas.map((p, i) => (
        <label key={i}>Vencimento da parcela {i + 1}
          <input type="date" value={p.vencimento} disabled={desabilitado} onChange={(e) => onMudar(i, e.target.value)} />
        </label>
      ))}
      {!plano.ok && <p className="erro" data-testid="erro-semanal">{plano.motivo}</p>}
      <div className="acoes">
        {!editando && (
          <button type="button" className="botao secundario" disabled={desabilitado} onClick={onEditar}>Mudar a data</button>
        )}
        {(editando || algumaEditada) && (
          <button type="button" className="botao secundario" disabled={desabilitado} onClick={onUsarQuarta}>Usar a quarta ({ddmm(plano.quarta)})</button>
        )}
      </div>
    </div>
  )
}

/** Depois de quanto tempo "lançando" a tela passa a perguntar sozinha ao servidor como terminou a execução do robô (uma nota leva ~3 min). */
const MINUTOS_ATE_VERIFICAR = 5
const INTERVALO_VERIFICAR = 60_000

/**
 * Nota "lançando": o botão "Verificar o robô" e a checagem automática. Em 07/10/2026 a execução da MERCURIO travou (o GitHub não instalou o
 * navegador) e a nota ficou "lançando", com o Lançar apagado, por 30 min — sem ninguém saber por quê. Aqui o app pergunta ao servidor (que consulta
 * o GitHub) como terminou a execução daquela nota: se caiu ANTES de tocar no SisChef, a nota volta liberada com a explicação; se caiu depois, fica
 * "pela metade" e travada; se ainda roda, diz que está rodando. Nada é lançado por esta pergunta.
 */
function VerificarRobo({ nota, recarregar }: { nota: NotaSefazLista; recarregar: () => Promise<void> }) {
  const [mensagem, setMensagem] = useState('')
  const [verificando, setVerificando] = useState(false)
  const ocupado = useRef(false)
  const verificar = useCallback(async (manual: boolean) => {
    if (ocupado.current) return
    ocupado.current = true
    setVerificando(true)
    try {
      const r = await api.verificarRobo(nota.chave)
      if (!r) return
      if (manual || r.situacao !== 'rodando') setMensagem(r.mensagem)
      if (r.mudou) await recarregar() // a nota passou a "precisa de você" (liberada) ou "pela metade": a lista mostra o estado novo
    } catch (e) {
      if (manual) setMensagem(e instanceof Error ? e.message : 'Não consegui verificar o robô agora. Tente de novo.')
    } finally {
      ocupado.current = false
      setVerificando(false)
    }
  }, [nota.chave, recarregar])
  useEffect(() => {
    const desde = Date.parse(nota.lancamento_estado_em ?? '')
    if (!Number.isFinite(desde)) return
    const tick = () => { if (Date.now() - desde >= MINUTOS_ATE_VERIFICAR * 60_000) void verificar(false) }
    tick()
    const id = setInterval(tick, INTERVALO_VERIFICAR)
    return () => clearInterval(id)
  }, [nota.lancamento_estado_em, verificar])
  return (
    <div className="verificar-robo" data-testid="verificar-robo">
      <button type="button" className="link" disabled={verificando} onClick={() => void verificar(true)}>
        {verificando ? 'Verificando…' : 'Verificar o robô'}
      </button>
      {mensagem && <div className="amarelo" data-testid="verificacao-msg">{mensagem}</div>}
    </div>
  )
}

interface PropsNota {
  nota: NotaSefazLista
  padroes: Record<string, string>
  /** Notas seguidas lançadas em boleto por fornecedor (CNPJ): 3 ou mais = fornecedor "aprendido". */
  seguidas: Record<string, number>
  /** Recarrega as listas (depois de lançar ou de descartar uma nota). */
  recarregar: () => Promise<void>
  /** Outra nota está 'lancando' (o robô é um por vez: o GitHub guarda só 1 disparo pendente e cancelaria o resto). */
  outraLancando: boolean
  /** Algum "Confirmar" está enviando agora (nesta ou em outra nota). */
  emEnvio: boolean
  /** Pede a vez de enviar: false se já há um envio em curso (trava síncrona entre notas). */
  iniciarEnvio: () => boolean
  fimEnvio: () => void
  /** Lista de insumos do app para escolher o produto de um item sem produto (null = carregando) e se a leitura dela falhou. */
  catalogo: ProdutoCatalogo[] | null
  catalogoFalhou: boolean
  /** Lê a lista de insumos de novo (depois de "Lembrar esta descrição", que muda as palavras-chave de um produto). */
  recarregarCatalogo: () => Promise<void>
}
function NotaALancar({ nota, padroes, seguidas, recarregar, outraLancando, emEnvio, iniciarEnvio, fimEnvio, catalogo, catalogoFalhou, recarregarCatalogo }: PropsNota) {
  // Só a escolha do usuário fica aqui; sem escolha, vale a forma gravada na nota / lembrada do fornecedor / Boleto.
  const [escolha, setEscolha] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [mudandoForma, setMudandoForma] = useState(false)
  const [descartando, setDescartando] = useState(false) // aberta a pergunta "Descartar a nota?"
  const [descartandoEnvio, setDescartandoEnvio] = useState(false)
  // parcelas digitadas (boleto sem duplicatas no XML): o rascunho deste aparelho (se houver) vale mais que o que o robô devolveu
  const [linhas, setLinhas] = useState<LinhaParcela[]>(() => rascunhoDasParcelas(nota.chave) ?? linhasIniciais(nota))
  function mudarLinhas(l: LinhaParcela[]) { setLinhas(l); guardarRascunhoDasParcelas(nota.chave, l) }
  // MAUES (pagamento semanal na quarta): datas que o Ivan editou, por parcela (vazio = a quarta da regra), e se a caixa de data está aberta
  const [datasSemanais, setDatasSemanais] = useState<string[]>([])
  const [editandoData, setEditandoData] = useState(false)
  const trancado = useRef(false) // trava síncrona contra duplo toque (o `enviando` só vale depois do próximo desenho)

  const forma = escolha ?? formaInicial(nota, padroes)
  const padraoDoFornecedor = formaPadraoDoFornecedor(nota, padroes)
  const prontidao = prontidaoDaNota(nota)
  const financeiro = resumoFinanceiro(nota)
  const aprendido = fornecedorAprendido(nota, seguidas)
  // Regra 2: nota pronta (itens associados + boletos que fecham) com Boleto marcado = só falta lançar. Mudando a forma, volta ao normal.
  const soLancar = prontidao.pronta && forma === 'boleto' && !mudandoForma
  const estado = nota.lancamento_estado ?? null
  const bloqueios = bloqueiosDaNota(nota)
  const presa = lancandoPresa(nota)
  const estadoTexto = presa ? AVISO_PRESA : textoDoEstado(estado, nota.lancamento_motivo)
  // 'erro' = pedido pela metade (nunca lançar de novo); 'lancando' = o robô já está nela (salvo se presa há mais de 30 min:
  // aí o servidor aceita reservar de novo, e o robô não relança nota que já saiu da fila do SisChef).
  const robotOuMetade = estado === 'erro' || (estado === 'lancando' && !presa)
  const travada = robotOuMetade || bloqueios.length > 0
  // Só falta produto no SisChef (ou nada trava): dá para escolher a forma de pagamento e digitar as parcelas já; o Lançar segue travado até lá.
  // Conta especial, nota sem itens, robô lançando e nota pela metade continuam sem nada para preparar.
  const podePreparar = !robotOuMetade && bloqueios.every(bloqueioDeProduto)
  const outraOcupando = outraLancando || (emEnvio && !enviando)
  // Boleto cujo XML não traz as duplicatas (ou ainda não foi lido — regra do Ivan, 07/10: o que ele digitar vale): o Ivan digita as parcelas e o
  // Lançar só destrava quando a soma fecha com o valor da nota.
  const exigeParcelas = precisaDigitarParcelas(nota, forma)
  const resultadoParcelas = validarParcelasDigitadas(linhas, nota.valor_nf, nota.emissao)
  // MAUES com boletos no XML e Boleto marcado: a tela mostra a quarta (ou a data que o Ivan editou) e é ELA que vai ao robô, sempre explícita.
  const plano = forma === 'boleto' ? planoSemanal(nota, datasSemanais) : null
  const podeLancar = !travada && forma !== '' && !enviando && !outraOcupando && (!exigeParcelas || resultadoParcelas.ok) && (!plano || plano.ok)
  // Etapa 2: o que AINDA trava o Lançar por item sem produto (decisão do app incompleta) e o que o robô vai associar no SisChef ao lançar (decisão completa).
  const pendencias = pendenciasParaLancar(nota)
  const peloRobo = associacoesPeloRobo(nota)
  // Escolher produto de um item sem produto: não com o robô lançando a nota nem com ela pela metade (o banco também recusa).
  const podeAssociar = estado !== 'erro' && !(estado === 'lancando' && !presa)
  // `conversao` = quanto vale 1 unidade da nota em unidades do produto (só quando as unidades diferem); sempre vai à RPC, nula quando não há.
  async function salvarAssociacao(n: number, produtoId: number | null, lembrar = false, conversao: number | null = null) {
    await api.associarItem(nota.chave, n, produtoId, conversao ?? null)
    // "Lembrar esta descrição": só reforça a busca da próxima vez. Falhar aqui NÃO desfaz a confirmação (que já está no banco).
    if (lembrar && produtoId != null) {
      const descricao = nota.itens.find((x) => x.n === n)?.descricao
      if (descricao) {
        try { if (await Promise.resolve(api.lembrarDescricao(produtoId, descricao))) await recarregarCatalogo() } catch { /* segue sem lembrar */ }
      }
    }
    await recarregar() // a decisão vem do banco: o item passa a mostrar o ✓ de confirmado
  }

  function escolher(nova: string) {
    setEscolha(nova); setConfirmando(false); setErro('')
    lembrarForma(nota.emitente, nova)
  }

  async function confirmar() {
    if (!podeLancar || trancado.current || !iniciarEnvio()) return
    trancado.current = true
    setEnviando(true); setErro('')
    try {
      if (exigeParcelas) await api.lancarNota(nota.chave, forma, resultadoParcelas.parcelas)
      else if (plano) await api.lancarNota(nota.chave, forma, plano.parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor })))
      else await api.lancarNota(nota.chave, forma)
      lembrarForma(nota.emitente, forma)
      limparRascunhoDasParcelas(nota.chave) // o robô já recebeu as parcelas
      setConfirmando(false)
      await recarregar() // recarrega: a nota passa a aparecer como "lançando"
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui lançar agora. Tente de novo.')
      setConfirmando(false)
    } finally {
      trancado.current = false
      setEnviando(false)
      fimEnvio()
    }
  }

  // Regra 3: nota que não dá para lançar pode ser descartada (sai da lista; nada muda no SisChef). Nunca a pela metade nem a lançando agora.
  const descartavel = podeDescartar(nota) && !enviando
  async function descartar() {
    if (descartandoEnvio) return
    setDescartandoEnvio(true); setErro('')
    try {
      await api.descartarNota(nota.chave, motivoDoDescarte(nota))
      await recarregar() // a nota sai de "Notas a lançar" e passa a aparecer em "Notas descartadas"
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui descartar agora. Tente de novo.')
      setDescartando(false)
    } finally {
      setDescartandoEnvio(false)
    }
  }

  return (
    <li data-testid="nota-a-lancar" className="nota-lancar">
      <div className="recente-linha">
        <span><b>{nota.emitente}</b> · NF {nota.numero} · {ddmm(nota.emissao)}{nota.valor_nf != null && ` · ${formatarReais(nota.valor_nf)}`}</span>
      </div>

      {soLancar && (
        <div className="ok" data-testid="nota-pronta">
          Pronta para lançar: todos os itens {peloRobo.length > 0 ? 'com produto (os confirmados no app, o robô associa ao lançar)' : 'associados'} e{' '}
          {financeiro.parcelas.length === 1 ? '1 boleto fecha' : `${financeiro.parcelas.length} boletos fecham`} com o valor da nota.
          {aprendido > 0 && <> Fornecedor aprendido ({aprendido} notas seguidas lançadas em boleto sem problema): pode só confirmar.</>}
        </div>
      )}
      {!soLancar && !exigeParcelas && prontidao.financeiro && !bloqueios.length && estado == null && (
        <div className="amarelo" data-testid="aviso-financeiro">{prontidao.financeiro}</div>
      )}
      <PainelConferir nota={nota} catalogo={catalogo} catalogoFalhou={catalogoFalhou} podeAssociar={podeAssociar} salvarAssociacao={salvarAssociacao} />
      {estadoTexto && (
        <div className={estado === 'erro' ? 'erro' : estado === 'ensaio_ok' ? 'ok' : 'amarelo'} data-testid="status-nota">{estadoTexto}</div>
      )}
      {estado === 'erro' && nota.lancamento_motivo && <div className="sub">{traduzirMotivo(nota.lancamento_motivo)}</div>}
      {estado === 'lancando' && <VerificarRobo nota={nota} recarregar={recarregar} />}
      {outraOcupando && !travada && <div className="amarelo" data-testid="aviso-outra">Aguarde: o robô está lançando outra nota. Cada nota leva uns 3 minutos.</div>}
      {/* falta só a conversão (produto já confirmado no app) é amarelo: resolve-se aqui na caixa; o resto é vermelho */}
      {bloqueios.map((b) => <div key={b} className={b === AVISO_FALTA_CONVERSAO ? 'amarelo' : 'erro'} data-testid="bloqueio-nota">{b}</div>)}

      {soLancar ? (
        <div className="sub" data-testid="pagamento-fixo">
          Pagamento: Boleto ({financeiro.parcelas.length} {financeiro.parcelas.length === 1 ? 'parcela' : 'parcelas'}){' '}
          <button type="button" className="link" onClick={() => setMudandoForma(true)}>mudar forma de pagamento</button>
        </div>
      ) : (
      <label>Como pagar
        <select value={forma} disabled={!podePreparar || enviando} onChange={(e) => escolher(e.target.value)}>
          {forma === '' && <option value="" disabled>Escolha como pagar…</option>}
          {OPCOES_ANTES_DO_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          <optgroup label="PIX">
            {OPCOES_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </optgroup>
          {OPCOES_DEPOIS_DO_PIX.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      </label>
      )}
      {exigeParcelas && podePreparar && (
        <EditorParcelas nota={nota} linhas={linhas} resultado={resultadoParcelas} desabilitado={enviando || confirmando} aguardandoProduto={travada} onChange={mudarLinhas} />
      )}
      {plano && podePreparar && (
        <PagamentoSemanal
          plano={plano} editando={editandoData} desabilitado={enviando || confirmando}
          onEditar={() => setEditandoData(true)}
          onMudar={(i, iso) => setDatasSemanais((atual) => { const novo = [...atual]; novo[i] = iso; return novo })}
          onUsarQuarta={() => { setDatasSemanais([]); setEditandoData(false) }}
        />
      )}
      {padraoDoFornecedor && escolha === null && forma === padraoDoFornecedor && (
        <div className="sub" data-testid="padrao-fornecedor">Padrão deste fornecedor: {rotuloForma(padraoDoFornecedor)} (a forma da última nota lançada dele).</div>
      )}
      {formaNaoProvada(forma) && <div className="amarelo" data-testid="aviso-forma">{AVISO_FORMA_NAO_PROVADA}</div>}

      {confirmando ? (
        <div className="bloco-envio">
          <p>Vai lançar a NF {nota.numero} de {nota.emitente} — pagamento: {rotuloForma(forma)}. Confirmar?</p>
          {(exigeParcelas || plano) && (
            <ul className="conferir-itens" data-testid="parcelas-confirmar">
              {(exigeParcelas ? resultadoParcelas.parcelas : plano?.parcelas ?? []).map((p, i) => (
                <li key={i}><span>Parcela {i + 1} · vence {dataBr(p.vencimento)}</span><b>{formatarReais(p.valor)}</b></li>
              ))}
            </ul>
          )}
          <div className="acoes">
            <button type="button" className="botao" disabled={!podeLancar} onClick={() => void confirmar()}>
              {enviando ? 'Enviando…' : 'Confirmar'}
            </button>
            <button type="button" className="botao secundario" disabled={enviando} onClick={() => setConfirmando(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="acoes">
          <button type="button" className="botao" disabled={!podeLancar} onClick={() => { setErro(''); setConfirmando(true) }}>Lançar</button>
        </div>
      )}
      {/* O Lançar apagado sem dizer por quê confunde: o motivo fica logo embaixo dele, com o que fazer (pedido do Ivan, 06/10 à noite).
          Etapa 2: o que trava é a decisão do app INCOMPLETA (sem produto, ou produto em outra unidade sem a conversão) — resolve-se aqui mesmo,
          na caixa de associação; associar direto no SisChef continua valendo (aí o botão libera na próxima leitura de lá). */}
      {!confirmando && !robotOuMetade && pendencias.length > 0 && (
        <div className="amarelo lancar-travado" data-testid="lancar-travado">
          <p>
            <b>
              O Lançar está apagado porque {pendencias.every((p) => p.codigo != null) ? 'falta a conversão de unidade de algum item' : 'falta produto no SisChef em algum item'}.
            </b>{' '}
            Decida aqui no app: ao lançar, o robô associa no SisChef (e grava a conversão, quando houver). Ou associe direto no SisChef.
          </p>
          <p>O que falta:</p>
          <ul>
            {pendencias.map((p, i) => {
              const nomes = p.codigo != null ? nomeParaMostrar(catalogo, p.codigo, p.nome ?? '') : null
              return (
                <li key={i} data-testid="lancar-travado-item">
                  <span>{semCodFor(p.descricao)}</span>{' → '}
                  {p.codigo != null
                    ? <><b>{p.codigo}</b>{nomes?.nome ? ` ${nomes.nome}` : ''}{nomes?.noSischef ? ` (no SisChef: ${nomes.noSischef})` : ''} · {p.falta}</>
                    : p.n != null ? <>escolha o produto em “Conferir itens e financeiro”</> : <>{p.falta}</>}
                </li>
              )
            })}
          </ul>
          <p className="sub">Se associar no SisChef, o botão libera na próxima leitura de lá.</p>
        </div>
      )}
      {/* Nada trava, mas há decisão do app a aplicar: antes de lançar, o Ivan vê o que o robô vai gravar no SisChef — o de-para por código do
          fornecedor é PERMANENTE lá (vale para as próximas notas), por isso o aviso fica junto do botão, inclusive na pergunta "Confirmar?". */}
      {!travada && peloRobo.length > 0 && (
        <div className="amarelo lancar-associa" data-testid="lancar-associa">
          <p><b>Ao lançar, o robô vai associar no SisChef:</b></p>
          <ul>
            {peloRobo.map((a) => {
              const nomes = nomeParaMostrar(catalogo, a.produto_id, a.produto_nome)
              return (
                <li key={a.n} data-testid="lancar-associa-item">
                  <span>item {a.n} {semCodFor(a.descricao)}</span>{' → '}
                  <b>{nomes.nome}</b> (cód. {a.produto_id}){nomes.noSischef ? ` (no SisChef: ${nomes.noSischef})` : ''}
                  {a.conversao != null && ` · ${textoConversao(a.unidadeNota, a.unidadeProduto, a.conversao)}`}
                  {/* A unidade que a lista do app tem para este produto é um palpite (ou não existe: produto novo) e o Ivan não informou a conversão.
                      A decisão vale, mas o robô confere no cadastro vivo do SisChef e pode parar a nota pedindo o fator — melhor avisar antes.
                      Se a NOTA veio sem unidade, o robô para antes de associar (não grava de-para às cegas): o aviso diz isso e a saída. */}
                  {a.unidadeIncerta && (rotuloUnidade(a.unidadeNota) === ''
                    ? <span className="sub"> · a leitura não trouxe a unidade deste item na nota: o robô vai parar antes de associar (atualize a lista de notas ou associe no SisChef)</span>
                    : <span className="sub"> · unidade no SisChef não confirmada pelo app: o robô confere lá e pode parar pedindo a conversão</span>)}
                </li>
              )
            })}
          </ul>
          <p className="sub">Essa associação fica gravada no SisChef para as próximas notas deste fornecedor.</p>
        </div>
      )}
      {descartavel && !confirmando && (descartando ? (
        <div className="bloco-envio" data-testid="confirmar-descarte">
          <p>Descartar a NF {nota.numero} de {nota.emitente}?</p>
          <p className="sub">
            Ela sai desta lista e nada é lançado. Não muda nada no SisChef nem na SEFAZ: a compra continua pendente lá, sem entrada no estoque nem no
            financeiro. Dá para desfazer em “Notas descartadas”.{nota.itens.length === 0 && ' Se o XML completo chegar depois, você vê um aviso lá.'}
          </p>
          <div className="acoes">
            <button type="button" className="botao perigo" disabled={descartandoEnvio} onClick={() => void descartar()}>
              {descartandoEnvio ? 'Descartando…' : 'Descartar'}
            </button>
            <button type="button" className="botao secundario" disabled={descartandoEnvio} onClick={() => setDescartando(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div><button type="button" className="link perigo" data-testid="descartar-nota" onClick={() => { setErro(''); setDescartando(true) }}>Descartar nota</button></div>
      ))}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </li>
  )
}

export default function NotaSefaz() {
  const [aLancar, setALancar] = useState<NotaSefazLista[]>([])
  const [lancadas, setLancadas] = useState<NotaSefazLista[]>([])
  const [descartadas, setDescartadas] = useState<NotaSefazLista[]>([]) // as que o Ivan descartou (ainda na fila do SisChef)
  const [voltando, setVoltando] = useState<string | null>(null) // chave da descartada que está voltando para a fila
  const [erroDescartadas, setErroDescartadas] = useState('')
  const envioRef = useRef(false)
  const [emEnvio, setEmEnvio] = useState(false)
  const iniciarEnvio = (): boolean => { if (envioRef.current) return false; envioRef.current = true; setEmEnvio(true); return true }
  const fimEnvio = (): void => { envioRef.current = false; setEmEnvio(false) }
  const [padroes, setPadroes] = useState<Record<string, string>>({}) // forma padrão por CNPJ (última nota lançada), vem do banco
  const [seguidas, setSeguidas] = useState<Record<string, number>>({}) // notas seguidas em boleto por CNPJ (fornecedor aprendido)
  const [falha, setFalha] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null) // qual lançada está aberta mostrando o detalhe
  // Lista de insumos do app (itens_semana) para escolher o produto de um item sem produto. Só é lida quando alguma nota tem esse tipo de item.
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [catalogoFalhou, setCatalogoFalhou] = useState(false)

  // Devolve a promessa para o "Lançar" esperar a lista nova (a nota passa a 'lancando') antes de liberar o botão.
  // `silencioso` (releitura automática / depois do Lançar): uma falha passageira não esconde a lista que já está na tela.
  function carregar(silencioso = false): Promise<void> {
    if (!silencioso) setCarregando(true)
    // O padrão por fornecedor é só uma sugestão: se falhar, a tela segue sem ele (Boleto).
    const padrao = Promise.resolve(api.formasPadraoPorFornecedor()).catch(() => ({}))
    const aprendidos = Promise.resolve(api.lancamentosSeguidosEmBoleto()).catch(() => ({}))
    // As descartadas também são só um complemento: se a leitura delas falhar, a lista de notas a lançar segue normal.
    const descartadasLidas = Promise.resolve(api.notasDescartadas()).catch(() => [] as NotaSefazLista[])
    return Promise.all([api.notasALancar(), api.notasLancadas(), padrao, aprendidos, descartadasLidas])
      .then(([a, l, p, s, d]) => { setALancar(a); setLancadas(l); setPadroes(p ?? {}); setSeguidas(s ?? {}); setDescartadas(d ?? []); setFalha(false) })
      .catch(() => { if (!silencioso) setFalha(true) })
      .finally(() => setCarregando(false))
  }
  useEffect(() => { void carregar() }, [])

  const precisaCatalogo = aLancar.some((n) => n.itens.some((it) => !itemAssociado(it)))
  useEffect(() => {
    if (!precisaCatalogo || catalogo !== null) return
    let vivo = true
    Promise.resolve(api.catalogoProdutos())
      .then((c) => { if (vivo) { setCatalogo(c ?? []); setCatalogoFalhou(false) } })
      .catch(() => { if (vivo) setCatalogoFalhou(true) })
    return () => { vivo = false }
  }, [precisaCatalogo, catalogo])

  /** Lê a lista de insumos de novo (as palavras-chave mudaram). Falha passageira: fica a lista que já está na tela. */
  async function recarregarCatalogo(): Promise<void> {
    try { const c = await Promise.resolve(api.catalogoProdutos()); if (c) setCatalogo(c) } catch { /* mantém a lista atual */ }
  }

  /** Desfaz o descarte: a nota volta para "Notas a lançar". */
  async function voltar(chave: string) {
    if (voltando) return
    setVoltando(chave); setErroDescartadas('')
    try {
      await api.restaurarNota(chave)
      await carregar(true)
    } catch (e) {
      setErroDescartadas(e instanceof Error ? e.message : 'Não consegui voltar a nota para a fila. Tente de novo.')
    } finally {
      setVoltando(null)
    }
  }

  // Enquanto o robô trabalha em alguma nota, olha de novo a cada ~15 s (e para quando nenhuma estiver 'lancando' — presa não conta).
  const algumaLancando = aLancar.some((n) => n.lancamento_estado === 'lancando' && !lancandoPresa(n))
  useEffect(() => {
    if (!algumaLancando) return
    const id = setInterval(() => { void carregar(true) }, INTERVALO_ATUALIZAR)
    return () => clearInterval(id)
  }, [algumaLancando])

  return (
    <section className="coluna cupom">
      <h2>Lançamento fiscal</h2>
      <p className="sub">Modo: eu disparo — você confere e manda lançar (o automático vem depois).</p>

      <div className="grupo">Notas a lançar</div>
      {falha && <p className="erro" role="alert">Não consegui carregar as notas.</p>}
      {!falha && (aLancar.length === 0
        ? <p className="sub">{carregando ? 'Carregando…' : 'Nenhuma nota pendente da SEFAZ agora.'}</p>
        : (
          <>
            <ul className="recentes">
              {aLancar.map((n) => <NotaALancar key={n.chave} nota={n} padroes={padroes} seguidas={seguidas} recarregar={() => carregar(true)}
                outraLancando={aLancar.some((o) => o.chave !== n.chave && o.lancamento_estado === 'lancando' && !lancandoPresa(o))}
                emEnvio={emEnvio} iniciarEnvio={iniciarEnvio} fimEnvio={fimEnvio} catalogo={catalogo} catalogoFalhou={catalogoFalhou}
                recarregarCatalogo={recarregarCatalogo} />)}
            </ul>
            <p className="sub">Confira, escolha como pagar e toque em “Lançar”: o robô faz o resto no SisChef.</p>
          </>
        ))}

      {!falha && descartadas.length > 0 && (
        <details className="conferir descartadas" data-testid="descartadas">
          <summary>
            Notas descartadas ({descartadas.length})
            {descartadas.some(descartadaVoltouComItens) && <b data-testid="descartadas-aviso"> · uma delas agora veio com itens</b>}
          </summary>
          <p className="sub">Estas notas saíram de “Notas a lançar” e o robô não as lança. Nada foi mudado no SisChef nem na SEFAZ.</p>
          <ul className="conferir-itens">
            {descartadas.map((n) => (
              <li key={n.chave} data-testid="nota-descartada">
                <span><b>{n.emitente}</b> · NF {n.numero} · {ddmm(n.emissao)}{n.valor_nf != null && ` · ${formatarReais(n.valor_nf)}`}</span>
                {n.descartada_motivo && <span className="sub">Motivo: {n.descartada_motivo}</span>}
                {descartadaVoltouComItens(n) && (
                  <span className="ok" data-testid="descartada-com-itens">
                    Esta nota agora veio com {n.itens.length} {n.itens.length === 1 ? 'item' : 'itens'} (o XML completo chegou). Volte para a fila para conferir e lançar.
                  </span>
                )}
                <button type="button" className="link" disabled={voltando !== null} onClick={() => void voltar(n.chave)}>
                  {voltando === n.chave ? 'Voltando…' : 'Voltar para a fila'}
                </button>
              </li>
            ))}
          </ul>
          {erroDescartadas && <p className="erro" role="alert">{erroDescartadas}</p>}
        </details>
      )}

      <div className="grupo">Últimos lançamentos</div>
      {!falha && (lancadas.length === 0
        ? <p className="sub">{carregando ? '' : 'Nenhuma nota lançada ainda.'}</p>
        : (
          <ul className="recentes">
            {lancadas.map((n) => {
              const aberto = expandido === n.chave
              return (
                <li key={n.chave} data-testid="nota-lancada">
                  <button type="button" className="recente-linha" aria-expanded={aberto}
                    onClick={() => setExpandido(aberto ? null : n.chave)}>
                    <span><b>lançada ✓</b> · {n.emitente} · NF {n.numero}{n.valor_nf != null && ` · ${formatarReais(n.valor_nf)}`}</span>
                    <span className="seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                  </button>
                  {aberto && <DetalheLancamento rotulo="NF no SisChef" pedido={n.nf_sischef} quando={n.lancada_em ? formatarDataHora(n.lancada_em) : null} rotuloQtd={false} itens={n.itens.map(linhaDoItem)} />}
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
