// supabase/functions/cadastrar-produto/logica.ts
// Lógica pura da Edge Function cadastrar-produto (pedido do Ivan, 13/10/2026): o Ivan toca em "Cadastrar no SisChef e no app" para um produto de cupom, nota fiscal ou compra
// avulsa que não está na lista do app. Aqui: autoriza o admin, valida o pedido (grupo da lista fechada, unidade KG/UN), evita pedido repetido, grava em produto_cadastro (PENDENTE)
// e dispara o robô (cadastrar-produto.yml). O cadastro em si é do robô, que confere de novo no SisChef se o produto já existe. Sem globais do Deno nem rede: tudo entra por `deps`.

export interface Corpo {
  descricao?: unknown; grupo?: unknown; unidade?: unknown; palavras?: unknown
  origem?: unknown; origem_id?: unknown; origem_item?: unknown; forcar?: unknown; existente_id?: unknown
}
export interface PedidoNovo {
  descricao: string; chave_nome: string; grupo: string; unidade: 'KG' | 'UN'; palavras: string | null
  origem: 'cupom' | 'nota' | 'avulsa'; origem_id: string | null; origem_item: number | null
  forcar: boolean; existente_id: number | null; criado_por: string
}
export interface Concluido { id: string; estado: 'CADASTRADO' | 'JA_EXISTIA'; produto_id: number }
export interface Deps {
  buscarUsuario(email: string): Promise<{ papel: string; ativo: boolean } | null>
  /** O pedido mais recente deste nome que terminou em CADASTRADO/JA_EXISTIA (null se não há). */
  ultimoConcluido(chave: string): Promise<Concluido | null>
  /** Pedido preso em PENDENTE/PROCESSANDO há mais de `minutos` vira REVISAR (para não travar o índice de "um por vez" para sempre). */
  expirarPresos(chave: string, minutos: number): Promise<void>
  /** Insere o pedido PENDENTE; `duplicado` = já há um em andamento para este nome (devolve o existente; nada é disparado). */
  criarPedido(p: PedidoNovo): Promise<{ id: string; duplicado?: boolean }>
  dispararCadastro(cadastroId: string): Promise<void>
  /** O disparo falhou: o pedido não pode ficar PENDENTE para sempre. */
  marcarRevisar(cadastroId: string, motivo: string): Promise<void>
}
export interface Resultado { status: number; corpo: Record<string, unknown> }

/** Os grupos de INSUMO do SisChef (cópia de src/admin/produtoRegras.ts: a função publicada só leva os próprios arquivos; um teste confere que as duas listas são iguais). */
export const GRUPOS_DE_INSUMO: string[] = [
  'DESCARTAVEL E EMBALAGENS - ESTOQUE CONTROLADO', 'DESCARTAVEL E EMBALAGENS INSUMO - ESTOQUE CONTROLADO', 'ESTOQUE CONTROLADO', 'GELATO - ESTOQUE CÂMARA', 'GELATO - ESTOQUE SECO',
  'GELATO INSUMO - ESTOQ. CAMARA', 'GELATO INSUMO - ESTOQ. SECO', 'HAMBURGEURIA INSUMO - ESTOQ. CAMARA', 'HAMBURGEURIA INSUMO - ESTOQ. SECO', 'HAMBURGUERIA - ESTOQUE CÂMARA',
  'HAMBURGUERIA - ESTOQUE SECO', 'HORTIFRUT - INSUMOS CONTROLADOS', 'INSUMO - ESTOQUE CONTROLADO', 'INSUMOS PRODUTOS - HORTIFRUTI', 'INSUMOS PRODUTOS MANUTENÇÃO - GERAL',
  'INSUMOS SETORES - CAMARA', 'KUKAN - ESTOQUE CÂMARA', 'KUKAN - ESTOQUE SECO', 'KUKAN INSUMO - ESTOQ. CAMARA', 'KUKAN INSUMO - ESTOQ. SECO', 'PIZZARIA - ESTOQUE CÂMARA',
  'PIZZARIA - ESTOQUE SECO', 'PIZZARIA INSUMO - ESTOQ. CAMARA', 'PIZZARIA INSUMO - ESTOQ. SECO', 'PRODUÇÃO - ESTOQUE CÂMARA', 'PRODUÇAO ESTOQUE  - SECO',
  'PRODUÇÃO INSUMO - ESTOQ. CAMARA', 'PRODUÇÃO INSUMO - ESTOQ. SECO',
]
export const ORIGENS = ['cupom', 'nota', 'avulsa'] as const
/** Pedido que fica PENDENTE/PROCESSANDO além disto é dado como perdido (o workflow leva ~2 min). */
export const MINUTOS_PRESO = 20

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** O nome sem acento, minúsculo, só letras e números, espaços colapsados: a "chave" que diferencia um pedido de outro (a mesma conta do app, src/admin/produtoRegras.ts). */
export function chaveDoNome(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const AVISO_DISPARO = 'o pedido foi gravado, mas não consegui chamar o robô agora: tente de novo em instantes'
const MOTIVO_PRESO = 'o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo'

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  const email = chamador.trim().toLowerCase()
  const u = await deps.buscarUsuario(email)
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const descricao = texto(c.descricao)
  const chave = chaveDoNome(descricao)
  if (chave === '') return { status: 400, corpo: { erro: 'falta o nome do produto' } }
  if (descricao.length > 200) return { status: 400, corpo: { erro: 'o nome do produto está grande demais' } }
  const grupo = typeof c.grupo === 'string' ? c.grupo : ''
  if (!GRUPOS_DE_INSUMO.includes(grupo)) return { status: 400, corpo: { erro: 'escolha o grupo do SisChef' } }
  const unidade = texto(c.unidade)
  if (unidade !== 'KG' && unidade !== 'UN') return { status: 400, corpo: { erro: 'a unidade tem de ser KG ou UN (as da lista do app)' } }
  const palavras = texto(c.palavras)
  if (palavras.length > 500) return { status: 400, corpo: { erro: 'as palavras-chave estão grandes demais' } }
  const origem = texto(c.origem)
  if (!(ORIGENS as readonly string[]).includes(origem)) return { status: 400, corpo: { erro: 'falta de onde veio o produto (cupom, nota ou compra avulsa)' } }
  const origemId = c.origem_id === undefined || c.origem_id === null ? '' : texto(c.origem_id)
  if (origemId.length > 80) return { status: 400, corpo: { erro: 'a origem está grande demais' } }
  const item = c.origem_item
  if (item !== undefined && item !== null && !(Number.isInteger(item) && (item as number) >= 0)) return { status: 400, corpo: { erro: 'o número do item não está certo' } }
  const exist = c.existente_id
  if (exist !== undefined && exist !== null && !(Number.isInteger(exist) && (exist as number) > 0)) return { status: 400, corpo: { erro: 'o código do produto existente não está certo' } }
  if (c.forcar !== undefined && typeof c.forcar !== 'boolean') return { status: 400, corpo: { erro: 'pedido inválido' } }
  const forcar = c.forcar === true
  const existenteId = typeof exist === 'number' ? exist : null

  // já foi cadastrado antes com este nome e o Ivan não pediu para criar de novo: devolve o que existe (nada é disparado)
  if (!forcar && existenteId === null) {
    const feito = await deps.ultimoConcluido(chave)
    if (feito) return { status: 200, corpo: { cadastro_id: feito.id, chave_nome: chave, ja_cadastrado: true, estado: feito.estado, produto_id: feito.produto_id, resumo: 'este produto já foi cadastrado' } }
  }

  await deps.expirarPresos(chave, MINUTOS_PRESO)   // o aviso fica no pedido preso; o novo pode então ser aceito
  const pedido = await deps.criarPedido({
    descricao, chave_nome: chave, grupo, unidade, palavras: palavras === '' ? null : palavras, origem: origem as PedidoNovo['origem'],
    origem_id: origemId === '' ? null : origemId, origem_item: typeof item === 'number' ? item : null, forcar, existente_id: existenteId, criado_por: email,
  })
  if (pedido.duplicado) return { status: 200, corpo: { cadastro_id: pedido.id, chave_nome: chave, em_andamento: true, resumo: 'já existe um cadastro em andamento para este produto' } }
  try {
    await deps.dispararCadastro(pedido.id)
  } catch {
    await deps.marcarRevisar(pedido.id, AVISO_DISPARO).catch(() => undefined)
    return { status: 502, corpo: { erro: AVISO_DISPARO, cadastro_id: pedido.id, chave_nome: chave } }
  }
  return { status: 200, corpo: { cadastro_id: pedido.id, chave_nome: chave, resumo: 'cadastro pedido: o robô leva uns 2 minutos' } }
}

export { MOTIVO_PRESO }
