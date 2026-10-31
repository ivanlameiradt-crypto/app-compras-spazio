// "Cadastrar fornecedor" dentro do app (pedido do Ivan, 08/10/2026): o cupom parou porque o SisChef não tem o fornecedor. O Ivan confere o CNPJ, o app busca os
// dados na consulta pública do CNPJ, ele confirma (razão social, nome fantasia, estado e município) e toca em "Cadastrar no SisChef"; o robô cadastra
// (Cadastros › Pessoas › Novo › Fornecedor). Pronto o cadastro, o Ivan toca em "Reenviar este cupom" — o app NUNCA reenvia sozinho.
// As ações (rede) entram por `acoes`, para a tela ser testada e mostrada sem servidor.
import { useEffect, useRef, useState } from 'react'
import {
  CADASTRO_CONCLUIDO, cnpjLidoSuspeito, cnpjValido, formatarCnpj, fornecedorNaoEncontrado, problemaDoFormulario, soDigitos,
  type DadosCnpj, type EstadoCadastro, type PedidoCadastro,
} from './fornecedorRegras'

export interface AcoesFornecedor {
  consultarCnpj(cnpj: string): Promise<DadosCnpj>
  cadastrar(pedido: PedidoCadastro): Promise<void>
  /** O pedido de cadastro mais recente deste CNPJ (null = nunca pedido), com as datas (ISO) para saber se ele ficou parado ou é mais antigo que a recusa da nota. */
  statusDoCadastro(cnpj: string): Promise<{ estado: EstadoCadastro; motivo: string | null; criado_em?: string | null; atualizado_em?: string | null } | null>
  reenviarCupom(cupomId: string): Promise<void>
}

interface Props {
  cupom: { id: string; motivo: string | null; emitente_nome?: string | null; emitente_cnpj?: string | null }
  acoes: AcoesFornecedor
  /** O servidor aceitou o reenvio (quem recarrega os "Últimos envios" é a tela de cima). */
  aoReenviar: () => void
  /** Intervalo entre as conferências do cadastro (ms); os testes usam um bem curto. */
  intervaloMs?: number
  /** Aba "Compras avulsas" (10/10/2026): não há cupom para reenviar. Pronto o cadastro, o botão vira "Usar este fornecedor" e entrega os dados a quem chamou. */
  aoUsar?: (f: { cnpj: string; razao: string; fantasia: string }) => void
  /** Nota fiscal (31/10/2026, Plast Mais 8928): o fornecedor da NOTA não está no SisChef. Aqui `cupom.id` é a CHAVE da nota; a razão social já vem da nota (`cupom.emitente_nome`) e,
   *  pronto o cadastro, o Ivan toca em "Lançar" na própria nota: não há cupom para reenviar. O botão só pede à tela de cima que releia a nota (`aoReenviar`). */
  paraNota?: boolean
  /** (paraNota) Quando o robô RECUSOU a nota por fornecedor novo (ISO, `lancamento_estado_em`). Um cadastro CONCLUÍDO que é mais antigo que a recusa não resolveu a nota: a caixa volta a oferecer o
   *  pedido (senão ✓ → Lançar → recusa → ✓ seria um laço sem saída; revisão independente de 31/10/2026, A4). */
  recusadaEm?: string | null
  /** (paraNota) O robô está lançando outra nota: o GitHub guarda só UM disparo pendente por vez e cancelaria o cadastro (ou o lançamento) que esperasse na fila — o botão espera. */
  ocupado?: boolean
}

/** Um pedido "em andamento" há mais que isto é dado como PARADO (o cadastro leva uns 2 minutos; o servidor também o encerra — MINUTOS_PENDENTE_PARADO da função cadastrar-fornecedor). */
const LIMITE_PARADO_MS = 15 * 60_000
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const mensagem = (e: unknown, padrao: string): string => (e instanceof Error && e.message ? e.message : padrao)

export default function CadastrarFornecedor({ cupom, acoes, aoReenviar, intervaloMs = 5000, aoUsar, paraNota = false, recusadaEm = null, ocupado = false }: Props) {
  const lido = fornecedorNaoEncontrado(cupom.motivo)
  const [cnpj, setCnpj] = useState(formatarCnpj(lido?.cnpj || cupom.emitente_cnpj || ''))
  const [razao, setRazao] = useState(lido?.nome ?? (paraNota ? (cupom.emitente_nome ?? '') : ''))    // a razão social: é ela (e o CNPJ) que vai ao SisChef
  const [fantasia, setFantasia] = useState('')
  const [uf, setUf] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [buscou, setBuscou] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [estado, setEstado] = useState<EstadoCadastro | null>(null)
  const [motivoRobo, setMotivoRobo] = useState<string | null>(null)
  const [criadoEm, setCriadoEm] = useState<string | null>(null)
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  const emAndamento = estado === 'PENDENTE' || estado === 'PROCESSANDO'
  const idadeMs = (iso: string | null): number => (iso && Number.isFinite(Date.parse(iso)) ? Date.now() - Date.parse(iso) : 0)
  // PARADO: em andamento há mais de 15 min (o robô nunca pegou o pedido — disparo cancelado na fila — ou caiu no meio): a caixa volta a oferecer o pedido (o servidor encerra o antigo antes de gravar o novo)
  const parado = emAndamento && !enviando && idadeMs(criadoEm) > LIMITE_PARADO_MS
  // ANTIGO (só na nota): o cadastro concluído é mais velho que a recusa da nota — não resolveu; a caixa oferece o pedido de novo e avisa
  const antigo = paraNota && !!recusadaEm && CADASTRO_CONCLUIDO(estado) && !!atualizadoEm && Date.parse(atualizadoEm) < Date.parse(recusadaEm)
  const cadastrando = emAndamento && !parado
  const pronto = CADASTRO_CONCLUIDO(estado) && !antigo
  const problema = problemaDoFormulario({ cnpj, razao, uf, municipio })
  // 29/10: o CNPJ que a leitura da foto trouxe e que NÃO fecha as contas (a leitura trocou algum número). O aviso vale enquanto o campo ainda tem esse número: mexeu no campo, já foi atendido.
  const cnpjLido = soDigitos(lido?.cnpj || cupom.emitente_cnpj || '')
  const avisoCnpjLido = !paraNota && cnpjLidoSuspeito(cnpjLido) && soDigitos(cnpj) === cnpjLido     // (na nota o CNPJ vem da chave, não da leitura de uma foto)

  // Se já existe um pedido de cadastro deste CNPJ (a tela foi fechada no meio), retoma de onde parou.
  useEffect(() => {
    const d = soDigitos(cnpj)
    if (d.length !== 14) return
    let vivo = true
    acoes.statusDoCadastro(d).then((s) => { if (vivo && s) { setEstado(s.estado); setMotivoRobo(s.motivo); setCriadoEm(s.criado_em ?? null); setAtualizadoEm(s.atualizado_em ?? null) } }).catch(() => undefined)
    return () => { vivo = false }
    // só ao abrir: o CNPJ digitado depois é consultado pelo botão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Enquanto o robô cadastra, olha o andamento a cada poucos segundos.
  useEffect(() => {
    if (!cadastrando) return
    const t = setInterval(() => {
      acoes.statusDoCadastro(soDigitos(cnpj)).then((s) => {
        if (!montado.current || !s) return
        setEstado(s.estado)
        setMotivoRobo(s.motivo)
        setCriadoEm(s.criado_em ?? criadoEm)
        setAtualizadoEm(s.atualizado_em ?? null)
      }).catch(() => undefined)
    }, intervaloMs)
    return () => clearInterval(t)
  }, [cadastrando, cnpj, acoes, intervaloMs])

  async function buscar() {
    setErro(''); setAviso('')
    if (!cnpjValido(cnpj)) { setErro('O CNPJ não está certo (confira os 14 números).'); return }
    setBuscando(true)
    try {
      const d = await acoes.consultarCnpj(soDigitos(cnpj))
      setRazao(d.razao_social)
      setFantasia(d.nome_fantasia)
      setUf(d.uf.toUpperCase())
      setMunicipio(d.municipio)
      setBuscou(true)
    } catch (e) {
      setBuscou(true) // sem a consulta o Ivan preenche à mão
      setAviso(mensagem(e, 'Não consegui consultar o CNPJ agora. Preencha os dados à mão.'))
    } finally {
      setBuscando(false)
    }
  }

  async function cadastrar() {
    if (problema) { setErro(problema); return }
    setErro(''); setEnviando(true)
    try {
      // na NOTA fiscal o `id` é a chave da nota (o servidor confere que ela parou por fornecedor novo e que o CNPJ é o do emitente); no cupom, o id do cupom
      await acoes.cadastrar({ cnpj: soDigitos(cnpj), razao_social: razao.trim(), nome_fantasia: fantasia.trim(), uf: uf.trim().toUpperCase(), municipio: municipio.trim(),
        ...(paraNota ? { nota_chave: cupom.id } : { cupom_id: cupom.id }) })
      setEstado('PENDENTE'); setMotivoRobo(null); setCriadoEm(new Date().toISOString()); setAtualizadoEm(null)
    } catch (e) {
      setErro(mensagem(e, 'Não consegui pedir o cadastro agora. Tente de novo.'))
    } finally {
      setEnviando(false)
    }
  }

  async function reenviar() {
    if (paraNota) { aoReenviar(); return }           // a nota segue pelo "Lançar" dela: aqui só se pede a releitura
    if (aoUsar) { aoUsar({ cnpj: soDigitos(cnpj), razao: razao.trim(), fantasia: fantasia.trim() }); return }
    setErro(''); setReenviando(true)
    try {
      await acoes.reenviarCupom(cupom.id)
      aoReenviar()
    } catch (e) {
      setErro(mensagem(e, 'Não consegui reenviar agora. Tente de novo.'))
    } finally {
      setReenviando(false)
    }
  }

  const travado = enviando || cadastrando || pronto
  return (
    <div className="associar cadastrar-fornecedor" data-testid="cadastrar-fornecedor">
      <div className="grupo">Fornecedor não cadastrado no SisChef</div>
      {avisoCnpjLido && (
        <p className="amarelo aviso-cnpj" data-testid="cnpj-lido-errado">
          O CNPJ que li na foto ({formatarCnpj(cnpjLido)}) parece errado: é provável que seja só um número trocado. Olhe a foto, digite o CNPJ certo no campo abaixo e toque em “Buscar dados do CNPJ”.
        </p>
      )}
      {paraNota ? (
        <p className="sub" data-testid="intro-nota">
          O robô não achou{cupom.emitente_nome ? <> <b>{cupom.emitente_nome}</b></> : ' o fornecedor desta nota'}{cnpj ? <> (CNPJ {formatarCnpj(cnpj)})</> : ''} no SisChef.
          Cadastre aqui e depois toque em “Lançar” na nota. O robô só cadastra quando você tocar em “Cadastrar no SisChef”.
        </p>
      ) : aoUsar ? (
        <p className="sub">Esse fornecedor ainda não está no app nem no SisChef. Digite o CNPJ: o app busca os dados e você confere. O robô só cadastra quando você tocar em “Cadastrar no SisChef”.</p>
      ) : (
        <p className="sub">
          O robô não achou{lido?.nome ? <> <b>{lido.nome}</b></> : ' o fornecedor do cupom'}{lido?.cnpj ? <> (CNPJ {formatarCnpj(lido.cnpj)})</> : ''} no SisChef.
          Cadastre aqui e depois reenvie o cupom. O robô só cadastra quando você tocar em “Cadastrar no SisChef”.
        </p>
      )}

      {parado && (
        <p className="amarelo" role="status" data-testid="pedido-parado">
          O pedido de cadastro anterior ficou parado na fila (mais de 15 minutos) e foi dado como perdido. Pode pedir de novo.
        </p>
      )}
      {antigo && (
        <p className="amarelo" role="status" data-testid="cadastro-antigo">
          {estado === 'JA_EXISTIA'
            ? 'O SisChef já tinha este CNPJ, mas o robô ainda recusou a nota depois disso: o cadastro pode estar sem a marca de fornecedor. Se pedir de novo e continuar assim, chame o Claude.'
            : 'O fornecedor foi cadastrado antes, mas o robô ainda recusou a nota depois disso. Peça o cadastro de novo e, se continuar assim, chame o Claude.'}
        </p>
      )}
      <label>CNPJ
        {/* na NOTA o servidor só aceita o CNPJ do emitente (dígitos 7 a 20 da chave): o campo fica travado (revisão independente de 31/10/2026, A10) */}
        <input type="text" inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" value={cnpj} disabled={travado || paraNota}
          onChange={(e) => { setCnpj(e.target.value); setBuscou(false) }} />
      </label>
      {!travado && (
        <div className="acoes">
          <button type="button" className="botao" disabled={buscando} onClick={() => void buscar()} data-testid="buscar-cnpj">
            {buscando ? 'Buscando…' : buscou ? 'Buscar de novo' : 'Buscar dados do CNPJ'}
          </button>
        </div>
      )}
      {aviso && <p className="amarelo" role="status" data-testid="aviso-cnpj">{aviso}</p>}

      {(buscou || travado) && (
        <>
          <label>Razão social (vai para o SisChef)
            <input type="text" autoComplete="off" value={razao} disabled={travado} onChange={(e) => setRazao(e.target.value)} />
          </label>
          <label>Nome fantasia (só para o app)
            <input type="text" autoComplete="off" value={fantasia} disabled={travado} onChange={(e) => setFantasia(e.target.value)} />
          </label>
          <p className="sub" data-testid="regra-fantasia">O SisChef recebe só o CNPJ e a razão social. A fantasia fica aqui no app, nas informações do lançamento.</p>
          <div className="duas-colunas">
            <label>Estado
              <select value={uf} disabled={travado} onChange={(e) => setUf(e.target.value)}>
                <option value="">--</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label>Município
              <input type="text" autoComplete="off" value={municipio} disabled={travado} onChange={(e) => setMunicipio(e.target.value)} />
            </label>
          </div>
          {!travado && ocupado && (
            <p className="amarelo" role="status" data-testid="aguarde-robo">Aguarde o robô terminar de lançar a outra nota para pedir o cadastro: o GitHub guarda só um pedido na fila e cancelaria um dos dois.</p>
          )}
          {!travado && (
            <div className="acoes">
              <button type="button" className="botao" disabled={enviando || problema !== null || ocupado} onClick={() => void cadastrar()} data-testid="cadastrar">
                {enviando ? 'Enviando…' : 'Cadastrar no SisChef'}
              </button>
            </div>
          )}
        </>
      )}

      {cadastrando && <p className="ok" role="status" data-testid="cadastrando">Cadastrando no SisChef… o robô leva uns 2 minutos. Pode deixar esta tela aberta.</p>}
      {estado === 'REVISAR' && (
        <p className="erro" role="alert" data-testid="cadastro-revisar">
          O robô não conseguiu cadastrar{motivoRobo ? `: ${motivoRobo}` : '.'} Nada foi cadastrado errado; confira no SisChef ou fale com o Claude.
        </p>
      )}
      {pronto && (
        <>
          <p className="ok" role="status" data-testid="cadastro-pronto">
            {estado === 'JA_EXISTIA' ? '✓ Esse CNPJ já estava cadastrado no SisChef.' : '✓ Fornecedor cadastrado no SisChef.'} {paraNota ? 'Agora é só tocar em “Lançar” na nota.' : aoUsar ? 'Agora é só usar este fornecedor na compra.' : 'Agora é só reenviar o cupom.'}
          </p>
          <div className="acoes">
            <button type="button" className="botao" disabled={reenviando} onClick={() => void reenviar()} data-testid="reenviar-cupom">
              {paraNota ? 'Atualizar a nota' : aoUsar ? 'Usar este fornecedor' : reenviando ? 'Reenviando…' : 'Reenviar este cupom'}
            </button>
          </div>
        </>
      )}
      {erro && <p className="erro" role="alert" data-testid="erro-fornecedor">{erro}</p>}
    </div>
  )
}
