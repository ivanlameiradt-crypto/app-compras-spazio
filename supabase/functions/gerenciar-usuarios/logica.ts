// Lógica pura da Edge Function `gerenciar-usuarios` — sem globais do Deno, importável pelo vitest.
// `index.ts` (Deno) monta `deps` com o cliente service_role e chama `tratar`.
import { emailDoLogin } from './_login.ts'

export type Papel = 'admin' | 'comprador'
export interface UsuarioLinha { email: string; nome: string; papel: Papel; ativo: boolean }

export type Corpo =
  | { acao: 'criar'; login: string; nome: string; papel: Papel; senha: string }
  | { acao: 'redefinir_senha'; email: string; senha: string }

/** `trocarSenha: true` → o app obriga a pessoa a escolher a própria senha no próximo acesso (P3). */
export interface OpcoesSenha { trocarSenha: boolean }

export interface Deps {
  buscarUsuario(email: string): Promise<UsuarioLinha | null>
  criarAuth(email: string, senha: string, nome: string, opcoes: OpcoesSenha): Promise<{ id: string }>
  removerAuth(id: string): Promise<void>
  inserirUsuario(u: UsuarioLinha): Promise<void>
  acharAuthPorEmail(email: string): Promise<{ id: string } | null>
  trocarSenha(id: string, senha: string, opcoes: OpcoesSenha): Promise<void>
}

export interface Resultado { status: number; corpo: { ok: true; email: string } | { erro: string } }

const erro = (status: number, mensagem: string): Resultado => ({ status, corpo: { erro: mensagem } })

export async function tratar(corpo: Corpo, chamador: string, deps: Deps): Promise<Resultado> {
  const admin = await deps.buscarUsuario(chamador.trim().toLowerCase())
  if (!admin || !admin.ativo || admin.papel !== 'admin') {
    return erro(403, 'apenas o administrador pode fazer isso')
  }

  if (corpo.acao === 'criar') {
    if (!corpo.senha || corpo.senha.length < 6) return erro(400, 'a senha precisa ter pelo menos 6 caracteres')
    if (corpo.papel !== 'admin' && corpo.papel !== 'comprador') return erro(400, 'papel inválido')
    if (!corpo.nome || !corpo.nome.trim()) return erro(400, 'informe o nome')
    if (!corpo.login || !corpo.login.trim()) return erro(400, 'informe o usuário')

    const email = emailDoLogin(corpo.login)
    // só símbolos ("!!!") somem na normalização: sobraria "@spazio.invalid", que o auth recusa com 500
    if (!email.split('@')[0]) return erro(400, 'usuário inválido: use letras ou números')
    const existente = await deps.acharAuthPorEmail(email)
    if (existente) return erro(409, 'esse usuário já existe')

    // conta nova começa com a senha padrão: troca obrigatória no primeiro acesso
    const auth = await deps.criarAuth(email, corpo.senha, corpo.nome.trim(), { trocarSenha: true })
    try {
      await deps.inserirUsuario({ email, nome: corpo.nome.trim(), papel: corpo.papel, ativo: true })
    } catch (e) {
      await deps.removerAuth(auth.id)
      return erro(400, e instanceof Error ? e.message : String(e))
    }
    return { status: 200, corpo: { ok: true, email } }
  }

  if (corpo.acao === 'redefinir_senha') {
    if (!corpo.senha || corpo.senha.length < 6) return erro(400, 'a senha precisa ter pelo menos 6 caracteres')
    const email = (corpo.email ?? '').trim().toLowerCase()
    const auth = await deps.acharAuthPorEmail(email)
    if (!auth) return erro(404, 'usuário não encontrado')
    await deps.trocarSenha(auth.id, corpo.senha, { trocarSenha: true }) // redefinida: troca obrigatória de novo
    return { status: 200, corpo: { ok: true, email } }
  }

  return erro(400, 'ação inválida')
}
