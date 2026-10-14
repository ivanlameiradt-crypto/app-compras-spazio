// supabase/functions/cadastrar-produto/logica.ts
// Lógica pura da Edge Function cadastrar-produto (pedido do Ivan, 13/10/2026): o Ivan toca em "Cadastrar no SisChef e no app" para um produto de cupom, nota fiscal ou compra
// avulsa que não está na lista do app. Aqui: autoriza o admin, valida o pedido (grupo da lista fechada, unidade KG/UN), evita pedido repetido, grava em produto_cadastro (PENDENTE)
// e dispara o robô (cadastrar-produto.yml); o pedido repetido que está parado na fila (PENDENTE há mais de 3 min) faz o robô ser chamado de novo (revisão nº 2, 14/10).
// O cadastro em si é do robô, que confere de novo no SisChef se o produto já existe. Sem globais do Deno nem rede: tudo entra por `deps`.

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
  /** Insere o pedido PENDENTE; `duplicado` = já há um em andamento para este nome (devolve o existente); `corrida` = o índice de "um por vez" recusou,
   *  mas o pedido em andamento terminou antes de ser lido (nada foi gravado). */
  criarPedido(p: PedidoNovo): Promise<{ id: string; duplicado?: boolean } | { corrida: true }>
  /** O estado do pedido e a hora da última mudança (ISO); null se não existe. */
  situacaoDoPedido(cadastroId: string): Promise<{ estado: string; atualizado_em: string } | null>
  dispararCadastro(cadastroId: string): Promise<void>
  /** O disparo do pedido NOVO falhou: o pedido não pode ficar PENDENTE para sempre (só vale para o que o robô ainda não pegou). */
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
/** Pedido em andamento que segue PENDENTE (o robô nem o pegou) há mais disto: o disparo pode ter se perdido na fila do SisChef (outro robô do mesmo grupo
 *  cancela o run que esperava). Um novo toque chama o robô de novo; é seguro: a reivindicação do robô é atômica e o run a mais só "pula". */
export const MINUTOS_REENVIO = 3
/** O maior número que a coluna origem_item (integer do Postgres) guarda: acima disso o banco recusaria com uma mensagem crua. */
const MAIOR_INTEGER = 2147483647

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** O nome sem acento, minúsculo, só letras e números, espaços colapsados: a "chave" que diferencia um pedido de outro (a mesma conta do app, src/admin/produtoRegras.ts). */
export function chaveDoNome(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const AVISO_DISPARO = 'o pedido foi gravado, mas não consegui chamar o robô agora: tente de novo em instantes'
const MOTIVO_PRESO = 'o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo'
const AVISO_CORRIDA = 'outro pedido deste mesmo produto acabou de terminar: toque de novo para ver o resultado'

/** O pedido em andamento parado na fila (PENDENTE há mais de MINUTOS_REENVIO): chama o robô de novo e devolve se chamou. Nunca derruba a resposta: o
 *  pedido já existia e fica como está (nada de REVISAR aqui: o robô pode estar pegando-o agora). */
async function reenviarSeParado(cadastroId: string, deps: Deps): Promise<boolean> {
  try {
    const s = await deps.situacaoDoPedido(cadastroId)
    if (!s || s.estado !== 'PENDENTE') return false   // PROCESSANDO: o robô já está nele
    const parado = Date.now() - Date.parse(s.atualizado_em)
    if (!(parado > MINUTOS_REENVIO * 60_000)) return false   // recente (o run ainda pode estar na fila) ou hora ilegível
    await deps.dispararCadastro(cadastroId)
    return true
  } catch {
    return false
  }
}

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
  // número que o JavaScript não guarda exato (acima de 2^53) ou que a coluna não cabe vira 400 aqui, não um 500 com a mensagem crua do banco
  const item = c.origem_item
  if (item !== undefined && item !== null && !(Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= MAIOR_INTEGER)) return { status: 400, corpo: { erro: 'o número do item não está certo' } }
  const exist = c.existente_id
  if (exist !== undefined && exist !== null && !(Number.isSafeInteger(exist) && (exist as number) > 0)) return { status: 400, corpo: { erro: 'o código do produto existente não está certo' } }
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
  if ('corrida' in pedido) return { status: 409, corpo: { erro: AVISO_CORRIDA, chave_nome: chave } }
  if (pedido.duplicado) {
    // o mesmo nome já está em andamento: nada novo é gravado; se ele está parado na fila há mais de MINUTOS_REENVIO, o robô é chamado de novo
    const reenviado = await reenviarSeParado(pedido.id, deps)
    const resumo = reenviado ? 'o pedido estava parado na fila: chamei o robô de novo (ele leva uns 2 minutos)' : 'já existe um cadastro em andamento para este produto'
    return { status: 200, corpo: { cadastro_id: pedido.id, chave_nome: chave, em_andamento: true, reenviado, resumo } }
  }
  try {
    await deps.dispararCadastro(pedido.id)
  } catch {
    await deps.marcarRevisar(pedido.id, AVISO_DISPARO).catch(() => undefined)
    return { status: 502, corpo: { erro: AVISO_DISPARO, cadastro_id: pedido.id, chave_nome: chave } }
  }
  return { status: 200, corpo: { cadastro_id: pedido.id, chave_nome: chave, resumo: 'cadastro pedido: o robô leva uns 2 minutos' } }
}

export { MOTIVO_PRESO }
