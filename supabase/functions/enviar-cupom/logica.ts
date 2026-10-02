// supabase/functions/enviar-cupom/logica.ts
// Lógica pura da Edge Function enviar-cupom. Sem globais do Deno nem rede: o SDK, o banco, o storage e o GitHub entram
// por `deps` (molde gerenciar-usuarios/cot-ler-resposta). index.ts monta `deps` e chama `tratar`.
import { ESQUEMA_CUPOM, validarSaidaCupom, type LeituraCupomIA } from './esquema.ts'
import { SISTEMA } from './prompt.ts'
import { casarItens, type Aprendizado } from './casamento.ts'
import { normalizar } from './normalizar.ts'

export interface Pagamento { forma: string; conta?: string }
export interface Corpo { foto_path?: unknown; pagamento?: unknown; teste?: unknown }
export interface ImagemBase64 { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export type PedidoModelo = Record<string, unknown>
export interface ModeloResposta { stop_reason: string; texto: string }
export interface UsuarioLinha { papel: string; ativo: boolean }

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  acharCupomPorFoto(fotoPath: string): Promise<{ id: string } | null>
  baixarFoto(fotoPath: string): Promise<ImagemBase64>
  chamarModelo(pedido: PedidoModelo): Promise<{ ok: true; resp: ModeloResposta } | { ok: false }>
  buscarAprendizado(eans: string[], chaves: { cnpj: string; desc: string }[]): Promise<Aprendizado[]>
  /**
   * Grava a linha. `duplicado: true` = o insert bateu num índice único (corrida no mesmo foto_path, ou 2ª foto do mesmo
   * cupom, que repete a `chave`): devolve a linha JÁ EXISTENTE e `tratar` NÃO dispara (o dono do insert é quem dispara).
   */
  inserirCupom(linha: Record<string, unknown>): Promise<{ id: string; duplicado?: boolean }>
  dispararLancamento(cupomId: string): Promise<void>
}

export interface Resultado { status: number; corpo: Record<string, unknown> }

const PENDENTE = 'PENDENTE'
const REVISAR = 'REVISAR'
const FORMAS_A_VISTA = new Set(['dinheiro', 'tesouraria', 'pix'])
// O que o Ivan lê quando a linha foi gravada (PENDENTE) mas o workflow não foi disparado. Nada o relança sozinho: o reaper do
// Plano 1 roda a cada 30 min e só marca como REVISAR ("conferir no Sischef") o PENDENTE com mais de 60 min, e então avisa o Ivan.
const AVISO_DISPARO_FALHOU =
  'enviado, mas o disparo automático falhou — o cupom ficou PENDENTE e nada vai lançá-lo sozinho; só depois de uns 60 min o sistema o marca para você conferir'

/** O pagamento vem do botão do Ivan: forma obrigatória; à vista/pix exigem conta (= MAPA_PIX). Nunca assume cartão. */
export function validarPagamento(pg: unknown): { ok: true; pagamento: Pagamento } | { ok: false; erro: string } {
  if (pg === null || typeof pg !== 'object') return { ok: false, erro: 'pagamento ausente' }
  const p = pg as Record<string, unknown>
  const forma = typeof p.forma === 'string' ? p.forma : ''
  if (forma === 'sem_cartao') return { ok: true, pagamento: { forma } }
  if (FORMAS_A_VISTA.has(forma)) {
    const conta = typeof p.conta === 'string' ? p.conta.trim() : ''
    if (!conta) return { ok: false, erro: 'escolha o banco/empresa do pagamento' }
    return { ok: true, pagamento: { forma, conta } }
  }
  return { ok: false, erro: 'forma de pagamento inválida' }
}

/** Pedido à API: 1 imagem + instrução, saída estruturada json_schema (molde cot-ler-resposta). */
export function montarPedidoIA(imagem: ImagemBase64, modelo: string): PedidoModelo {
  return {
    model: modelo,
    max_tokens: 8000,
    system: SISTEMA,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: imagem.media_type, data: imagem.base64 } },
        { type: 'text', text: 'Leia este cupom fiscal e devolva o JSON pedido.' },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: ESQUEMA_CUPOM } },
  }
}

/** Só os dígitos de `v`; null quando não sobram exatamente `tamanho` (normaliza, não chuta nem completa). */
function soDigitos(v: string | null, tamanho: number): string | null {
  if (v === null) return null
  const d = v.replace(/\D/g, '')
  return d.length === tamanho ? d : null
}

/**
 * Saída do modelo → leitura validada; qualquer coisa fora do formato ⇒ ilegível. A `chave` (44 dígitos) e o
 * `emitente_cnpj` (14) saem NORMALIZADOS (só dígitos; senão null): o índice único da chave e a chave de aprendizado
 * (emitente_cnpj|descricao_norm) ficam estáveis, e uma leitura boa com a chave em grupos de 4 não vira "ilegível".
 */
export function interpretarIA(resp: ModeloResposta): { ok: true; leitura: LeituraCupomIA } | { ok: false } {
  if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') return { ok: false }
  let bruto: unknown
  try { bruto = JSON.parse(resp.texto) } catch { return { ok: false } }
  if (validarSaidaCupom(bruto) !== null) return { ok: false }
  const leitura = bruto as LeituraCupomIA
  return {
    ok: true,
    leitura: { ...leitura, chave: soDigitos(leitura.chave, 44), emitente_cnpj: soDigitos(leitura.emitente_cnpj, 14) },
  }
}

function linha(x: {
  estado: string; pagamento: Pagamento; fotoPath: string; teste: boolean
  chave?: string | null; emitenteCnpj?: string | null; emitenteNome?: string | null
  valorAPagar?: number | null; itens?: unknown[]; motivo?: string | null
}): Record<string, unknown> {
  return {
    estado: x.estado, pagamento: x.pagamento, foto_path: x.fotoPath, teste: x.teste,
    chave: x.chave ?? null, emitente_cnpj: x.emitenteCnpj ?? null, emitente_nome: x.emitenteNome ?? null,
    // cupom.valor_a_pagar é NOT NULL (Plano 1): sem total legível grava 0. Só entra em linha REVISAR, que o robô nunca lança.
    valor_a_pagar: x.valorAPagar ?? 0, itens: x.itens ?? [], motivo: x.motivo ?? null,
  }
}

const jaRecebido = (cupomId: string): Resultado =>
  ({ status: 200, corpo: { cupom_id: cupomId, resumo: 'já recebido', duplicado: true } })

export async function tratar(corpo: Corpo, chamador: string, deps: Deps, modelo = 'claude-sonnet-5'): Promise<Resultado> {
  // 1. autoriza (admin ativo) — a RLS do Plano 1 é a trava real; isto é defesa em profundidade, como gerenciar-usuarios.
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  // 2. valida entrada.
  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const fotoPath = typeof c.foto_path === 'string' && c.foto_path.trim() ? c.foto_path : ''
  if (!fotoPath) return { status: 400, corpo: { erro: 'sem a foto do cupom' } }
  const pg = validarPagamento(c.pagamento)
  if (!pg.ok) return { status: 400, corpo: { erro: pg.erro } }
  const teste = c.teste === true

  // 3. dedup por foto_path (idempotência: reenvio/duplo-toque/retry não duplicam, nem gastam a leitura por IA).
  const existente = await deps.acharCupomPorFoto(fotoPath)
  if (existente) return jaRecebido(existente.id)

  // 4. lê a foto com IA.
  const imagem = await deps.baixarFoto(fotoPath)
  const cham = await deps.chamarModelo(montarPedidoIA(imagem, modelo))
  const interp = cham.ok ? interpretarIA(cham.resp) : ({ ok: false } as const)
  if (!interp.ok || !interp.leitura.legivel || interp.leitura.itens.length === 0) {
    const cupom = await deps.inserirCupom(linha({ estado: REVISAR, pagamento: pg.pagamento, fotoPath, teste, motivo: 'não consegui ler a foto do cupom' }))
    if (cupom.duplicado) return jaRecebido(cupom.id)
    return { status: 200, corpo: { cupom_id: cupom.id, resumo: 'não consegui ler a foto — precisa de você', estado: REVISAR, disparo_ok: false } }
  }
  const leitura = interp.leitura

  // 5. casa (só o aprendizado confirmado; o resto vira incerto → REVISAR).
  const eans = leitura.itens.map((i) => i.codigo_barras).filter((x): x is string => !!x)
  const chaves = leitura.emitente_cnpj
    ? leitura.itens.map((i) => ({ cnpj: leitura.emitente_cnpj as string, desc: normalizar(i.descricao) }))
    : []
  const aprendizados = await deps.buscarAprendizado(eans, chaves)
  const itens = casarItens(leitura.itens, leitura.emitente_cnpj, aprendizados)
  const incertos = itens.filter((i) => !i.sugestao_produto).length
  // sem o total o robô não consegue conferir a soma dos itens (e a coluna é NOT NULL): não se lança, vai a REVISAR.
  const semTotal = !(leitura.valor_total !== null && leitura.valor_total > 0)
  const estado = incertos > 0 || semTotal ? REVISAR : PENDENTE
  const motivos: string[] = []
  if (incertos > 0) motivos.push(`${incertos} item(ns) sem casamento confirmado — confira no Code`)
  if (semTotal) motivos.push('não consegui ler o total do cupom')

  // 6. grava a linha (service_role; o app nunca insere direto).
  const cupom = await deps.inserirCupom(linha({
    estado, pagamento: pg.pagamento, fotoPath, teste,
    chave: leitura.chave, emitenteCnpj: leitura.emitente_cnpj, emitenteNome: leitura.emitente_nome,
    valorAPagar: semTotal ? null : leitura.valor_total, itens,
    motivo: motivos.length > 0 ? motivos.join('; ') : null,
  }))
  // corrida no mesmo foto_path ou 2ª foto do mesmo cupom (mesma chave): a linha já existe e quem a criou é quem dispara.
  if (cupom.duplicado) return jaRecebido(cupom.id)

  // 7. dispara só quando PENDENTE (nada incerto). Falha de disparo NÃO derruba o envio: a linha fica PENDENTE (o reaper do
  // Plano 1 só a marca para conferência depois de 60 min; nada a relança sozinho — por isso a mensagem avisa).
  let disparoOk = false
  if (estado === PENDENTE) {
    try { await deps.dispararLancamento(cupom.id); disparoOk = true } catch { /* fica PENDENTE; quem registra o motivo é o index.ts */ }
  }
  const resumo = estado === REVISAR
    ? incertos > 0 ? `${incertos} item(ns) para você conferir` : 'não consegui ler o total do cupom — precisa de você'
    : disparoOk ? 'enviado para lançar' : AVISO_DISPARO_FALHOU
  return { status: 200, corpo: { cupom_id: cupom.id, resumo, estado, disparo_ok: disparoOk } }
}
