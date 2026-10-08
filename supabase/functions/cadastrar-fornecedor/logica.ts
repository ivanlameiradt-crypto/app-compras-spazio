// supabase/functions/cadastrar-fornecedor/logica.ts
// Lógica pura da Edge Function cadastrar-fornecedor (pedido do Ivan, 08/10/2026): o Ivan toca em "Cadastrar no SisChef" numa caixa de cupom parado por
// "fornecedor não encontrado". Aqui: autoriza o admin, valida o pedido, guarda o NOME FANTASIA só no app (fornecedor_app; o Sischef nunca o recebe), grava o pedido em
// fornecedor_cadastro (PENDENTE) e dispara o robô (cadastrar-fornecedor.yml). O cadastro em si é do robô, que confere de novo no Sischef se o CNPJ já existe.
// Só vale para um cupom que de fato parou por "fornecedor não encontrado". Sem globais do Deno nem rede: tudo entra por `deps`.

export interface Corpo { cnpj?: unknown; razao_social?: unknown; nome_fantasia?: unknown; uf?: unknown; municipio?: unknown; cupom_id?: unknown }
export interface CupomLinha { id: string; estado: string; motivo: string | null; pedido_sischef: string | null }
export interface PedidoNovo { cnpj: string; razao_social: string; nome_fantasia: string | null; uf: string; municipio: string; cupom_id: string; criado_por: string }
export interface Deps {
  buscarUsuario(email: string): Promise<{ papel: string; ativo: boolean } | null>
  lerCupom(id: string): Promise<CupomLinha | null>
  /** Grava a fantasia do app (upsert por CNPJ). Só chamada com fantasia não vazia. */
  salvarFantasia(cnpj: string, razaoSocial: string, fantasia: string): Promise<void>
  /** Insere o pedido PENDENTE; `duplicado` = já há um em andamento para este CNPJ (devolve o existente; nada é disparado). */
  criarPedido(p: PedidoNovo): Promise<{ id: string; duplicado?: boolean }>
  dispararCadastro(cadastroId: string): Promise<void>
  /** O disparo falhou: o pedido não pode ficar PENDENTE para sempre. */
  marcarRevisar(cadastroId: string, motivo: string): Promise<void>
}
export interface Resultado { status: number; corpo: Record<string, unknown> }

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
/** O motivo que o robô de cupom grava (cupom_navegador.py). */
export const MOTIVO_FORNECEDOR = /^fornecedor não encontrado no Sischef/i

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

export function cnpjValido(v: unknown): boolean {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

const AVISO_DISPARO = 'o pedido foi gravado, mas não consegui chamar o robô agora: tente de novo em instantes'

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  const u = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!u || !u.ativo || u.papel !== 'admin') return { status: 403, corpo: { erro: 'apenas o administrador pode fazer isso' } }

  const c: Corpo = corpo !== null && typeof corpo === 'object' ? corpo : {}
  const cnpj = soDigitos(c.cnpj)
  if (!cnpjValido(cnpj)) return { status: 400, corpo: { erro: 'o CNPJ não está certo: confira os 14 números' } }
  const razao = texto(c.razao_social)
  if (razao === '' || razao.length > 200) return { status: 400, corpo: { erro: 'a razão social está vazia ou grande demais' } }
  const fantasia = texto(c.nome_fantasia)
  if (fantasia.length > 200) return { status: 400, corpo: { erro: 'o nome fantasia está grande demais' } }
  const uf = texto(c.uf).toUpperCase()
  if (!UFS.includes(uf)) return { status: 400, corpo: { erro: 'falta o estado (UF)' } }
  const municipio = texto(c.municipio)
  if (municipio === '' || municipio.length > 120) return { status: 400, corpo: { erro: 'falta o município' } }
  const cupomId = typeof c.cupom_id === 'string' ? c.cupom_id.trim() : ''
  if (!/^[0-9a-f-]{36}$/i.test(cupomId)) return { status: 400, corpo: { erro: 'sem o cupom' } }

  // só se cadastra fornecedor para um cupom que parou por isso (nada de cadastro solto)
  const cupom = await deps.lerCupom(cupomId)
  if (!cupom) return { status: 404, corpo: { erro: 'cupom não encontrado' } }
  if (cupom.estado !== 'REVISAR' || cupom.pedido_sischef || !MOTIVO_FORNECEDOR.test((cupom.motivo ?? '').trim())) {
    return { status: 409, corpo: { erro: 'este cupom não está parado por fornecedor não cadastrado: atualize a tela' } }
  }

  // a fantasia fica SÓ no app (regra do Ivan); o Sischef recebe CNPJ + razão social + estado + município
  if (fantasia !== '') await deps.salvarFantasia(cnpj, razao, fantasia)
  const pedido = await deps.criarPedido({ cnpj, razao_social: razao, nome_fantasia: fantasia === '' ? null : fantasia, uf, municipio, cupom_id: cupomId, criado_por: chamador.trim().toLowerCase() })
  if (pedido.duplicado) return { status: 200, corpo: { cadastro_id: pedido.id, em_andamento: true, resumo: 'já existe um cadastro em andamento para este CNPJ' } }
  try {
    await deps.dispararCadastro(pedido.id)
  } catch {
    await deps.marcarRevisar(pedido.id, AVISO_DISPARO).catch(() => undefined)
    return { status: 502, corpo: { erro: AVISO_DISPARO, cadastro_id: pedido.id } }
  }
  return { status: 200, corpo: { cadastro_id: pedido.id, resumo: 'cadastro pedido: o robô leva uns 2 minutos' } }
}
