// supabase/functions/confirmar-cupom/logica.ts
// Lógica pura da Edge Function confirmar-cupom: o Ivan corrige, DENTRO do app, um cupom parado em REVISAR por item sem produto confirmado
// (pedido dele, 07/10: "deixe eu corrigir as pendências no app" + "botão para reenviar"). Recebe, por item pendente, o produto do SisChef e a
// quantidade que está no cupom; refaz os itens, confere a soma contra o total (a mesma conta e tolerância do robô: cupom_valores.py), volta o
// cupom a PENDENTE, guarda o aprendizado confirmado (cupom_aprendizado) e dispara o robô. Sem foto nova nem leitura nova.
// Sem globais do Deno nem rede: banco e GitHub entram por `deps` (molde enviar-cupom/logica.ts). index.ts monta `deps` e chama `tratar`.
import { normalizar } from './normalizar.ts'
import { fraseDaRepetida, impressaoDaCompra, semTrechoDaFalha, semTrechoDaRepetida, trechoDaFalha, trechoDaRepetida, type Impressao, type Parecida } from './parecida.ts'

/** `outra_compra: true` (E5) = o Ivan viu o aviso "POSSÍVEL REPETIDA" deste cupom e disse que É outra compra: modo próprio, sem itens (ver `tratar`). */
/** `conferir_de_novo: true` (E5) = o robô não conseguiu conferir se a compra é repetida (falha passageira): confere DE NOVO e só então solta, SEM gravar a marca "outra compra" (a marca só vem de `outra_compra`). */
export interface Corpo { cupom_id?: unknown; itens?: unknown; so_confirmar?: unknown; reenviar_fornecedor?: unknown; outra_compra?: unknown; conferir_de_novo?: unknown }
/** O cupom está todo casado e só espera o Ivan conferir e confirmar (o mesmo texto de enviar-cupom/logica.ts e de src/admin/cupomRegras.ts). */
export const CONFIRMAR_PREFIXO = 'CONFIRMAR:'
/** O motivo que o robô de cupom grava quando o fornecedor não está no Sischef (cupom_navegador.py) — o app deixa cadastrá-lo e reenviar o cupom. */
export const FORNECEDOR_PREFIXO = /^fornecedor não encontrado no Sischef/i
/** O pedido de cadastro de fornecedor mais recente deste cupom (tabela fornecedor_cadastro). */
export interface CadastroLinha { cnpj: string; razao_social: string; estado: string }
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
  /** E5: preenchida = o Ivan já decidiu que esta compra NÃO é repetida (migração 20261226000001); nenhum portão a confere de novo. Ausente/nula = ainda não decidiu. */
  outra_compra_ok_em?: string | null
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
  atualizarCupom(id: string, itens: Record<string, unknown>[], extras?: Record<string, unknown>): Promise<boolean>
  /** O pedido de cadastro de fornecedor mais recente feito para este cupom (null = nenhum). */
  cadastroDoFornecedor(cupomId: string): Promise<CadastroLinha | null>
  gravarAprendizado(linha: LinhaAprendizado): Promise<void>
  dispararLancamento(cupomId: string): Promise<void>
  /**
   * E5 (pedido do Ivan, 04/11/2026): as compras PARECIDAS (mesmo CNPJ e total) que já existem, sem contar a própria (`ignorarId`). É o PORTÃO: antes de soltar o cupom para o robô, achou e o Ivan ainda
   * não disse que é outra compra ⇒ 409 com a frase. Erro da consulta ⇒ 503 (nunca solta às cegas). Ausente = nada muda (testes antigos).
   */
  buscarParecidas?(imp: Impressao, ignorarId: string): Promise<Parecida[]>
  /** Grava a frase no FIM do motivo (UPDATE condicionado: REVISAR, sem pedido, motivo igual ao lido) para o cartão do cupom mostrar os dois botões depois do 409. Melhor esforço: o 409 sai mesmo se falhar. */
  anotarRepetida?(id: string, motivoLido: string | null, frase: string): Promise<void>
  /** "É outra compra" com motivo que sobra: grava a marca (quando e quem) e troca o motivo por `motivoNovo` (UPDATE condicionado como acima). true se trocou exatamente a linha. */
  anotarOutraCompra?(id: string, motivoLido: string | null, motivoNovo: string, por: string): Promise<boolean>
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

const ERRO_CONFERIR_REPETIDA = 'Não consegui conferir se esta compra é repetida agora. Tente de novo em instantes.'
/**
 * E5 — o PORTÃO antes de soltar o cupom para o robô (autoridade; o aviso do `enviar-cupom` na criação só informa). Procura compra parecida (mesmo CNPJ FINAL e mesmo total) já lançada, na fila ou
 * esperando. null = pode seguir: sem a dependência (testes antigos), cupom de teste, o Ivan já decidiu ("é outra compra"), sem impressão digital (CNPJ ou total inválidos) ou nada parecido.
 * Achou: grava a frase no motivo (para o cartão mostrar os botões; melhor esforço) e devolve o 409 com a mesma frase. A consulta que falha NUNCA solta às cegas: 503 em texto simples.
 */
async function conferirRepetida(cupom: CupomLinha, cnpjFinal: string | null, deps: Deps): Promise<Resultado | null> {
  if (!deps.buscarParecidas || cupom.teste === true || cupom.outra_compra_ok_em) return null
  const imp = impressaoDaCompra(cnpjFinal, cupom.valor_a_pagar)
  if (!imp) return null
  let achadas: Parecida[]
  try { achadas = await deps.buscarParecidas(imp, cupom.id) } catch { return { status: 503, corpo: { erro: ERRO_CONFERIR_REPETIDA } } }
  if (achadas.length === 0) return null
  const frase = fraseDaRepetida(achadas, imp.centavos)
  try { await deps.anotarRepetida?.(cupom.id, cupom.motivo, frase) } catch { /* só ajuda o cartão a mostrar os botões: o 409 sai do mesmo jeito */ }
  return { status: 409, corpo: { erro: frase } }
}

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
  // "Reenviar este cupom" depois de cadastrar o fornecedor (pedido do Ivan, 08/10): também sem itens a confirmar
  const reenviarFornecedor = c.reenviar_fornecedor === true
  // "É outra compra" (E5, pedido do Ivan de 04/11): ele viu o aviso POSSÍVEL REPETIDA deste cupom e decidiu. Modo próprio: sem itens e sem os outros modos. Só o booleano true liga.
  const outraCompra = c.outra_compra === true
  const conferirDeNovo = c.conferir_de_novo === true
  if ((outraCompra && (soConfirmar || reenviarFornecedor || conferirDeNovo)) || (conferirDeNovo && (soConfirmar || reenviarFornecedor))) return { status: 400, corpo: { erro: 'peça um modo de cada vez' } }
  if ((outraCompra || conferirDeNovo) && Array.isArray(c.itens) && c.itens.length > 0) return { status: 400, corpo: { erro: 'a decisão de "outra compra" e o "tentar de novo" não levam itens nem outro modo' } }
  if ((soConfirmar || reenviarFornecedor) && Array.isArray(c.itens) && c.itens.length > 0) return { status: 400, corpo: { erro: 'confirmar o cupom inteiro não leva itens: confirme os itens um a um ou o cupom todo' } }
  const conf = soConfirmar || reenviarFornecedor || outraCompra || conferirDeNovo ? { ok: true as const, itens: [] as Confirmacao[] } : lerConfirmacoes(c.itens)
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
  if (outraCompra) {
    // só vale para o cupom que carrega o aviso (o trecho POSSÍVEL REPETIDA no motivo); o que "pode já estar no SisChef" já foi barrado acima (NAO_REENVIAVEL) e nunca passa por aqui
    if (trechoDaRepetida(cupom.motivo) === null) {
      return { status: 409, corpo: { erro: 'este cupom não está esperando a sua decisão de "outra compra" (já foi decidido, ou nunca houve aviso): atualize a tela' } }
    }
    const resto = semTrechoDaRepetida(cupom.motivo)
    const por = chamador.trim().toLowerCase()
    if (resto === '') {
      // o aviso era o ÚNICO motivo (o robô o grava assim, antes de abrir o SisChef): se tudo está casado e a soma fecha, a marca vai junto e o cupom volta à fila
      if (pendentes.length > 0) return { status: 409, corpo: { erro: 'este cupom ainda tem item sem produto: atualize a tela' } }
      const soma = conferirSoma(originais, total)
      if (!soma.bate) {
        return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}.`, soma: soma.soma, total } }
      }
      if (!(await deps.atualizarCupom(cupomId, originais, { outra_compra_ok_em: new Date().toISOString(), outra_compra_ok_por: por }))) {
        return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
      }
      let disparou = false
      try { await deps.dispararLancamento(cupomId); disparou = true } catch { /* quem registra o motivo é o index.ts */ }
      return { status: 200, corpo: { cupom_id: cupomId, estado: PENDENTE, resumo: disparou ? 'confirmado como outra compra e enviado para lançar' : AVISO_DISPARO_FALHOU, disparo_ok: disparou, lembrados: 0, nao_lembrados: 0 } }
    }
    // sobra motivo (CONFIRMAR:, itens sem produto…): só anota a decisão (a marca faz os portões deixarem passar) e tira o aviso; o cupom continua parado e o Ivan segue pelos botões de sempre
    if (!deps.anotarOutraCompra) return { status: 500, corpo: { erro: 'função sem a gravação da decisão' } }
    if (!(await deps.anotarOutraCompra(cupomId, cupom.motivo, resto, por))) {
      return { status: 409, corpo: { erro: 'este cupom mudou enquanto você decidia: atualize a tela' } }
    }
    return { status: 200, corpo: { cupom_id: cupomId, estado: REVISAR, resumo: 'anotado: você disse que é outra compra. Siga com o cupom como de costume.', disparo_ok: false, lembrados: 0, nao_lembrados: 0 } }
  }
  if (conferirDeNovo) {
    // "Tentar de novo" (E5): só vale para o cupom parado SÓ porque o robô não conseguiu conferir se a compra é repetida (nada foi tocado no SisChef). Confere de novo (o portão) e, nada achando, solta
    // como PENDENTE SEM gravar a marca "outra compra" (a marca é decisão do Ivan, não de uma falha passageira). Achou: 409 com a frase, e o aviso de repetida troca o da falha no motivo.
    if (trechoDaFalha(cupom.motivo) === null || semTrechoDaFalha(cupom.motivo) !== '') {
      return { status: 409, corpo: { erro: 'este cupom não está esperando só a conferência de compra repetida: atualize a tela' } }
    }
    if (pendentes.length > 0) return { status: 409, corpo: { erro: 'este cupom ainda tem item sem produto: atualize a tela' } }
    const soma = conferirSoma(originais, total)
    if (!soma.bate) {
      return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}.`, soma: soma.soma, total } }
    }
    const barradoC = await conferirRepetida(cupom, cupom.emitente_cnpj, deps)
    if (barradoC) return barradoC
    if (!(await deps.atualizarCupom(cupomId, originais))) {
      return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
    }
    let disparou = false
    try { await deps.dispararLancamento(cupomId); disparou = true } catch { /* quem registra o motivo é o index.ts */ }
    return { status: 200, corpo: { cupom_id: cupomId, estado: PENDENTE, resumo: disparou ? 'conferido de novo e enviado para lançar' : AVISO_DISPARO_FALHOU, disparo_ok: disparou, lembrados: 0, nao_lembrados: 0 } }
  }
  if (reenviarFornecedor) {
    // só vale para o cupom parado por fornecedor não cadastrado, com todos os itens já com produto, depois de o cadastro do fornecedor ter dado certo
    if (!FORNECEDOR_PREFIXO.test((cupom.motivo ?? '').trim()) || pendentes.length > 0) {
      return { status: 409, corpo: { erro: 'este cupom não está parado só por fornecedor não cadastrado: atualize a tela' } }
    }
    const cadastro = await deps.cadastroDoFornecedor(cupomId)
    if (!cadastro || (cadastro.estado !== 'CADASTRADO' && cadastro.estado !== 'JA_EXISTIA')) {
      return { status: 409, corpo: { erro: 'o fornecedor ainda não foi cadastrado no SisChef: espere o aviso de cadastro pronto' } }
    }
    const soma = conferirSoma(originais, total)
    if (!soma.bate) {
      return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}.`, soma: soma.soma, total } }
    }
    // o robô acha o fornecedor pelo CNPJ do cupom: se o Ivan corrigiu o CNPJ ao cadastrar, o cupom passa a trazer o cadastrado
    const extras = cadastro.cnpj !== cupom.emitente_cnpj ? { emitente_cnpj: cadastro.cnpj, emitente_nome: cadastro.razao_social } : undefined
    // E5: o portão confere com o CNPJ FINAL (o do cadastro), não com o que a leitura da foto trouxe torto
    const barradoF = await conferirRepetida(cupom, extras?.emitente_cnpj ?? cupom.emitente_cnpj, deps)
    if (barradoF) return barradoF
    if (!(await deps.atualizarCupom(cupomId, originais, extras))) {
      return { status: 409, corpo: { erro: 'este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela' } }
    }
    let disparou = false
    try { await deps.dispararLancamento(cupomId); disparou = true } catch { /* quem registra o motivo é o index.ts */ }
    return { status: 200, corpo: { cupom_id: cupomId, estado: PENDENTE, resumo: disparou ? 'reenviado para lançar' : AVISO_DISPARO_FALHOU, disparo_ok: disparou, lembrados: 0, nao_lembrados: 0 } }
  }
  if (soConfirmar) {
    // só vale para o cupom que o envio deixou esperando a confirmação (motivo CONFIRMAR:) e em que todo item já tem produto
    if (!(cupom.motivo ?? '').trim().startsWith(CONFIRMAR_PREFIXO) || pendentes.length > 0) {
      return { status: 409, corpo: { erro: 'este cupom ainda tem item sem produto (ou não está esperando só a sua confirmação): atualize a tela' } }
    }
    const soma = conferirSoma(originais, total)
    if (!soma.bate) {
      return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}.`, soma: soma.soma, total } }
    }
    const barradoS = await conferirRepetida(cupom, cupom.emitente_cnpj, deps)   // E5: o portão
    if (barradoS) return barradoS
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
  // diferentes o 2º gravaria por cima do 1º em silêncio — melhor recusar e pedir o MESMO produto nos dois (a caixinha "Lembrar" saiu da tela em 08/10; texto trocado em 13/11); com o mesmo produto basta uma linha.
  const chaveDe = (l: LinhaAprendizado) => l.codigo_barras ?? `${l.emitente_cnpj}|${l.descricao_norm}`
  const porChave = new Map<string, { linha: LinhaAprendizado; indice: number }>()
  for (const a of aprendizados) {
    const outro = porChave.get(chaveDe(a.linha))
    if (!outro) { porChave.set(chaveDe(a.linha), a); continue }
    if (outro.linha.insumo_id !== a.linha.insumo_id) {
      return { status: 400, corpo: { erro: `os itens ${outro.indice + 1} e ${a.indice + 1} têm a mesma descrição no cupom e produtos diferentes: escolha o mesmo produto nos dois (toque em "Editar" no item para trocar)` } }
    }
  }
  const linhasDeAprendizado = [...porChave.values()].map((a) => a.linha)

  // 5. a soma tem de bater com o total (senão o robô recusaria depois do disparo, e o app mostra o erro agora).
  const soma = conferirSoma(itens, total)
  if (!soma.bate) {
    return { status: 400, corpo: { erro: `a soma dos itens (${brl(soma.soma)}) não bate com o total do cupom (${brl(total)}): diferença de ${brl(Math.abs(soma.diferenca))}. Confira os pesos.`, soma: soma.soma, total } }
  }

  // 5b. E5: o portão (compra parecida já lançada/na fila/esperando): antes de gravar o que quer que seja (nem o aprendizado), só avisa; o Ivan responde "é outra compra" ou exclui.
  const barrado = await conferirRepetida(cupom, cupom.emitente_cnpj, deps)
  if (barrado) return barrado

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
