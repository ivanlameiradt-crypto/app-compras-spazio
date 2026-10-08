// supabase/functions/confirmar-cupom/logica.ts
// Lógica pura da Edge Function confirmar-cupom: o Ivan corrige, DENTRO do app, um cupom parado em REVISAR por item sem produto confirmado
// (pedido dele, 07/10: "deixe eu corrigir as pendências no app" + "botão para reenviar"). Recebe, por item pendente, o produto do SisChef e a
// quantidade que está no cupom; refaz os itens, confere a soma contra o total (a mesma conta e tolerância do robô: cupom_valores.py), volta o
// cupom a PENDENTE, guarda o aprendizado confirmado (cupom_aprendizado) e dispara o robô. Sem foto nova nem leitura nova.
// Sem globais do Deno nem rede: banco e GitHub entram por `deps` (molde enviar-cupom/logica.ts). index.ts monta `deps` e chama `tratar`.
import { normalizar } from './normalizar.ts'

export interface Corpo { cupom_id?: unknown; itens?: unknown; so_confirmar?: unknown }
/** O cupom está todo casado e só espera o Ivan conferir e confirmar (o mesmo texto de enviar-cupom/logica.ts e de src/admin/cupomRegras.ts). */
export const CONFIRMAR_PREFIXO = 'CONFIRMAR:'
export interface UsuarioLinha { papel: string; ativo: boolean }
/** A linha `cupom` como o banco a devolve (itens em JSONB; numeric pode vir como texto). */
export interface CupomLinha {
  id: string
  estado: string
  pedido_sischef: string | null
  motivo: string | null
  itens: unknown
  valor_a_pagar: number | string | null
  emitente_cnpj: string | null
  teste: boolean | null
}
/** Um produto da lista de insumos do app (itens_semana). */
export interface Produto { id: string; nome: string | null; unidade: string | null }
/** Uma linha de cupom_aprendizado a gravar (confirmada). */
export interface LinhaAprendizado {
  codigo_barras: string | null
  emitente_cnpj: string | null
  descricao_norm: string | null
  insumo_id: string
  insumo_nome: string | null
  fator_conversao: number
  unidade_destino: string | null
  confirmado: true
}
/** O que o app manda por item pendente (ver ConfirmacaoItemCupom em src/lib/tipos.ts). */
export interface Confirmacao { indice: number; insumo_id: string; quantidade: number; entrada: number | null; lembrar: boolean }

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  lerCupom(id: string): Promise<CupomLinha | null>
  buscarProduto(id: string): Promise<Produto | null>
  /** UPDATE condicionado (estado REVISAR e sem pedido): true se trocou exatamente a linha; false se ela já não estava assim. */
  atualizarCupom(id: string, itens: Record<string, unknown>[]): Promise<boolean>
  gravarAprendizado(linha: LinhaAprendizado): Promise<void>
  dispararLancamento(cupomId: string): Promise<void>
}

export interface Resultado { status: number; corpo: Record<string, unknown> }

/** A mesma tolerância do robô (cupom_valores.conferir_total): ele fecha até 2 centavos no desconto da última linha. */
export const TOLERANCIA = 0.02
const PENDENTE = 'PENDENTE'
const REVISAR = 'REVISAR'
/** Motivos em que algo PODE ter chegado ao SisChef (ou nada há para corrigir): reenviar pelo app poderia duplicar a compra. */
const NAO_REENVIAVEL = /^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO|^falha ao preencher o pagamento no Sischef|já lançado em outro envio|não consegui ler a foto/i
const AVISO_DISPARO_FALHOU =
  'corrigido, mas o disparo automático falhou — o cupom ficou na fila e nada vai lançá-lo sozinho; só depois de uns 60 min o sistema o marca para você conferir'

const round2 = (v: number) => Math.round(v * 100) / 100
const round3 = (v: number) => Math.round(v * 1000) / 1000
const ehNumPositivo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const ehCnpj = (v: unknown): v is string => typeof v === 'string' && /^\d{14}$/.test(v)
/**
 * Código de barras que pode ser CHAVE GLOBAL de aprendizado (vale para qualquer fornecedor): um GTIN de verdade — EAN-8, UPC-12, EAN-13 ou
 * GTIN-14 — com o dígito verificador certo (módulo 10 do GS1) e que não é só zeros. Qualquer outra sequência de dígitos lida na foto (código
 * interno do mercado, EAN cortado na borda, o "0000000000000" dos itens pesados) NÃO serve: dois fornecedores podem imprimir o mesmo número
 * para produtos diferentes, e o casamento por EAN (enviar-cupom/casamento.ts) não confere descrição nem fornecedor — o robô lançaria o produto
 * errado em silêncio. Esses caem na chave (CNPJ do emitente, descrição), que só vale para aquele fornecedor. Espelho: cupomCorrigirRegras.ts.
 */
export function ehGtin(v: unknown): v is string {
  if (typeof v !== 'string' || !/^(\d{8}|\d{12,14})$/.test(v) || /^0+$/.test(v)) return false
  let soma = 0
  for (let i = v.length - 1, peso = 1; i >= 0; i--, peso = 4 - peso) soma += Number(v[i]) * peso
  return soma % 10 === 0
}
/** Unidade comparável: "UN", "UND", "UNID" e "PC" são a mesma coisa para a conversão; o resto fica como veio (kg, cx, l). */
export function unidadeNorm(u: unknown): string {
  const t = String(u ?? '').trim().toLowerCase()
  return /^(un|und|unid|unidade|pc|pç)$/.test(t) ? 'un' : t
}

type Item = Record<string, unknown>
const semProduto = (it: Item): boolean => String((it.sugestao_produto as { id?: unknown } | null)?.id ?? '').trim() === ''

/** Valida e normaliza a lista de confirmações do corpo; texto de erro ou a lista. */
export function lerConfirmacoes(v: unknown): { ok: true; itens: Confirmacao[] } | { ok: false; erro: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, erro: 'nenhum item confirmado' }
  const itens: Confirmacao[] = []
  const vistos = new Set<number>()
  for (const bruto of v) {
    if (bruto === null || typeof bruto !== 'object') return { ok: false, erro: 'item em formato inválido' }
    const c = bruto as Record<string, unknown>
    const indice = c.indice
    if (typeof indice !== 'number' || !Number.isInteger(indice) || indice < 0) return { ok: false, erro: 'item sem posição válida' }
    if (vistos.has(indice)) return { ok: false, erro: `item ${indice + 1} confirmado duas vezes` }
    vistos.add(indice)
    const insumoId = String(c.insumo_id ?? '').trim()
    if (!/^\d{1,12}$/.test(insumoId)) return { ok: false, erro: `item ${indice + 1}: código do produto inválido` }
    if (!ehNumPositivo(c.quantidade)) return { ok: false, erro: `item ${indice + 1}: quantidade inválida (precisa ser maior que zero)` }
    let entrada: number | null = null
    if (c.entrada !== undefined && c.entrada !== null) {
      if (!ehNumPositivo(c.entrada)) return { ok: false, erro: `item ${indice + 1}: quantidade do estoque inválida (precisa ser maior que zero)` }
      entrada = c.entrada
    }
    itens.push({ indice, insumo_id: insumoId, quantidade: c.quantidade, entrada, lembrar: c.lembrar === true })
  }
  return { ok: true, itens }
}

/**
 * O item refeito com a confirmação: produto, `entrada_estoque` na unidade do produto e o preço por unidade DO ESTOQUE (com conversão o valor
 * da linha é preservado: quantidade × preço do cupom ÷ entrada — a mesma regra do casamento automático, enviar-cupom/casamento.ts). Devolve
 * também o fator (entrada ÷ quantidade) para o aprendizado. Texto de erro quando a conta não fecha (entrada que arredonda para zero).
 */
export function refazerItem(original: Item, c: Confirmacao): { ok: true; item: Item; fator: number } | { ok: false; erro: string } {
  const precoCupom = Number(original.valor_unitario)
  if (!Number.isFinite(precoCupom) || precoCupom < 0) return { ok: false, erro: `item ${c.indice + 1}: preço do cupom inválido` }
  const entrada = round3(c.entrada ?? c.quantidade)
  if (!(entrada > 0)) return { ok: false, erro: `item ${c.indice + 1}: a quantidade do estoque arredonda para zero` }
  const converte = c.entrada !== null && Math.abs(c.entrada - c.quantidade) > 1e-9
  const valorUnitario = converte ? (c.quantidade * precoCupom) / entrada : precoCupom
  const fator = converte ? entrada / c.quantidade : 1
  const desconto = Number(original.desconto_item ?? 0)
  return {
    ok: true,
    fator,
    item: {
      ...original,
      sugestao_produto: { id: c.insumo_id },
      entrada_estoque: entrada,
      valor_unitario: valorUnitario,
      desconto_item: Number.isFinite(desconto) ? desconto : 0,
      casado_por: 'app',
      proposta: null,
      quantidade_cupom: c.quantidade,
    },
  }
}

/** A soma das linhas como o robô a calcula (cada linha arredondada a 2 casas) e a diferença para o total. */
export function conferirSoma(itens: Item[], total: number): { soma: number; diferenca: number; bate: boolean } {
  let soma = 0
  for (const it of itens) soma += round2(Number(it.entrada_estoque ?? 0) * Number(it.valor_unitario ?? 0) - Number(it.desconto_item ?? 0))
  soma = round2(soma)
  const diferenca = round2(soma - round2(total))
  return { soma, diferenca, bate: Math.abs(diferenca) <= TOLERANCIA + 1e-9 }
}

/** A linha de aprendizado de um item confirmado: por GTIN válido (global) ou por (CNPJ do emitente, descrição); null quando não há como lembrar. */
export function linhaDeAprendizado(item: Item, c: Confirmacao, produto: Produto, emitenteCnpj: string | null, fator: number): LinhaAprendizado | null {
  const base = { insumo_id: c.insumo_id, insumo_nome: produto.nome, fator_conversao: fator, unidade_destino: produto.unidade, confirmado: true as const }
  if (ehGtin(item.codigo_barras)) return { codigo_barras: item.codigo_barras, emitente_cnpj: null, descricao_norm: null, ...base }
  const desc = normalizar(typeof item.descricao_cupom === 'string' ? item.descricao_cupom : '')
  if (ehCnpj(emitenteCnpj) && desc !== '') return { codigo_barras: null, emitente_cnpj: emitenteCnpj, descricao_norm: desc, ...base }
  return null
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  // 1. autoriza (admin ativo) — a RLS é a trava real; isto é defesa em profundidade, como nas outras funções.
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  // 2. valida a entrada.
  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const cupomId = typeof c.cupom_id === 'string' ? c.cupom_id.trim() : ''
  if (!/^[0-9a-f-]{36}$/i.test(cupomId)) return { status: 400, corpo: { erro: 'sem o cupom' } }
  // "Confirmar e lançar" de um cupom em que TODOS os itens já vieram conhecidos (pedido do Ivan, 08/10): sem itens a confirmar um a um.
  const soConfirmar = c.so_confirmar === true
  if (soConfirmar && Array.isArray(c.itens) && c.itens.length > 0) return { status: 400, corpo: { erro: 'confirmar o cupom inteiro não leva itens: confirme os itens um a um ou o cupom todo' } }
  const conf = soConfirmar ? { ok: true as const, itens: [] as Confirmacao[] } : lerConfirmacoes(c.itens)
  if (!conf.ok) return { status: 400, corpo: { erro: conf.erro } }

  // 3. o cupom tem de estar parado por item sem produto, e nada pode ter chegado ao SisChef.
  const cupom = await deps.lerCupom(cupomId)
  if (!cupom) return { status: 404, corpo: { erro: 'cupom não encontrado' } }
  if (cupom.estado !== REVISAR || cupom.pedido_sischef) {
    return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
  }
  if (NAO_REENVIAVEL.test((cupom.motivo ?? '').trim())) {
    return { status: 409, corpo: { erro: 'este cupom pode já ter chegado ao SisChef (ou não tem itens lidos): não dá para reenviar pelo app; peça ao Claude conferir' } }
  }
  const total = Number(cupom.valor_a_pagar)
  if (!(total > 0)) return { status: 409, corpo: { erro: 'o total deste cupom não foi lido: sem ele não dá para conferir a soma; peça ao Claude' } }
  const originais = Array.isArray(cupom.itens) ? (cupom.itens as Item[]) : []
  const pendentes = originais.map((it, i) => (semProduto(it) ? i : -1)).filter((i) => i >= 0)
  if (soConfirmar) {
    // só vale para o cupom que o envio deixou esperando a confirmação (motivo CONFIRMAR:) e em que todo item já tem produto
    if (!(cupom.motivo ?? '').trim().startsWith(CONFIRMAR_PREFIXO) || pendentes.length > 0) {
      return { status: 409, corpo: { erro: 'este cupom ainda tem item sem produto (ou não está esperando só a sua confirmação): atualize a tela' } }
    }
    const soma = conferirSoma(originais, total)
    if (!soma.bate) {
      return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}.`, soma: soma.soma, total } }
    }
    if (!(await deps.atualizarCupom(cupomId, originais))) {
      return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
    }
    let disparou = false
    try { await deps.dispararLancamento(cupomId); disparou = true } catch { /* quem registra o motivo é o index.ts */ }
    return { status: 200, corpo: { cupom_id: cupomId, estado: PENDENTE, resumo: disparou ? 'confirmado e enviado para lançar' : AVISO_DISPARO_FALHOU, disparo_ok: disparou, lembrados: 0, nao_lembrados: 0 } }
  }
  if (pendentes.length === 0) return { status: 409, corpo: { erro: 'este cupom não tem item sem produto para confirmar' } }
  const faltando = pendentes.filter((i) => !conf.itens.some((x) => x.indice === i))
  if (faltando.length > 0) return { status: 400, corpo: { erro: `falta confirmar o item ${faltando.map((i) => i + 1).join(', ')}` } }
  const sobrando = conf.itens.filter((x) => !pendentes.includes(x.indice))
  if (sobrando.length > 0) return { status: 400, corpo: { erro: `o item ${sobrando.map((x) => x.indice + 1).join(', ')} já tem produto confirmado (ou não existe)` } }

  // 4. produtos e itens refeitos.
  const itens: Item[] = [...originais]
  const aprendizados: { linha: LinhaAprendizado; indice: number }[] = []
  let naoLembrados = 0
  for (const x of conf.itens) {
    const produto = await deps.buscarProduto(x.insumo_id)
    if (!produto) return { status: 400, corpo: { erro: `item ${x.indice + 1}: o produto cód. ${x.insumo_id} não está na lista de insumos do app` } }
    const original = originais[x.indice]
    const uCupom = unidadeNorm(original.unidade_cupom)
    const uProduto = unidadeNorm(produto.unidade)
    const unidadesDiferem = uCupom !== '' && uProduto !== '' && uCupom !== uProduto
    if (x.entrada === null && unidadesDiferem) {
      return { status: 400, corpo: { erro: `item ${x.indice + 1}: o cupom está em ${uCupom.toUpperCase()} e o produto é em ${uProduto.toUpperCase()}: informe quanto entra no estoque em ${uProduto.toUpperCase()}` } }
    }
    // o servidor não confia na tela: uma "conversão" entre unidades iguais (0,5 kg que "entram" como 0,4 kg) gravaria um fator que encolheria
    // o estoque em todos os próximos cupons deste item
    if (x.entrada !== null && !unidadesDiferem) {
      return { status: 400, corpo: { erro: `item ${x.indice + 1}: o cupom e o produto estão na mesma unidade (ou a unidade não é conhecida): não informe quanto entra no estoque` } }
    }
    const refeito = refazerItem(original, x)
    if (!refeito.ok) return { status: 400, corpo: { erro: refeito.erro } }
    itens[x.indice] = refeito.item
    if (x.lembrar) {
      const linha = linhaDeAprendizado(original, x, produto, cupom.emitente_cnpj, refeito.fator)
      if (linha) aprendizados.push({ linha, indice: x.indice }); else naoLembrados += 1
    }
  }
  // Dois itens do mesmo cupom com a MESMA chave de aprendizado (mesmo código de barras, ou mesma descrição deste fornecedor): com produtos
  // diferentes o 2º gravaria por cima do 1º em silêncio — melhor recusar e deixar o Ivan desmarcar um "Lembrar"; com o mesmo produto basta uma linha.
  const chaveDe = (l: LinhaAprendizado) => l.codigo_barras ?? `${l.emitente_cnpj}|${l.descricao_norm}`
  const porChave = new Map<string, { linha: LinhaAprendizado; indice: number }>()
  for (const a of aprendizados) {
    const outro = porChave.get(chaveDe(a.linha))
    if (!outro) { porChave.set(chaveDe(a.linha), a); continue }
    if (outro.linha.insumo_id !== a.linha.insumo_id) {
      return { status: 400, corpo: { erro: `os itens ${outro.indice + 1} e ${a.indice + 1} têm a mesma descrição no cupom e produtos diferentes: desmarque "Lembrar" em um deles` } }
    }
  }
  const linhasDeAprendizado = [...porChave.values()].map((a) => a.linha)

  // 5. a soma tem de bater com o total (senão o robô recusaria depois do disparo, e o app mostra o erro agora).
  const soma = conferirSoma(itens, total)
  if (!soma.bate) {
    return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}. Confira os pesos.`, soma: soma.soma, total } }
  }

  // 6. grava os itens e volta a PENDENTE — só se o cupom AINDA estiver REVISAR sem pedido (compara-e-troca contra uma tela velha).
  if (!(await deps.atualizarCupom(cupomId, itens))) {
    return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
  }

  // 7. aprendizado: depois de o cupom já estar na fila; uma falha aqui não desfaz a correção (só fica para a próxima vez).
  let lembrados = 0
  for (const linha of linhasDeAprendizado) {
    try { await deps.gravarAprendizado(linha); lembrados += 1 } catch { naoLembrados += 1 }
  }

  // 8. dispara. Falha de disparo NÃO desfaz: a linha fica PENDENTE (o reaper a marca para conferência depois de 60 min).
  let disparoOk = false
  try { await deps.dispararLancamento(cupomId); disparoOk = true } catch { /* quem registra o motivo é o index.ts */ }
  const resumo = disparoOk ? 'corrigido e reenviado para lançar' : AVISO_DISPARO_FALHOU
  return { status: 200, corpo: { cupom_id: cupomId, estado: PENDENTE, resumo, disparo_ok: disparoOk, lembrados, nao_lembrados: naoLembrados } }
}
