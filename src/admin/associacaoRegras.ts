// Regras puras da caixa de associação de produto (aba "Lançamento fiscal"): busca na lista de insumos do app, sugestão pelas palavras-chave do Ivan,
// quando a conversão de unidade é obrigatória/opcional/escondida (situacaoConversao) e como ela é lida e mostrada (etapa 2). Sem rede nem React (os
// testes de tela trocam o api inteiro por um mock).
import { normalizar } from '../lib/regras'
import type { AssociacaoApp, ItemNotaSefaz, ProdutoCatalogo } from '../lib/tipos'

/** Quantos produtos a busca mostra de uma vez (o resto some atrás de "digite mais letras"). */
export const MAX_RESULTADOS = 8

/** `parcial`: nenhum produto tem TODAS as palavras digitadas; os mostrados têm ALGUMA (os mais parecidos primeiro). */
export interface ResultadoBusca { itens: ProdutoCatalogo[]; total: number; parcial?: boolean }

interface Campos { p: ProdutoCatalogo; nome: string; sischef: string; chaves: string; codigo: string }
const camposDe = (p: ProdutoCatalogo): Campos => ({
  p, nome: normalizar(p.nome), sischef: normalizar(p.nome_sischef ?? ''), chaves: normalizar(p.palavras ?? ''), codigo: String(p.produto_id),
})

/**
 * Procura na lista de insumos: TODAS as palavras digitadas têm de aparecer no nome (o corrigido ou o do SisChef), no código ou nas
 * palavras-chave do Ivan (sem acento e sem diferença de maiúsculas). Vêm primeiro os que casam só pelo nome/código — os que COMEÇAM com a 1ª
 * palavra, depois os que a têm no começo de alguma palavra, depois o resto —, e por último os que só casam graças às palavras-chave; empate:
 * nome mais curto, depois ordem alfabética. Texto vazio = nada (a caixa não despeja a lista inteira).
 *
 * Se NENHUM produto tem todas as palavras, a busca não termina em "nada": devolve os que têm ALGUMA (só palavras de 3 letras ou mais, para
 * "de" e "kg" não casarem com tudo), os que têm mais palavras primeiro, com `parcial: true` — o Ivan reconhece o produto e escolhe.
 */
export function buscarProdutos(catalogo: ProdutoCatalogo[], texto: string, limite = MAX_RESULTADOS): ResultadoBusca {
  const palavras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return { itens: [], total: 0 }
  const campos = catalogo.filter((p) => !p.oculto).map(camposDe)                              // produto de receita da casa não é opção
  const noNomeOuCodigo = (c: Campos, w: string) => c.nome.includes(w) || c.sischef.includes(w) || c.codigo.includes(w)
  const noComeco = (c: Campos) => {
    const w = palavras[0]
    if (c.nome.startsWith(w) || c.sischef.startsWith(w)) return 0
    const inicioDePalavra = (s: string) => { const i = s.indexOf(w); return i > 0 && s[i - 1] === ' ' }
    return inicioDePalavra(c.nome) || inicioDePalavra(c.sischef) ? 1 : 2
  }
  const ordenar = (a: { p: ProdutoCatalogo; nota: number }, b: { p: ProdutoCatalogo; nota: number }) =>
    a.nota - b.nota || a.p.nome.length - b.p.nome.length || a.p.nome.localeCompare(b.p.nome, 'pt-BR')

  const achados: { p: ProdutoCatalogo; nota: number }[] = []
  for (const c of campos) {
    if (!palavras.every((w) => noNomeOuCodigo(c, w) || c.chaves.includes(w))) continue
    achados.push({ p: c.p, nota: palavras.every((w) => noNomeOuCodigo(c, w)) ? noComeco(c) : 3 })
  }
  if (achados.length > 0) {
    achados.sort(ordenar)
    return { itens: achados.slice(0, limite).map((x) => x.p), total: achados.length }
  }

  const longas = [...new Set(palavras.filter((w) => w.length >= 3))]
  const parecidos: { p: ProdutoCatalogo; nota: number; casadas: number }[] = []
  for (const c of campos) {
    const casadas = longas.filter((w) => noNomeOuCodigo(c, w) || c.chaves.includes(w)).length
    if (casadas > 0) parecidos.push({ p: c.p, nota: noComeco(c), casadas })
  }
  parecidos.sort((a, b) => b.casadas - a.casadas || ordenar(a, b))
  if (parecidos.length === 0) return { itens: [], total: 0 }
  return { itens: parecidos.slice(0, limite).map((x) => x.p), total: parecidos.length, parcial: true }
}

// ---------- sugestão pelas palavras-chave

/** Palavras que não ajudam a reconhecer um produto: ligações, unidades e embalagens (e "insumo", que está no nome de quase todos). */
const SEM_VALOR = new Set([
  'com', 'sem', 'para', 'por', 'dos', 'das', 'uma', 'uns', 'ate', 'und', 'unid', 'unidade', 'pct', 'pacote', 'caixa', 'pet', 'pack',
  'insumo', 'insumos', 'ltda', 'tipo',
])
/** As palavras de um texto (descrição da nota, nome ou palavras-chave) que servem para reconhecer o produto: só letras, 3 ou mais, sem acento. */
function palavrasUteis(texto: string): string[] {
  const todas = normalizar(texto).match(/[a-z]{3,}/g) ?? []
  return [...new Set(todas.filter((w) => !SEM_VALOR.has(w)))]
}
/**
 * A palavra da NOTA (`a`) reconhece a palavra do PRODUTO (`b`) se são iguais, se a da nota é o COMEÇO da do produto (abreviação: "muss" =
 * "mussarela", "cond" = "condensado", "resf" = "resfriada" — só com 4 letras ou mais, para "bis" não virar "biscoito") ou se a do produto é o
 * começo da da nota (plural: "queijos" para "queijo").
 */
const reconhece = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))

export interface SugestaoPorPalavras { produto: ProdutoCatalogo; palavras: string[] }

/**
 * Sugere o produto pela descrição do item na nota, usando o nome e as palavras-chave que o Ivan escreveu ("queijo muss" é mussarela). Conta,
 * para cada produto, quantas palavras da nota ele reconhece; só sugere se o melhor reconhece 2 ou mais. Empate de contagem: fica o produto com
 * MENOS palavras do próprio nome que a nota não menciona — "Q. MUÇARELA" ganha de "QUEIJO MUÇARELA DE BÚFALA" para "QUEIJO MUSS ARGE LA PAULINA",
 * porque a variante (búfala) só vale quando a nota fala dela. Empate de verdade (nem isso desempata) = nada: o Ivan escolhe. Devolve também as
 * palavras da nota que casaram, para a tela mostrar o porquê. Só SUGERE: quem decide é o Ivan, e nada vai ao SisChef.
 */
export function sugestaoPorPalavras(it: ItemNotaSefaz, catalogo: ProdutoCatalogo[]): SugestaoPorPalavras | null {
  const daNota = palavrasUteis((it.descricao ?? '').replace(/^CÓD\. FOR:\s*\S+\s*/i, ''))
  if (daNota.length < 2) return null
  let melhor: SugestaoPorPalavras & { sobras: number } | null = null
  let empate = false
  for (const p of catalogo) {
    if (p.oculto) continue
    const doProduto = palavrasUteis(`${p.nome} ${p.nome_sischef ?? ''} ${p.palavras ?? ''}`)
    const casadas = daNota.filter((a) => doProduto.some((b) => reconhece(a, b)))
    if (casadas.length < 2) continue
    // palavras do nome mostrado que a nota não menciona (o nome do SisChef, que pode ter erro de digitação, não entra nessa conta)
    const sobras = palavrasUteis(p.nome).filter((w) => !daNota.some((a) => reconhece(a, w))).length
    if (melhor === null || casadas.length > melhor.palavras.length || (casadas.length === melhor.palavras.length && sobras < melhor.sobras)) {
      melhor = { produto: p, palavras: casadas, sobras }; empate = false
    } else if (casadas.length === melhor.palavras.length && sobras === melhor.sobras) {
      empate = true
    }
  }
  return melhor !== null && !empate ? { produto: melhor.produto, palavras: melhor.palavras } : null
}

/**
 * O nome para MOSTRAR de um produto já escolhido: o do catálogo (que traz o nome corrigido pelo Ivan; `noSischef` é o nome original, quando ele
 * foi corrigido) ou, sem o catálogo, o que ficou guardado na decisão. O guardado é sempre o nome do SisChef: o servidor não conhece o corrigido.
 */
export function nomeParaMostrar(catalogo: ProdutoCatalogo[] | null, id: number, guardado: string): { nome: string; noSischef?: string } {
  const p = catalogo?.find((x) => x.produto_id === id)
  return p ? { nome: p.nome, noSischef: p.nome_sischef } : { nome: guardado }
}

/** O que a caixa faz com o campo da conversão para este par de unidades (ver situacaoConversao). */
export type SituacaoConversao = 'obrigatoria' | 'opcional' | 'oculta'

/**
 * Decide se a caixa de associação PEDE a conversão de unidade, só OFERECE o campo, ou o esconde — comparando a unidade da nota (item.unidade_sischef,
 * já normalizada pelo robô: UN, KG, CX, L, PCT…) com a unidade do produto na lista do app (ProdutoCatalogo.unidade / AssociacaoApp.unidade).
 *
 * POR QUE três respostas e não só "igual/diferente": a unidade da lista do app é um PALPITE tirado do nome do produto. "kg" só aparece quando o nome
 * tem "(KG)" — isso é confiável. "un" é o que sobra para TODOS os outros nomes — é um chute: no cadastro vivo do SisChef o produto pode estar em UN,
 * mas também em PCT, CX, L… E produto novo (fora da lista semanal) não tem unidade nenhuma aqui. Quem tem a palavra final é o ROBÔ: antes de escrever
 * no SisChef ele lê o cadastro vivo e confere (nfe_decisoes_app.conferir_conversoes): se faltar conversão, ou se houver conversão com unidades iguais,
 * ele para a nota em "revisar" sem gravar nada. Por isso o app só OBRIGA quando tem certeza; nos outros casos deixa o Ivan informar se souber.
 *
 * Regra (nota = sem espaços, em maiúsculas; produto = sem espaços, em minúsculas; vazio/null = desconhecida):
 *  - nota desconhecida → "oculta" (sem a unidade da nota não há o que comparar; o robô também barra isso antes de associar);
 *  - produto "kg": nota "KG" → "oculta"; qualquer outra → "obrigatoria" (certeza de que o SisChef vai pedir o fator no modal "UN DIFERE");
 *  - produto "un" (ou qualquer palpite que não seja "kg"): nota igual → "oculta"; diferente → "opcional" (pode ser que no SisChef sejam iguais);
 *  - produto desconhecida (produto novo) → "opcional".
 * "opcional" NUNCA trava o Lançar (notaSefazRegras.faltaNaDecisao); "oculta" ainda pode ser aberta por um link na caixa, para o caso raro de o
 * produto estar em outra unidade no SisChef apesar do nome.
 */
export function situacaoConversao(unidadeNota: string | null | undefined, unidadeProduto: string | null | undefined): SituacaoConversao {
  const nota = (unidadeNota ?? '').trim().toUpperCase()
  const produto = (unidadeProduto ?? '').trim().toLowerCase()
  if (nota === '') return 'oculta'
  if (produto === '') return 'opcional'
  if (produto === 'kg') return nota === 'KG' ? 'oculta' : 'obrigatoria'
  return nota === produto.toUpperCase() ? 'oculta' : 'opcional'
}

/**
 * O palpite do robô de leitura para o item (item.sugestao). Se o produto está na lista de insumos do app, devolve o da lista (nome e unidade
 * dela). Se NÃO está — produto novo, criado no SisChef depois da lista semanal (ex.: CHOCOLATE BIS) —, devolve o palpite mesmo assim, marcado
 * `novo`, com o nome do palpite e sem unidade: o banco aceita esse produto só para ESTE item (cot_nfe_associar confere o código). Sem palpite
 * utilizável (sem código inteiro positivo ou sem nome): null.
 */
export function sugestaoNoCatalogo(it: ItemNotaSefaz, catalogo: ProdutoCatalogo[]): ProdutoCatalogo | null {
  const id = Number(it.sugestao?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  const daLista = catalogo.find((p) => p.produto_id === id)
  if (daLista) return daLista.oculto ? null : daLista                                        // escondido: nem como palpite (não é produto de compra)
  const nome = (it.sugestao?.nome ?? '').replace(/\s+/g, ' ').trim()
  return nome === '' ? null : { produto_id: id, nome, unidade: null, novo: true }
}

// ---------- conversão de unidade (etapa 2: o número que o robô digita no modal "UN DIFERE" do SisChef ao associar o produto)

/** Unidade como a tela a mostra ("UN", "KG"); vazio quando desconhecida. */
export const rotuloUnidade = (u: string | null | undefined): string => (u ?? '').trim().toUpperCase()

/** Limites da conversão: os mesmos do banco (cot_nfe_associar) e do robô (motor_logica.conversao_decidida), que é quem digita o valor no SisChef. */
export const CONVERSAO_MAXIMA = 10_000
export const CONVERSAO_CASAS = 4

/**
 * "0,395" / "0.395" / ",5" / "2" → 0.395 / 0.395 / 0.5 / 2. Aceita vírgula ou ponto como decimal (ponto sem vírgula é decimal, não milhar: a conversão
 * é um número pequeno). Texto com ponto E vírgula ao mesmo tempo ("1.000,5") é recusado: não dá para saber qual é o milhar e qual é o decimal, e um
 * fator 1000 vezes errado ficaria gravado no SisChef para sempre. Válido só se > 0, ≤ 10000 e com até 4 casas; qualquer outra coisa (texto, zero,
 * negativo, 5 casas) → null, e o Confirmar fica desabilitado. Fail-closed de propósito: o que o robô digitar no modal do SisChef fica gravado para as
 * próximas notas do fornecedor.
 */
export function parseConversao(texto: string): number | null {
  const t = texto.trim()
  if (t.includes('.') && t.includes(',')) return null
  if (!new RegExp(`^(\\d{1,5}|\\d{0,5}[.,]\\d{1,${CONVERSAO_CASAS}})$`).test(t)) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= CONVERSAO_MAXIMA ? n : null
}
/**
 * 0.395 → "0,395"; 1000 → "1000" (jeito brasileiro na vírgula, até 4 casas, sem zeros à toa e SEM ponto de milhar). Sem milhar de propósito: o texto
 * volta para o campo da caixa (o "Trocar" pré-preenche com ele) e parseConversao lê "1.000" como 1 — com o milhar, uma conversão de 1000 viraria 1 em
 * silêncio. Regra: parseConversao(formatarConversao(v)) tem de ser v.
 */
export const formatarConversao = (v: number): string => v.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: CONVERSAO_CASAS })
/**
 * A conversão como a tela a mostra (eco "Vai gravar", linha "confirmado no app", bloco "o robô vai associar"). "1 UN = 0,395 KG" só quando a unidade
 * do produto é CONFIÁVEL — situacaoConversao "obrigatoria", isto é, produto com "(KG)" no nome. Nos outros casos a unidade da lista do app é um palpite
 * ("un" para todo nome sem "(KG)") ou não existe (produto novo): escrever "1 UN = 2 UN" quando no SisChef o produto pode estar em PCT enganaria o
 * Ivan, então fica "1 UN = 2 na unidade do produto no SisChef" — a mesma frase nos três lugares, para a tela não se contradizer. Sem a unidade da
 * nota (decisão antiga, leitura sem unidade) não há com o que comparar: só "conversão 0,395".
 */
export function textoConversao(unidadeNota: string | null | undefined, unidadeProduto: string | null | undefined, conversao: number): string {
  const a = rotuloUnidade(unidadeNota)
  const v = formatarConversao(conversao)
  if (a === '') return `conversão ${v}`
  if (situacaoConversao(unidadeNota, unidadeProduto) === 'obrigatoria') return `1 ${a} = ${v} ${rotuloUnidade(unidadeProduto)}`
  return `1 ${a} = ${v} na unidade do produto no SisChef`
}
/**
 * Sugestão de conversão tirada do NOME da nota: "LEITE COND TIROL SEMIDES TP 395G" em UN → 1 UN = 0,395 KG. O Ivan só confere e corrige (a caixa mostra
 * o número já preenchido); nunca vai ao SisChef sem o Confirmar dele. Só sugere quando há UM peso claro no nome (g ou kg) e a nota está em UN: nota em
 * CX/PCT não vale (a caixa pode ter vários pacotes: a "2,5KG" da SEARA é o pacote, não a caixa) e nome com "12X395G" (embalagem múltipla) também não.
 * Devolve o peso em kg (até 4 casas) e o trecho que o gerou ("395G"), para a tela explicar de onde veio.
 */
export function pesoPeloNome(descricao: string | null | undefined, unidadeNota: string | null | undefined): { kg: number; trecho: string } | null {
  if (rotuloUnidade(unidadeNota) !== 'UN') return null
  const t = (descricao ?? '').replace(/^CÓD\. FOR:\s*\S+\s*/i, '')
  if (/\d\s*[xX]\s*\d/.test(t)) return null
  const achados = [...t.matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(KG|GRS?|G)(?![A-Za-z])/gi)]
  if (achados.length !== 1) return null
  const numero = Number(achados[0][1].replace(',', '.'))
  const eKg = achados[0][2].toUpperCase() === 'KG'
  const kg = Math.round((eKg ? numero : numero / 1000) * 10_000) / 10_000
  if (!Number.isFinite(kg) || kg <= 0 || kg > 50) return null
  return { kg, trecho: `${achados[0][1]}${achados[0][2].toUpperCase()}` }
}

/** A conversão da decisão foi informada (número > 0)? Decisão gravada antes da etapa 2 não tem o campo: conta como não informada (null). */
export const conversaoDaDecisao = (d: AssociacaoApp | null | undefined): number | null =>
  d != null && typeof d.conversao === 'number' && Number.isFinite(d.conversao) && d.conversao > 0 ? d.conversao : null
