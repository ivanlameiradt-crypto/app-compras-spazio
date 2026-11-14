// Sugestões ESTRUTURADAS que o robô grava junto do motivo (etapa 6 do inventário dos erros do robô, 14/11/2026; migração 20261229000001).
// Formato: lista de { codigo, item_n, acao, dados }, com `dados` só de números e ids. A frase que o Ivan lê mora AQUI (no app), nunca no banco.
// REGRA: o app PREFERE a sugestão a adivinhar pelo texto, mas só quando ela é bem formada E o texto do motivo não mostra nenhum sinal de que algo foi criado no SisChef (cinto e suspensório:
// o robô diz que é seguro, o app confere de novo). Sem sugestões (coluna nula, ausente ou torta), tudo é igual a antes: vale o texto. Sem rede nem React.
import type { EstadoLancamentoNfe, ItemNotaSefaz, NotaSefazLista, SugestaoDoRobo } from '../lib/tipos'
import { conversoesDesnecessarias, motivoSemPrefixoTecnico, semSinalDeLancamento } from './motivoDoRobo'
import type { MotivoConversaoDesnecessaria } from './motivoDoRobo'

export const CODIGO_CONVERSAO_DESNECESSARIA = 'conversao_desnecessaria'
export const CODIGO_ITENS_MESMO_CODIGO = 'itens_mesmo_codigo'
export const CODIGO_FALHA_PASSAGEIRA = 'falha_passageira'

const inteiroPositivo = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0

/** As sugestões como vêm do banco (jsonb) -> só as bem formadas. Nulo, vazio, lixo ou nenhuma boa = null (vale o texto). Código desconhecido fica na lista: quem não o entende o ignora. */
export function sugestoesLidas(x: unknown): SugestaoDoRobo[] | null {
  if (!Array.isArray(x)) return null
  const boas: SugestaoDoRobo[] = []
  for (const s of x) {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) continue
    const o = s as Record<string, unknown>
    if (typeof o.codigo !== 'string' || o.codigo.trim() === '' || typeof o.acao !== 'string' || o.acao.trim() === '') continue
    if (o.item_n !== null && o.item_n !== undefined && !inteiroPositivo(o.item_n)) continue
    if (o.dados === null || typeof o.dados !== 'object' || Array.isArray(o.dados)) continue
    boas.push({ codigo: o.codigo, item_n: (o.item_n as number | null | undefined) ?? null, acao: o.acao, dados: o.dados as Record<string, unknown> })
  }
  return boas.length > 0 ? boas : null
}

const doCodigo = (lista: SugestaoDoRobo[] | null | undefined, codigo: string): SugestaoDoRobo[] => (Array.isArray(lista) ? lista.filter((s) => s.codigo === codigo) : [])
const textoDe = (motivo: string | null | undefined): string => (motivo ?? '').replace(/\s+/g, ' ').trim()
/** A sugestão só vale em "revisar" e quando o texto não mostra sinal de lançamento (pedido já gerado, pela metade, queda depois de começar, texto cortado em 2.000 letras…). */
// (além dos sinais de semSinalDeLancamento: qualquer pedido de conferir no SisChef ou marca de clique dado)
const SINAL_EXTRA = /confer(?:ir|a) no SisChef|_CLICADO|pedido (?:JÁ )?(?:criado|gerado)|Gerar compra|Finalizar compra/i
const podeConfiar = (estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined): boolean =>
  estado === 'revisar' && semSinalDeLancamento(textoDe(motivo)) && !SINAL_EXTRA.test(textoDe(motivo))

const tirarCodForDoNome = (d: string): string => d.replace(/^\s*C[OÓ]D\.?\s*FOR:?\s*\S+\s*(?:##)?\s*/i, '').replace(/\s*-\s*INSUMOS\s*$/i, '').replace(/\s+/g, ' ').trim()
const numeroComoORoboEscreve = (n: number): string => String(n).replace('.', ',')

/**
 * Conversão que não precisava (nota e produto na mesma unidade) pela SUGESTÃO do robô: o item (pelo `item_n`, com o nome vindo da própria nota) e o número informado. `resto` = o que o
 * texto do motivo diz ALÉM disto (vazio = é só este problema); se o app não reconhece o texto, o resto é o texto inteiro (a tela o mostra e o "lança junto" não vale). Texto que cita itens
 * diferentes dos da sugestão = dúvida = null (vale o caminho do texto). Sem sugestão válida, null.
 */
export function conversoesDaSugestao(n: Pick<NotaSefazLista, 'lancamento_estado' | 'lancamento_motivo' | 'lancamento_sugestoes' | 'itens'>): MotivoConversaoDesnecessaria | null {
  const sugestoes = doCodigo(n.lancamento_sugestoes, CODIGO_CONVERSAO_DESNECESSARIA)
  if (sugestoes.length === 0 || !podeConfiar(n.lancamento_estado, n.lancamento_motivo)) return null
  const itens: MotivoConversaoDesnecessaria['itens'] = []
  for (const s of sugestoes) {
    const numero = typeof s.dados.numero === 'number' ? s.dados.numero : NaN
    if (!inteiroPositivo(s.item_n) || !Number.isFinite(numero) || numero <= 0) return null // sugestão torta: nada de adivinhar
    if (itens.some((x) => x.n === s.item_n)) continue
    const daNota: ItemNotaSefaz | undefined = (n.itens ?? []).find((it) => it.n === s.item_n)
    itens.push({ n: s.item_n, nome: (daNota ? tirarCodForDoNome(daNota.descricao ?? '') : '') || `item ${s.item_n}`, unidade: (daNota?.unidade_sischef ?? '').trim(), numero: numeroComoORoboEscreve(numero) })
  }
  const texto = textoDe(n.lancamento_motivo)
  const lidoPeloTexto = conversoesDesnecessarias(texto)
  if (lidoPeloTexto) {
    const doTexto = lidoPeloTexto.itens.map((x) => x.n).sort((a, b) => a - b).join(',')
    if (doTexto !== itens.map((x) => x.n).sort((a, b) => a - b).join(',')) return null
    return { itens, resto: lidoPeloTexto.resto }
  }
  return { itens, resto: motivoSemPrefixoTecnico(texto) }
}

/** Dois itens da nota com o mesmo CÓD. FOR (o robô não sabe qual associar): os números dos itens e o código, pela sugestão. Sem sugestão boa ou sem a certeza de que nada foi lançado, null. */
export function itensMesmoCodigoDeSugestoes(estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined, sugestoes: SugestaoDoRobo[] | null | undefined): { itens: number[]; codFor: string } | null {
  const s = doCodigo(sugestoes, CODIGO_ITENS_MESMO_CODIGO)[0]
  if (!s || !podeConfiar(estado, motivo)) return null
  const bruto = Array.isArray(s.dados.itens) ? s.dados.itens : []
  const itens = [...new Set(bruto.filter(inteiroPositivo))].sort((a, b) => a - b)
  const cod = typeof s.dados.cod_for === 'string' || typeof s.dados.cod_for === 'number' ? String(s.dados.cod_for).trim() : ''
  if (itens.length < 2 || itens.length !== bruto.length || cod === '') return null
  return { itens, codFor: cod }
}
export const itensMesmoCodigoDaSugestao = (n: Pick<NotaSefazLista, 'lancamento_estado' | 'lancamento_motivo' | 'lancamento_sugestoes'>) =>
  itensMesmoCodigoDeSugestoes(n.lancamento_estado, n.lancamento_motivo, n.lancamento_sugestoes)

/** "1 e 2", "1, 2 e 3". */
export const listaDeItens = (itens: number[]): string => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`)
export function fraseItensMesmoCodigo(x: { itens: number[]; codFor: string }): string {
  return `Precisa de você — nada foi lançado.\nPor quê: Os itens ${listaDeItens(x.itens)} da nota têm o mesmo código do fornecedor (${x.codFor}), e o robô não sabe qual é qual.\nO que fazer: associe esses itens direto no SisChef e lance de novo.`
}

/** O robô PROVOU que a falha foi passageira e que nada foi criado no SisChef (`dados.nada_criado` = 1)? O app ainda confere o texto: nenhum sinal de lançamento, senão não vale. */
export function falhaPassageiraDeSugestoes(estado: EstadoLancamentoNfe | null | undefined, motivo: string | null | undefined, sugestoes: SugestaoDoRobo[] | null | undefined): boolean {
  const s = doCodigo(sugestoes, CODIGO_FALHA_PASSAGEIRA)[0]
  return s != null && s.dados.nada_criado === 1 && podeConfiar(estado, motivo)
}
export const falhaPassageiraDaSugestao = (n: Pick<NotaSefazLista, 'lancamento_estado' | 'lancamento_motivo' | 'lancamento_sugestoes'>): boolean =>
  falhaPassageiraDeSugestoes(n.lancamento_estado, n.lancamento_motivo, n.lancamento_sugestoes)
