// Edge Function (Deno) — cria acesso e redefine senha. Só o administrador pode chamar; a
// service_role key nunca sai do servidor. Lógica de negócio pura em logica.ts (testada pelo
// vitest); aqui só a ligação com Deno.serve, CORS, verificação do token e o cliente service_role.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { tratar, type Corpo, type Deps, type UsuarioLinha } from './logica.ts'

const ORIGENS_PERMITIDAS = new Set([
  'https://ivanlameiradt-crypto.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])

function cabecalhosCors(origem: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem && ORIGENS_PERMITIDAS.has(origem) ? origem : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function resposta(status: number, corpo: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'método não permitido' }, cors)

  try {
    const cabecalhoAuth = req.headers.get('authorization') ?? ''
    const token = cabecalhoAuth.replace(/^Bearer\s+/i, '')
    if (!token) return resposta(401, { erro: 'sem autenticação' }, cors)

    const url = Deno.env.get('SUPABASE_URL')
    const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !chaveServico) return resposta(500, { erro: 'função sem configuração' }, cors)

    const admin = createClient(url, chaveServico)
    const { data: verificado, error: erroToken } = await admin.auth.getUser(token)
    const chamador = verificado?.user?.email
    if (erroToken || !chamador) return resposta(401, { erro: 'sessão inválida' }, cors)

    const corpo = (await req.json()) as Corpo

    const deps: Deps = {
      async buscarUsuario(email) {
        const { data } = await admin.from('usuarios').select('email, nome, papel, ativo').eq('email', email).maybeSingle()
        return (data as UsuarioLinha | null) ?? null
      },
      async criarAuth(email, senha, nome, { trocarSenha }) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: senha,
          email_confirm: true,
          user_metadata: { nome, trocar_senha: trocarSenha },
        })
        if (error || !data.user) throw new Error(error?.message ?? 'falha ao criar usuário no auth')
        return { id: data.user.id }
      },
      async removerAuth(id) {
        await admin.auth.admin.deleteUser(id)
      },
      async inserirUsuario(u) {
        const { error } = await admin.from('usuarios').insert(u)
        if (error) throw new Error(error.message)
      },
      async acharAuthPorEmail(email) {
        // a admin API não busca por e-mail direto: percorre as páginas até achar
        for (let pagina = 1; ; pagina++) {
          const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 })
          if (error) throw new Error(error.message)
          const achado = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
          if (achado) return { id: achado.id }
          if (data.users.length < 200) return null
        }
      },
      async trocarSenha(id, senha, { trocarSenha }) {
        const { data: atual } = await admin.auth.admin.getUserById(id)
        const metaAtual = (atual?.user?.user_metadata ?? {}) as Record<string, unknown>
        const { error } = await admin.auth.admin.updateUserById(id, {
          password: senha,
          user_metadata: { ...metaAtual, trocar_senha: trocarSenha },
        })
        if (error) throw new Error(error.message)
      },
    }

    const resultado = await tratar(corpo, chamador, deps)
    return resposta(resultado.status, resultado.corpo, cors)
  } catch (e) {
    return resposta(500, { erro: e instanceof Error ? e.message : String(e) }, cors)
  }
})
