// Mensagens de WhatsApp da cotação (spec seção 10), montadas no App a partir dos itens congelados. O Ivan envia pelo
// WhatsApp dele: o App só abre a conversa com o texto pronto (wa.me). Os exemplos de preço são FIXOS e iguais em toda
// mensagem, escolhidos sem olhar preço real (spec 2 e 10.1): a mensagem nunca troca o exemplo conforme a cotação.
import type { Cotacao, DadosEnvio, Gerais, ItemCotacao, ItemSemana, LinhaConferencia, MarcaItem, Pedido, TipoEmbalagem, Vendedor } from '../lib/tipos'
import { formatarQtd } from '../lib/regras'
import { embalagensPara } from './conversao'
import { totalPedido } from './pedido'

export { embalagensPara }

/** Endereço da página do vendedor (D12: um lugar só; pode virar spazio-gourmet se o nome estiver ocupado). */
export const URL_PAGINA: string = (import.meta.env.VITE_COTACAO_URL as string | undefined) || 'https://spaziogourmet.github.io/cotacao/'

/**
 * Horário em que a Spazio recebe mercadoria (decisão do Ivan de 27/09; ajuste Foozi 5). É o MESMO texto do config.js
 * da página do vendedor (contrato 9.2): mudou num, muda no outro. Vai na mensagem do pedido (10.3), nunca na de cotação.
 */
export const RECEBIMENTO = 'seg a sex, 7h–11h e 14h–18h; sáb, 7h–11h e 14h–16h'

/** Acima disso o link do wa.me pode não abrir: a tela avisa (não bloqueia; D52). As notas do Ivan contam. */
export const LIMITE_MENSAGEM = 1300

/** O código vai depois do "#": não aparece em log do GitHub Pages nem em Referer (spec 7.3.7). Prévia do Ivan: &p=1. */
export function linkCotacao(codigo: string, previa = false): string {
  return `${URL_PAGINA}#c=${codigo}${previa ? '&p=1' : ''}`
}

export function linkWhatsApp(whatsapp: string, texto: string): string {
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`
}

// ---------- tempo (sempre em America/Sao_Paulo; nada depende do fuso do aparelho)
const FUSO = 'America/Sao_Paulo'
const DIA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export interface HoraLocal { data: string; hora: number; minuto: number }
/** Carimbo ISO (UTC "…Z" ou "+00:00") → data e hora de Brasília. */
export function horaLocal(quando: string | Date): HoraLocal {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(typeof quando === 'string' ? new Date(quando) : quando)
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute) }
}
/** Texto "AAAA-MM-DD HH:MM" (os campos *_local do banco) → data e hora. */
export function horaDoTexto(local: string): HoraLocal {
  const [data, hm = '00:00'] = local.trim().split(/\s+/)
  const [h, m] = hm.split(':').map(Number)
  return { data, hora: h, minuto: m }
}
/** Carimbo → "AAAA-MM-DD HH:MM" em Brasília (o mesmo formato dos *_local do banco). */
export function textoLocal(quando: string): string {
  const l = horaLocal(quando)
  return `${l.data} ${String(l.hora).padStart(2, '0')}:${String(l.minuto).padStart(2, '0')}`
}
/** Hora curta brasileira (cot_hora_br): 17h, 9h07, 10h15. */
export function horaBr(l: HoraLocal): string {
  return `${l.hora}h${l.minuto === 0 ? '' : String(l.minuto).padStart(2, '0')}`
}
const diaDaSemana = (data: string) => {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}
export const diaLongo = (data: string) => DIA_LONGO[diaDaSemana(data)]
export const diaCurto = (data: string) => DIA_CURTO[diaDaSemana(data)]
/** "2026-09-22" → "22/09". */
export const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`

// ---------- números
/** 0,5 · 19,9 · 1.200 (sem casas à toa). */
export const numeroBr = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
/** "R$ 31,50", com espaço comum (o de formatarReais é o sem quebra do Intl, que não é o da mensagem). */
export const reais = (v: number) =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Rótulo curto do vendedor (contrato 1.2): empresa até o "(" — "FORNECEDOR A (Centro)" → "FORNECEDOR A". */
export const rotuloVendedor = (empresa: string) => empresa.split('(')[0].trim()

// ---------- embalagem
const ABREVIADA: Record<TipoEmbalagem, string> = { fardo: 'fd', caixa: 'cx', pacote: 'pct', saco: 'sc' }
const PLURAL: Record<TipoEmbalagem | 'embalagem', string> = {
  fardo: 'fardos', caixa: 'caixas', pacote: 'pacotes', saco: 'sacos', embalagem: 'embalagens',
}
const ARTIGO: Record<TipoEmbalagem | 'embalagem', string> = { fardo: 'o', caixa: 'a', pacote: 'o', saco: 'o', embalagem: 'a' }
/** Peso de uma embalagem em kg → "400 g" / "5 kg". */
export const peso = (kg: number) => (kg < 1 ? `${numeroBr(Math.round(kg * 1000 * 1000) / 1000)} g` : `${numeroBr(kg)} kg`)

type ItemMsg = DadosEnvio['itens'][number]
/** Quantidade com o rótulo: "104 un", "3 sacos", "0,5 kg"; com fator confirmado, "104 un (9 fd c/12)". */
export function textoQtd(it: Pick<ItemMsg, 'qtd' | 'unidade' | 'rotulo' | 'embalagem' | 'fator'>): string {
  const n = numeroBr(it.qtd)
  let texto = it.rotulo === 'saco' ? `${n} ${Number(it.qtd) === 1 ? 'saco' : 'sacos'}` : `${n} ${it.unidade}`
  if (it.embalagem && it.fator) {
    const emb = embalagensPara(it.qtd, it.fator)
    texto += it.unidade === 'un'
      ? ` (${emb} ${ABREVIADA[it.embalagem]} c/${numeroBr(it.fator)})`
      : ` (${emb} ${ABREVIADA[it.embalagem]} de ${peso(Number(it.fator))})`
  }
  return texto
}

const juntar = (xs: (string | number)[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`

// ---------- 10.1 pedido de cotação
// As linhas fixas da mensagem são exportadas: o leitor do "Colar resposta" (leitorTexto.ts) ignora a mensagem devolvida
// casando a linha INTEIRA com estas mesmas constantes (mudou aqui, muda lá).
export const AVISO_COTACAO = '*É COTAÇÃO, ainda não é pedido.* Pode me passar seus preços para os itens abaixo?'
export const CHAMADA_LINK = 'Para responder pelo link (sem cadastro):'
export const CHAMADA_LISTA = 'Ou copie a lista, escreva o preço no fim de cada linha e me mande de volta:'
export const EXEMPLO_FARDO = 'Preço de fardo ou caixa: diga quantas unidades vêm (ex.: R$ 31,50 fd c/6).'
export const EXEMPLO_KG = 'Itens em kg: preço do kg ou da embalagem, com o peso (ex.: R$ 12,40 pct 400 g).'
export const EXEMPLO_LITRO = 'pode cotar o litro ou a caixa, dizendo os ml (ex.: cx 1 L = 1000 ml).'
export const COMO_NAO_TEM = 'Não tem? Escreva "não tenho".'

/** "Item 5 (líquido): …" ou "Itens 5, 10 e 12 (líquidos): …"; sem líquido, null. */
export function linhaLiquidos(numeros: number[]): string | null {
  if (numeros.length === 0) return null
  return numeros.length === 1 ? `Item ${numeros[0]} (líquido): ${EXEMPLO_LITRO}` : `Itens ${juntar(numeros)} (líquidos): ${EXEMPLO_LITRO}`
}

export function linhaVersao(d: Pick<DadosEnvio, 'versao' | 'complementar' | 'substitui_versao'>): string {
  if (d.substitui_versao != null) return `Cotação v${d.versao} — substitui a v${d.substitui_versao}; números iguais, itens novos no fim · Obrigado!`
  if (d.complementar) return 'Cotação complementar — itens novos desta semana · Obrigado!'
  return `Cotação v${d.versao} · Obrigado!`
}

export function mensagemCotacao(d: DadosEnvio): string {
  const itens = [...d.itens].sort((a, b) => a.numero - b.numero)
  const liquidos = itens.filter((i) => i.vende_por_litro).map((i) => i.numero)
  const prazo = horaDoTexto(d.prazo_local)
  const linhaLiquido = linhaLiquidos(liquidos)
  const linhas = [
    `Oi, ${d.vendedor.nome}! Aqui é o Ivan, da Spazio Gourmet.`,
    AVISO_COTACAO,
    '',
    CHAMADA_LINK,
    linkCotacao(d.codigo ?? ''),
    '',
    CHAMADA_LISTA,
    // a nota do Ivan (ajuste Foozi 3) vai entre parênteses depois da quantidade e conta no limite de 1.300 caracteres
    ...itens.map((i) => `${i.numero}. ${i.nome} – ${textoQtd(i)}${i.nota ? ` (${i.nota})` : ''} – R$`),
    '',
    EXEMPLO_FARDO,
    EXEMPLO_KG,
    ...(linhaLiquido ? [linhaLiquido] : []),
    COMO_NAO_TEM,
    '',
    `Prazo: ${diaLongo(prazo.data)}, ${ddmm(prazo.data)}, até ${horaBr(prazo)}.`,
    linhaVersao(d),
  ]
  return linhas.join('\n')
}

// ---------- 10.2 cobrança (só entre o prazo e o fechamento)
export function mensagemCobranca(nome: string, fechamento: string, agora: Date): string {
  const f = horaLocal(fechamento)
  const quando = f.data === horaLocal(agora).data
    ? `até as ${horaBr(f)} de hoje`
    : `até ${diaLongo(f.data)}, ${ddmm(f.data)}, às ${horaBr(f)}`
  return `Oi, ${nome}! Conseguiu ver a cotação? Se der, me manda ${quando}. Obrigado!`
}

// ---------- 10.3 confirmar pedido
type LinhaPedido = Pedido['itens'][number]
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios)

function linhaPedido(l: LinhaPedido, it: ItemMsg | undefined): string {
  const nome = it?.nome ?? `item ${l.numero}`
  const unidade = it?.unidade ?? 'un'
  const saco = it?.rotulo === 'saco'
  const preco = reais(Number(l.preco_combinado))
  const qtd = Number(l.qtd)
  if (l.base === 'embalagem') {
    const tipo: TipoEmbalagem | 'embalagem' = it?.embalagem ?? 'embalagem'
    const n = l.embalagens ?? 0
    let texto = `${n} ${n === 1 ? tipo : PLURAL[tipo]}`
    // líquido cotado em caixa: o vendedor conhece a caixa dele; a conta em kg é só do SisChef (D51)
    if (l.fator != null && !it?.vende_por_litro) {
      texto += unidade === 'un'
        ? ` c/${numeroBr(Number(l.fator))} (${numeroBr(qtd)} ${saco ? plural(qtd, 'saco', 'sacos') : 'un'})`
        : ` de ${peso(Number(l.fator))} (${numeroBr(qtd)} kg)`
    }
    return `${l.numero}. ${nome} – ${texto} – ${preco} ${ARTIGO[tipo]} ${tipo}`
  }
  const texto = saco ? `${numeroBr(qtd)} ${plural(qtd, 'saco', 'sacos')}` : `${numeroBr(qtd)} ${unidade}`
  const por = l.base === 'litro' ? 'o litro' : l.base === 'kg' ? 'o kg' : saco ? 'o saco' : 'a unidade'
  return `${l.numero}. ${nome} – ${texto} – ${preco} ${por}`
}

/**
 * 10.3: só os itens que ficaram "No pedido" no mapa, o total com frete (totalPedido) e a entrega com o horário de
 * recebimento da Spazio. `entrega` = o campo "Entrega" da tela (vem com o que o vendedor escreveu); vazio = "a combinar".
 */
export function mensagemPedido(d: DadosEnvio, pedido: Pedido, gerais: Gerais, entrega: string | null): string {
  const porNumero = new Map(d.itens.map((i) => [i.numero, i]))
  const linhas = [...pedido.itens].sort((a, b) => a.numero - b.numero)
  const t = totalPedido(linhas, gerais.frete)
  let total = gerais.frete == null ? `Total: ${reais(t.itens)}`
    : Number(gerais.frete) === 0 ? `Total: ${reais(t.itens)} (sem frete)`
      : `Total com frete: ${reais(t.total)} (itens ${reais(t.itens)} + frete ${reais(t.frete)})`
  if (t.semTotal.length > 0) total += ` + ${plural(t.semTotal.length, 'item', 'itens')} ${juntar(t.semTotal)} sem total`
  const pagamento = gerais.pagamento?.trim()
  if (pagamento) total += ` · Pagamento: ${pagamento}`
  const quando = entrega?.trim().replace(/[.\s]+$/, '') || 'a combinar'
  return [
    `${d.vendedor.nome}, vamos fechar! PEDIDO Spazio Gourmet (cotação v${d.versao}):`,
    ...linhas.map((l) => linhaPedido(l, porNumero.get(l.numero))),
    total,
    `Entrega: ${quando}, ${RECEBIMENTO}.`,
    'Pode confirmar, por favor?',
  ].join('\n')
}

/**
 * Linha de condições no cartão (ajuste Foozi 1): "boleto 28 d · mín. R$ 300,00 · frete R$ 30,00 · entrega 1 dia ·
 * válido até qua 23/09". Pagamento e entrega como o vendedor escreveu; campo vazio some. `hoje` = AAAA-MM-DD local.
 */
export function linhaCondicoes(g: Gerais, hoje: string): string {
  const partes: string[] = []
  if (g.pagamento?.trim()) partes.push(g.pagamento.trim())
  if (g.pedido_minimo != null) partes.push(Number(g.pedido_minimo) === 0 ? 'sem mínimo' : `mín. ${reais(Number(g.pedido_minimo))}`)
  if (g.frete != null) partes.push(Number(g.frete) === 0 ? 'frete grátis' : `frete ${reais(Number(g.frete))}`)
  if (g.entrega?.trim()) partes.push(`entrega ${g.entrega.trim()}`)
  if (g.validade) {
    partes.push(g.validade < hoje ? `preço vencido em ${ddmm(g.validade)}` : `válido até ${diaCurto(g.validade)} ${ddmm(g.validade)}`)
  }
  return partes.join(' · ')
}

// ---------- etiqueta do item em Comprar e no Resumo (spec 8.3; só informa, não bloqueia)
/**
 * O que a etiqueta NÃO cobre (D63): a aprovada menos a `qtd` do pedido ou do "só tenho", quando sobra; senão null
 * (a etiqueta vale para o item inteiro). O "aguardando" (qtd null) cobre o item inteiro.
 */
export function restoDaEtiqueta(m: MarcaItem, qtdAprovada: number): number | null {
  if (m.estado === 'aguardando_cotacao' || m.qtd == null) return null
  const resto = +(Number(qtdAprovada) - Number(m.qtd)).toFixed(3)
  return resto > 0 ? resto : null
}

/**
 * Texto da etiqueta. Com o item, a etiqueta que cobre só parte dele diz quanto e manda comprar o resto na loja:
 * "Pedido com MATEUS: 1 kg — comprar o resto (7 kg) na loja" (D63).
 */
export function textoEtiqueta(m: MarcaItem, item?: Pick<ItemSemana, 'qtd_aprovada' | 'unidade'>): string {
  const resto = item ? restoDaEtiqueta(m, item.qtd_aprovada) : null
  if (item && resto != null && (m.estado === 'pedido' || m.estado === 'em_cotacao')) {
    const quem = m.estado === 'pedido' ? 'Pedido com' : 'Em cotação com'
    return `${quem} ${m.vendedor}: ${formatarQtd(Number(m.qtd), item.unidade)} — comprar o resto (${formatarQtd(resto, item.unidade)}) na loja`
  }
  if (m.estado === 'pedido') return `Pedido com ${m.vendedor} — chega por entrega`
  if (m.estado === 'em_cotacao') return `Em cotação com ${m.vendedor} — não comprar na loja`
  const ate = m.ate ? horaLocal(m.ate) : null
  return `Aguardando cotação com ${m.vendedor}${ate ? ` até ${diaCurto(ate.data)} ${horaBr(ate)}` : ''} — não comprar na loja`
}

// ---------- 10.6 e 10.7 (Fase 2, Bloco D): diferença na NF, falta e avaria. Só saem com o toque do Ivan.
// NUNCA citam o último preço, outro vendedor ou a economia: só o que foi combinado com este vendedor (D.8).

const ARTIGO_BASE: Record<BaseConf, string> = { un: 'a unidade', kg: 'o kg', litro: 'o litro', embalagem: 'a embalagem' }
type BaseConf = 'un' | 'kg' | 'litro' | 'embalagem'
type LinhaConf = Pick<LinhaConferencia, 'numero' | 'nome' | 'base' | 'qtd' | 'embalagens' | 'preco_combinado' | 'valor_acima' | 'preco' | 'falta' | 'resto' | 'unidade' | 'fator' | 'avaria'>

/** Quantidade de falta em embalagens inteiras quando a conta fecha (24 un ÷ 12 = 2 embalagens), senão na unidade. */
function qtdFalta(falta: number, unidade: string, fator: number | null, embalagem?: string | null): string {
  if (fator && fator > 0 && Math.abs(falta % fator) < 1e-9) {
    const n = falta / fator
    return `${numeroBr(n)} ${embalagem ? (n === 1 ? embalagem : PLURAL[embalagem as TipoEmbalagem] ?? embalagem + 's') : (n === 1 ? 'embalagem' : 'embalagens')}`
  }
  return `${numeroBr(falta)} ${unidade}`
}

/** 10.6 — diferença de preço na NF: uma linha por item ACIMA, na base combinada. Frete acima entra à parte. */
export function mensagemDiferencaNf(
  nome: string, nf: string, pedidoData: string, linhas: LinhaConf[],
  frete?: { combinado: number | null; nf: number | null },
): string {
  const acima = linhas.filter((l) => l.preco === 'acima')
  const freteAcima = frete && frete.nf != null && frete.combinado != null && frete.nf > frete.combinado + 0.01
  if (acima.length === 0 && !freteAcima) return ''
  const linha = (l: LinhaConf): string => {
    const base = l.base as BaseConf
    const qtdBase = base === 'embalagem' ? Number(l.embalagens ?? l.qtd) : Number(l.qtd)
    const nfBase = l.preco_combinado + (qtdBase ? l.valor_acima / qtdBase : 0)
    const unid = base === 'embalagem' ? `${numeroBr(qtdBase)} embalagens` : `${numeroBr(qtdBase)} ${base === 'kg' ? 'kg' : base === 'litro' ? 'L' : 'un'}`
    return `${l.numero}. ${l.nome} – combinado ${reais(l.preco_combinado)} ${ARTIGO_BASE[base]}, na NF ${reais(nfBase)} (${unid}: ${reais(l.valor_acima)} a mais)`
  }
  const partes = [`${nome}, recebemos a NF ${nf} do pedido de ${diaCurto(pedidoData)} ${ddmm(pedidoData)}. Vi diferença no preço:`]
  for (const l of acima) partes.push(linha(l))
  if (freteAcima) partes.push(`Frete: combinado ${reais(frete!.combinado!)}, na NF ${reais(frete!.nf!)}`)
  partes.push('Pode verificar, por favor? Obrigado!')
  return partes.join('\n')
}

/** 10.7 — falta e avaria. O resto é por item (2ª revisão n.º 10): quem ainda vem em "Faltou:", quem não vem mais à parte. */
export function mensagemFaltaAvaria(nome: string, pedidoData: string, linhas: LinhaConf[]): string {
  const faltasVem = linhas.filter((l) => (l.falta ?? 0) > 0 && l.resto === 'vem_depois')
  const faltasNao = linhas.filter((l) => (l.falta ?? 0) > 0 && l.resto === 'nao_vem')
  const avarias = linhas.filter((l) => (l.avaria ?? 0) > 0)
  const partes = [`${nome}, chegou o pedido de ${diaCurto(pedidoData)} ${ddmm(pedidoData)}, obrigado!`]
  if (faltasVem.length) {
    partes.push('Faltou: ' + faltasVem.map((l) => `${qtdFalta(Number(l.falta), l.unidade, l.fator)} de ${l.nome}`).join('; ') + '.')
  }
  if (faltasNao.length) {
    partes.push('Não precisa mandar: ' + faltasNao.map((l) => `${qtdFalta(Number(l.falta), l.unidade, l.fator)} de ${l.nome}`).join('; ') + ' (compramos por aqui).')
  }
  for (const a of avarias) {
    partes.push(`Com avaria: ${qtdFalta(Number(a.avaria), a.unidade, a.fator)} de ${a.nome}.`)
  }
  if (faltasVem.length) {
    partes.push(`Vai mandar o que faltou? A Spazio recebe ${RECEBIMENTO}.`)
  } else if (faltasNao.length) {
    partes.push('Tudo bem, compramos o que faltou por aqui.')
  }
  return partes.join('\n')
}

// ---------- 10.4 e 10.5
export function mensagemObrigado(nome: string): string {
  return `${nome}, obrigado pela cotação! Desta vez não vou fechar, mas conto com você na próxima.`
}
export function mensagemLinkNovo(nome: string, codigo: string): string {
  return `${nome}, o link da cotação mudou. Use este: ${linkCotacao(codigo)}. O anterior não vale mais.`
}

/**
 * O mesmo formato de cot_dados_envio, montado das leituras da aba, para os botões-link ("Abrir o WhatsApp de novo",
 * "Cobrar", "Não enviada?") não precisarem de `await` antes do toque (Safari/iOS bloqueia janela aberta depois de await).
 * `extra` completa o que a linha da cotação não tem: a data da semana e a versão que esta substituiu.
 */
export function dadosEnvioDe(c: Cotacao, itens: ItemCotacao[], v: Vendedor, codigo: string | null,
  extra: { data_referencia?: string; substitui_versao?: number | null } = {}): DadosEnvio {
  return {
    cotacao_id: c.id, semana_id: c.semana_id, data_referencia: extra.data_referencia ?? '',
    versao: c.versao, complementar: c.complementar, substitui_versao: extra.substitui_versao ?? null, status: c.status,
    codigo, prazo: c.prazo ?? '', fechamento: c.fechamento ?? '',
    prazo_local: c.prazo ? textoLocal(c.prazo) : '', fechamento_local: c.fechamento ? textoLocal(c.fechamento) : '',
    vendedor: { id: v.id, codigo: v.codigo, nome: v.nome, empresa: v.empresa, rotulo: rotuloVendedor(v.empresa), whatsapp: v.whatsapp },
    itens: itens
      .filter((i) => i.cotacao_id === c.id && i.incluido && i.numero != null)
      .sort((a, b) => (a.numero as number) - (b.numero as number))
      .map((i) => ({
        numero: i.numero as number, produto_id: i.produto_id, nome: i.nome, qtd: Number(i.qtd), unidade: i.unidade, rotulo: i.rotulo,
        vende_por_litro: i.vende_por_litro,
        embalagem: i.fator_confirmado ? i.embalagem : null, fator: i.fator_confirmado ? i.fator : null,
        nota: i.nota_vendedor ?? null,
      })),
  }
}
