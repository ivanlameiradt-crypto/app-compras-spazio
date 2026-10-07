// Sub-fase 3: tela "Lançar cupom" — 3 passos (forma de pagamento → foto do cupom → enviar) + "Últimos envios".
// A guarda por papel (só admin, em App.tsx) é só de UX: a segurança real é a RLS + a checagem de admin da Edge Function enviar-cupom.
import { useEffect, useState, type ChangeEvent } from 'react'
import * as api from '../lib/api'
import { reduzirFoto } from '../lib/foto'
import { formatarReais } from '../lib/regras'
import { CONTAS_PIX, CONTA_DINHEIRO, CONTA_TESOURARIA, FORMAS } from '../cupom/formasPagamento'
import type {
  CupomRecente, EstadoCupom, FormaCupom, ItemCupomRecente, PagamentoCupom, ProdutoCatalogo, RespostaConfirmacaoCupom, ResumoEnvioCupom,
} from '../lib/tipos'
import DetalheLancamento, { type LinhaDetalhe } from '../components/DetalheLancamento'
import { diagnosticoDoCupom, envioRepetido } from './cupomRegras'
import CorrigirCupom from './CorrigirCupom'

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

/** Converte um item do cupom para a linha genérica do detalhe (descrição · quantidade + unidade que entrou · valor). */
const linhaDoItem = (it: ItemCupomRecente): LinhaDetalhe =>
  ({ descricao: it.descricao_cupom ?? 'item', quantidade: it.entrada_estoque, unidade: it.unidade_cupom, valor: it.valor_unitario })

/** Cupom parado que o Ivan corrige DENTRO do app (item sem produto confirmado, com o total lido): só nesses a caixa de correção aparece. */
const corrigivel = (c: CupomRecente): boolean => c.estado === 'REVISAR' && diagnosticoDoCupom(c)?.corrigivel === true

/**
 * O que a tela diz logo depois de um "Reenviar para lançar" aceito pelo servidor; `amarelo` quando o cupom ficou na fila sem o disparo automático
 * ou quando alguma confirmação com "Lembrar" não ficou guardada — sem o aviso o Ivan acreditaria que o item passa direto da próxima vez, e ele
 * pararia de novo sem explicação (a correção deste cupom em si foi aceita do mesmo jeito).
 */
interface AvisoReenvio { classe: 'ok' | 'amarelo'; texto: string }
function avisoDeReenvio(r: RespostaConfirmacaoCupom): AvisoReenvio {
  const n = r.nao_lembrados ?? 0
  const naoGuardou = n > 0 ? `a confirmação de ${n} item(ns) não ficou guardada: no próximo cupom ${n === 1 ? 'ele para' : 'eles param'} de novo.` : ''
  if (r.disparo_ok === false) return { classe: 'amarelo', texto: naoGuardou ? `${r.resumo}. Além disso, ${naoGuardou}` : r.resumo }
  if (naoGuardou) return { classe: 'amarelo', texto: `Cupom corrigido e reenviado para lançar, mas ${naoGuardou}` }
  return { classe: 'ok', texto: 'Cupom corrigido e reenviado para lançar. Em 2 ou 3 minutos ele aparece como “lançado ✓” ou volta com um motivo novo.' }
}

/** Cupom parado ("precisa de você"): o que está errado e o que fazer para o robô poder lançá-lo (pedido do Ivan, 06/10 à noite). O motivo técnico
 *  registrado fica embaixo, em letra pequena, para conferência. */
function ProblemaDoCupom({ c }: { c: CupomRecente }) {
  const d = diagnosticoDoCupom(c)
  if (!d) return null
  return (
    <div className="amarelo problema-cupom" data-testid="cupom-problema">
      <p><b>O que está errado:</b> {d.problema}</p>
      {d.itens.length > 0 && (
        <ul data-testid="cupom-problema-itens">
          {d.itens.map((it, i) => <li key={i}><span>{it.descricao}</span>{it.preco && <span className="sub"> · {it.preco}</span>}</li>)}
        </ul>
      )}
      {d.pedidos.length > 0 && (
        <>
          <p><b>O que preciso de você:</b></p>
          <ol data-testid="cupom-pedidos">
            {d.pedidos.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
          {d.conferencia && <p className="sub" data-testid="cupom-conferencia">Para conferir a sua resposta: {d.conferencia}</p>}
        </>
      )}
      <p><b>Como resolver:</b> {d.solucao}</p>
      {c.motivo && <p className="sub">Motivo registrado: <span>{c.motivo}</span></p>}
    </div>
  )
}

/**
 * Quantidade do item como o robô a leu no cupom (v2 da Edge Function). Nos cupons antigos ela não ficou guardada: o que existe é a ENTRADA no
 * estoque, que pode estar em outra unidade (5 un viram 0,4 kg) — por isso ela aparece como "entrou … no estoque", nunca com a unidade do cupom.
 */
const num3 = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
/**
 * O preço por unidade como está IMPRESSO no cupom. Num item casado com conversão (5 un → 0,4 kg) o `valor_unitario` gravado é o preço por unidade
 * do ESTOQUE (R$ 99,875/kg): mostrá-lo ao lado de "5 un" contradiria o papel (R$ 7,99) e o Ivan concluiria que o robô leu errado. Refaz-se o preço
 * do cupom = valor da linha ÷ quantidade do cupom; sem a quantidade do cupom (envio antigo) fica o que há.
 */
function precoDoCupom(it: ItemCupomRecente): number | null {
  const v = Number(it.valor_unitario)
  if (it.valor_unitario == null || !Number.isFinite(v)) return null
  const q = Number(it.quantidade_cupom)
  const e = Number(it.entrada_estoque)
  if (it.quantidade_cupom != null && it.entrada_estoque != null && q > 0 && e > 0) return Math.round((v * e / q) * 100) / 100
  return v
}
function qtdLida(it: ItemCupomRecente): string {
  if (it.quantidade_cupom != null && Number.isFinite(Number(it.quantidade_cupom))) {
    return `${num3(Number(it.quantidade_cupom))} ${(it.unidade_cupom ?? '').toLowerCase()}`.trim()
  }
  if (it.entrada_estoque != null && Number.isFinite(Number(it.entrada_estoque))) return `entrou ${num3(Number(it.entrada_estoque))} no estoque (qtd do cupom não guardada)`
  return 'qtd não guardada'
}

/**
 * "Ver a foto do cupom" (pedido do Ivan, 07/10): num envio parado, abre a foto DENTRO do cartão, com a lista do que o robô leu ao lado, para
 * ele conferir se a leitura (produto, quantidade, preço) bate com o papel antes de corrigir. A URL é assinada na hora (bucket privado `cupons`,
 * só o admin lê) e vale 10 min — por isso cada abertura pede uma URL nova: reaproveitar a anterior viraria uma imagem quebrada sem aviso.
 */
function FotoDoCupom({ c }: { c: CupomRecente }) {
  const [url, setUrl] = useState<string | null>(null)
  const [aberta, setAberta] = useState(false)
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState('')
  if (!c.foto_path) return null
  async function abrir() {
    if (aberta) { setAberta(false); return }
    setErro('')
    setAbrindo(true)
    try {
      setUrl(await api.urlCupom(c.foto_path!))
      setAberta(true)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui abrir a foto agora.')
    } finally {
      setAbrindo(false)
    }
  }
  return (
    <div className="foto-cupom" data-testid="foto-cupom">
      <button type="button" className="link" disabled={abrindo} onClick={() => void abrir()}>
        {abrindo ? 'Abrindo a foto…' : aberta ? 'Fechar a foto' : '📷 Ver a foto do cupom'}
      </button>
      {erro && <p className="erro" role="alert">Não consegui abrir a foto: {erro}</p>}
      {aberta && url && (
        <figure>
          <img src={url} alt="Foto do cupom fiscal enviada" />
          <figcaption>
            <b>O que o robô leu</b> (confira com a foto):
            <ul data-testid="leitura-robo">
              {c.itens.map((it, i) => {
                const preco = precoDoCupom(it)
                return (
                <li key={i}>
                  <span>{it.descricao_cupom ?? 'item'}</span>
                  <span className="sub">
                    {' · '}{qtdLida(it)}{preco != null && ` · ${formatarReais(preco)}`}
                    {Number(it.desconto_item ?? 0) > 0 && ` · desconto ${formatarReais(Number(it.desconto_item))}`}
                  </span>
                </li>
                )
              })}
            </ul>
            {c.valor_a_pagar != null && c.valor_a_pagar > 0 && <span className="sub">Total lido: {formatarReais(c.valor_a_pagar)}</span>}
          </figcaption>
        </figure>
      )}
    </div>
  )
}

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
  const [expandido, setExpandido] = useState<string | null>(null) // qual "Últimos envios" está aberto mostrando o detalhe
  // Lista de insumos do app para a caixa de correção (escolher o produto de um item pendente). Só é lida quando algum envio parado é corrigível,
  // e UMA vez: a lista muda pouco e cada leitura é pesada (molde: NotaSefaz).
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [catalogoFalhou, setCatalogoFalhou] = useState(false)
  // aviso por cupom depois de "Reenviar para lançar": preso ao id (a lista recarrega e o cupom muda de estado) e mostrado só enquanto ele está na fila
  // — quando vira "lançado ✓" ou volta a REVISAR com outro motivo, o aviso velho contradiria o estado novo
  const [reenviados, setReenviados] = useState<Record<string, AvisoReenvio>>({})

  function carregarRecentes() {
    api.cuponsRecentes()
      .then((r) => { setRecentes(r); setFalhaRecentes(false) })
      .catch(() => setFalhaRecentes(true))
  }
  useEffect(() => { carregarRecentes() }, [])

  // Depois de um envio ou reenvio o cupom fica "na fila" e o robô leva 2 ou 3 minutos: enquanto houver cupom na fila a lista se atualiza sozinha a
  // cada 30 s — sem isso o aviso "em 2 ou 3 minutos ele aparece como lançado" só se cumpriria recarregando a página.
  const naFila = recentes.some((c) => c.estado === 'PENDENTE' || c.estado === 'PROCESSANDO')
  useEffect(() => {
    if (!naFila) return
    const id = setInterval(carregarRecentes, 30_000)
    return () => clearInterval(id)
  }, [naFila])

  const precisaCatalogo = recentes.some(corrigivel)
  useEffect(() => {
    if (!precisaCatalogo || catalogo !== null) return
    let vivo = true
    Promise.resolve(api.catalogoProdutos())
      .then((c) => { if (vivo) { setCatalogo(c ?? []); setCatalogoFalhou(false) } })
      .catch(() => { if (vivo) setCatalogoFalhou(true) })
    return () => { vivo = false }
  }, [precisaCatalogo, catalogo])

  /** O servidor aceitou a correção: guarda o aviso deste cupom e recarrega a lista (ele volta como "na fila"). */
  function aoReenviar(id: string, r: RespostaConfirmacaoCupom) {
    setReenviados((m) => ({ ...m, [id]: avisoDeReenvio(r) }))
    carregarRecentes()
  }

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
      {resultado && (
        <p className={pedeAtencao(resultado) ? 'amarelo' : 'ok'} data-testid="resultado">
          {resultado.estado === 'REVISAR'
            ? <>Cupom recebido, mas NÃO foi lançado: {resultado.resumo}. Veja em “Últimos envios”, logo abaixo, o que está errado e como resolver.</>
            : resultado.resumo}
        </p>
      )}

      <div className="grupo">Últimos envios</div>
      {falhaRecentes && <p className="erro" role="alert">Não consegui carregar os últimos envios.</p>}
      {recentes.length === 0 ? (!falhaRecentes && <p className="sub">Nenhum envio ainda.</p>) : (
        <ul className="recentes">
          {recentes.map((c) => {
            const valor = valorDaLinha(c)
            const aberto = expandido === c.id
            return (
              <li key={c.id} data-testid="cupom-recente">
                <button type="button" className="recente-linha" aria-expanded={aberto}
                  onClick={() => setExpandido(aberto ? null : c.id)}>
                  <span><b>{envioRepetido(c) ? 'já lançado ✓' : ROTULO_ESTADO[c.estado]}</b> · {c.emitente_nome ?? 'cupom'}{valor && ` · ${valor}`}</span>
                  <span className="seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                </button>
                {reenviados[c.id] && (c.estado === 'PENDENTE' || c.estado === 'PROCESSANDO') && (
                  <p className={reenviados[c.id].classe} data-testid="reenviado">{reenviados[c.id].texto}</p>
                )}
                {/* envio repetido de um cupom já lançado: a compra já está no SisChef — concluído, sem bloco de problema, foto nem caixa */}
                {envioRepetido(c) && <p className="sub" data-testid="envio-repetido">Envio repetido: este cupom já tinha sido lançado em outro envio. Nada a fazer.</p>}
                {c.estado === 'REVISAR' && !envioRepetido(c) && <ProblemaDoCupom c={c} />}
                {c.estado === 'REVISAR' && !envioRepetido(c) && <FotoDoCupom c={c} />}
                {corrigivel(c) && (
                  <CorrigirCupom cupom={c} catalogo={catalogo} catalogoFalhou={catalogoFalhou} aoReenviar={(r) => aoReenviar(c.id, r)} />
                )}
                {aberto && <DetalheLancamento pedido={c.pedido_sischef} itens={c.itens.map(linhaDoItem)} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
