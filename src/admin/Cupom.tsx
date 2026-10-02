// Sub-fase 3: tela "Lançar cupom" — 3 passos (forma de pagamento → foto do cupom → enviar) + "Últimos envios".
// A guarda por papel (só admin, em App.tsx) é só de UX: a segurança real é a RLS + a checagem de admin da Edge Function enviar-cupom.
import { useEffect, useState, type ChangeEvent } from 'react'
import * as api from '../lib/api'
import { reduzirFoto } from '../lib/foto'
import { formatarReais } from '../lib/regras'
import { CONTAS_PIX, CONTA_DINHEIRO, CONTA_TESOURARIA, FORMAS } from '../cupom/formasPagamento'
import type { CupomRecente, EstadoCupom, FormaCupom, PagamentoCupom, ResumoEnvioCupom } from '../lib/tipos'

const ROTULO_ESTADO: Record<EstadoCupom, string> = {
  PENDENTE: 'na fila', PROCESSANDO: 'na fila', LANCADO: 'lançado ✓', REVISAR: 'precisa de você ⚠', TESTE: 'teste ✓',
}

/** Monta o pagamento a partir dos botões; null = ainda incompleto (PIX sem banco/empresa). */
function montarPagamento(forma: FormaCupom | null, contaPix: string | null): PagamentoCupom | null {
  if (forma === 'sem_cartao') return { forma: 'sem_cartao' }
  if (forma === 'dinheiro') return { forma: 'dinheiro', conta: CONTA_DINHEIRO }
  if (forma === 'tesouraria') return { forma: 'tesouraria', conta: CONTA_TESOURARIA }
  if (forma === 'pix') return contaPix ? { forma: 'pix', conta: contaPix } : null
  return null
}

/**
 * Caminho da foto no bucket `cupons`. Gerado UMA vez por captura — nunca por toque em "Enviar": o servidor deduplica
 * por foto_path, então o retry só é seguro se reusar o MESMO caminho (um caminho novo no retry duplicaria o cupom).
 */
const novoCaminho = (): string =>
  `cupom/${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}.jpg`

/** Valor para mostrar na linha, ou null. REVISAR sem total legível (foto ilegível) é gravado com 0 (coluna NOT NULL): isso não é um valor. */
function valorDaLinha(c: CupomRecente): string | null {
  if (c.valor_a_pagar == null) return null
  if (c.estado === 'REVISAR' && c.valor_a_pagar === 0) return null
  return formatarReais(c.valor_a_pagar)
}

/** Envio que não está "tudo certo": foi para REVISAR, ou ficou PENDENTE porque o disparo automático falhou. */
const pedeAtencao = (r: ResumoEnvioCupom): boolean => r.estado === 'REVISAR' || r.disparo_ok === false

export default function Cupom() {
  const [forma, setForma] = useState<FormaCupom | null>(null)
  const [contaPix, setContaPix] = useState<string | null>(null)
  // a foto e o caminho dela nascem juntos (um estado só) e sobrevivem a um envio com erro: o retry reusa o MESMO caminho
  const [foto, setFoto] = useState<{ blob: Blob; path: string } | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [teste, setTeste] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResumoEnvioCupom | null>(null)
  const [erro, setErro] = useState('')
  const [recentes, setRecentes] = useState<CupomRecente[]>([])
  // a última carga dos "Últimos envios" falhou? (não pode aparecer como lista vazia: esconderia migração/coluna faltando ou RLS errada)
  const [falhaRecentes, setFalhaRecentes] = useState(false)

  function carregarRecentes() {
    api.cuponsRecentes()
      .then((r) => { setRecentes(r); setFalhaRecentes(false) })
      .catch(() => setFalhaRecentes(true))
  }
  useEffect(() => { carregarRecentes() }, [])

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return
    setResultado(null); setErro('')
    setPreparando(true)
    try {
      const blob = await reduzirFoto(arquivo)
      setFoto({ blob, path: novoCaminho() }) // o caminho nasce AQUI, uma vez por captura; cada "Enviar" reusa este
    } finally {
      setPreparando(false)
    }
  }

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    // a foto fica no estado; o seletor limpo não mostra um nome velho depois do envio e deixa anexar o mesmo arquivo de novo
    e.target.value = ''
    void escolherFoto(arquivo)
  }

  const pagamento = montarPagamento(forma, contaPix)
  const podeEnviar = pagamento !== null && foto !== null && !preparando && !enviando

  async function enviar() {
    if (!pagamento || !foto) return
    setEnviando(true); setErro(''); setResultado(null)
    try {
      await api.subirFotoCupom(foto.path, foto.blob)
      const r = await api.enviarCupom(foto.path, pagamento, teste)
      setResultado(r)
      setFoto(null); setForma(null); setContaPix(null) // limpa para o próximo cupom (o "Modo teste" fica como está)
      carregarRecentes()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui enviar. Tente de novo.') // a foto fica; o retry reusa o MESMO caminho
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="coluna cupom">
      <h2>Lançar cupom</h2>

      {/* travado durante o envio (trocar foto/forma no meio apagaria a escolha do próximo cupom quando o envio terminasse) e durante o
          preparo da foto (duas capturas em seguida podem terminar fora de ordem, e a foto velha venceria) */}
      <fieldset className="coluna" disabled={enviando || preparando}>
        <div className="grupo">1. Forma de pagamento</div>
        <div className="chips">
          {FORMAS.map((f) => (
            <button key={f.forma} className={`chip${forma === f.forma ? ' ativo' : ''}`} aria-pressed={forma === f.forma}
              onClick={() => { setForma(f.forma); setContaPix(null) }}>{f.rotulo}</button>
          ))}
        </div>
        {forma === 'pix' && (
          <>
            <p className="sub">Banco e empresa do PIX</p>
            <div className="chips" role="group" aria-label="Banco e empresa do PIX">
              {CONTAS_PIX.map((c) => (
                <button key={`${c.banco}|${c.empresa}`} className={`chip${contaPix === c.conta ? ' ativo' : ''}`} aria-pressed={contaPix === c.conta}
                  onClick={() => setContaPix(c.conta)}>{c.rotulo}</button>
              ))}
            </div>
          </>
        )}

        <div className="grupo">2. Inserir o cupom</div>
        <label>📷 Bater foto
          <input type="file" accept="image/*" capture="environment" aria-label="Bater foto do cupom" onChange={aoEscolherArquivo} />
        </label>
        <label>📎 Anexar
          <input type="file" accept="image/*" aria-label="Anexar arquivo do cupom" onChange={aoEscolherArquivo} />
        </label>
        {preparando && <p className="sub">Preparando a foto…</p>}
        {foto && !preparando && <p className="ok" data-testid="foto-pronta">✓ Foto anexada</p>}

        <label className="marcar">
          <input type="checkbox" checked={teste} onChange={(e) => setTeste(e.target.checked)} />
          Modo teste (não lança de verdade)
        </label>
      </fieldset>

      <div className="grupo">3. Enviar</div>
      <button className="botao" disabled={!podeEnviar} onClick={() => void enviar()}>
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {resultado && <p className={pedeAtencao(resultado) ? 'amarelo' : 'ok'} data-testid="resultado">{resultado.resumo}</p>}

      <div className="grupo">Últimos envios</div>
      {falhaRecentes && <p className="erro" role="alert">Não consegui carregar os últimos envios.</p>}
      {recentes.length === 0 ? (!falhaRecentes && <p className="sub">Nenhum envio ainda.</p>) : (
        <ul className="recentes">
          {recentes.map((c) => {
            const valor = valorDaLinha(c)
            return (
              <li key={c.id} data-testid="cupom-recente">
                <b>{ROTULO_ESTADO[c.estado]}</b> · {c.emitente_nome ?? 'cupom'}
                {valor && ` · ${valor}`}
                {c.estado === 'REVISAR' && c.motivo && <div className="sub">{c.motivo}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
