// supabase/functions/enviar-compra-avulsa/logica.ts
// Lógica pura da Edge Function enviar-compra-avulsa (pedido do Ivan, 10/10/2026): compra feita SEM cupom e SEM nota fiscal. O app manda o fornecedor (CNPJ), a forma de
// pagamento (os mesmos botões do cupom) e os itens (produto, quantidade NA UNIDADE DO BANCO e preço por essa unidade). A função grava uma linha `cupom` (origem 'avulsa',
// sem foto e sem chave fiscal) já PENDENTE e dispara o MESMO robô do cupom (lancar-cupom.yml): Pedido de compra manual no SisChef, estoque e, conforme a forma, financeiro à vista.
// Sem globais do Deno nem rede: banco e GitHub entram por `deps` (molde enviar-cupom/logica.ts). index.ts monta `deps` e chama `tratar`.

export interface Corpo { envio_id?: unknown; fornecedor?: unknown; pagamento?: unknown; itens?: unknown }
export interface UsuarioLinha { papel: string; ativo: boolean }
export interface Resultado { status: number; corpo: Record<string, unknown> }

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  /** Dos ids dados, os que existem na lista de produtos do app (itens_semana ou a planilha do Ivan). */
  produtosExistentes(ids: string[]): Promise<Set<string>>
  /** Insert sem duplicar (gravacao.ts): `duplicado: true` quando o foto_path já existia (duplo toque / reenvio). */
  inserirCupom(linha: Record<string, unknown>): Promise<{ id: string; duplicado?: boolean }>
  dispararLancamento(cupomId: string): Promise<void>
}

export type Pagamento = { forma: 'sem_cartao' } | { forma: 'dinheiro' | 'tesouraria' | 'pix'; conta: string }

/** As contas que o robô sabe achar na tela 'Finalizar compra' (iguais às de src/cupom/formasPagamento.ts e do MAPA_PIX do robô). Qualquer outro texto é recusado aqui. */
export const CONTAS_PERMITIDAS: Record<'dinheiro' | 'tesouraria' | 'pix', string[]> = {
  dinheiro: ['DINHEIRO - À Vista'],
  tesouraria: ['TESOURARIA - À Vista'],
  pix: [
    'CONTA BANCÁRIA - PANG BANK - I J LAMEIRA', 'CONTA BANCÁRIA - PANG BANK - S P DELIVERY',
    'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA', 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY',
    'CONTA BANCÁRIA - PANG ITAU - I J LAMEIRA',
    'CONTA BANCÁRIA - CAIXA - I J LAMEIRA', 'CONTA BANCÁRIA - CAIXA - S P DELIVERY',
  ],
}

export const MAX_ITENS = 60
export const QUANTIDADE_MAXIMA = 100_000
export const PRECO_MAXIMO = 100_000
const AVISO_DISPARO_FALHOU =
  'enviado, mas o disparo automático falhou — a compra ficou PENDENTE e nada vai lançá-la sozinha; só depois de uns 60 min o sistema a marca para você conferir'

const round2 = (v: number) => Math.round(v * 100) / 100
const round3 = (v: number) => Math.round(v * 1000) / 1000
const round4 = (v: number) => Math.round(v * 10000) / 10000
const ehNumPositivo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const ID_ENVIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O pagamento vem dos botões do Ivan: forma obrigatória; dinheiro, tesouraria e PIX exigem a conta certa. Nunca assume cartão. */
export function validarPagamento(pg: unknown): { ok: true; pagamento: Pagamento } | { ok: false; erro: string } {
  if (pg === null || typeof pg !== 'object') return { ok: false, erro: 'pagamento ausente' }
  const p = pg as Record<string, unknown>
  const forma = typeof p.forma === 'string' ? p.forma : ''
  if (forma === 'sem_cartao') return { ok: true, pagamento: { forma } }
  if (forma === 'dinheiro' || forma === 'tesouraria' || forma === 'pix') {
    const conta = typeof p.conta === 'string' ? p.conta.trim() : ''
    if (!conta) return { ok: false, erro: 'escolha o banco/empresa do pagamento' }
    if (!CONTAS_PERMITIDAS[forma].includes(conta)) return { ok: false, erro: 'conta de pagamento desconhecida' }
    return { ok: true, pagamento: { forma, conta } }
  }
  return { ok: false, erro: 'forma de pagamento inválida' }
}

export interface ItemValido { produto_id: string; quantidade: number; preco: number }

export function validarItens(v: unknown): { ok: true; itens: ItemValido[] } | { ok: false; erro: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, erro: 'nenhum item' }
  if (v.length > MAX_ITENS) return { ok: false, erro: `itens demais (máximo ${MAX_ITENS})` }
  const itens: ItemValido[] = []
  const vistos = new Set<string>()
  for (let i = 0; i < v.length; i++) {
    const b = v[i]
    if (b === null || typeof b !== 'object') return { ok: false, erro: `item ${i + 1} em formato inválido` }
    const c = b as Record<string, unknown>
    const produtoId = String(c.produto_id ?? '').trim()
    if (!/^\d{1,12}$/.test(produtoId)) return { ok: false, erro: `item ${i + 1}: código do produto inválido` }
    if (vistos.has(produtoId)) return { ok: false, erro: `item ${i + 1}: produto repetido (junte as quantidades numa linha)` }
    vistos.add(produtoId)
    if (!ehNumPositivo(c.quantidade) || c.quantidade > QUANTIDADE_MAXIMA || round3(c.quantidade) <= 0) return { ok: false, erro: `item ${i + 1}: quantidade inválida` }
    if (!ehNumPositivo(c.preco) || c.preco > PRECO_MAXIMO || round4(c.preco) <= 0) return { ok: false, erro: `item ${i + 1}: preço inválido` }
    itens.push({ produto_id: produtoId, quantidade: round3(c.quantidade), preco: round4(c.preco) })
  }
  return { ok: true, itens }
}

/** O item como o robô do cupom lê (cupom_contrato.validar_cupom): produto, `entrada_estoque` na unidade do produto, preço por essa unidade, sem desconto. */
export const itemDoCupom = (i: ItemValido): Record<string, unknown> => ({
  sugestao_produto: { id: i.produto_id }, entrada_estoque: i.quantidade, quantidade_cupom: i.quantidade, valor_unitario: i.preco, desconto_item: 0,
})

/** O total a pagar = a soma de quantidade × preço (já arredondados como o SisChef guarda), em centavos. */
export const totalDosItens = (itens: ItemValido[]): number => round2(itens.reduce((s, i) => s + i.quantidade * i.preco, 0))

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  // 1. autoriza (admin ativo) — defesa em profundidade; a RLS é a trava real.
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  // 2. valida a entrada.
  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const envioId = typeof c.envio_id === 'string' ? c.envio_id.trim() : ''
  if (!ID_ENVIO.test(envioId)) return { status: 400, corpo: { erro: 'envio sem identificador' } }
  const f = c.fornecedor !== null && typeof c.fornecedor === 'object' ? (c.fornecedor as Record<string, unknown>) : {}
  const cnpj = soDigitos(f.cnpj)
  const nome = typeof f.nome === 'string' ? f.nome.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (cnpj.length !== 14) return { status: 400, corpo: { erro: 'fornecedor sem CNPJ válido' } }
  if (nome === '') return { status: 400, corpo: { erro: 'fornecedor sem nome' } }
  const pg = validarPagamento(c.pagamento)
  if (!pg.ok) return { status: 400, corpo: { erro: pg.erro } }
  const it = validarItens(c.itens)
  if (!it.ok) return { status: 400, corpo: { erro: it.erro } }
  const total = totalDosItens(it.itens)
  if (!(total > 0) || total >= 100_000_000) return { status: 400, corpo: { erro: 'total da compra inválido' } }

  // 3. todo produto tem de existir na lista do app (o robô acha o produto pelo código no SisChef).
  const existentes = await deps.produtosExistentes(it.itens.map((i) => i.produto_id))
  const faltando = it.itens.findIndex((i) => !existentes.has(i.produto_id))
  if (faltando >= 0) return { status: 400, corpo: { erro: `item ${faltando + 1}: produto não encontrado na lista` } }

  // 4. grava (PENDENTE, sem foto e sem chave fiscal). `foto_path` = avulsa/<envio_id>: o índice único dele é a trava contra duplo toque (o reenvio devolve a mesma linha).
  const fotoPath = `avulsa/${envioId.toLowerCase()}`
  const cupom = await deps.inserirCupom({
    estado: 'PENDENTE', origem: 'avulsa', teste: false, foto_path: fotoPath, chave: null,
    emitente_cnpj: cnpj, emitente_nome: nome, pagamento: pg.pagamento, valor_a_pagar: total, itens: it.itens.map(itemDoCupom), motivo: null,
  })
  if (cupom.duplicado) return { status: 200, corpo: { cupom_id: cupom.id, resumo: 'já recebido', duplicado: true } }

  // 5. dispara o robô. Falha de disparo NÃO derruba o envio: a linha fica PENDENTE e o aviso diz isso (o reaper só a marca para conferência após 60 min).
  let disparoOk = false
  try { await deps.dispararLancamento(cupom.id); disparoOk = true } catch { /* fica PENDENTE; quem registra o motivo é o index.ts */ }
  return { status: 200, corpo: { cupom_id: cupom.id, resumo: disparoOk ? 'enviado para lançar' : AVISO_DISPARO_FALHOU, estado: 'PENDENTE', disparo_ok: disparoOk } }
}

