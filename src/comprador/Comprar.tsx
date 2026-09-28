import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { errosDaFila, ouvir, pendentes, processar, type Op } from '../lib/fila'
import type { ItemSemana, LinhaCompra, MarcaItem, Resultado, Semana, Usuario } from '../lib/tipos'
import { formatarQtd, formatarReais, nomeCurto } from '../lib/regras'
import { restoDaEtiqueta, textoEtiqueta } from '../cotacao/mensagens'
import { Acompanhamento, marcacoesDaCompra } from './marcacoes'
import EscolherLoja from './EscolherLoja'
import QuadroItem from './QuadroItem'
import FecharCompra from './FecharCompra'

interface CompraAberta { id: string; semanaId: number; loja: string }
const CHAVE_COMPRA = 'compra-aberta'
const CHAVE_CACHE = 'cache-comprar'
const CHAVE_LOJAS = 'lojas-usadas'

function ler<T>(chave: string): T | null {
  try { return JSON.parse(localStorage.getItem(chave) ?? 'null') as T | null } catch { return null }
}
function gravar(chave: string, valor: unknown) {
  try { localStorage.setItem(chave, JSON.stringify(valor)) } catch { /* sem espaço: segue sem cache */ }
}
function apagar(chave: string) {
  try { localStorage.removeItem(chave) } catch { /* ignora */ }
}
const novoId = () => crypto.randomUUID()
/** Operações que mudam qual é a compra aberta: enquanto uma delas está na fila, o servidor ainda não sabe. */
const mudaACompra = (op: Op) => op.tipo === 'abrir_compra' || op.tipo === 'fechar_compra' || op.tipo === 'cancelar_compra'
/**
 * Fase 1B: etiquetas da cotação ("Em cotação com MATEUS — não comprar na loja"). Só informam: se a leitura falhar,
 * a tela segue com as que já tinha (null) e a compra continua normal.
 */
async function lerMarcas(semanaId: number): Promise<MarcaItem[] | null> {
  try { return (await api.marcasDaSemana(semanaId)) ?? [] } catch { return null }
}

export default function Comprar({ usuario }: { usuario: Usuario }) {
  const [dados, setDados] = useState<{ semana: Semana | null; itens: ItemSemana[] } | undefined>()
  const [linhas, setLinhas] = useState<LinhaCompra[]>([])
  const [ops, setOps] = useState<Op[]>([])
  const [lojas, setLojas] = useState<string[]>(() => ler<string[]>(CHAVE_LOJAS) ?? [])
  const [compra, setCompraEstado] = useState<CompraAberta | null>(() => ler<CompraAberta>(CHAVE_COMPRA))
  const [aberto, setAberto] = useState<number | null>(null)
  const [fechando, setFechando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [avisoTroca, setAvisoTroca] = useState('')
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [marcas, setMarcas] = useState<MarcaItem[]>(() => ler<{ marcas?: MarcaItem[] }>(CHAVE_CACHE)?.marcas ?? [])

  // fonte da verdade pra lógica (sem closure velha dentro do useCallback abaixo); `compra` (estado)
  // só existe pra disparar o re-render.
  const compraRef = useRef(compra)
  const definirCompra = useCallback((c: CompraAberta | null) => {
    compraRef.current = c
    setCompraEstado(c)
    if (c) gravar(CHAVE_COMPRA, c); else apagar(CHAVE_COMPRA)
  }, [])

  // uma marcação recém-enviada continua marcada na tela até a busca de linhas confirmar (ou negar)
  const acompRef = useRef<Acompanhamento | null>(null)
  if (!acompRef.current) acompRef.current = new Acompanhamento(usuario.email)
  const acomp = acompRef.current

  // no máximo uma recarga rodando por vez; disparos que chegam no meio viram uma única recarga extra
  const coalesceRef = useRef<{ emAndamento: Promise<void> | null; pendente: boolean }>({ emAndamento: null, pendente: false })

  // tela fechada no meio de uma recarga (ex.: foi para outra rota): a recarga para — não busca nem
  // grava mais nada no celular (compra aberta, cache); quem manda agora é a próxima tela
  const montadaRef = useRef(true)
  useEffect(() => { montadaRef.current = true; return () => { montadaRef.current = false } }, [])

  useEffect(() => { api.nomesEquipe().then(setNomes).catch(() => undefined) }, [])

  const recarregarUmaVez = useCallback(async () => {
    const compraNoInicio = compraRef.current
    // 1) o que já se sabe agora (fila/erros), sem esperar a rede: a tela nunca perde a marca
    const opsImediatos = await pendentes()
    const errosImediatos = await errosDaFila()
    const { linhas: linhasImediatas } = acomp.atualizar(0, opsImediatos, errosImediatos)
    setOps(opsImediatos)
    setLinhas(linhasImediatas)
    if (!montadaRef.current) return

    const pedido = acomp.leitura()
    try {
      const semana = await api.semanaEmCompra()
      const itens = semana ? (await api.itensDaSemana(semana.id)).filter((i) => i.incluido) : []
      const linhasServidor = semana ? await api.linhasDaSemana(semana.id) : []
      const minha = semana ? await api.minhaCompraAberta(semana.id, usuario.email).catch(() => undefined) : undefined
      const marcasLidas = semana ? await lerMarcas(semana.id) : []
      const opsAtuais = await pendentes()
      const errosAtuais = await errosDaFila()
      if (!montadaRef.current) return

      // I2: sem compra local pra esta semana (ou a que tinha já não é mais a aberta do servidor —
      // ex.: o administrador cancelou uma vazia), retoma a compra aberta do próprio comprador.
      // Mas o servidor só manda quando já sabe de tudo: não enquanto a fila tiver (agora ou no
      // começo desta recarga) abrir/fechar/cancelar compra ainda não confirmado, nem se o comprador
      // trocou de compra durante a recarga — aí a resposta já é velha e a próxima recarga decide.
      const filaMudaACompra = opsImediatos.some(mudaACompra) || opsAtuais.some(mudaACompra)
      const atual = compraRef.current
      if (!filaMudaACompra && atual === compraNoInicio) {
        if (semana) {
          if (minha !== undefined) {
            const semCorrespondencia = !atual || atual.semanaId !== semana.id || !minha || minha.id !== atual.id
            if (semCorrespondencia) definirCompra(minha ? { id: minha.id, semanaId: semana.id, loja: minha.loja } : null)
          }
        } else if (atual) {
          definirCompra(null)
        }
      }

      const { linhas } = acomp.atualizar(pedido, opsAtuais, errosAtuais, { linhas: linhasServidor })
      const marcasAgora = marcasLidas ?? ler<{ marcas?: MarcaItem[] }>(CHAVE_CACHE)?.marcas ?? []
      setDados({ semana, itens })
      setMarcas(marcasAgora)
      setOps(opsAtuais)
      setLinhas(linhas)
      gravar(CHAVE_CACHE, { semana, itens, linhas, marcas: marcasAgora })
      const doServidor = await api.lojasUsadas().catch(() => [] as string[])
      setLojas((atuais) => [...new Set([...atuais, ...(doServidor ?? [])])].sort())
    } catch {
      const opsAtuais = await pendentes()
      const errosAtuais = await errosDaFila()
      if (!montadaRef.current) return
      const cache = ler<{ semana: Semana | null; itens: ItemSemana[]; linhas: LinhaCompra[]; marcas?: MarcaItem[] }>(CHAVE_CACHE)
      if (cache) acomp.usarBase(cache.linhas ?? [])
      const { linhas } = acomp.atualizar(pedido, opsAtuais, errosAtuais)
      setDados((atual) => atual ?? { semana: cache?.semana ?? null, itens: cache?.itens ?? [] })
      setOps(opsAtuais)
      setLinhas(linhas)
      gravar(CHAVE_CACHE, { semana: cache?.semana ?? null, itens: cache?.itens ?? [], linhas, marcas: cache?.marcas ?? [] })
    }
  }, [acomp, definirCompra, usuario.email])

  const recarregar = useCallback(async () => {
    const estado = coalesceRef.current
    if (estado.emAndamento) { estado.pendente = true; return estado.emAndamento }
    const rodar = async (): Promise<void> => {
      await recarregarUmaVez()
      if (estado.pendente) { estado.pendente = false; await rodar() }
    }
    const promessa = rodar().finally(() => { estado.emAndamento = null })
    estado.emAndamento = promessa
    return promessa
  }, [recarregarUmaVez])

  useEffect(() => {
    recarregar()
    return ouvir(() => { recarregar() })
  }, [recarregar])

  const minhas = useMemo(() => (compra ? marcacoesDaCompra(compra.id, linhas, ops) : new Map()), [compra, linhas, ops])
  // a etiqueta que cobre só parte do item diz quanto e manda comprar o resto na loja; a sugestão de quantidade
  // do quadro já vem sem a parte coberta (D63)
  const { etiquetas, cobertos } = useMemo(() => {
    const porId = new Map((dados?.itens ?? []).map((i) => [i.id, i]))
    const etiquetas = new Map<number, string>()
    const cobertos = new Map<number, number>()
    for (const m of marcas) {
      const i = porId.get(m.item_semana_id)
      etiquetas.set(m.item_semana_id, textoEtiqueta(m, i))
      if (i && restoDaEtiqueta(m, i.qtd_aprovada) != null) cobertos.set(i.id, Number(m.qtd))
    }
    return { etiquetas, cobertos }
  }, [marcas, dados])

  if (dados === undefined) return <p className="centro">Carregando…</p>
  const semana = dados.semana
  if (!semana) return <p className="vazio">{aviso || 'Nenhuma lista liberada para compra agora.'}</p>

  if (!compra || compra.semanaId !== semana.id) {
    return (
      <>
        {aviso && <p className="faixa">{aviso}</p>}
        <EscolherLoja lojas={lojas} onEscolher={async (loja) => {
          const c = { id: novoId(), semanaId: semana.id, loja: loja.trim().toUpperCase() }
          const todas = [...new Set([...lojas, c.loja])].sort()
          gravar(CHAVE_LOJAS, todas)
          setLojas(todas)
          definirCompra(c)
          setAviso('')
          await api.enviarOp({ id: novoId(), tipo: 'abrir_compra', args: { p_id: c.id, p_semana: c.semanaId, p_loja: c.loja } })
          await recarregar()
        }} />
      </>
    )
  }
  const c = compra

  const totalMarcado = [...minhas.values()].reduce((s, x) => s + x.qtd * (x.preco ?? 0), 0)
  if (fechando) {
    return (
      <FecharCompra loja={c.loja} totalSugerido={totalMarcado} onVoltar={() => setFechando(false)}
        onConfirmar={async (comNota, total, foto) => {
          const guardada = foto ? { dados: await foto.arrayBuffer(), tipo: foto.type || 'image/jpeg' } : undefined
          const opId = novoId()
          await api.enviarOp({ id: opId, tipo: 'fechar_compra', args: { p_compra: c.id, p_com_nota: comNota, p_total: total, p_foto: null }, ...(guardada ? { foto: guardada } : {}) })
          definirCompra(null)
          setFechando(false)
          // dá uma chance do envio acontecer antes de decidir a mensagem (sem travar: se estiver
          // offline o próprio envio falha rápido com ErroRede e a fila mantém a operação)
          await processar(api.executarOp).catch(() => undefined)
          const aindaNaFila = (await pendentes()).some((o) => o.id === opId)
          const falhou = (await errosDaFila()).find((e) => e.op.id === opId) // erro definitivo: não foi
          setAviso(falhou
            ? `Não foi possível fechar a compra: ${falhou.mensagem}`
            : aindaNaFila
              ? 'Compra fechada. Será enviada para aprovação quando a internet voltar.'
              : 'Compra enviada para aprovação do administrador.')
          await recarregar()
        }} />
    )
  }

  // I-3: a operação é registrada no acompanhamento assim que entra na fila — se for enviada antes
  // de uma recarga (já em andamento) ler a fila, a tela continua sabendo dela
  async function marcar(item: ItemSemana, qtd: number, preco: number | null, resultado: Resultado) {
    const op: Op = { id: novoId(), tipo: 'registrar_item', args: { p_id: novoId(), p_compra: c.id, p_item: item.id, p_qtd: qtd, p_preco: preco, p_resultado: resultado } }
    await api.enviarOp(op)
    acomp.entrouNaFila(op)
    setAberto(null)
    setOps(await pendentes())
    void recarregar()
  }
  async function desmarcar(item: ItemSemana) {
    const op: Op = { id: novoId(), tipo: 'desmarcar_item', args: { p_compra: c.id, p_item: item.id } }
    await api.enviarOp(op)
    acomp.entrouNaFila(op)
    setAberto(null)
    setOps(await pendentes())
    void recarregar()
  }

  // I2: só dá pra trocar de loja sem marcar nada ainda; com marca, tem que fechar a compra primeiro
  // (um item marcado na loja errada é corrigido depois pelo administrador na fila).
  async function trocarDeLoja() {
    if (minhas.size > 0) {
      setAvisoTroca('Você já marcou algum item nesta loja. Feche a compra antes de trocar de loja.')
      return
    }
    await api.enviarOp({ id: novoId(), tipo: 'cancelar_compra', args: { p_compra: c.id } })
    definirCompra(null)
    setAvisoTroca('')
    setAviso('')
    await recarregar()
  }

  const grupos: [string, ItemSemana[]][] = [
    ['Bebidas', dados.itens.filter((i) => i.bebida)],
    ['Insumos', dados.itens.filter((i) => !i.bebida)],
  ]
  const feitos = dados.itens.filter((i) => minhas.has(i.id)).length

  return (
    <section>
      <div className="cabecalho">
        <h2>Compra no {c.loja}</h2>
        <button className="link" onClick={trocarDeLoja}>Trocar de loja</button>
      </div>
      {avisoTroca && <p className="erro">{avisoTroca}</p>}
      <div className="sub">{feitos} de {dados.itens.length} itens</div>
      <div className="progresso"><i style={{ width: `${dados.itens.length ? (100 * feitos) / dados.itens.length : 0}%` }} /></div>
      {grupos.map(([titulo, lista]) => lista.length > 0 && (
        <div key={titulo}>
          <div className="grupo">{titulo}</div>
          {lista.map((i) => {
            const minha = minhas.get(i.id)
            const outros = linhas.filter((l) => l.compra_id !== c.id && l.item_semana_id === i.id && l.resultado !== 'nao_achei')
            const qtdOutros = outros.reduce((s, l) => s + Number(l.qtd), 0)
            if (aberto === i.id) {
              return <QuadroItem key={i.id} item={i} marcacao={minha} jaCompradoPorOutros={qtdOutros} etiqueta={etiquetas.get(i.id)}
                cobertoPelaCotacao={cobertos.get(i.id)}
                onConfirmar={(q, p, r) => marcar(i, q, p, r)} onDesmarcar={() => desmarcar(i)} onCancelar={() => setAberto(null)} />
            }
            return (
              <button key={i.id} className={minha ? 'item feito' : 'item'} onClick={() => setAberto(i.id)}>
                <span className={minha ? 'marca on' : 'marca'}>{minha ? '✓' : ''}</span>
                <span>
                  <span className="nome">{i.produto}</span>
                  {etiquetas.has(i.id) && <span className="etiqueta-cotacao" data-testid={`etiqueta-${i.id}`}>{etiquetas.get(i.id)}</span>}
                  <span className="sub" style={{ display: 'block' }}>
                    {minha
                      ? (minha.resultado === 'nao_achei' ? 'Não achei' : `${formatarQtd(minha.qtd, i.unidade)}${minha.preco != null ? ` · ${formatarReais(minha.preco)}` : ''}`)
                      : formatarQtd(i.qtd_aprovada, i.unidade)}
                    {minha?.pendente && ' · aguardando envio'}
                  </span>
                  {outros.length > 0 && (
                    <span className="sub" style={{ display: 'block' }}>
                      {outros.map((l) => `Comprado por ${nomes[l.marcado_por] ?? nomeCurto(l.marcado_por)} (${formatarQtd(Number(l.qtd), i.unidade)})`).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      <div className="rodape">
        <div>
          <button className="botao secundario" style={{ flex: 1 }} onClick={() => setFechando(true)} disabled={minhas.size === 0}>
            Fechar compra desta loja (nota / cupom)
          </button>
        </div>
      </div>
    </section>
  )
}
