// "Cadastrar fornecedor" dentro do app (pedido do Ivan, 08/10/2026): o cupom parou porque o SisChef não tem o fornecedor. O Ivan confere o CNPJ, o app busca os
// dados na consulta pública do CNPJ, ele confirma (razão social, nome fantasia, estado e município) e toca em "Cadastrar no SisChef"; o robô cadastra
// (Cadastros › Pessoas › Novo › Fornecedor). Pronto o cadastro, o Ivan toca em "Reenviar este cupom" — o app NUNCA reenvia sozinho.
// As ações (rede) entram por `acoes`, para a tela ser testada e mostrada sem servidor.
import { useEffect, useRef, useState } from 'react'
import {
  CADASTRO_CONCLUIDO, cnpjValido, formatarCnpj, fornecedorNaoEncontrado, problemaDoFormulario, soDigitos,
  type DadosCnpj, type EstadoCadastro, type PedidoCadastro,
} from './fornecedorRegras'

export interface AcoesFornecedor {
  consultarCnpj(cnpj: string): Promise<DadosCnpj>
  cadastrar(pedido: PedidoCadastro): Promise<void>
  /** O pedido de cadastro mais recente deste CNPJ (null = nunca pedido). */
  statusDoCadastro(cnpj: string): Promise<{ estado: EstadoCadastro; motivo: string | null } | null>
  reenviarCupom(cupomId: string): Promise<void>
}

interface Props {
  cupom: { id: string; motivo: string | null; emitente_nome?: string | null; emitente_cnpj?: string | null }
  acoes: AcoesFornecedor
  /** O servidor aceitou o reenvio (quem recarrega os "Últimos envios" é a tela de cima). */
  aoReenviar: () => void
  /** Intervalo entre as conferências do cadastro (ms); os testes usam um bem curto. */
  intervaloMs?: number
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const mensagem = (e: unknown, padrao: string): string => (e instanceof Error && e.message ? e.message : padrao)

export default function CadastrarFornecedor({ cupom, acoes, aoReenviar, intervaloMs = 5000 }: Props) {
  const lido = fornecedorNaoEncontrado(cupom.motivo)
  const [cnpj, setCnpj] = useState(formatarCnpj(lido?.cnpj || cupom.emitente_cnpj || ''))
  const [razao, setRazao] = useState(lido?.nome ?? '')    // a razão social: é ela (e o CNPJ) que vai ao SisChef
  const [fantasia, setFantasia] = useState('')
  const [uf, setUf] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [buscou, setBuscou] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [estado, setEstado] = useState<EstadoCadastro | null>(null)
  const [motivoRobo, setMotivoRobo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  const cadastrando = estado === 'PENDENTE' || estado === 'PROCESSANDO'
  const pronto = CADASTRO_CONCLUIDO(estado)
  const problema = problemaDoFormulario({ cnpj, razao, uf, municipio })

  // Se já existe um pedido de cadastro deste CNPJ (a tela foi fechada no meio), retoma de onde parou.
  useEffect(() => {
    const d = soDigitos(cnpj)
    if (d.length !== 14) return
    let vivo = true
    acoes.statusDoCadastro(d).then((s) => { if (vivo && s) { setEstado(s.estado); setMotivoRobo(s.motivo) } }).catch(() => undefined)
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
      await acoes.cadastrar({ cnpj: soDigitos(cnpj), razao_social: razao.trim(), nome_fantasia: fantasia.trim(), uf: uf.trim().toUpperCase(), municipio: municipio.trim(), cupom_id: cupom.id })
      setEstado('PENDENTE'); setMotivoRobo(null)
    } catch (e) {
      setErro(mensagem(e, 'Não consegui pedir o cadastro agora. Tente de novo.'))
    } finally {
      setEnviando(false)
    }
  }

  async function reenviar() {
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
      <p className="sub">
        O robô não achou{lido?.nome ? <> <b>{lido.nome}</b></> : ' o fornecedor do cupom'}{lido?.cnpj ? <> (CNPJ {formatarCnpj(lido.cnpj)})</> : ''} no SisChef.
        Cadastre aqui e depois reenvie o cupom. O robô só cadastra quando você tocar em “Cadastrar no SisChef”.
      </p>

      <label>CNPJ
        <input type="text" inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" value={cnpj} disabled={travado}
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
          {!travado && (
            <div className="acoes">
              <button type="button" className="botao" disabled={enviando || problema !== null} onClick={() => void cadastrar()} data-testid="cadastrar">
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
            {estado === 'JA_EXISTIA' ? '✓ Esse CNPJ já estava cadastrado no SisChef.' : '✓ Fornecedor cadastrado no SisChef.'} Agora é só reenviar o cupom.
          </p>
          <div className="acoes">
            <button type="button" className="botao" disabled={reenviando} onClick={() => void reenviar()} data-testid="reenviar-cupom">
              {reenviando ? 'Reenviando…' : 'Reenviar este cupom'}
            </button>
          </div>
        </>
      )}
      {erro && <p className="erro" role="alert" data-testid="erro-fornecedor">{erro}</p>}
    </div>
  )
}
