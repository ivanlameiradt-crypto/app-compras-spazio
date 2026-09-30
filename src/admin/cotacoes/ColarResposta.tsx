// "Colar resposta" (spec 8.2, item 6 + Fase 2 B.4): o Ivan cola o texto do vendedor, anexa print e/ou marca "é
// transcrição de áudio", e confere antes de gravar. Dois caminhos:
//  - "Ler" (1B): leitor comum, grátis, tabela de sempre; gravação origem 'ivan_colou'.
//  - "Ler com IA": roda o leitor comum antes (grátis); se ele resolveu tudo e não há print, mostra a tabela do Ler
//    (sem custo, origem 'ivan_colou'); senão chama a Edge Function cot-ler-resposta e mostra a PRÉVIA em cartões (um por
//    item, feita para o celular), com marca de "gravar" em cada, e grava com origem 'ivan_ia'. Nada é gravado antes do
//    toque em Gravar. Texto e trechos aparecem como texto (React escapa), nunca como HTML.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../lib/api'
import { mensagemDeErro } from '../../lib/regras'
import type { Cotacao, EntradaItem, ImagemIA, IaStatus, ItemCotacao, UsoIA } from '../../lib/tipos'
import { converter } from '../../cotacao/conversao'
import { lerColagem, type Colagem } from '../../cotacao/leitorTexto'
import { rotuloVendedor } from '../../cotacao/mensagens'
import { reduzirImagem, ErroImagem } from '../../cotacao/imagem'
import {
  entradasParaGravar, juntarLeituras, textoParaIA, type CampoGeral, type EntradaBruta, type LinhaPrevia, type Previa,
} from '../../cotacao/ia'
import { chaveCot, useCotacoes } from './contexto'
import { resumirResultado, useEnvioId } from './DigitarPrecos'
import { colarApagaResposta, comoCotou, cotadoSisChef, reaisPrecisos, respostaGravada, textoAvisoIvan, textoAvisoVendedor } from './formato'
import { entradaDe, linhaDe, type BaseTela, type LinhaTela } from './linhaResposta'

interface EscolhasState {
  marcados: Set<number>; substituir: Set<number>; escolha: Map<number, 'ia' | 'comum'>
  correcoes: Map<number, EntradaBruta>; condicoes: Set<CampoGeral>; corrigindo: Set<number>
}
const escolhasVazias = (): EscolhasState => ({
  marcados: new Set(), substituir: new Set(), escolha: new Map(), correcoes: new Map(), condicoes: new Set(), corrigindo: new Set(),
})

export default function ColarResposta({ c, onFechar }: { c: Cotacao; onFechar: () => void }) {
  const ctx = useCotacoes()
  const itens = useMemo(() => ctx.itensDe(c.id), [ctx, c.id])
  const noEnvio = itens.filter((i) => i.incluido && i.numero != null)
  const vendedor = ctx.vendedor(c.vendedor_id)

  const [texto, setTexto] = useState('')
  const [prints, setPrints] = useState<{ img: ImagemIA; url: string }[]>([])
  const [transcricao, setTranscricao] = useState(false)
  const [erroAnexo, setErroAnexo] = useState('')

  // caminho "Ler" (1B) e o "sem custo" do Ler com IA
  const [lida, setLida] = useState<Colagem | null>(null)
  const [semCusto, setSemCusto] = useState(false)
  const [substituir, setSubstituir] = useState<Set<number>>(() => new Set())

  // caminho IA (cartões)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [esc, setEsc] = useState<EscolhasState>(escolhasVazias)
  const [uso, setUso] = useState<UsoIA | null>(null)
  const [leituraId, setLeituraId] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [erroIA, setErroIA] = useState('')
  const [filtro, setFiltro] = useState<'precisam' | 'todos'>('precisam')
  const abortar = useRef<AbortController | null>(null)

  const [statusIA, setStatusIA] = useState<IaStatus | null | undefined>(undefined)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  const envioId = useEnvioId()

  useEffect(() => { void Promise.resolve(api.iaStatus()).then((s) => setStatusIA(s ?? null)).catch(() => setStatusIA(null)) }, [])
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => {
    if (!carregando) return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [carregando])

  const iaLigada = statusIA != null && statusIA.ligada
  const atual = (numero: number) => noEnvio.find((x) => x.numero === numero)
  const protegido = (numero: number) => { const i = atual(numero); return i != null && colarApagaResposta(i) }

  // ---------- Ler (1B): tabela de sempre
  const aGravarLer = lida ? lida.reconhecidos.filter((e) => !protegido(e.numero) || substituir.has(e.numero)) : []
  const protegidos = lida ? lida.reconhecidos.filter((e) => protegido(e.numero)).length : 0

  function limparPrevias() { setLida(null); setPrevia(null); setSemCusto(false); setErroIA(''); setEsc(escolhasVazias()) }

  function ler() {
    setLida(lerColagem(texto, itens)); setSubstituir(new Set()); setPrevia(null); setSemCusto(false); setErroIA('')
  }

  async function anexarPrint(arquivos: FileList | null) {
    setErroAnexo('')
    if (!arquivos) return
    for (const arq of Array.from(arquivos)) {
      if (prints.length >= 3) { setErroAnexo('No máximo 3 prints por leitura. Leia em duas vezes.'); break }
      try {
        const img = await reduzirImagem(arq)
        setPrints((ps) => (ps.length >= 3 ? ps : [...ps, { img, url: URL.createObjectURL(arq) }]))
      } catch (e) {
        setErroAnexo(e instanceof ErroImagem ? e.message : mensagemDeErro(e))
      }
    }
  }
  function tirarPrint(n: number) { setPrints((ps) => ps.filter((_, k) => k !== n)) }

  // ---------- Ler com IA
  async function lerComIA() {
    if (!iaLigada || !online) return
    limparPrevias()
    const colagem = texto.trim() ? lerColagem(texto, itens) : null
    // o leitor comum resolveu tudo e não há print: a IA não é chamada (B.4, item 3)
    if (colagem && prints.length === 0 && colagem.reconhecidos.length > 0 && colagem.naoEntendidas.length === 0) {
      setLida(colagem); setSubstituir(new Set()); setSemCusto(true); return
    }
    setCarregando(true); setSegundos(0); setErroIA('')
    const ac = new AbortController(); abortar.current = ac
    const cancelar = setTimeout(() => ac.abort(), 140_000)
    try {
      const textoLimpo = texto.trim() && vendedor
        ? textoParaIA(texto, { nome: vendedor.nome, rotulo: rotuloVendedor(vendedor.empresa), empresa: vendedor.empresa })
        : texto.trim() ? texto : null
      // Cotação grande (B.5.3): com mais de 25 itens e o leitor comum tendo lido alguma linha, a IA devolve só os
      // números que ele NÃO leu (os pendentes). Isso encurta a saída e o tempo. Sem colagem (só print) ou com o leitor
      // comum sem ler nada, não há pendentes e a IA lê tudo.
      const reconhecidos = new Set((colagem?.reconhecidos ?? []).map((r) => r.numero))
      const pendentes = noEnvio.length > 25 && reconhecidos.size > 0
        ? noEnvio.map((i) => i.numero!).filter((n) => !reconhecidos.has(n))
        : undefined
      const leitura = await api.lerComIA(c.id, {
        texto: textoLimpo, imagens: prints.map((p) => p.img), transcricao, pendentes,
      }, ac.signal)
      const p = juntarLeituras(itens, colagem, leitura, c, ctx.hoje)
      setPrevia(p); setUso(leitura.uso); setLeituraId(leitura.leitura_id)
      const marcados = new Set(p.linhas.filter((l) => l.marcadoPadrao).map((l) => l.numero))
      const condicoes = new Set(p.condicoes.filter((cd) => cd.marcadoPadrao).map((cd) => cd.campo))
      setEsc({ ...escolhasVazias(), marcados, condicoes })
      setFiltro(p.linhas.some((l) => !l.marcadoPadrao) ? 'precisam' : 'todos')
    } catch (e) {
      setErroIA(mensagemDeErro(e))
    } finally {
      clearTimeout(cancelar); setCarregando(false); abortar.current = null
    }
  }

  // ---------- Gravar (Ler / sem custo → ivan_colou)
  async function gravarLer() {
    if (aGravarLer.length === 0) return
    const envio = aGravarLer
    const id = envioId.para(envio)
    await ctx.acao(chaveCot(c), async () => {
      const r = await api.responderComoAdmin(c.id, id, envio, null, 'ivan_colou')
      ctx.mudarSessao(c.id, { resultado: resumirResultado(r, itens) })
      onFechar()
    })
  }

  // ---------- Gravar (IA → ivan_ia)
  const paraGravar = previa ? entradasParaGravar(previa, esc, itens, c) : null
  async function gravarIA() {
    if (!previa || !paraGravar || paraGravar.itens.length === 0) return
    const id = envioId.para({ itens: paraGravar.itens, gerais: paraGravar.gerais })
    await ctx.acao(chaveCot(c), async () => {
      const r = await api.responderComoAdmin(c.id, id, paraGravar.itens, paraGravar.gerais, 'ivan_ia')
      ctx.mudarSessao(c.id, { resultado: resumirResultado(r, itens) })
      if (leituraId != null) void api.iaGravada(leituraId, id, paraGravar.resumo).catch(() => undefined)
      onFechar()
    })
  }

  const alterarEsc = (f: (e: EscolhasState) => void) => setEsc((e) => { const n = { ...e, marcados: new Set(e.marcados), substituir: new Set(e.substituir), escolha: new Map(e.escolha), correcoes: new Map(e.correcoes), condicoes: new Set(e.condicoes), corrigindo: new Set(e.corrigindo) }; f(n); return n })

  const motivoIaDesabilitada = statusIA === undefined ? 'Carregando…' : !iaLigada ? 'Leitura com IA desligada' : !online ? 'Sem internet: use Ler (sem IA)' : ''

  return (
    <div className="formulario" data-testid="colar-resposta">
      <div className="nome">Colar resposta — v{c.versao}</div>
      <p className="sub">
        Cole a mensagem do vendedor ou a transcrição do áudio, ou anexe o print. Vale o número do item, não a ordem das
        linhas. Prints muito compridos perdem nitidez: prefira 2 ou 3.
      </p>
      <textarea aria-label="Resposta colada" rows={8} value={texto} onChange={(e) => { setTexto(e.target.value); limparPrevias() }} />

      <div className="acoes" style={{ flexWrap: 'wrap' }}>
        <label className="botao secundario" style={{ cursor: 'pointer' }}>
          Anexar print
          <input type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { void anexarPrint(e.target.files); e.target.value = '' }} />
        </label>
        <label className="marcar">
          <input type="checkbox" checked={transcricao} onChange={(e) => setTranscricao(e.target.checked)} />
          É transcrição de áudio (o WhatsApp transcreveu)
        </label>
      </div>
      {prints.length > 0 && (
        <div className="prints" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {prints.map((p, n) => (
            <div key={n} style={{ textAlign: 'center' }}>
              <img src={p.url} alt={`print ${n + 1}`} style={{ maxWidth: 80, maxHeight: 80, borderRadius: 6 }} />
              <div><button className="link" onClick={() => tirarPrint(n)}>Tirar</button></div>
            </div>
          ))}
        </div>
      )}
      {erroAnexo && <p className="erro">{erroAnexo}</p>}

      <div className="acoes" style={{ flexWrap: 'wrap' }}>
        <button className="botao secundario" disabled={carregando || (!texto.trim() && prints.length === 0)} onClick={ler}>Ler</button>
        <button className="botao secundario" data-testid="ler-ia" disabled={carregando || !!motivoIaDesabilitada || (!texto.trim() && prints.length === 0)}
          title={motivoIaDesabilitada} onClick={() => void lerComIA()}>Ler com IA</button>
        <button className="botao secundario" onClick={onFechar}>Fechar</button>
      </div>
      {motivoIaDesabilitada && <p className="sub">{motivoIaDesabilitada}</p>}
      {carregando && (
        <p className="sub" data-testid="lendo-ia">Lendo com IA… {segundos} s
          <button className="link" style={{ marginLeft: 8 }} onClick={() => abortar.current?.abort()}>Cancelar</button>
        </p>
      )}
      {erroIA && <p className="erro" role="alert">{erroIA}</p>}

      {/* ---------- caminho Ler (1B) e o sem-custo do Ler com IA ---------- */}
      {lida && <TabelaLer lida={lida} noEnvio={noEnvio} c={c} substituir={substituir} setSubstituir={setSubstituir}
        atual={atual} protegido={protegido} aGravar={aGravarLer} protegidos={protegidos} semCusto={semCusto}
        ocupado={ctx.ocupado} gravar={gravarLer} agora={ctx.agora} />}

      {/* ---------- caminho IA (cartões, celular) ---------- */}
      {previa && <PreviaIA previa={previa} esc={esc} alterarEsc={alterarEsc} filtro={filtro} setFiltro={setFiltro}
        c={c} uso={uso} paraGravar={paraGravar} ocupado={ctx.ocupado} gravar={gravarIA} agora={ctx.agora} />}
    </div>
  )
}

// ---------- Tabela do Ler (comportamento da 1B, com a linha "sem custo" quando o Ler com IA resolveu sozinho)
function TabelaLer({ lida, noEnvio, c, substituir, setSubstituir, atual, protegido, aGravar, protegidos, semCusto, ocupado, gravar, agora }: {
  lida: Colagem; noEnvio: ItemCotacao[]
  c: Cotacao; substituir: Set<number>; setSubstituir: (f: (s: Set<number>) => Set<number>) => void
  atual: (n: number) => ItemCotacao | undefined; protegido: (n: number) => boolean
  aGravar: EntradaItem[]; protegidos: number; semCusto: boolean; ocupado: boolean
  gravar: () => void; agora: Date
}) {
  function marcar(numero: number, sim: boolean) {
    setSubstituir((atuais) => { const novo = new Set(atuais); if (sim) novo.add(numero); else novo.delete(numero); return novo })
  }
  return (
    <>
      {semCusto && <p className="sub" data-testid="sem-custo">O leitor comum entendeu tudo; a IA não foi usada (sem custo).</p>}
      <p data-testid="contagem">
        {lida.reconhecidos.length} de {noEnvio.length} itens reconhecidos
        {lida.naoEntendidas.length > 0 ? '; linhas não entendidas:' : ''}
      </p>
      {lida.naoEntendidas.length > 0 && <ul className="nao-entendidas">{lida.naoEntendidas.map((l, n) => <li key={n}>{l}</li>)}</ul>}
      {lida.foraDaVersao.map((n) => <p key={n} className="erro">item {n} não está na v{c.versao}</p>)}
      {protegidos > 0 && (
        <p className="aviso" data-testid="aviso-substituir">
          {protegidos === 1 ? 'Um item já tem resposta' : `${protegidos} itens já têm resposta`} pelo link ou com "tem só",
          "a partir de", similar ou marca (veja "Antes"). Gravar por cima apaga o que o texto colado não traz: esses itens
          só são gravados se você marcar "substituir".
        </p>
      )}
      {lida.reconhecidos.length > 0 && (
        <div className="rolagem">
          <table className="tabela-cot">
            <thead><tr><th>nº</th><th>Item</th><th>Linha</th><th>Resposta</th><th>Cotado</th><th>Antes</th><th>Avisos</th></tr></thead>
            <tbody>
              {lida.reconhecidos.map((e) => {
                const i = atual(e.numero)!
                const conta = converter(i, e)
                const como = { ...i, estado: e.estado, preco_digitado: e.preco ?? null, base: e.base ?? null,
                  emb_unidades: e.emb_unidades ?? null, emb_gramas: e.emb_gramas ?? null, emb_ml: e.emb_ml ?? null }
                const horas = lida.horas[e.numero] ?? []
                const apaga = colarApagaResposta(i)
                return (
                  <tr key={e.numero} data-testid={`colar-item-${e.numero}`}>
                    <td>{e.numero}</td>
                    <td>{i.nome}</td>
                    <td data-testid={`linha-colada-${e.numero}`}>
                      {(lida.linhas[e.numero] ?? []).map((l, n) => (
                        <div key={n}>{horas[n] ? <span className="sub">[{horas[n]}] </span> : null}{l}</div>
                      ))}
                    </td>
                    <td>{comoCotou(como)}</td>
                    <td>{cotadoSisChef({ estado: e.estado, preco_convertido: conta.preco_convertido, unidade: i.unidade })}</td>
                    <td data-testid={`antes-${e.numero}`}>{respostaGravada(i, agora)}</td>
                    <td>
                      {[...conta.avisos_vendedor.map(textoAvisoVendedor), ...conta.avisos_ivan.map((a) => textoAvisoIvan(a, { ...i, fator_informado: conta.fator_informado }))]
                        .map((t) => <span key={t} className="pill">{t}</span>)}
                      {apaga && (
                        <>
                          <span className="pill">{i.origem === 'vendedor' ? 'substitui a resposta do link' : 'substitui a resposta gravada'}</span>
                          <label className="marcar">
                            <input type="checkbox" checked={substituir.has(e.numero)}
                              aria-label={`Substituir a resposta gravada do item ${e.numero}`}
                              onChange={(ev) => marcar(e.numero, ev.target.checked)} />
                            substituir
                          </label>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="acoes">
        <button className="botao" disabled={ocupado || aGravar.length === 0} onClick={gravar}>
          Gravar {aGravar.length} {aGravar.length === 1 ? 'item' : 'itens'}
        </button>
      </div>
    </>
  )
}

// ---------- Prévia com IA (cartões, para o celular)
function PreviaIA({ previa, esc, alterarEsc, filtro, setFiltro, c, uso, paraGravar, ocupado, gravar, agora }: {
  previa: Previa; esc: EscolhasState; alterarEsc: (f: (e: EscolhasState) => void) => void
  filtro: 'precisam' | 'todos'; setFiltro: (f: 'precisam' | 'todos') => void; c: Cotacao; uso: UsoIA | null
  paraGravar: ReturnType<typeof entradasParaGravar> | null; ocupado: boolean; gravar: () => void; agora: Date
}) {
  const precisam = previa.linhas.filter((l) => !esc.marcados.has(l.numero) || l.duasOpcoes || l.certeza !== 'alta')
  const visiveis = filtro === 'precisam' && precisam.length > 0 ? precisam : previa.linhas
  const marcadas = paraGravar ? paraGravar.itens.length : 0
  const condMarcadas = esc.condicoes.size

  const alternar = (numero: number, l: LinhaPrevia) => {
    if (l.protegido) return // só o "substituir" marca o item protegido
    alterarEsc((e) => { if (e.marcados.has(numero)) e.marcados.delete(numero); else e.marcados.add(numero) })
  }

  return (
    <div className="previa-ia" data-testid="previa-ia" style={{ maxWidth: 360 }}>
      <p className="resumo" data-testid="resumo-ia">
        IA leu {previa.linhas.length} {previa.linhas.length === 1 ? 'item' : 'itens'} · {marcadas} marcados
        {precisam.length > 0 ? ` · ${precisam.length} para conferir` : ''}
        {previa.naoEntendidos.length > 0 ? ` · ${previa.naoEntendidos.length} trecho(s) não entendido(s)` : ''}
      </p>
      {previa.linhas.length > 0 && (
        <div className="acoes" style={{ flexWrap: 'wrap' }}>
          <button className={`botao secundario ${filtro === 'precisam' ? 'ativo' : ''}`} onClick={() => setFiltro('precisam')}>
            Só os que precisam de você ({precisam.length})
          </button>
          <button className={`botao secundario ${filtro === 'todos' ? 'ativo' : ''}`} onClick={() => setFiltro('todos')}>
            Todos ({previa.linhas.length})
          </button>
        </div>
      )}
      {previa.foraDaVersao.map((n) => <p key={n} className="erro">item {n} não está na v{c.versao}</p>)}
      {previa.naoEntendidos.length > 0 && (
        <div className="nao-entendidos">
          <div className="grupo">Trechos não entendidos</div>
          <ul>{previa.naoEntendidos.map((n, k) => <li key={k}>{n.trecho} — <span className="sub">{n.motivo}</span></li>)}</ul>
        </div>
      )}

      {visiveis.map((l) => (
        <Cartao key={l.numero} l={l} esc={esc} alterarEsc={alterarEsc} alternar={alternar} agora={agora} />
      ))}

      {previa.condicoes.length > 0 && (
        <div className="condicoes">
          <div className="grupo">Condições que a IA leu</div>
          {previa.condicoes.map((cd) => (
            <label key={cd.campo} className="marcar" style={{ display: 'block' }}>
              <input type="checkbox" checked={esc.condicoes.has(cd.campo)}
                aria-label={`Gravar condição ${cd.campo}`}
                onChange={(ev) => alterarEsc((e) => { if (ev.target.checked) e.condicoes.add(cd.campo); else e.condicoes.delete(cd.campo) })} />
              {cd.campo}: {String(cd.valor)} <span className="sub">— {cd.trecho}{cd.aviso ? ` (${cd.aviso})` : ''}</span>
            </label>
          ))}
        </div>
      )}

      <p className="sub legenda">
        Marcados vão ser gravados. Desmarcados ficam de fora: confira e marque, ou deixe para Digitar preços. Nada é
        gravado antes de Gravar.
      </p>
      {uso && (
        <p className="sub" data-testid="uso-ia">
          IA hoje: {uso.hoje} de {uso.limite_dia} · no mês: {uso.mes} de {uso.limite_mes} · ≈ US$ {uso.custo_mes_usd.toFixed(2)}
        </p>
      )}
      <div className="acoes gravar-fixo" style={{ position: 'sticky', bottom: 0, background: 'var(--fundo, #fff)', paddingTop: 8 }}>
        <button className="botao" data-testid="gravar-ia" disabled={ocupado || marcadas === 0} onClick={gravar}>
          Gravar {marcadas} {marcadas === 1 ? 'item' : 'itens'}{condMarcadas > 0 ? ` e ${condMarcadas} ${condMarcadas === 1 ? 'condição' : 'condições'}` : ''}
        </button>
      </div>
    </div>
  )
}

function Cartao({ l, esc, alterarEsc, alternar, agora }: {
  l: LinhaPrevia; esc: EscolhasState; alterarEsc: (f: (e: EscolhasState) => void) => void
  alternar: (n: number, l: LinhaPrevia) => void; agora: Date
}) {
  const marcado = esc.marcados.has(l.numero)
  const substituir = esc.substituir.has(l.numero)
  const corrigindo = esc.corrigindo.has(l.numero)
  const entradaExibir = esc.correcoes.get(l.numero) ?? l.entrada
  const conta = converter(l.item, { numero: l.numero, rev_lida: l.item.rev, ...entradaExibir })
  const como = { ...l.item, estado: entradaExibir.estado, preco_digitado: entradaExibir.preco ?? null, base: entradaExibir.base ?? null,
    emb_unidades: entradaExibir.emb_unidades ?? null, emb_gramas: entradaExibir.emb_gramas ?? null, emb_ml: entradaExibir.emb_ml ?? null }

  return (
    <div className={`cartao-ia ${marcado ? 'marcado' : ''}`} data-testid={`cartao-ia-${l.numero}`}
      style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div className="topo" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}
        onClick={() => alternar(l.numero, l)} role="button" tabIndex={0}>
        <b>{l.numero} · {l.item.nome}</b>
        {!l.protegido && (
          <input type="checkbox" checked={marcado} aria-label={`Gravar item ${l.numero}`} style={{ width: 22, height: 22 }}
            onChange={() => alternar(l.numero, l)} onClick={(e) => e.stopPropagation()} />
        )}
      </div>
      {l.protegido && (
        <div className="protegido">
          <span className="pill">substitui a resposta do link</span>
          <label className="marcar">
            <input type="checkbox" checked={substituir} aria-label={`Substituir a resposta do link do item ${l.numero}`}
              onChange={(ev) => alterarEsc((e) => {
                if (ev.target.checked) { e.substituir.add(l.numero); e.marcados.add(l.numero) }
                else { e.substituir.delete(l.numero); e.marcados.delete(l.numero) }
              })} />
            substituir a resposta do link
          </label>
        </div>
      )}
      <div className="trecho sub" data-testid={`trecho-${l.numero}`}>
        {l.fonte === 'imagem' ? <span className="sub">lido no print: </span> : null}{l.trecho}
        {l.linhasColadas.map((lc, n) => <div key={n}>{lc}</div>)}
      </div>
      <div className="lido-cotado">
        {comoCotou(como)} → {cotadoSisChef({ estado: entradaExibir.estado, preco_convertido: conta.preco_convertido, unidade: l.item.unidade })}
        {l.item.ref_preco != null && <div className="sub">antes: {reaisPrecisos(Number(l.item.ref_preco))}/{l.item.unidade}</div>}
      </div>
      <div className="pills">{l.avisos.map((t) => <span key={t} className="pill">{t}</span>)}</div>
      {l.duasOpcoes && (
        <div className="discorda" data-testid={`discorda-${l.numero}`}>
          <button className={`botao secundario ${esc.escolha.get(l.numero) === 'ia' ? 'ativo' : ''}`}
            disabled={l.protegido}
            onClick={() => alterarEsc((e) => { e.escolha.set(l.numero, 'ia'); if (!l.protegido) e.marcados.add(l.numero) })}>
            IA: {l.duasOpcoes.ia.rotulo}
          </button>
          <button className={`botao secundario ${esc.escolha.get(l.numero) === 'comum' ? 'ativo' : ''}`}
            disabled={l.protegido}
            onClick={() => alterarEsc((e) => { e.escolha.set(l.numero, 'comum'); if (!l.protegido) e.marcados.add(l.numero) })}>
            Leitor comum: {l.duasOpcoes.comum.rotulo}
          </button>
        </div>
      )}
      <div className="acoes">
        <button className="link" onClick={() => alterarEsc((e) => { if (e.corrigindo.has(l.numero)) e.corrigindo.delete(l.numero); else e.corrigindo.add(l.numero) })}>
          {corrigindo ? 'Fechar' : 'Corrigir'}
        </button>
      </div>
      {corrigindo && <Corrigir l={l} entradaAtual={entradaExibir} alterarEsc={alterarEsc} />}
    </div>
  )
}

// "Corrigir": os campos do Digitar preços para aquele item, um embaixo do outro. Corrigir marca o cartão (menos no
// protegido, que só entra com "substituir"). A correção fica guardada em escolhas.correcoes.
function Corrigir({ l, entradaAtual, alterarEsc }: {
  l: LinhaPrevia; entradaAtual: EntradaBruta; alterarEsc: (f: (e: EscolhasState) => void) => void
}) {
  const [linha, setLinha] = useState<LinhaTela>(() => linhaDe({ ...l.item, ...entradaBrutaParaItem(entradaAtual) }))
  const opcoes: [BaseTela, string][] = l.item.unidade === 'un'
    ? [['un', l.item.rotulo === 'saco' ? '1 saco' : '1 un'], ['emb_un', 'fardo/caixa com ___ un']]
    : [['kg', '1 kg'], ['emb_g', 'embalagem de ___ g'], ['litro', '1 L'], ['emb_ml', 'embalagem de ___ ml']]
  function aplicar(l2: LinhaTela) {
    setLinha(l2)
    const bruta = entradaDe(l2, l.item.unidade)
    alterarEsc((e) => { e.correcoes.set(l.numero, bruta); if (!l.protegido) e.marcados.add(l.numero) })
  }
  const mudar = (p: Partial<LinhaTela>) => aplicar({ ...linha, ...p })
  return (
    <div className="campos" data-testid={`corrigir-${l.numero}`} style={{ display: 'grid', gap: 6 }}>
      <select aria-label={`Resposta do item ${l.numero}`} value={linha.estado} onChange={(e) => mudar({ estado: e.target.value as LinhaTela['estado'] })}>
        <option value="sem_resposta">— sem resposta</option>
        <option value="tem">tem</option>
        <option value="nao_tem">não tem</option>
      </select>
      {linha.estado === 'tem' && (
        <>
          <input aria-label={`Preço do item ${l.numero}`} inputMode="decimal" placeholder="R$" value={linha.preco} onChange={(e) => mudar({ preco: e.target.value })} />
          <select aria-label={`Esse preço é de (item ${l.numero})`} value={linha.base} onChange={(e) => mudar({ base: e.target.value as BaseTela, emb: '' })}>
            {opcoes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          {linha.base.startsWith('emb_') && (
            <input aria-label={`Quanto vem na embalagem (item ${l.numero})`} inputMode="decimal"
              placeholder={linha.base === 'emb_un' ? 'un' : linha.base === 'emb_g' ? 'g' : 'ml'} value={linha.emb} onChange={(e) => mudar({ emb: e.target.value })} />
          )}
          <input aria-label={`Marca do item ${l.numero}`} placeholder="Marca" maxLength={60} value={linha.marca} onChange={(e) => mudar({ marca: e.target.value })} />
          <input aria-label={`Tenho só (item ${l.numero})`} placeholder="Tenho só" inputMode="decimal" value={linha.tenhoSo} onChange={(e) => mudar({ tenhoSo: e.target.value })} />
          <input aria-label={`A partir de (item ${l.numero})`} placeholder="A partir de" inputMode="decimal" value={linha.aPartirDe} onChange={(e) => mudar({ aPartirDe: e.target.value })} />
        </>
      )}
    </div>
  )
}

/** EntradaBruta → os campos de ItemCotacao que linhaDe() lê (para pré-preencher o Corrigir). */
function entradaBrutaParaItem(e: EntradaBruta): Partial<ItemCotacao> {
  return {
    estado: e.estado, preco_digitado: e.preco ?? null, base: e.base ?? null,
    emb_unidades: e.emb_unidades ?? null, emb_gramas: e.emb_gramas ?? null, emb_ml: e.emb_ml ?? null,
    tenho_so: e.tenho_so ?? null, a_partir_de: e.a_partir_de ?? null,
    similar_desc: e.similar_desc ?? null, similar_preco: e.similar_preco ?? null, marca_informada: e.marca ?? null,
  }
}
