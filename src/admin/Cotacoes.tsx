// Aba Cotações (spec 8.2, Fase 1B): a semana em compra dividida por vendedor, do maior valor estimado para o menor, e
// abaixo as cotações de semanas anteriores ainda vivas (ou fechadas sem resultado há menos de 7 dias). Ao abrir, a cada
// 30 s com a aba visível e no botão Atualizar: sempre cot_preparar (idempotente) e depois as leituras.
// Nenhum window.open depois de await (Safari/iOS e o App instalado bloqueiam, como em Lançamentos): ação que grava e
// depois abre o WhatsApp é feita em dois toques, e o segundo é um <a href="https://wa.me/…"> de verdade.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { formatarData, mensagemDeErro } from '../lib/regras'
import type {
  Cotacao, ItemAtravessado, ItemCotacao, ItemForaDaCotacao, ItemSemana, Pedido, Preparo, ResumoCotacao, Semana, Vendedor,
} from '../lib/tipos'
import {
  dadosEnvioDe, ddmm, diaCurto, horaBr, horaLocal, linkCotacao, mensagemCotacao, numeroBr, rotuloVendedor,
} from '../cotacao/mensagens'
import CartaoVendedor, { AvisoTamanho, preparadaEm } from './cotacoes/CartaoVendedor'
import Chaves from './cotacoes/Chaves'
import { chaveCot, ContextoCotacoes, useCotacoes, type Contexto, type Sessao } from './cotacoes/contexto'
import { BotoesCopiar, LinkWhatsApp } from './cotacoes/Copiar'
import { prontaSemSinal } from './cotacoes/estado'
import { textoMotivo } from './cotacoes/formato'

const INTERVALO = 30_000

interface Dados {
  semana: Semana | null
  preparo: Preparo | null
  vendedores: Vendedor[]
  daSemana: Cotacao[]
  anteriores: Cotacao[]
  /** as que alguma anterior substituiu: não aparecem, mas dão o sinal de envio e o "substitui a v1" da substituta */
  substituidas: Cotacao[]
  itens: ItemCotacao[]
  resumos: ResumoCotacao[]
  codigos: Record<number, string>
  pedidos: Record<number, Pedido | null>
  itensSemana: ItemSemana[]
  atualizadoEm: Date
}

/**
 * `retidas` (id da cotação → semana): cotações de semanas anteriores em que o Ivan acabou de gravar o pedido ou o
 * "Obrigado". Elas saem da lista das vivas, mas a tela precisa delas até o segundo toque (o link do WhatsApp).
 */
async function lerTudo(retidas: Map<number, number>): Promise<Dados> {
  const semana = await api.semanaEmCompra()
  const preparo = semana ? await api.prepararCotacoes(semana.id) : null
  const [vendedores, daSemana, vivas, itensSemana] = await Promise.all([
    api.listarVendedores(),
    semana ? api.cotacoesDaSemana(semana.id) : Promise.resolve([] as Cotacao[]),
    api.cotacoesAnterioresVivas(semana ? semana.id : null),
    semana ? api.itensDaSemana(semana.id) : Promise.resolve([] as ItemSemana[]),
  ])
  const faltando = [...retidas].filter(([id, s]) => s !== semana?.id && !(vivas ?? []).some((c) => c.id === id))
  const extras = faltando.length === 0 ? [] : (await Promise.all([...new Set(faltando.map(([, s]) => s))]
    .map((s) => api.cotacoesDaSemana(s)))).flat().filter((c) => faltando.some(([id]) => id === c.id))
  const anteriores = [...(vivas ?? []), ...extras]
  const visiveis = [...daSemana, ...anteriores].filter((c) => c.status !== 'cancelada' && c.status !== 'substituida')
  const ids = visiveis.map((c) => c.id)
  // a v1 que a v2 de uma semana anterior substituiu não vem nas vivas (a da semana em compra vem inteira em daSemana):
  // sem ela, a v2 pareceria "sem sinal de envio" e a mensagem dela perderia o "substitui a v1"
  const [itens, resumos, codigos, substituidas] = await Promise.all([
    api.itensDasCotacoes(ids), api.resumosDasCotacoes(ids), api.codigosDasCotacoes(ids),
    api.cotacoesSubstituidasPor(anteriores.map((c) => c.id)),
  ])
  const pedidos = Object.fromEntries(await Promise.all(
    visiveis.filter((c) => c.resultado === 'pedido').map(async (c) => [c.id, await api.pedidoDaCotacao(c.id)] as const),
  ))
  return {
    semana, preparo, vendedores: vendedores ?? [], daSemana: daSemana ?? [], anteriores: anteriores ?? [],
    substituidas: substituidas ?? [], itens: itens ?? [],
    resumos: resumos ?? [], codigos: codigos ?? {}, pedidos, itensSemana: itensSemana ?? [], atualizadoEm: new Date(),
  }
}

export default function Cotacoes() {
  const [dados, setDados] = useState<Dados | undefined>()
  const [erroCarga, setErroCarga] = useState('')
  const [sessoes, setSessoes] = useState<Record<number, Sessao>>({})
  const [erros, setErros] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  // tela fechada no meio de uma leitura: a leitura para de mexer no estado
  const montada = useRef(true)
  // cotações de semanas anteriores com pedido/"Obrigado" gravado nesta sessão (ver lerTudo)
  const retidas = useRef(new Map<number, number>())
  const ultimos = useRef<Dados | undefined>(undefined)
  // no máximo uma leitura por vez; pedidos que chegam no meio viram uma única leitura extra
  const leitura = useRef<{ emAndamento: Promise<void> | null; pendente: boolean }>({ emAndamento: null, pendente: false })

  const lerUmaVez = useCallback(async () => {
    try {
      const d = await lerTudo(retidas.current)
      if (!montada.current) return
      ultimos.current = d
      setDados(d)
      setErroCarga('')
    } catch (e) {
      if (!montada.current) return
      setErroCarga(mensagemDeErro(e))
      setDados((atual) => atual ?? {
        semana: null, preparo: null, vendedores: [], daSemana: [], anteriores: [], substituidas: [], itens: [], resumos: [], codigos: {},
        pedidos: {}, itensSemana: [], atualizadoEm: new Date(),
      })
    }
  }, [])

  const atualizar = useCallback(async () => {
    const estado = leitura.current
    if (estado.emAndamento) { estado.pendente = true; return estado.emAndamento }
    const rodar = async (): Promise<void> => {
      await lerUmaVez()
      if (estado.pendente) { estado.pendente = false; await rodar() }
    }
    const p = rodar().finally(() => { estado.emAndamento = null })
    estado.emAndamento = p
    return p
  }, [lerUmaVez])

  useEffect(() => {
    montada.current = true
    void atualizar()
    // sozinha a cada 30 s enquanto a aba está visível (aba escondida não gasta chamada ao banco)
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void atualizar() }, INTERVALO)
    return () => { montada.current = false; clearInterval(t) }
  }, [atualizar])

  const mudarSessao = useCallback((id: number, s: Partial<Sessao>) => {
    if (s.pedido || s.obrigado) {
      const c = ultimos.current?.anteriores.find((x) => x.id === id)
      if (c) retidas.current.set(id, c.semana_id)
    }
    setSessoes((atual) => ({ ...atual, [id]: { ...atual[id], ...s } }))
  }, [])

  const acao = useCallback(async (chave: string, f: () => Promise<void>) => {
    setOcupado(true)
    setErros((e) => ({ ...e, [chave]: '' }))
    try {
      await f()
    } catch (e) {
      setErros((x) => ({ ...x, [chave]: mensagemDeErro(e) }))
    } finally {
      setOcupado(false)
    }
    await atualizar()
  }, [atualizar])

  const ctx = useMemo<Contexto | null>(() => {
    if (!dados) return null
    const vendedores = new Map(dados.vendedores.map((v) => [v.id, v]))
    // todas as lidas, as substituídas inclusive (comSinalDeEnvio e substituiVersao procuram quem aponta para a cotação)
    const todas = [...dados.daSemana, ...dados.anteriores, ...dados.substituidas]
    const itensPorCotacao = new Map<number, ItemCotacao[]>()
    for (const i of dados.itens) itensPorCotacao.set(i.cotacao_id, [...(itensPorCotacao.get(i.cotacao_id) ?? []), i])
    const resumos = new Map(dados.resumos.map((r) => [r.cotacao_id, r]))
    const itensSemana = new Map(dados.itensSemana.map((i) => [i.id, i]))
    const substituiVersao = (id: number) => todas.find((x) => x.substituida_por === id)?.versao ?? null
    const itensDe = (id: number) => itensPorCotacao.get(id) ?? []
    const codigo = (id: number) => dados.codigos[id] ?? null
    const agora = dados.preparo ? new Date(dados.preparo.agora) : dados.atualizadoEm
    const c: Contexto = {
      agora,
      hoje: horaLocal(agora).data,
      semanaEmCompra: dados.semana,
      preparo: dados.preparo,
      vendedor: (id) => vendedores.get(id),
      vendedoresAtivos: dados.vendedores.filter((v) => v.ativo),
      itensDe,
      resumo: (id) => resumos.get(id),
      codigo,
      pedido: (id) => dados.pedidos[id] ?? null,
      itemSemana: (id) => itensSemana.get(id),
      substituiVersao,
      semSinal: (cot) => prontaSemSinal(cot, itensDe(cot.id), todas),
      // passado o fechamento, a mensagem guardada aqui não vale mais (o vendedor abriria "Cotação encerrada"): sem sinal,
      // a cotação cai no "Não enviada?", só com Desfazer ou Cancelar (spec 5.2); com sinal, no cartão de sempre
      preparadaAqui: (cot) => {
        const d = sessoes[cot.id]?.dados
        return cot.status === 'pronta' && d != null && d.codigo === codigo(cot.id) &&
          !!cot.fechamento && agora < new Date(cot.fechamento)
      },
      dadosDe: (cot) => {
        const v = vendedores.get(cot.vendedor_id)
        if (!v) return null
        return dadosEnvioDe(cot, itensDe(cot.id), v, codigo(cot.id), {
          data_referencia: cot.semana_id === dados.semana?.id ? dados.semana.data_referencia : undefined,
          substitui_versao: substituiVersao(cot.id),
        })
      },
      sessao: (id) => sessoes[id] ?? {},
      mudarSessao,
      ocupado,
      erro: (chave) => erros[chave] ?? '',
      acao,
      preparar: (cot) => acao(chaveCot(cot), async () => {
        const d = await api.congelarCotacao(cot.id)
        // um "link novo" de antes (Trocar link e depois Desfazer) morreu com o Preparar: sai da tela
        mudarSessao(cot.id, { dados: d, saude: await checarSaude(d.codigo, d.itens.length), abriu: false, linkNovo: undefined })
      }),
      checarDeNovo: (cot) => acao(chaveCot(cot), async () => {
        const d = sessoes[cot.id]?.dados
        if (d) mudarSessao(cot.id, { saude: await checarSaude(d.codigo, d.itens.length) })
      }),
    }
    return c
  }, [dados, sessoes, erros, ocupado, acao, mudarSessao])

  if (!dados || !ctx) return <p className="centro">Carregando…</p>
  const { semana, preparo } = dados

  return (
    <ContextoCotacoes.Provider value={ctx}>
      <section className="cotacoes">
        <div className="cabecalho">
          <h2>Cotações{semana ? ` · semana ${formatarData(semana.data_referencia)}` : ''}</h2>
          <a className="link" href="#/historico">Histórico</a>
          <button className="botao secundario" disabled={ocupado} onClick={() => void atualizar()}>Atualizar</button>
        </div>
        {erroCarga && <p className="erro" role="alert">Não consegui atualizar: {erroCarga}</p>}
        {erros.geral && <p className="erro" role="alert">{erros.geral}</p>}
        {!semana && <p className="vazio">Aprove a lista da semana para montar as cotações.</p>}
        {semana && preparo && <SemanaEmCompra dados={dados} preparo={preparo} />}
        {/* sem semana em compra (a anterior encerrada, a nova ainda não aprovada), a pronta sem sinal de uma semana
            anterior ainda precisa do "Já enviei", do "Desfazer" e do WhatsApp: o cartão dela manda para cá */}
        {!(semana && preparo) && <NaoEnviadas cotacoes={[...dados.daSemana, ...dados.anteriores]} />}
        {dados.anteriores.filter((c) => c.status !== 'cancelada' && c.status !== 'substituida').length > 0 && (
          <Anteriores dados={dados} />
        )}
        <p className="sub rodape-cotacoes" data-testid="rodape">
          Atualizado às {horaBr(horaLocal(dados.atualizadoEm))}. As respostas aparecem aqui ao atualizar (sozinho a cada 30 s).
          O e-mail avisa nas coletas de seg a sex (8h17, 12h17, 16h17); o GitHub costuma atrasar de 5 a 30 min.
        </p>
        <Chaves />
      </section>
    </ContextoCotacoes.Provider>
  )
}

/** Checagem de saúde depois do Preparar: o mesmo caminho do vendedor (cotacao_abrir em prévia). 'ok' ou o problema. */
async function checarSaude(codigo: string | null, itens: number): Promise<string> {
  if (!codigo) return 'a cotação ficou sem link'
  try {
    const a = await api.abrirComoVendedor(codigo)
    if (!a.ok) return a.texto
    if (a.estado !== 'aberta') return a.texto ?? `a página mostra a cotação como "${a.estado}"`
    if (a.itens.length !== itens) return `a página mostra ${a.itens.length} de ${itens} itens`
    return 'ok'
  } catch (e) {
    return mensagemDeErro(e)
  }
}

function SemanaEmCompra({ dados, preparo }: { dados: Dados; preparo: Preparo }) {
  const cotacoesDe = (vendedorId: number) => {
    const cartao = preparo.cartoes.find((c) => c.vendedor_id === vendedorId)
    const ids = cartao?.cotacoes ?? []
    return ids.map((id) => dados.daSemana.find((c) => c.id === id)).filter((c): c is Cotacao => c != null)
  }
  return (
    <>
      <SemVendedor preparo={preparo} />
      <ForaDaCotacao titulo="Fora da cotação já enviada" linhas={preparo.fora_da_enviada} dados={dados}
        botao={(rotulo, versao) => `Gerar v${versao} para ${rotulo} incluindo`} />
      <ForaDaCotacao titulo="Depois do pedido" linhas={preparo.depois_do_resultado} dados={dados}
        botao={(rotulo) => `Cotação complementar para ${rotulo}`} />
      <DaSemanaAnterior linhas={preparo.atravessados} dados={dados} />
      <NaoEnviadas cotacoes={[...dados.daSemana, ...dados.anteriores]} />
      {preparo.cartoes.length === 0 && <p className="vazio">Nenhum item com vendedor nesta semana.</p>}
      {preparo.cartoes.map((cartao) => {
        const v = dados.vendedores.find((x) => x.id === cartao.vendedor_id)
        if (!v) return null
        return <CartaoVendedor key={v.id} v={v} cartao={cartao} cotacoes={cotacoesDe(v.id)} daSemana />
      })}
    </>
  )
}

function SemVendedor({ preparo }: { preparo: Preparo }) {
  const ctx = useCotacoes()
  if (preparo.sem_vendedor.length === 0) return null
  return (
    <>
      <div className="grupo">Sem vendedor ({preparo.sem_vendedor.length})</div>
      {preparo.sem_vendedor.map((s) => {
        const inativo = s.vendedor_id != null ? ctx.vendedor(s.vendedor_id) : undefined
        const chave = `p${s.produto_id}`
        return (
          <div key={s.item_semana_id} className="cartao" data-testid={`sem-vendedor-${s.produto_id}`}>
            <div className="nome">{s.nome}</div>
            <div className="sub">{numeroBr(s.qtd)} {s.unidade} · {textoMotivo(s.motivo, s.fornecedor, inativo ? rotuloVendedor(inativo.empresa) : null)}</div>
            <label>Pedir a:
              <select aria-label={`Pedir ${s.nome} a`} value="" disabled={ctx.ocupado || ctx.vendedoresAtivos.length === 0}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v) void ctx.acao(chave, () => api.definirVendedor(s.produto_id, v))
                }}>
                <option value="">escolha o vendedor…</option>
                {ctx.vendedoresAtivos.map((v) => <option key={v.id} value={v.id}>{v.empresa}</option>)}
              </select>
            </label>
            {ctx.erro(chave) && <p className="erro" role="alert">{ctx.erro(chave)}</p>}
          </div>
        )
      })}
    </>
  )
}

function ForaDaCotacao({ titulo, linhas, dados, botao }: {
  titulo: string; linhas: ItemForaDaCotacao[]; dados: Dados; botao: (rotulo: string, proximaVersao: number) => string
}) {
  const ctx = useCotacoes()
  if (linhas.length === 0) return null
  const grupos = new Map<number, ItemForaDaCotacao[]>()
  for (const l of linhas) grupos.set(l.cotacao_id, [...(grupos.get(l.cotacao_id) ?? []), l])
  return (
    <>
      <div className="grupo">{titulo}</div>
      {[...grupos.entries()].map(([cotacaoId, itens]) => {
        const v = ctx.vendedor(itens[0].vendedor_id)
        const rotulo = v ? rotuloVendedor(v.empresa) : `vendedor ${itens[0].vendedor_id}`
        const versoes = dados.daSemana.filter((c) => c.vendedor_id === itens[0].vendedor_id).map((c) => c.versao)
        const chave = `c${cotacaoId}`
        return (
          <div key={cotacaoId} className="cartao">
            <div className="sub">{rotulo}: {itens.map((i) => `${i.nome} (${numeroBr(i.qtd)} ${i.unidade})`).join(' · ')}</div>
            {ctx.erro(chave) && <p className="erro" role="alert">{ctx.erro(chave)}</p>}
            <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chave, async () => { await api.novaVersao(cotacaoId) })}>
              {botao(rotulo, Math.max(0, ...versoes) + 1)}
            </button>
          </div>
        )
      })}
    </>
  )
}

/**
 * "Da semana anterior" (D43): itens da semana que uma cotação da semana anterior ainda segura. Só leitura: a cotação
 * antiga aparece abaixo, entre as das semanas anteriores, com as ações dela.
 */
function DaSemanaAnterior({ linhas, dados }: { linhas: ItemAtravessado[]; dados: Dados }) {
  const ctx = useCotacoes()
  if (linhas.length === 0) return null
  const texto = (l: ItemAtravessado) => {
    const v = ctx.vendedor(l.vendedor_id)
    const rotulo = v ? rotuloVendedor(v.empresa) : `vendedor ${l.vendedor_id}`
    if (l.estado === 'pedido') return `Pedido com ${rotulo} na semana anterior`
    const c = dados.anteriores.find((x) => x.id === l.cotacao_id)
    const f = c?.fechamento ? horaLocal(c.fechamento) : null
    const detalhe = [c ? `v${c.versao}` : '', f ? `fecha ${diaCurto(f.data)} ${ddmm(f.data)} ${horaBr(f)}` : ''].filter(Boolean).join(', ')
    return `Já em cotação da semana anterior com ${rotulo}${detalhe ? ` (${detalhe})` : ''}`
  }
  return (
    <>
      <div className="grupo">Da semana anterior</div>
      {linhas.map((l) => (
        <div key={l.item_semana_id} className="cartao" data-testid={`atravessado-${l.produto_id}`}>
          <div className="nome">{l.nome}</div>
          <div className="sub">{texto(l)}</div>
        </div>
      ))}
    </>
  )
}

/** "Não enviada?": cotações PRONTAS SEM SINAL de envio (contrato 3.1, D36; spec 8.2, bloco 3). */
function NaoEnviadas({ cotacoes }: { cotacoes: Cotacao[] }) {
  const ctx = useCotacoes()
  // a preparada neste aparelho fica no cartão dela (com a mensagem do Preparar); a refeita em outro aparelho vem para cá
  const lista = cotacoes.filter((c) => ctx.semSinal(c) && !ctx.preparadaAqui(c))
  if (lista.length === 0) return null
  return (
    <>
      <div className="grupo">Não enviada?</div>
      {lista.map((c) => {
        const v = ctx.vendedor(c.vendedor_id)
        const d = ctx.dadosDe(c)
        const texto = v && d && d.codigo ? mensagemCotacao(d) : null
        const antesDoFechamento = !!c.fechamento && ctx.agora < new Date(c.fechamento)
        const chave = chaveCot(c)
        return (
          <div key={c.id} className="cartao" data-testid={`nao-enviada-${c.id}`}>
            <div className="nome">{v ? rotuloVendedor(v.empresa) : ''} · v{c.versao}</div>
            <div className="sub">{preparadaEm(c, ctx.agora)} e sem sinal de envio</div>
            {texto && antesDoFechamento && <AvisoTamanho texto={texto} />}
            {ctx.erro(chave) && <p className="erro" role="alert">{ctx.erro(chave)}</p>}
            <div className="acoes">
              {v && d?.codigo && texto && antesDoFechamento && (
                <>
                  <LinkWhatsApp numero={v.whatsapp} texto={texto}>Abrir WhatsApp</LinkWhatsApp>
                  <BotoesCopiar mensagem={texto} link={linkCotacao(d.codigo)} />
                </>
              )}
              {antesDoFechamento && (
                <button className="botao secundario" disabled={ctx.ocupado} onClick={() => ctx.acao(chave, () => api.confirmarEnvio(c.id))}>Já enviei</button>
              )}
              <button className="botao secundario" disabled={ctx.ocupado} onClick={() => {
                if (!window.confirm(`Se você mandou a mensagem, o link que o ${v?.nome ?? 'vendedor'} recebeu deixa de funcionar.\n\nDesfazer (não enviei)?`)) return
                void ctx.acao(chave, () => api.descongelarCotacao(c.id))
              }}>Desfazer (não enviei)</button>
              <button className="botao secundario" disabled={ctx.ocupado} onClick={() => {
                if (!window.confirm(`Cancelar a cotação v${c.versao}? O link deixa de abrir a lista.`)) return
                void ctx.acao(chave, () => api.cancelarCotacao(c.id))
              }}>Cancelar</button>
            </div>
          </div>
        )
      })}
    </>
  )
}

function Anteriores({ dados }: { dados: Dados }) {
  // as vivas (ou fechadas sem resultado há menos de 7 dias) e as que o Ivan acabou de resolver nesta sessão
  const visiveis = dados.anteriores.filter((c) => c.status !== 'cancelada' && c.status !== 'substituida')
  const porVendedor = new Map<number, Cotacao[]>()
  for (const c of visiveis) porVendedor.set(c.vendedor_id, [...(porVendedor.get(c.vendedor_id) ?? []), c])
  return (
    <>
      <div className="grupo">Semanas anteriores</div>
      {[...porVendedor.entries()].map(([vendedorId, cotacoes]) => {
        const v = dados.vendedores.find((x) => x.id === vendedorId)
        if (!v) return null
        return <CartaoVendedor key={`a${vendedorId}`} v={v} cotacoes={cotacoes} daSemana={false} />
      })}
    </>
  )
}
