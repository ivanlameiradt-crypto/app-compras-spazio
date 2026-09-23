import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { Papel, Usuario } from '../lib/tipos'
import { mensagemDeErro } from '../lib/regras'
import { SENHA_PADRAO, usuarioDoEmail } from '../lib/login'

export default function Pessoas({ usuario }: { usuario: Usuario }) {
  const [pessoas, setPessoas] = useState<Usuario[]>([])
  const [login, setLogin] = useState('')
  const [nome, setNome] = useState('')
  const [papel, setPapel] = useState<Papel>('comprador')
  const [senha, setSenha] = useState(SENHA_PADRAO)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregar = () => api.listarUsuarios().then(setPessoas).catch((e) => setErro(mensagemDeErro(e)))
  useEffect(() => { carregar() }, [])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setAviso('')
    try {
      const r = await api.criarAcesso({ login, nome: nome.trim(), papel, senha })
      setAviso(`Acesso criado: usuário ${usuarioDoEmail(r.email)}, senha inicial ${senha} — no primeiro acesso a pessoa escolhe a própria senha.`)
      setLogin(''); setNome(''); setPapel('comprador'); setSenha(SENHA_PADRAO)
      await carregar()
    } catch (err) {
      setErro(mensagemDeErro(err))
    }
  }

  async function salvar(u: Usuario) {
    try {
      await api.salvarUsuario(u)
      setErro('')
      await carregar()
    } catch (err) {
      setErro(mensagemDeErro(err))
    }
  }

  async function redefinir(p: Usuario) {
    const nomeUsuario = usuarioDoEmail(p.email)
    if (!window.confirm(`A senha de ${nomeUsuario} volta para ${SENHA_PADRAO} e ela terá que trocar no próximo acesso. Confirmar?`)) return
    try {
      await api.redefinirSenha(p.email)
      setErro('')
      setAviso(`Senha de ${nomeUsuario} redefinida para ${SENHA_PADRAO}.`)
    } catch (err) {
      setErro(mensagemDeErro(err))
    }
  }

  return (
    <section>
      <h2>Pessoas</h2>
      {erro && <p className="erro">{erro}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      <form className="coluna cartao" onSubmit={criar}>
        <label>Nome<input aria-label="Nome" required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label>Usuário (ou e-mail)
          <input aria-label="Usuário (ou e-mail)" required value={login} onChange={(e) => setLogin(e.target.value)} />
        </label>
        <label>Papel
          <select aria-label="Papel" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
            <option value="comprador">Comprador</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>Senha inicial
          <input aria-label="Senha inicial" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <button className="botao" type="submit">Cadastrar</button>
      </form>
      <table>
        <tbody>
          {pessoas.map((p) => (
            <tr key={p.email}>
              <td>{p.nome}<div className="sub">{usuarioDoEmail(p.email)}</div></td>
              <td>{p.papel === 'admin' ? 'Administrador' : 'Comprador'}{!p.ativo && ' · desativado'}</td>
              <td>
                {p.email !== usuario.email && (
                  <>
                    <button className="link" onClick={() => redefinir(p)}>Redefinir senha</button>{' '}
                    <button className={p.ativo ? 'link perigo' : 'link'} onClick={() => salvar({ ...p, ativo: !p.ativo })}>
                      {p.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
