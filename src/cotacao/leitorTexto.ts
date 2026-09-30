// Leitor tolerante do "Colar resposta" (spec 8.2, item 6): o vendedor devolve pelo WhatsApp a lista da mensagem com o
// preço no fim de cada linha; o Ivan cola aqui. Casa NÚMERO DO ITEM + PREÇO, nunca a ordem das linhas. O que não dá
// para entender com segurança vai para "linhas não entendidas" (o Ivan digita), em vez de virar um preço errado: linha
// que cita dois itens ("3 e 5 não tenho"), conversa que começa com número ("2 dias pra entregar", "12 un 3,50"), linha
// com condições no meio ("mínimo", "frete", "pix"), com dois "R$" e um preço em cada, com ressalva ao lado do preço ("só
// tenho 1 kg", "mas acabou", "tenho similar"), antes ou depois do "R$", com a unidade dita e uma embalagem ao mesmo
// tempo ("45,00 o kg pct 500g"), horário ("10:00"), o mesmo item em duas linhas com respostas diferentes, a quantidade
// de outra versão ou semana no lugar da quantidade ("9. CEBOLA – 8 kg – R$" num item de 5 kg), a quantidade da
// mensagem seguida de "=" ou "por" ("10 un = 18,90": o total), preço com a vírgula na frente ("R$ ,80"), palavra
// depois da marca ("marca Italac desnatado"), a peça ("pç") num item em kg — também grudada no preço ("45,00pç",
// "2,50un", "64,00sc": nunca o preço na base padrão do item) — e a linha que só começa como uma da mensagem ("Itens em
// kg: preço da caixa de 10 kg", "Não tem? 6 e 11").
import type { BaseCotacao, EntradaItem, ItemCotacao } from '../lib/tipos'
import { lerNumero } from '../lib/regras'
import { validar } from './conversao'
import { basePresumida } from './ia'
import {
  AVISO_COTACAO, CHAMADA_LINK, CHAMADA_LISTA, COMO_NAO_TEM, EXEMPLO_FARDO, EXEMPLO_KG, linhaLiquidos, linhaVersao,
  textoQtd, URL_PAGINA,
} from './mensagens'

export interface Colagem {
  /** um por número de item, com rev_lida = rev do item (item respondido em linhas diferentes de jeitos diferentes não entra) */
  reconhecidos: EntradaItem[]
  /** as linhas que têm conteúdo mas não viraram resposta, como vieram (sem o cabeçalho do WhatsApp), na ordem da colagem;
   * inclui todas as linhas de um item respondido de dois jeitos diferentes (nenhuma vale em silêncio) */
  naoEntendidas: string[]
  /** números citados que não existem nesta versão ("item 7 não está na v2") */
  foraDaVersao: number[]
  /** as linhas coladas de cada item reconhecido (sem o cabeçalho do WhatsApp), para a conferência mostrar o que o
   * vendedor escreveu ao lado do que foi lido */
  linhas: Record<number, string[]>
  /** a data e a hora do cabeçalho do WhatsApp de cada linha de `linhas`, na mesma posição, como vieram ("05/10, 09:14",
   * "09:14, 05/10/2026"): a do último cabeçalho acima dela (a mensagem de várias linhas só tem o cabeçalho na
   * primeira); null = sem cabeçalho acima. A conferência mostra ao lado da linha, para comparar com a hora da resposta
   * que o vendedor mandou pelo link. */
  horas: Record<number, (string | null)[]>
}

/** "[05/10, 09:14] Fulano: " · "[05/10 09:14] " · "[05/10/2026, 09:14:33] Fulano: " · "05/10/2026 09:14 - Fulano: " ·
 * do WhatsApp Web/Desktop, com a hora antes da data: "[09:14, 05/10/2026] Fulano: " · "[9:14 AM, 10/5/2026] Fulano: ".
 * O grupo 1 é a data e a hora, como vieram. */
const CABECALHOS = [
  /^\s*\[(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?,\s*\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+[^:]{1,60}:\s*/,
]
/** Tira os cabeçalhos do WhatsApp linha a linha (B.8: usado por ia.ts textoParaIA e pela limpeza da Edge Function). */
export function tirarCabecalhos(texto: string): string {
  return texto.split(/\r?\n/).map((linha) => {
    for (const c of CABECALHOS) { const m = linha.match(c); if (m) linha = linha.slice(m[0].length) }
    return linha
  }).join('\n')
}

/** Número do item no começo da linha: "1.", "1 -", "1)", "1:", "item 1", "1 " (mas não "1.250" nem "22/09"). O
 * separador fica no grupo 2: separado só por espaço, o resto precisa parecer resposta (pareceResposta). */
const NUMERO = /^(?:item\s*)?(\d{1,3})(\s*[)\-:–—]\s*|\s*\.(?!\d)\s*|\s+)(.*)$/i
/** Horário no começo da linha ("10:00", "9:14", "14:00 às 18:00"): o vendedor respondeu a hora, ou a cópia do WhatsApp
 * trouxe a hora do balão numa linha própria. "1: 2,50", "1:2,50" e "1:25,00" continuam sendo o item 1. */
const HORA = /^\d{1,2}:[0-5]\d(?![\d.,])/
/** Outro número de item logo depois do primeiro: "3 e 5 não tenho", "3) e 5", "3 / 5", "3 & 5". */
const OUTRO_NUMERO = /^(?:e|,|;|\/|&|\+)\s*\d/
/** Conversa sobre condições (prazo, mínimo, frete, pagamento): nunca é o preço de um item. */
const CONDICAO = /\b(?:dias?|dd|util|uteis|minimo|frete|boleto|pix|entrega|entregar|entregamos|prazo|pedido)\b/

const PALAVRA_EMB = 'fd|fardo|cx|caixa|pct|pacote|dp|display|emb|embalagem|saco|sc|bag|balde|lata|garrafa|galao|bombona|frasco'
const NUM = '(\\d+(?:[.,]\\d+)?)'
const P_ML = new RegExp(`${NUM}\\s*ml\\b`)
const P_LITROS_EMB = new RegExp(`\\b(?:${PALAVRA_EMB})\\.?\\s*(?:de|c\\/|com)?\\s*${NUM}\\s*(?:l|lt|lts|litros?)\\b`)
const P_KG_EMB = new RegExp(`\\b(?:${PALAVRA_EMB})\\.?\\s*(?:de|c\\/|com)?\\s*${NUM}\\s*kg\\b`)
const P_GRAMAS = new RegExp(`${NUM}\\s*(?:g|gr|grs|gramas?)\\b`)
const P_COM_UNIDADES = /(?:c\/|\bcom\b)\s*(\d+)(?![.,]\d)\s*(?:un|und|unid|unidades?|latas?|garrafas?|sacos?|pcs?|pecas?|pacotes?)?\b/
const P_EMB_UNIDADES = new RegExp(`\\b(?:${PALAVRA_EMB})\\.?\\s*(?:de\\s+)?(\\d+)(?![.,]\\d)\\s*(?:un|und|unid|unidades?|pcs?|pecas?)?\\b(?!\\s*(?:g|gr|kg|ml|l|lt|litros?)\\b)`)
// "o litro", "/L", "1 L", "por litro" (o "1" é parte da base, não um número solto); "31,00kg" também vale. O "1" da base
// não vem logo depois de dígito, vírgula ou ponto: em "2,1 kg", "3,1 un" e "6,1 L" o 1 é do preço (sem isso, "2,1 kg"
// virava R$ 2,00 o kg e "0,1 un" virava "não tem")
const P_LITRO = /(?:\/\s*|\bo\s+|\bpor\s+|(?<![\w.,])1\s*|\b)(?:l|lt|lts|litros?)\b/
const P_KG = /(?:\/\s*|\bo\s+|\bpor\s+|(?<![\w.,])1\s*)?kg\b/
// a peça ("pç", "pc", "pcs", "peça") é a unidade: num item em kg dá base_incompativel e a linha vai para "não entendidas"
// (a peça de frios e queijos tem peso variável), nunca vira o preço do kg
const P_UN = /(?:\/\s*|\ba\s+|\bpor\s+|(?<![\w.,])1\s*|\b)(?:un|und|unid|unidades?|pcs?|pecas?)\b|\bcada\b/
const P_PALAVRA_EMB = new RegExp(`\\b(${PALAVRA_EMB})\\b`, 'g')
/** Unidade ou embalagem grudada no número ("2,50un", "45,00pç", "64,00sc", "6,10lt", "150,00cx"): entre o dígito e a
 * letra não há `\b`, e as regras acima não a viam; a palavra sobrava como "livre" e o preço valia na base padrão do item
 * ("2,50un" num item em kg = R$ 2,50 o kg). Ganha um espaço e cai nas mesmas regras de "2,50 un". O "kg", o "g" e o
 * "ml" grudados ("45,90kg", "500g", "350ml") já eram lidos e ficam como estão. */
const UNIDADE_GRUDADA = new RegExp(
  `(\\d)(?=(?:${PALAVRA_EMB})s?\\b|(?:un|und|unid|unidades?|pcs?|pecas?|cada|l|lt|lts|litros?)\\b)`, 'g')
/** Uma quantidade como a da mensagem: número + unidade ("8 kg", "5 un", "1 kg", "5 sacos", "19,9 kg", "1.250 un"). */
const QTD = '(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)\\s*(?:un|und|unid|unidades?|kg|g|gr|grs|gramas?|l|lt|lts|litros?|ml|sacos?)'
/** No lugar da quantidade (logo depois do nome, ou um trecho entre travessões): seguida de travessão ou hífen, "R$",
 * "(" (a embalagem da mensagem, "96 un (8 fd c/12)") ou do fim. */
const QTD_NA_POSICAO = new RegExp(`^${QTD}(?=\\s*(?:[-–—(]|r\\$|$))`)
/** Sem o nome, só é a posição da quantidade quando vem um hífen depois ("9 - 8 kg - R$"); "7 - 9,90 kg" é o preço. */
const QTD_ANTES_DO_HIFEN = new RegExp(`^${QTD}(?=\\s*[-–—])`)
/** Logo depois da quantidade da mensagem, "=" ou "por" ("10 un = 18,90", "5 kg por R$ 17,45", "– 5 kg – por 17,45"):
 * o preço que vem é o total da quantidade, não o da unidade ou do kg. */
const TOTAL_DA_QTD = /^[\s\-–—:]*(?:=|por\b)/
/** O preço: número que não vem logo depois de vírgula, ponto ou outro dígito (",80", ".80", "O,50" e "l,50" não são 80
 * nem 50: a linha fica sem preço e vai para "não entendidas"). */
const P_PRECO = /(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/
const NAO_TEM = /^(?:nao tenho|nao tem|nao temos|falta|em falta|sem estoque|sem|zerado|esgotado)\b/
/** "não tenho" depois de um número ("3 - 5 não tenho"): o número é de outro item, não um preço */
const NAO_TEM_NO_MEIO = /\b(?:nao tenho|nao tem|nao temos|falta|em falta|sem estoque|zerado|esgotado)\b/
/** Ressalva ao lado da resposta ("só tenho 1 kg", "mas acabou", "tenho similar", "outra marca", "chega amanhã"): muda o
 * sentido, e o preço cheio (ou o "não tem") não pode valer em silêncio. */
const RESSALVA = /\b(?:so|somente|apenas|tenho|temos|acabou|acabando|similar|parecid[oa]s?|outr[oa]s?|amanha|mas|porem|chega)\b/
/** O que pode sobrar ao lado do preço, depois de tirar as embalagens conhecidas: unidade, embalagem e ligação. */
const PALAVRA_LIVRE = new RegExp(`^(?:(?:${PALAVRA_EMB})s?|un|und|unid|unidades?|kg|g|gr|grs|gramas?|ml|l|lt|lts|litros?|pcs?|o|a|cada|reais|real|por|de|com|c)$`)

/** Sem acento, minúsculo, espaços juntos. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const tirarSeparadores = (s: string) => s.replace(/^[\s\-–—:=]+/, '').replace(/[\s\-–—:=]+$/, '')
const decimal = (s: string) => Number(s.replace(',', '.'))
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Como uma linha é comparada com as da mensagem: normalizada, sem os asteriscos do negrito do WhatsApp (a cópia pode
 * vir com ou sem eles) e com as aspas curvas retas. */
const comoModelo = (s: string) => norm(s.replace(/\*/g, '').replace(/[“”]/g, '"'))
/** Números que não aparecem numa mensagem de verdade: marcam, no texto de mensagens.ts, onde vai um número qualquer. */
const N1 = 900001
const N2 = 900002
/** A linha INTEIRA da mensagem (as mesmas constantes de mensagens.ts), com `numeros` trocados pelo padrão dado. */
function modelo(texto: string | null, numeros: [string, string][] = []): RegExp {
  let re = escapar(comoModelo(texto ?? ''))
  for (const [de, para] of numeros) re = re.split(de).join(para)
  return new RegExp(`^${re}$`)
}
/**
 * Linhas da própria mensagem de cotação (quando o vendedor devolve o texto inteiro): não são resposta. Todas casam só
 * INTEIRAS, no formato de mensagemCotacao: a linha que só começa como uma delas é do vendedor ("Oi, Ivan, item 12 R$
 * 12,00", "Prazo: 28 dias no boleto", "Itens em kg: preço da caixa de 10 kg", "Não tem? 6 e 11", "Cotação v2
 * respondida, só mudou o 7") e segue o caminho normal (reconhecida ou "não entendida", nunca some).
 */
const LINHAS_DO_MODELO = [
  /^oi, .+ aqui e o ivan, da spazio gourmet\.?$/,
  modelo(AVISO_COTACAO), modelo(CHAMADA_LINK), modelo(CHAMADA_LISTA),
  // o link desta página, com o código (o de qualquer outro endereço é do vendedor)
  new RegExp(`^${escapar(comoModelo(URL_PAGINA))}#c=[a-z0-9_-]+$`),
  modelo(EXEMPLO_FARDO), modelo(EXEMPLO_KG),
  modelo(linhaLiquidos([N1]), [[String(N1), '\\d+']]),
  modelo(linhaLiquidos([N1, N2]), [[`${N1} e ${N2}`, '\\d+(?:, \\d+)* e \\d+']]),
  modelo(COMO_NAO_TEM),
  /^prazo: [a-z]+, \d{2}\/\d{2}, ate \d{1,2}h(?:\d{2})?\.?$/,
  modelo(linhaVersao({ versao: N1, complementar: false, substitui_versao: null }), [[String(N1), '\\d+']]),
  modelo(linhaVersao({ versao: N1, complementar: false, substitui_versao: N2 }), [[String(N1), '\\d+'], [String(N2), '\\d+']]),
  modelo(linhaVersao({ versao: N1, complementar: true, substitui_versao: null })),
]

/**
 * O resto de uma resposta com preço (já sem o preço e as embalagens conhecidas) só tem unidade, embalagem e ligação?
 * Qualquer outra palavra pode mudar o sentido ("só tenho 1 kg", "mas acabou", "tenho similar"): a linha vai para "não
 * entendidas". Da marca, só a palavra logo depois de "marca" fica de fora ("marca Cristal" não é lida nem impede o
 * preço; o Ivan digita a marca em "Digitar preços"); o que vem depois dela é conferido como o resto ("marca Italac
 * desnatado", "marca Crystal com gás": a variação do produto não passa em silêncio; a marca de duas palavras também vai
 * para "não entendidas").
 */
function restoLivre(s: string): boolean {
  if (RESSALVA.test(s)) return false
  return (s.replace(/\bmarca\s*:?\s*[a-z]+/, ' ').match(/[a-z]+/g) ?? []).every((p) => PALAVRA_LIVRE.test(p))
}

type Lida = { resposta: Omit<EntradaItem, 'numero' | 'rev_lida'> } | { erro: true } | null

/** Lê a resposta de um item (o que vem depois do "R$" ou do último "–"). null = linha sem resposta (em branco). */
function lerResposta(texto: string, item: ItemCotacao): Lida {
  let s = tirarSeparadores(texto.replace(/r\$/g, ' ').replace(/\s+/g, ' ').trim()).replace(UNIDADE_GRUDADA, '$1 ')
  if (!s) return null
  if (/^0+(?:[.,]0+)?$/.test(s)) return { resposta: { estado: 'nao_tem' } }
  const naoTem = s.match(NAO_TEM)
  if (naoTem) {
    // "não tenho no momento" vale; "não tenho, mas tenho similar", "falta, chega amanhã", "sem, só 1 kg" não
    const resto = s.slice(naoTem[0].length)
    return /\d/.test(resto) || RESSALVA.test(resto) ? { erro: true } : { resposta: { estado: 'nao_tem' } }
  }

  let embMl: number | null = null
  let embGramas: number | null = null
  let embUnidades: number | null = null
  let base: BaseCotacao | null = null
  const tirar = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    const m = s.match(re)
    if (m) { f(m); s = s.replace(re, ' ') }
  }
  tirar(P_ML, (m) => { embMl = decimal(m[1]) })
  tirar(P_LITROS_EMB, (m) => { if (embMl == null) embMl = decimal(m[1]) * 1000 })
  tirar(P_KG_EMB, (m) => { embGramas = decimal(m[1]) * 1000 })
  tirar(P_GRAMAS, (m) => { if (embGramas == null) embGramas = decimal(m[1]) })
  tirar(P_COM_UNIDADES, (m) => { embUnidades = Number(m[1]) })
  if (embUnidades == null && embGramas == null && embMl == null) tirar(P_EMB_UNIDADES, (m) => { embUnidades = Number(m[1]) })
  let porLitro = false
  let porKg = false
  let porUn = false
  tirar(P_LITRO, () => { porLitro = true })
  tirar(P_KG, () => { porKg = true })
  tirar(P_UN, () => { porUn = true })
  // unidade dita E embalagem com quantidade ("45,00 o kg pct 500g", "2,50 un fd c/12", "8,00 o litro garrafa 750ml"):
  // o preço é da unidade ou da embalagem? Valer a embalagem dividiria o preço por ela em silêncio. As embalagens com a
  // quantidade escrita ("fd 12 un", "c/12 un", "pct 1 kg", "cx 1 L") já levaram o próprio "un"/"kg"/"L" acima
  if ((porKg || porLitro || porUn) && (embMl != null || embGramas != null || embUnidades != null)) return { erro: true }
  const palavras = [...s.matchAll(P_PALAVRA_EMB)].map((m) => m[1])

  const m = s.match(P_PRECO)
  if (!m) return { erro: true }
  const preco = lerNumero(m[0])
  s = s.replace(P_PRECO, ' ')
  // sobrou número depois do preço e das embalagens conhecidas ("42,00 12 un", "8,90 vence 30/10"), "não tenho" depois
  // do número ("5 não tenho": o 5 é outro item) ou palavra que não é de unidade nem de embalagem ("só tenho 1 kg",
  // "mas acabou"): ambíguo
  if (preco === null || /\d/.test(s) || NAO_TEM_NO_MEIO.test(s) || !restoLivre(s)) return { erro: true }
  if (preco === 0) return { resposta: { estado: 'nao_tem' } }

  if (embMl != null || embGramas != null || embUnidades != null) base = 'embalagem'
  else if (palavras.length > 0) {
    // "R$ 20,00 o saco" num item vendido em saco é o preço de 1 saco (1 saco = 1 un no SisChef)
    if (item.rotulo === 'saco' && palavras.every((p) => p === 'saco' || p === 'sc')) base = 'un'
    else base = 'embalagem' // embalagem sem dizer quantas unidades ou o peso: o banco recusaria (sem_embalagem)
  } else if (porLitro) base = 'litro'
  else if (porKg) base = 'kg'
  else if (porUn) base = 'un'
  else {
    // só o preço: base presumida (a MESMA regra compartilhada com a IA, ia.ts basePresumida, B.5.5): num item com
    // embalagem confirmada ("104 un (9 fd c/12)") vale a embalagem, como na página; senão un/litro/kg.
    const bp = basePresumida(item)
    base = bp.base
    embUnidades = bp.emb_unidades
    embGramas = bp.emb_gramas
  }

  return {
    resposta: {
      estado: 'tem', preco, base,
      emb_unidades: embUnidades, emb_gramas: embGramas, emb_ml: embMl,
    },
  }
}

/**
 * Separa a resposta do resto da linha copiada ("2. COCA COLA - ZERO 350 ML – 104 un – R$ 42,00 fd c/12"). null = dois
 * "R$" com preço antes do último ("R$ 42,00 – R$ 3,50", "R$ 1,80 cx c/12 R$ 21,00") ou uma quantidade diferente da
 * desta versão no lugar da quantidade (semRs): qual vale, o Ivan decide.
 */
function respostaDaLinha(resto: string, item: ItemCotacao): string | null {
  const r = norm(resto)
  const iRs = r.lastIndexOf('r$')
  if (iRs < 0) return semRs(r, item)
  const depois = r.slice(iRs + 2)
  if (tirarSeparadores(depois)) {
    // o que vem antes do último "R$" (sem o nome e a quantidade da mensagem) também é resposta e nunca some: a
    // embalagem ("cx c/12 R$ 45", "fd c/6 R$ 21,00", "pct 500g R$ 22,50") é lida junto com o preço, e a ressalva ("só
    // tenho 1 kg R$ 12,00", "similar R$ 9,90", "não tenho, similar R$ 2,30") leva a linha a "não entendidas"
    const semNome = semRs(r.slice(0, iRs), item)
    if (semNome === null) return null
    const antes = tirarSeparadores(semNome.replace(/r\$/g, ' '))
    // outro "R$" antes: o trecho antes do último não pode ter preço
    if (r.indexOf('r$') !== iRs && /\d/.test(antes)) return null
    return antes ? `${antes} ${depois}` : depois
  }
  // nada depois do último "R$": ou é a linha da lista devolvida sem preço ("– 10 un – R$"), ou o preço veio antes
  // dele ("– 59 un – 1,80 R$", "1 - 1,80 R$"). Lê o que vem antes, como numa linha sem "R$"
  return semRs(r.slice(0, iRs), item)
}

/**
 * A resposta de uma linha sem "R$" (já normalizada): o que sobra depois do nome e da quantidade da mensagem. Só sai o
 * que é exatamente o nome do item e a quantidade da mensagem (com a nota do Ivan, se houver); o resto fica para
 * lerResposta ler ou recusar, nunca some: "1 – cx c/12 – 45", "NOME – fd c/12 – R$ 21", "NOME – 10 un (só tenho 5) –
 * R$ 2,50" e o nome de outro item ("1. CEBOLA – 5 kg – R$ 3,20" no número da ÁGUA).
 * null = no lugar da quantidade (logo depois do nome, ou do número com o nome apagado) vem uma quantidade diferente da
 * desta versão: a lista da semana passada ou de outra versão devolvida em branco ("9. CEBOLA – 8 kg – R$", "9 – 8 kg –
 * R$", "9. CEBOLA - 8 kg - R$") ou a quantidade mexida ("– 1 kg – R$ 9,90", "– 5 un – R$ 2,50"). Sem isso, o número da
 * quantidade viraria o preço (a unidade sai como base) ou o "1" sumiria junto com a unidade ("1 kg" = o kg) (D64).
 * Também null: a quantidade da mensagem seguida de "=" ou "por" ("10 un = 18,90", "5 kg por R$ 17,45"): o preço é o
 * total dela (D66).
 */
function semRs(r: string, item: ItemCotacao): string | null {
  const nome = norm(item.nome)
  const nota = item.nota_vendedor ? ` (${norm(item.nota_vendedor)})` : ''
  const qtds = [
    norm(textoQtd({ ...item, embalagem: item.fator_confirmado ? item.embalagem : null, fator: item.fator_confirmado ? item.fator : null })),
    norm(textoQtd({ ...item, embalagem: null, fator: null })),
  ].flatMap((q) => (nota ? [q + nota, q] : [q]))
  const partes = r.split(/\s*[–—]\s*/)
  if (partes.length >= 2) {
    // "NOME – QTD – resposta", como na mensagem (o vendedor pode ter apagado o nome)
    let k = partes[0] === '' || partes[0] === nome ? 1 : 0
    if (k < partes.length && qtds.includes(partes[k].trim())) {
      k++
      // "– 5 kg – por 17,45": o total da quantidade, não o preço do kg
      if (k < partes.length && TOTAL_DA_QTD.test(partes[k])) return null
    }
    // outra quantidade no lugar da da mensagem (com k = 0, o trecho vem antes de um travessão)
    else if (k < partes.length && QTD_NA_POSICAO.test(partes[k].trim())) return null
    return partes.slice(k).join(' ')
  }
  // sem os travessões da mensagem: tira o nome e a quantidade do começo, se o vendedor os deixou; a quantidade seguida
  // de "=" ou "por" ("1 - 10 un = 18,90", "9. CEBOLA 5 kg por R$ 17,45") traz o total dela, não o preço da unidade ou
  // do kg: sem isso, o "=" e o "por" sumiam e as 10 un a R$ 18,90 viravam R$ 18,90 a un
  let s = r
  const comNome = s.startsWith(nome)
  if (comNome) s = s.slice(nome.length).replace(/^[\s\-–—:=]+/, '')
  for (const q of qtds) {
    if (!s.startsWith(q)) continue
    const depois = s.slice(q.length)
    return TOTAL_DA_QTD.test(depois) ? null : tirarSeparadores(depois)
  }
  // outra quantidade logo depois do nome ("CEBOLA - 8 kg - R$") ou, sem o nome, antes de um hífen ("9 - 8 kg - R$"); sem
  // o nome e sem o hífen depois ("7 - 9,90 kg", "1 - 1,80 un R$") é o preço com a unidade
  if ((comNome ? QTD_NA_POSICAO : QTD_ANTES_DO_HIFEN).test(s)) return null
  return tirarSeparadores(s)
}

/**
 * O resto da linha (depois do número) parece a resposta daquele item? Não quando cita outro item logo depois ("3 e 5
 * não tenho"), quando fala de condições ("2 dias pra entregar", "mínimo R$ 300") ou, com o número separado só por
 * espaço, quando não começa pelo nome do item, por "R$", por um preço ou por "não tenho" ("12 un 3,50").
 */
function pareceResposta(separador: string, resto: string, item: ItemCotacao | undefined): boolean {
  const r = norm(resto)
  if (OUTRO_NUMERO.test(r)) return false
  const nome = item ? norm(item.nome) : ''
  const comNome = nome !== '' && r.startsWith(nome)
  if (CONDICAO.test(comNome ? r.slice(nome.length) : r)) return false
  if (separador.trim()) return true
  return comNome || /^r\$/.test(r) || /^\d/.test(r) || NAO_TEM.test(r)
}

/** A resposta de um item, para comparar duas linhas com o mesmo número. */
const assinaturaResposta = (e: EntradaItem) => JSON.stringify(e, Object.keys(e).sort())

export function lerColagem(texto: string, itens: ItemCotacao[]): Colagem {
  const porNumero = new Map(itens.filter((i) => i.incluido && i.numero != null).map((i) => [i.numero as number, i]))
  const respostas = new Map<number, EntradaItem>()
  /** números respondidos em linhas diferentes de jeitos diferentes: nenhuma vale, todas vão para "não entendidas" */
  const divergentes = new Set<number>()
  // as linhas na ordem da colagem: não entendida (sem número) ou reconhecida (com o número do item)
  const ordem: { linha: string; numero?: number; hora: string | null }[] = []
  const fora = new Set<number>()
  // a data e a hora do último cabeçalho do WhatsApp: vale para as linhas seguintes da mesma mensagem
  let hora: string | null = null

  for (const bruta of texto.split(/\r?\n/)) {
    let linha = bruta
    for (const c of CABECALHOS) {
      const cab = linha.match(c)
      if (cab) { hora = cab[1].replace(/\s+/g, ' ').trim(); linha = linha.slice(cab[0].length) }
    }
    linha = linha.trim()
    if (!linha) continue
    if (LINHAS_DO_MODELO.some((re) => re.test(comoModelo(linha)))) continue
    // horário no começo da linha ("10:00", "09:14", "14:00 às 18:00"): não é o item 10 com o preço 00
    if (HORA.test(linha)) { ordem.push({ linha, hora }); continue }
    const m = linha.match(NUMERO)
    if (!m) { ordem.push({ linha, hora }); continue }
    const numero = Number(m[1])
    const item = porNumero.get(numero)
    if (!pareceResposta(m[2], m[3], item)) { ordem.push({ linha, hora }); continue }
    if (!item) { fora.add(numero); continue }
    const resposta = respostaDaLinha(m[3], item)
    const lida: Lida = resposta === null ? { erro: true } : lerResposta(resposta, item)
    if (lida === null) continue // linha da lista devolvida sem preço: item não respondido
    if ('erro' in lida) { ordem.push({ linha, hora }); continue }
    const entrada: EntradaItem = { numero, rev_lida: item.rev, ...lida.resposta }
    if (validar(item, entrada) !== null) { ordem.push({ linha, hora }); continue }
    const antes = respostas.get(numero)
    // o mesmo item de novo: igual, tanto faz; diferente (o vendedor corrigiu? errou o número?), quem decide é o Ivan —
    // a última linha não passa por cima da outra em silêncio
    if (antes && assinaturaResposta(antes) !== assinaturaResposta(entrada)) divergentes.add(numero)
    respostas.set(numero, entrada)
    ordem.push({ linha, numero, hora })
  }

  const linhas: Record<number, string[]> = {}
  const horas: Record<number, (string | null)[]> = {}
  for (const o of ordem) {
    if (o.numero === undefined || divergentes.has(o.numero)) continue
    linhas[o.numero] = [...(linhas[o.numero] ?? []), o.linha]
    horas[o.numero] = [...(horas[o.numero] ?? []), o.hora]
  }
  return {
    reconhecidos: [...respostas.values()].filter((e) => !divergentes.has(e.numero)).sort((a, b) => a.numero - b.numero),
    naoEntendidas: ordem.filter((o) => o.numero === undefined || divergentes.has(o.numero)).map((o) => o.linha),
    foraDaVersao: [...fora].sort((a, b) => a - b),
    linhas,
    horas,
  }
}
