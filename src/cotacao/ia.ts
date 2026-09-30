// Leitura com IA — lógica pura do App (B.5.3 a B.5.8, B.8). A IA só PROPÕE; quem grava é o App, no toque em Gravar, com
// o login do Ivan (origem 'ivan_ia'). Conversão, avisos e preço convertido continuam saindo das regras da 1B
// (conversao.ts). A base presumida (B.5.5) é compartilhada com o leitor comum (leitorTexto.ts).
import type {
  BaseCotacao, CertezaIA, Cotacao, EntradaGerais, EntradaItem, GeraisIA, ItemCotacao, LeituraIA, ResumoIA, SinalIA,
} from '../lib/tipos'
import { converter } from './conversao'
import type { Colagem } from './leitorTexto'
import { colarApagaResposta, textoAvisoIvan, textoAvisoVendedor } from '../admin/cotacoes/formato'

/** A resposta de um item sem numero/rev (o que vai em cot_responder_admin). */
export type EntradaBruta = Omit<EntradaItem, 'numero' | 'rev_lida'>
export type Sinal =
  | 'nome' | 'print' | 'audio' | 'extenso' | 'base_presumida' | 'concorda' | 'discorda' | 'so_leitor' | 'duvida' | 'corrigido'
export type CampoGeral = 'pagamento' | 'validade' | 'pedido_minimo' | 'frete' | 'entrega' | 'observacao'

export interface OpcaoLeitor { rotulo: string; entrada: EntradaBruta }
export interface LinhaPrevia {
  numero: number
  item: ItemCotacao
  entrada: EntradaBruta
  fonte: 'texto' | 'imagem' | 'leitor'
  trecho: string
  linhasColadas: string[]
  horas: (string | null)[]
  certeza: CertezaIA
  sinais: Sinal[]
  avisos: string[]
  duvida: string | null
  protegido: boolean
  /** os dois leitores discordam: duas opções, nenhuma escolhida (B.5.3) */
  duasOpcoes: { ia: OpcaoLeitor; comum: OpcaoLeitor } | null
  marcadoPadrao: boolean
}
export interface CondicaoPrevia {
  campo: CampoGeral; valor: string | number; trecho: string; certeza: CertezaIA; marcadoPadrao: boolean; aviso: string | null
}
export interface Previa {
  linhas: LinhaPrevia[]
  foraDaVersao: number[]
  naoEntendidos: { trecho: string; motivo: string }[]
  condicoes: CondicaoPrevia[]
  /** a IA foi usada nesta leitura (origem ivan_ia); false = o leitor comum resolveu sozinho (origem ivan_colou) */
  usouIA: boolean
}

// ---------- Base presumida (B.5.5): a mesma regra "só o preço" do leitorTexto.ts, para os dois leitores.
export function basePresumida(item: Pick<ItemCotacao, 'unidade' | 'vende_por_litro' | 'fator_confirmado' | 'fator'>): {
  base: BaseCotacao; emb_unidades: number | null; emb_gramas: number | null; emb_ml: number | null
} {
  if (item.fator_confirmado && item.fator != null) {
    if (item.unidade === 'un') return { base: 'embalagem', emb_unidades: Number(item.fator), emb_gramas: null, emb_ml: null }
    return { base: 'embalagem', emb_unidades: null, emb_gramas: Math.round(Number(item.fator) * 1000 * 1000) / 1000, emb_ml: null }
  }
  return { base: item.unidade === 'un' ? 'un' : item.vende_por_litro ? 'litro' : 'kg', emb_unidades: null, emb_gramas: null, emb_ml: null }
}

/** Texto curto da base presumida, para a pílula ("base presumida: fardo c/12 (embalagem confirmada)"). */
export function textoBasePresumida(item: Pick<ItemCotacao, 'unidade' | 'vende_por_litro' | 'fator_confirmado' | 'fator' | 'embalagem'>): string {
  if (item.fator_confirmado && item.fator != null) {
    const emb = item.embalagem ?? 'embalagem'
    return `base presumida: ${emb} c/${Number(item.fator)} (embalagem confirmada)`
  }
  const base = item.unidade === 'un' ? 'un' : item.vende_por_litro ? 'litro' : 'kg'
  return `base presumida: ${base === 'un' ? 'unidade' : base} (o vendedor não disse)`
}

// ---------- Limpeza do texto para a IA (B.10), repetida por segurança + troca do nome do vendedor por [vendedor].
const CABECALHOS = [
  /^\s*\[(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?,\s*\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(?:[^\d\s:[][^:]{0,59}:\s*)?/i,
  /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+[^:]{1,60}:\s*/,
]
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
/** Normalização da B.5.2 (regra 4) para comparar trechos: sem acento, minúsculo, sem asterisco, espaços juntos. */
const normalizarTrecho = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim()

function limparDados(texto: string): string {
  let t = texto.split(/\r?\n/).map((linha) => {
    for (const c of CABECALHOS) { const m = linha.match(c); if (m) linha = linha.slice(m[0].length) }
    return linha
  }).join('\n')
  t = t.replace(/\+?55\s?\(?\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}\b/g, '[telefone]')
  t = t.replace(/\(\d{2}\)\s?9?\d{4}[\s-]?\d{4}\b/g, '[telefone]')
  t = t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[e-mail]')
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[pix]')
  t = t.replace(/\b(?:ag(?:[êe]ncia)?|c\/c|cc|conta corrente|conta|op)\b\.?\s*\d{3,}[-\d]*/gi, '[conta]')
  return t.slice(0, 8000)
}

/** B.8: a limpeza da função, repetida, MAIS a troca do nome, do rótulo e da empresa deste vendedor por "[vendedor]". */
export function textoParaIA(texto: string, vendedor: { nome: string; rotulo: string; empresa: string }): string {
  const alvos = new Set(
    [vendedor.nome, vendedor.rotulo, vendedor.empresa.split('(')[0]]
      .flatMap((s) => normalizar(s).split(' '))
      .filter((w) => w.length >= 3),
  )
  const t = limparDados(texto)
  return t.replace(/[\p{L}][\p{L}\d]*/gu, (w) => (alvos.has(normalizar(w)) ? '[vendedor]' : w))
}

// ---------- Junção dos dois leitores (B.5.3, B.5.4)
const BLOQUEIAM = new Set(['unidade_suspeita', 'valor_alto', 'centavos', 'fator_diferente', 'acima_500_sem_ref'])
const AVISOS_BLOQUEIO = new Set<string>(['unidade suspeita', 'valor alto', 'centavos', 'embalagem diferente', 'acima de R$ 500'])

function normalizarEntrada(e: Partial<EntradaBruta> & { estado: EntradaBruta['estado'] }): EntradaBruta {
  return {
    estado: e.estado, preco: e.preco ?? null, base: e.base ?? null,
    emb_unidades: e.emb_unidades ?? null, emb_gramas: e.emb_gramas ?? null, emb_ml: e.emb_ml ?? null,
    tenho_so: e.tenho_so ?? null, a_partir_de: e.a_partir_de ?? null,
    similar_desc: e.similar_desc ?? null, similar_preco: e.similar_preco ?? null, marca: e.marca ?? null,
  }
}
const chaveNucleo = (e: EntradaBruta) => JSON.stringify([e.estado, e.preco, e.base, e.emb_unidades, e.emb_gramas, e.emb_ml])

/** A entrada da IA para um item, com a base presumida aplicada quando o vendedor não disse a base (B.5.5). */
function entradaDaIA(ia: LeituraIA['itens'][number], item: ItemCotacao): { entrada: EntradaBruta; presumida: boolean } {
  const e = ia.entrada
  if (e.estado === 'tem' && e.base == null) {
    const bp = basePresumida(item)
    return {
      entrada: normalizarEntrada({ estado: 'tem', preco: e.preco, base: bp.base, emb_unidades: bp.emb_unidades,
        emb_gramas: bp.emb_gramas, emb_ml: bp.emb_ml, tenho_so: e.tenho_so, a_partir_de: e.a_partir_de,
        similar_desc: e.similar_desc, similar_preco: e.similar_preco, marca: e.marca }),
      presumida: true,
    }
  }
  return { entrada: normalizarEntrada(e), presumida: false }
}

function menorCerteza(c: CertezaIA, teto: CertezaIA): CertezaIA {
  const ordem: CertezaIA[] = ['baixa', 'media', 'alta']
  return ordem[Math.min(ordem.indexOf(c), ordem.indexOf(teto))]
}

/** Pílulas de aviso de um item, das regras da 1B (converter) + os sinais da IA (B.5.4). */
function avisosDe(item: ItemCotacao, entrada: EntradaBruta, sinais: Sinal[], duvida: string | null): { avisos: string[]; bloqueado: boolean } {
  const conta = converter(item, { numero: item.numero ?? 0, rev_lida: item.rev, ...entrada })
  const avisos: string[] = []
  const bloqueado = conta.avisos_vendedor.some((a) => BLOQUEIAM.has(a)) || conta.avisos_ivan.some((a) => BLOQUEIAM.has(a))
  for (const a of conta.avisos_vendedor) avisos.push(textoAvisoVendedor(a))
  for (const a of conta.avisos_ivan) avisos.push(textoAvisoIvan(a, { ...item, fator_informado: conta.fator_informado,
    tenho_so: entrada.tenho_so ?? null, a_partir_de: entrada.a_partir_de ?? null,
    similar_desc: entrada.similar_desc ?? null, similar_preco: entrada.similar_preco ?? null }))
  if (sinais.includes('nome')) avisos.push('casado pelo nome')
  if (sinais.includes('print')) avisos.push('lido no print')
  if (sinais.includes('audio')) avisos.push('de áudio')
  if (sinais.includes('extenso')) avisos.push('valor por extenso')
  if (sinais.includes('base_presumida')) avisos.push(textoBasePresumida(item))
  if (sinais.includes('concorda')) avisos.push('os dois leitores concordam')
  if (sinais.includes('discorda')) avisos.push('os leitores discordam: escolha')
  if (duvida) avisos.push(`dúvida: ${duvida}`)
  return { avisos, bloqueado }
}

/** B.5.6: a linha chega marcada só com certeza alta/média, sem dúvida, sem discordância, sem aviso que bloqueia e sem proteção. */
export function marcadoPorPadrao(l: Pick<LinhaPrevia, 'certeza' | 'duvida' | 'duasOpcoes' | 'avisos' | 'protegido' | 'sinais'>): boolean {
  if (l.protegido) return false
  if (l.duasOpcoes) return false
  if (l.certeza === 'baixa') return false
  if (l.duvida) return false
  if (l.sinais.includes('duvida')) return false
  if (l.avisos.some((t) => [...AVISOS_BLOQUEIO].some((b) => t.includes(b)))) return false
  return true
}

function linhaDaIA(item: ItemCotacao, ia: LeituraIA['itens'][number], colagem: Colagem | null): LinhaPrevia {
  const { entrada, presumida } = entradaDaIA(ia, item)
  const comum = colagem?.reconhecidos.find((r) => r.numero === item.numero)
  const sinais: Sinal[] = [...ia.sinais]
  if (presumida) sinais.push('base_presumida')
  if (ia.duvida) sinais.push('duvida')

  let certeza = ia.certeza
  if (sinais.some((s) => s === 'nome' || s === 'print' || s === 'audio' || s === 'extenso' || s === 'base_presumida')) {
    certeza = menorCerteza(certeza, 'media')
  }
  let duasOpcoes: LinhaPrevia['duasOpcoes'] = null
  if (comum) {
    const eComum = normalizarEntrada(comum)
    if (chaveNucleo(eComum) === chaveNucleo(entrada)) {
      if (!ia.duvida) { sinais.push('concorda'); certeza = 'alta' }
    } else {
      sinais.push('discorda')
      duasOpcoes = { ia: { rotulo: comoCotouCurto(item, entrada), entrada }, comum: { rotulo: comoCotouCurto(item, eComum), entrada: eComum } }
    }
  }
  const { avisos } = avisosDe(item, entrada, sinais, ia.duvida)
  const protegido = colarApagaResposta(item)
  const base: Omit<LinhaPrevia, 'marcadoPadrao'> = {
    numero: item.numero!, item, entrada, fonte: ia.fonte,
    trecho: ia.trecho, linhasColadas: colagem?.linhas[item.numero!] ?? [], horas: colagem?.horas[item.numero!] ?? [],
    certeza, sinais, avisos, duvida: ia.duvida, protegido, duasOpcoes,
  }
  return { ...base, marcadoPadrao: marcadoPorPadrao(base) }
}

function linhaDoLeitor(item: ItemCotacao, comum: EntradaItem, colagem: Colagem): LinhaPrevia {
  const entrada = normalizarEntrada(comum)
  const sinais: Sinal[] = ['so_leitor']
  const { avisos } = avisosDe(item, entrada, sinais, null)
  const protegido = colarApagaResposta(item)
  const base: Omit<LinhaPrevia, 'marcadoPadrao'> = {
    numero: item.numero!, item, entrada, fonte: 'leitor',
    trecho: '', linhasColadas: colagem.linhas[item.numero!] ?? [], horas: colagem.horas[item.numero!] ?? [],
    certeza: 'alta', sinais, avisos, duvida: null, protegido, duasOpcoes: null,
  }
  return { ...base, marcadoPadrao: marcadoPorPadrao(base) }
}

/** Rótulo curtinho de uma resposta, para o botão da discordância ("R$ 42,00 fardo c/12"). */
function comoCotouCurto(item: ItemCotacao, e: EntradaBruta): string {
  if (e.estado === 'nao_tem') return 'não tem'
  if (e.preco == null) return '—'
  const p = `R$ ${Number(e.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  if (e.base === 'embalagem') {
    if (e.emb_unidades != null) return `${p} ${item.embalagem ?? 'embalagem'} c/${e.emb_unidades}`
    if (e.emb_gramas != null) return `${p} ${item.embalagem ?? 'embalagem'} ${e.emb_gramas} g`
    if (e.emb_ml != null) return `${p} ${item.embalagem ?? 'embalagem'} ${e.emb_ml} ml`
    return `${p} embalagem`
  }
  return `${p} ${e.base === 'un' ? 'a un' : e.base === 'kg' ? 'o kg' : 'o litro'}`
}

const CAMPOS_GERAIS: CampoGeral[] = ['pagamento', 'validade', 'pedido_minimo', 'frete', 'entrega', 'observacao']

function condicoesDe(ia: LeituraIA, c: Cotacao, hoje: string): CondicaoPrevia[] {
  const veioPeloLink = c.gerais_origem === 'vendedor'
  const out: CondicaoPrevia[] = []
  for (const campo of CAMPOS_GERAIS) {
    const cond = ia.gerais[campo]
    if (!cond) continue
    let aviso: string | null = veioPeloLink ? 'veio pelo link; marcar substitui' : null
    let marcadoPadrao = cond.certeza === 'alta' && !veioPeloLink
    if (campo === 'validade' && typeof cond.valor === 'string') {
      const limite = new Date(hoje)
      const val = new Date(cond.valor)
      const max = new Date(limite); max.setDate(max.getDate() + 366)
      if (Number.isNaN(val.getTime()) || val < limite || val > max) { marcadoPadrao = false; aviso = 'data fora do que o banco aceita' }
    }
    out.push({ campo, valor: cond.valor, trecho: cond.trecho, certeza: cond.certeza, marcadoPadrao, aviso })
  }
  return out
}

/**
 * Junta o leitor comum e a IA num cartão por item (B.5.3). `colagem` null = leitura só de print (sem leitor comum);
 * então toda linha vem da IA. Números que a IA leu fora da versão vão para foraDaVersao; os não entendidos, para
 * naoEntendidos (mais as linhas do leitor comum que não aparecem em nenhum trecho da IA).
 */
export function juntarLeituras(itens: ItemCotacao[], colagem: Colagem | null, ia: LeituraIA, c: Cotacao, hoje: string): Previa {
  const noEnvio = itens.filter((i) => i.incluido && i.numero != null)
  const porNumero = new Map(noEnvio.map((i) => [i.numero as number, i]))
  const iaPorNumero = new Map(ia.itens.map((x) => [x.numero, x]))
  const comumPorNumero = new Map((colagem?.reconhecidos ?? []).map((r) => [r.numero, r]))

  const numeros = new Set<number>([...iaPorNumero.keys(), ...comumPorNumero.keys()].filter((n) => porNumero.has(n)))
  const linhas: LinhaPrevia[] = []
  for (const numero of [...numeros].sort((a, b) => a - b)) {
    const item = porNumero.get(numero)!
    const iaItem = iaPorNumero.get(numero)
    const comum = comumPorNumero.get(numero)
    if (iaItem) linhas.push(linhaDaIA(item, iaItem, colagem))
    else if (comum && colagem) linhas.push(linhaDoLeitor(item, comum, colagem))
  }

  const foraDaVersao = [...new Set(ia.fora_da_lista.map((f) => f.numero))].sort((a, b) => a - b)
  // não entendidos da IA + as linhas do leitor comum que NÃO aparecem em nenhum trecho da IA (B.5.3): a linha que a IA
  // leu (casada pelo nome, ou de um item que ela resolveu mas veio duplicado/divergente no colado) já virou um cartão;
  // não pode aparecer também aqui como "o leitor comum não entendeu"
  const naoEntendidos = ia.nao_entendidos.map((n) => ({ trecho: n.trecho, motivo: n.motivo }))
  const trechosIA = [...ia.itens.map((i) => i.trecho), ...ia.nao_entendidos.map((n) => n.trecho)].map(normalizarTrecho)
  for (const l of colagem?.naoEntendidas ?? []) {
    const ln = normalizarTrecho(l)
    if (ln && trechosIA.some((t) => t.includes(ln))) continue
    naoEntendidos.push({ trecho: l, motivo: 'o leitor comum não entendeu' })
  }

  return { linhas, foraDaVersao, naoEntendidos, condicoes: condicoesDe(ia, c, hoje), usouIA: true }
}

// ---------- Gravação (B.5.8)
export interface Escolhas {
  marcados: Set<number>
  substituir: Set<number>
  escolha: Map<number, 'ia' | 'comum'>
  correcoes: Map<number, EntradaBruta>
  condicoes: Set<CampoGeral>
}

function entradaDaLinha(l: LinhaPrevia, escolhas: Escolhas): EntradaBruta {
  const corr = escolhas.correcoes.get(l.numero)
  if (corr) return corr
  const esc = escolhas.escolha.get(l.numero)
  if (l.duasOpcoes && esc) return esc === 'ia' ? l.duasOpcoes.ia.entrada : l.duasOpcoes.comum.entrada
  return l.entrada
}

/**
 * Monta o que vai para cot_responder_admin (só as linhas marcadas) e o resumo para cot_ia_gravada. Item protegido pela
 * cotação atual (colarApagaResposta) sem "substituir" fica FORA, mesmo marcado — a proteção é conferida de novo aqui,
 * contra o item atual (a resposta que chegou pelo link depois do Ler com IA também sai).
 */
export function entradasParaGravar(previa: Previa, escolhas: Escolhas, atuais: ItemCotacao[], c: Cotacao): {
  itens: EntradaItem[]; gerais: EntradaGerais | null; resumo: ResumoIA
} {
  const atualDe = new Map(atuais.map((i) => [i.numero, i]))
  const itens: EntradaItem[] = []
  let corrigidos = 0
  let discordancias = 0
  for (const l of previa.linhas) {
    if (l.duasOpcoes) discordancias++
    if (!escolhas.marcados.has(l.numero)) continue
    const atual = atualDe.get(l.numero)
    if (atual && colarApagaResposta(atual) && !escolhas.substituir.has(l.numero)) continue
    if (escolhas.correcoes.has(l.numero)) corrigidos++
    itens.push({ numero: l.numero, rev_lida: l.item.rev, ...entradaDaLinha(l, escolhas) })
  }

  let gerais: EntradaGerais | null = null
  if (escolhas.condicoes.size > 0) {
    gerais = {
      rev_lida: c.gerais_rev, pagamento: c.pagamento, validade: c.validade, pedido_minimo: c.pedido_minimo,
      frete: c.frete, entrega: c.entrega, observacao: c.observacao,
    }
    for (const cond of previa.condicoes) {
      if (!escolhas.condicoes.has(cond.campo)) continue
      if (cond.campo === 'pedido_minimo' || cond.campo === 'frete') gerais[cond.campo] = Number(cond.valor)
      else gerais[cond.campo] = String(cond.valor)
    }
  }

  const resumo: ResumoIA = {
    gravados: itens.length, corrigidos, discordancias,
    descartados: previa.linhas.length - itens.length,
  }
  return { itens, gerais, resumo }
}

// ---------- coerção de tipos vindos do JSON da função (numeric pode chegar como texto/number)
const numOuNull = (v: unknown): number | null => (v == null ? null : Number(v))
/** Normaliza os números de uma LeituraIA (defensivo: garante number|null nos campos numéricos). */
export function normalizarLeitura(l: LeituraIA): LeituraIA {
  return {
    ...l,
    custo_usd: numOuNull(l.custo_usd),
    itens: l.itens.map((i) => ({
      ...i,
      entrada: {
        ...i.entrada,
        preco: numOuNull(i.entrada.preco), emb_unidades: numOuNull(i.entrada.emb_unidades),
        emb_gramas: numOuNull(i.entrada.emb_gramas), emb_ml: numOuNull(i.entrada.emb_ml),
        tenho_so: numOuNull(i.entrada.tenho_so), a_partir_de: numOuNull(i.entrada.a_partir_de),
        similar_preco: numOuNull(i.entrada.similar_preco),
      },
    })),
  }
}
