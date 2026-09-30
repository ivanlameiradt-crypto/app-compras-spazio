// Lógica pura da Edge Function `cot-ler-resposta` (B.7). Sem globais do Deno nem rede: o SDK e o banco entram por
// `deps`, como em `gerenciar-usuarios`. `index.ts` (Deno) monta `deps` e chama `tratar`.
// A resposta do vendedor é DADO: vai ao modelo entre marcas, o trecho e o preço são conferidos contra o texto enviado
// (B.5.2), e a limpeza (B.7.1/B.10) tira cabeçalho, telefone, e-mail, CPF, CNPJ, PIX e conta. Nada é gravado aqui: a
// função só PROPÕE (o App grava, no toque em Gravar, com o login do Ivan).
import { ESQUEMA, type Certeza, type ItemModelo, type RespostaModelo, validarSaida } from './esquema.ts'
import { SISTEMA } from './prompt.ts'

// ---------- Tipos
export interface ImagemEntrada { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export interface Entrada {
  cotacao_id: number
  texto: string | null
  imagens: ImagemEntrada[]
  transcricao: boolean
  /** cotação grande (B.5.3): os números que o leitor comum NÃO leu; só esses o modelo devolve */
  pendentes?: number[]
}

export interface ItemContexto {
  numero: number; nome: string; qtd: number; unidade: 'un' | 'kg'; rotulo: 'un' | 'kg' | 'saco'
  vende_por_litro: boolean; embalagem: string | null; fator: number | null; nota: string | null
  descricao_fornecedor: string | null; codigo_fornecedor: string | null
}
/** O que cot_ia_iniciar devolve (lista branca, B.6.3): nunca ref_*, avisos, custo, telefone, empresa. */
export interface ContextoIA {
  leitura_id: number; modelo: string; esforco: 'low' | 'medium' | 'high'
  hoje: string; dia_semana: string; versao: number
  itens: ItemContexto[]
  uso: { hoje: number; limite_dia: number; mes: number; limite_mes: number; custo_mes_usd: number }
}

export type Sinal = 'nome' | 'print' | 'audio' | 'extenso'
export type CodigoErro =
  | 'entrada' | 'admin' | 'desligada' | 'limite_dia' | 'limite_mes' | 'cotacao' | 'sessao'
  | 'recusa' | 'incompleta' | 'invalida' | 'tempo' | 'ocupada' | 'sem_credito' | 'chave' | 'api'

export interface EntradaProposta {
  estado: 'tem' | 'nao_tem'; preco: number | null; base: 'un' | 'kg' | 'litro' | 'embalagem' | null
  emb_unidades: number | null; emb_gramas: number | null; emb_ml: number | null
  tenho_so: number | null; a_partir_de: number | null
  similar_desc: string | null; similar_preco: number | null; marca: string | null
}
export interface ItemProposto {
  numero: number; fonte: 'texto' | 'imagem'; casou_por: 'numero' | 'nome'
  entrada: EntradaProposta; trecho: string; certeza: Certeza; duvida: string | null; sinais: Sinal[]
}
export interface Condicao { valor: string | number; trecho: string; certeza: Certeza }
export interface GeraisProposta {
  pagamento: Condicao | null; validade: Condicao | null; pedido_minimo: Condicao | null
  frete: Condicao | null; entrega: Condicao | null; observacao: Condicao | null
}
export interface Resultado {
  itens: ItemProposto[]; gerais: GeraisProposta
  fora_da_lista: { numero: number; trecho: string }[]
  nao_entendidos: { trecho: string; motivo: string }[]
}

export interface ModeloResposta { stop_reason: string; texto: string; usage: { input_tokens: number; output_tokens: number } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PedidoModelo = Record<string, any>
export interface Deps {
  iniciar(e: { cotacao_id: number; caracteres: number; imagens: number; transcricao: boolean }):
    Promise<{ ok: true; ctx: ContextoIA } | { ok: false; mensagem: string; sessao?: boolean }>
  chamarModelo(pedido: PedidoModelo): Promise<{ ok: true; resp: ModeloResposta } | { ok: false; erro: CodigoErro }>
  concluir(leitura: number, p: Record<string, unknown>): Promise<void>
  chaveExiste(): boolean
  agora(): number
}

const LIMITE_TEXTO = 8000
const LIMITE_BASE64 = 800_000

// ---------- B.7.1 limparTexto
// Cabeçalhos do WhatsApp: cópia dos 3 padrões de leitorTexto.ts (testada junto, como _login.ts).
const CABECALHOS = [
  /^\s*\[(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?,\s*\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+[^:]{1,60}:\s*/,
]

/** Remove os cabeçalhos do WhatsApp linha a linha (mesma regra do leitorTexto.ts do App). */
export function tirarCabecalhos(texto: string): string {
  return texto.split(/\r?\n/).map((linha) => {
    for (const c of CABECALHOS) { const m = linha.match(c); if (m) linha = linha.slice(m[0].length) }
    return linha
  }).join('\n')
}

/**
 * B.7.1 / B.10: tira cabeçalho, telefone, e-mail, CNPJ, CPF, PIX, agência e conta; neutraliza as marcas do frame e
 * corta em 8.000. Preço nunca tem 11 ou 14 dígitos seguidos, então as trocas não tocam em preço nem em número de item.
 */
export function limparTexto(texto: string): string {
  let t = tirarCabecalhos(texto)
  // telefone (antes de CNPJ/CPF): 55 + DDD + 9 + 8 dígitos, ou (DD) 9xxxx-xxxx
  t = t.replace(/\+?55\s?\(?\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}\b/g, '[telefone]')
  t = t.replace(/\(\d{2}\)\s?9?\d{4}[\s-]?\d{4}\b/g, '[telefone]')
  // e-mail
  t = t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[e-mail]')
  // CNPJ (14 dígitos, com ou sem máscara) e depois CPF (11 dígitos, com ou sem máscara)
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
  // chave PIX aleatória (UUID)
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[pix]')
  // agência e conta ("ag 1234", "agência 1234-5", "c/c 12345-6", "conta corrente 98765-4", "op 001")
  t = t.replace(/\b(?:ag(?:[êe]ncia)?|c\/c|cc|conta corrente|conta|op)\b\.?\s*\d{3,}[-\d]*/gi, '[conta]')
  // neutraliza as marcas do frame vindas no texto do vendedor (injeção)
  t = t.replace(/<(\/?(?:lista_da_cotacao|resposta_do_vendedor))/gi, '‹$1')
  return t.slice(0, LIMITE_TEXTO)
}

// ---------- B.7.2 validarCorpo
export function validarCorpo(corpo: unknown):
  { ok: true; entrada: Entrada } | { ok: false; erro: 'entrada'; mensagem: string } {
  const falha = (m: string) => ({ ok: false as const, erro: 'entrada' as const, mensagem: m })
  if (corpo === null || typeof corpo !== 'object') return falha('corpo inválido')
  const c = corpo as Record<string, unknown>
  if (!Number.isInteger(c.cotacao_id) || (c.cotacao_id as number) <= 0) return falha('cotacao_id inválido')
  const temTexto = c.texto !== null && c.texto !== undefined
  if (temTexto) {
    if (typeof c.texto !== 'string') return falha('texto inválido')
    if ((c.texto as string).length > LIMITE_TEXTO) return falha('texto grande demais')
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(c.texto as string)) return falha('texto com caracteres de controle')
  }
  const imagens = c.imagens ?? []
  if (!Array.isArray(imagens)) return falha('imagens inválido')
  if (imagens.length > 3) return falha('no máximo 3 imagens')
  for (const im of imagens) {
    if (im === null || typeof im !== 'object') return falha('imagem inválida')
    const i = im as Record<string, unknown>
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(i.media_type as string)) return falha('media_type inválido')
    if (typeof i.base64 !== 'string' || i.base64.length === 0 || i.base64.length > LIMITE_BASE64) return falha('base64 inválido')
    if (!/^[A-Za-z0-9+/=\s]+$/.test(i.base64 as string)) return falha('base64 inválido')
  }
  if (typeof c.transcricao !== 'boolean') return falha('transcricao inválido')
  const textoVazio = !temTexto || (c.texto as string).trim() === ''
  if (textoVazio && imagens.length === 0) return falha('sem texto e sem imagem')
  let pendentes: number[] | undefined
  if (c.pendentes !== null && c.pendentes !== undefined) {
    if (!Array.isArray(c.pendentes) || !c.pendentes.every((n) => Number.isInteger(n) && (n as number) > 0)) return falha('pendentes inválido')
    pendentes = c.pendentes as number[]
  }
  return {
    ok: true,
    entrada: {
      cotacao_id: c.cotacao_id as number,
      texto: temTexto ? (c.texto as string) : null,
      imagens: imagens as ImagemEntrada[],
      transcricao: c.transcricao as boolean,
      pendentes,
    },
  }
}

// ---------- B.7.5 montarPedido
const PRECOS: Record<string, { entrada: number; saida: number }> = {
  'claude-opus-5': { entrada: 5, saida: 25 },
  'claude-sonnet-5': { entrada: 2, saida: 10 },
  'claude-haiku-4-5': { entrada: 1, saida: 5 },
}
const numeroCurto = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','))

function linhaItem(i: ItemContexto): Record<string, unknown> {
  const unidade = i.rotulo === 'saco' ? 'sacos' : i.unidade
  return {
    n: i.numero,
    nome: i.nome,
    qtd: `${numeroCurto(Number(i.qtd))} ${unidade}`,
    unidade: i.unidade,
    liquido: i.vende_por_litro,
    embalagem_confirmada: i.embalagem && i.fator != null ? `${i.embalagem} c/${numeroCurto(Number(i.fator))}` : null,
    nota: i.nota,
    descricao_fornecedor: i.descricao_fornecedor,
    codigo_fornecedor: i.codigo_fornecedor,
  }
}

/** Monta o pedido para a API (B.7.5). Prints primeiro, depois o bloco de texto com o frame. Só a lista branca é serializada. */
export function montarPedido(ctx: ContextoIA, entrada: Entrada): PedidoModelo {
  if (!(ctx.modelo in PRECOS)) throw new Error(`modelo inválido: ${ctx.modelo}`)
  const linhas = ctx.itens.map((i) => JSON.stringify(linhaItem(i))).join('\n')
  const grande = ctx.itens.length > 25
  const pend = grande && entrada.pendentes && entrada.pendentes.length > 0 ? ` pendentes="${entrada.pendentes.join(',')}"` : ''
  const tipo = entrada.transcricao ? 'transcrição de áudio feita pelo WhatsApp'
    : entrada.texto && entrada.texto.trim() ? 'texto colado do WhatsApp' : 'só prints'
  const frame = `<lista_da_cotacao versao="${ctx.versao}" hoje="${ctx.hoje} (${ctx.dia_semana})"${pend}>\n${linhas}\n</lista_da_cotacao>\n` +
    `<resposta_do_vendedor tipo="${tipo}">\n${entrada.texto ?? ''}\n</resposta_do_vendedor>`

  const conteudo: Record<string, unknown>[] = []
  for (const im of entrada.imagens) {
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.base64 } })
  }
  conteudo.push({ type: 'text', text: frame })

  const opus = ctx.modelo === 'claude-opus-5'
  const haiku = ctx.modelo === 'claude-haiku-4-5'
  const pedido: PedidoModelo = {
    model: ctx.modelo,
    max_tokens: haiku ? 8000 : 16000,
    system: SISTEMA,
    messages: [{ role: 'user', content: conteudo }],
  }
  if (!haiku) {
    pedido.thinking = { type: 'adaptive' }
    pedido.output_config = { effort: ctx.esforco, format: { type: 'json_schema', schema: ESQUEMA } }
  } else {
    pedido.output_config = { format: { type: 'json_schema', schema: ESQUEMA } }
  }
  if (opus) pedido.fallbacks = 'default'
  return pedido
}

// ---------- custo
export function custoUsd(modelo: string, uso: { input_tokens: number; output_tokens: number }): number | null {
  const p = PRECOS[modelo]
  if (!p) return null
  const v = (uso.input_tokens / 1e6) * p.entrada + (uso.output_tokens / 1e6) * p.saida
  return Math.round(v * 1e5) / 1e5
}

// ---------- B.5.2 interpretar
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const paraComparar = (s: string) => semAcento(s).toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim()
const cortar = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const EXTENSO = /\b(?:reais|real|conto|contos|zero|um|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|mil)\b/

/** Um número (preço) aparece escrito no trecho? "42","42,00","42.00","R$42","R$ 42,00" valem para 42. */
export function precoNoTrecho(preco: number, trecho: string): boolean {
  const alvo = Math.round(preco * 100)
  for (const m of trecho.matchAll(/\d[\d.,]*/g)) {
    const tok = m[0]
    let n: number
    if (tok.includes(',')) n = Number(tok.replace(/\./g, '').replace(',', '.'))
    else if (/^\d{1,3}(\.\d{3})+$/.test(tok)) n = Number(tok.replace(/\./g, ''))
    else n = Number(tok)
    if (Number.isFinite(n) && Math.round(n * 100) === alvo) return true
  }
  return false
}

function embConvertido(it: ItemContexto, base: string | null, emb: number | null): Pick<EntradaProposta, 'emb_unidades' | 'emb_gramas' | 'emb_ml'> {
  if (base !== 'embalagem' || emb == null) return { emb_unidades: null, emb_gramas: null, emb_ml: null }
  if (it.unidade === 'un') return { emb_unidades: emb, emb_gramas: null, emb_ml: null }
  if (it.vende_por_litro) return { emb_unidades: null, emb_gramas: null, emb_ml: emb }
  return { emb_unidades: null, emb_gramas: emb, emb_ml: null }
}

const assinaturaLeitura = (m: ItemModelo) => JSON.stringify([m.estado, m.preco, m.base, m.emb])

/**
 * Aplica B.5.2 à saída do modelo e devolve a prévia (sem os sinais/certeza de junção, que o App calcula). Trata
 * stop_reason e o JSON.
 */
export function interpretar(modelo: ModeloResposta, ctx: ContextoIA, entrada: Entrada):
  { ok: true; resultado: Resultado } | { ok: false; erro: CodigoErro } {
  if (modelo.stop_reason === 'refusal') return { ok: false, erro: 'recusa' }
  if (modelo.stop_reason === 'max_tokens') return { ok: false, erro: 'incompleta' }
  let bruto: unknown
  try { bruto = JSON.parse(modelo.texto) } catch { return { ok: false, erro: 'invalida' } }
  if (validarSaida(bruto) !== null) return { ok: false, erro: 'invalida' }
  const saida = bruto as RespostaModelo

  const numeros = new Set(ctx.itens.map((i) => i.numero))
  const itemDe = new Map(ctx.itens.map((i) => [i.numero, i]))
  const textoComparar = paraComparar(entrada.texto ?? '')
  const temImagem = entrada.imagens.length > 0

  const itens: ItemProposto[] = []
  const foraDaLista = [...saida.fora_da_lista.map((f) => ({ numero: f.numero, trecho: f.trecho }))]
  const naoEntendidos = [...saida.nao_entendidos.map((n) => ({ trecho: n.trecho, motivo: n.motivo }))]
  const dificil = (trecho: string, motivo: string) => naoEntendidos.push({ trecho, motivo })

  // agrupa por número; leituras diferentes do mesmo número → todas em nao_entendidos
  const porNumero = new Map<number, ItemModelo[]>()
  for (const m of saida.itens) porNumero.set(m.numero, [...(porNumero.get(m.numero) ?? []), m])

  for (const [numero, leituras] of porNumero) {
    if (!numeros.has(numero)) { // número fora da versão
      for (const m of leituras) foraDaLista.push({ numero, trecho: m.trecho })
      continue
    }
    const assinaturas = new Set(leituras.map(assinaturaLeitura))
    if (assinaturas.size > 1) {
      for (const m of leituras) dificil(m.trecho, `a IA leu o item ${numero} de dois jeitos`)
      continue
    }
    const m = leituras[0]
    const it = itemDe.get(numero)!
    // regra 3: coerência estado × campos
    if (m.estado === 'nao_tem') {
      if (m.preco != null || m.base != null || m.emb != null || m.tenho_so != null || m.a_partir_de != null || m.marca != null) {
        dificil(m.trecho, 'não tem, mas com preço'); continue
      }
    } else if (m.preco == null) { dificil(m.trecho, 'sem preço'); continue }
    // regra 3a: print que não existe
    if (m.fonte === 'imagem' && !temImagem) {
      dificil(m.trecho, 'a IA disse que leu um print, mas não havia print'); continue
    }
    // regra 4: trecho de texto tem de aparecer no texto enviado (comparados normalizados)
    if (m.fonte !== 'imagem' && !textoComparar.includes(paraComparar(m.trecho))) {
      dificil(m.trecho, 'o trecho não está no texto'); continue
    }
    // regra 5: preço no trecho — preco E similar_preco, para 'tem' e 'nao_tem' (B.5.2 regra 5, sem condicionar ao estado).
    // No 'nao_tem' o preco já é null (regra 3), mas o similar_preco do "outro produto no lugar" (prompt, regra 4) também
    // é conferido contra o trecho: um similar_preco que não está escrito no texto vai para nao_entendidos.
    const sinais: Sinal[] = []
    const faltaPreco = m.preco != null && !precoNoTrecho(m.preco, m.trecho)
    const faltaSimilar = m.similar_preco != null && !precoNoTrecho(m.similar_preco, m.trecho)
    if (faltaPreco || faltaSimilar) {
      if (EXTENSO.test(paraComparar(m.trecho))) sinais.push('extenso')
      else if (m.fonte === 'imagem') sinais.push('print')
      else { dificil(m.trecho, 'o preço não está no trecho'); continue }
    }
    if (m.casou_por === 'nome') sinais.push('nome')
    if (m.fonte === 'imagem' && !sinais.includes('print')) sinais.push('print')
    if (entrada.transcricao) sinais.push('audio')
    // regra 6: limites de texto
    let certeza: Certeza = m.certeza
    let duvida = m.duvida
    const marcaLonga = m.marca != null && m.marca.length > 60
    const similarLongo = m.similar_desc != null && m.similar_desc.length > 200
    if (marcaLonga || similarLongo) {
      certeza = 'baixa'
      const extra = marcaLonga ? `marca: ${m.marca}` : `similar: ${m.similar_desc}`
      duvida = cortar([duvida, extra].filter(Boolean).join(' — '), 120)
    }
    const emb = embConvertido(it, m.base, m.emb)
    itens.push({
      numero,
      fonte: m.fonte === 'imagem' ? 'imagem' : 'texto',
      casou_por: m.casou_por === 'nome' ? 'nome' : 'numero',
      entrada: {
        estado: m.estado, preco: m.preco, base: m.base, ...emb,
        tenho_so: m.tenho_so, a_partir_de: m.a_partir_de,
        similar_desc: m.similar_desc, similar_preco: m.similar_preco, marca: m.marca,
      },
      trecho: cortar(m.trecho, 80), certeza, duvida: duvida != null ? cortar(duvida, 120) : null, sinais,
    })
  }

  const resultado: Resultado = {
    itens: itens.sort((a, b) => a.numero - b.numero),
    gerais: saida.gerais,
    fora_da_lista: foraDaLista,
    nao_entendidos: naoEntendidos,
  }
  return { ok: true, resultado: limparProposta(resultado) }
}

/** B.5.2 regra 7: limpa todo texto da proposta antes de devolver e de gravar (o trecho de print é transcrição da IA). */
function limparProposta(r: Resultado): Resultado {
  const limpo = (s: string | null) => (s == null ? null : limparTexto(s))
  const cond = (c: Condicao | null): Condicao | null =>
    c == null ? null : { valor: typeof c.valor === 'string' ? limparTexto(c.valor) : c.valor, trecho: limparTexto(c.trecho), certeza: c.certeza }
  return {
    itens: r.itens.map((i) => ({
      ...i, trecho: limparTexto(i.trecho), duvida: limpo(i.duvida),
      entrada: { ...i.entrada, similar_desc: limpo(i.entrada.similar_desc), marca: limpo(i.entrada.marca) },
    })),
    gerais: {
      pagamento: cond(r.gerais.pagamento), validade: cond(r.gerais.validade), pedido_minimo: cond(r.gerais.pedido_minimo),
      frete: cond(r.gerais.frete), entrega: cond(r.gerais.entrega), observacao: cond(r.gerais.observacao),
    },
    fora_da_lista: r.fora_da_lista.map((f) => ({ numero: f.numero, trecho: limparTexto(f.trecho) })),
    nao_entendidos: r.nao_entendidos.map((n) => ({ trecho: limparTexto(n.trecho), motivo: limparTexto(n.motivo) })),
  }
}

// ---------- B.7.2 fluxo (tratar)
const HTTP: Record<CodigoErro, number> = {
  entrada: 400, admin: 403, desligada: 503, limite_dia: 429, limite_mes: 429, cotacao: 409, sessao: 401,
  recusa: 200, incompleta: 200, invalida: 200, tempo: 200, ocupada: 200, sem_credito: 200, chave: 200, api: 200,
}
const TEXTO: Record<CodigoErro, string> = {
  entrada: 'Não consegui ler o que foi enviado.',
  admin: 'apenas o administrador pode fazer isso',
  desligada: 'A leitura com IA está desligada. Use Ler (sem IA) ou Digitar preços.',
  limite_dia: 'Já foram 30 leituras com IA hoje (o limite). Use Ler (sem IA) ou Digitar preços; amanhã volta.',
  limite_mes: 'Já foram 150 leituras com IA neste mês (o limite). Use Ler (sem IA) ou Digitar preços.',
  cotacao: 'esta cotação não aceita mais respostas',
  sessao: 'Sua sessão expirou. Entre de novo no App e toque Ler com IA outra vez.',
  recusa: 'A IA não leu esta resposta. Use Ler (sem IA) ou Digitar preços.',
  incompleta: 'A resposta era grande demais para ler de uma vez. Cole em duas partes (por exemplo, até o item 20 e depois o resto).',
  invalida: 'A IA devolveu algo que não deu para conferir. Nada foi gravado. Tente de novo ou use Ler (sem IA).',
  tempo: 'A IA demorou demais e a leitura foi cancelada. Tente de novo ou use Ler (sem IA).',
  ocupada: 'A IA está ocupada agora. Tente de novo em 1 minuto ou use Ler (sem IA).',
  sem_credito: 'Acabou o crédito da IA. Use Ler (sem IA) ou Digitar preços. Para recarregar: console.anthropic.com → Billing.',
  chave: 'A chave da IA não vale mais; nada foi lido. Use Ler (sem IA). (Gere uma chave nova e cole nos Secrets do Supabase.)',
  api: 'A IA não respondeu. Nada foi gravado. Tente de novo ou use Ler (sem IA).',
}

/** Mensagem do banco (cot_ia_iniciar) → código de erro (B.7.2, passo 3). */
export function codigoDoBanco(mensagem: string): CodigoErro {
  if (/apenas o administrador/i.test(mensagem)) return 'admin'
  if (/leitura com IA está desligada/i.test(mensagem)) return 'desligada'
  if (/de hoje atingido/i.test(mensagem)) return 'limite_dia'
  if (/do mês atingido/i.test(mensagem)) return 'limite_mes'
  if (/não encontrada|não aceita mais respostas/i.test(mensagem)) return 'cotacao'
  if (/leitura inválida/i.test(mensagem)) return 'entrada'
  return 'api'
}

function erroResp(erro: CodigoErro) {
  return { status: HTTP[erro], corpo: { ok: false, erro, mensagem: TEXTO[erro] } }
}

/** Fluxo completo (B.7.2). O modelo só é chamado DEPOIS de cot_ia_iniciar devolver ok. */
export async function tratar(corpo: unknown, deps: Deps): Promise<{ status: number; corpo: unknown }> {
  const val = validarCorpo(corpo)
  if (!val.ok) return { status: 400, corpo: { ok: false, erro: 'entrada', mensagem: val.mensagem } }
  const entrada = val.entrada
  const caracteres = entrada.texto ? [...entrada.texto].length : 0

  const ini = await deps.iniciar({
    cotacao_id: entrada.cotacao_id, caracteres, imagens: entrada.imagens.length, transcricao: entrada.transcricao,
  })
  if (!ini.ok) return erroResp(ini.sessao ? 'sessao' : codigoDoBanco(ini.mensagem))
  const ctx = ini.ctx

  const t0 = deps.agora()
  const concluir = (p: Record<string, unknown>) => deps.concluir(ctx.leitura_id, p).catch(() => undefined)

  if (!deps.chaveExiste()) {
    await concluir({ status: 'erro', erro: 'desligada', modelo: ctx.modelo, duracao_ms: deps.agora() - t0 })
    return erroResp('desligada')
  }

  // limpeza repetida por segurança (o App já limpa; o nome do vendedor só o App troca)
  const entradaLimpa: Entrada = { ...entrada, texto: entrada.texto != null ? limparTexto(entrada.texto) : null }
  const pedido = montarPedido(ctx, entradaLimpa)
  const cham = await deps.chamarModelo(pedido)
  if (!cham.ok) {
    await concluir({ status: 'erro', erro: cham.erro, modelo: ctx.modelo, duracao_ms: deps.agora() - t0 })
    return erroResp(cham.erro)
  }

  const interp = interpretar(cham.resp, ctx, entradaLimpa)
  const duracao = deps.agora() - t0
  if (!interp.ok) {
    await concluir({ status: 'erro', erro: interp.erro, modelo: ctx.modelo, duracao_ms: duracao,
      tokens_entrada: cham.resp.usage.input_tokens, tokens_saida: cham.resp.usage.output_tokens })
    return erroResp(interp.erro)
  }

  const r = interp.resultado
  const incertos = r.itens.filter((i) => i.certeza !== 'alta').length + r.nao_entendidos.length
  const custo = custoUsd(ctx.modelo, cham.resp.usage)
  await concluir({
    status: 'ok', erro: null, modelo: ctx.modelo,
    tokens_entrada: cham.resp.usage.input_tokens, tokens_saida: cham.resp.usage.output_tokens,
    duracao_ms: duracao, itens_propostos: r.itens.length, itens_incertos: incertos,
    custo_usd: custo ?? 0, proposta: r,
  })

  return {
    status: 200,
    corpo: {
      ok: true, leitura_id: ctx.leitura_id, modelo: ctx.modelo, duracao_ms: duracao, custo_usd: custo,
      itens: r.itens, gerais: r.gerais, fora_da_lista: r.fora_da_lista, nao_entendidos: r.nao_entendidos,
      uso: ctx.uso,
    },
  }
}
