import { useState } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { escolherSenhaInicial, trocarMinhaSenha } from '../lib/api'
import { SENHA_PADRAO } from '../lib/login'

function mensagemDeErroSenha(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (isAuthRetryableFetchError(e) || /failed to fetch|network|load failed|timeout/i.test(msg)) return 'Sem internet. Tente de novo.'
  return msg
}

/**
 * Duas situações, uma tela: troca voluntária (P2, link "Trocar minha senha" no cabeçalho, pede a
 * senha atual) e troca obrigatória no primeiro acesso (P3, senha padrão 123456, a sessão já prova
 * quem é — sem campo de senha atual, sem menu, só "Sair").
 */
export default function TrocarSenha({ forcada, offline = false, onSair }: {
  forcada: boolean
  offline?: boolean
  onSair?: () => void
}) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState(false)
  const [enviando, setEnviando] = useState(false)

  if (forcada && offline) {
    return (
      <main className="login">
        <h1>Escolha sua senha</h1>
        <p>Sem internet. Conecte para escolher sua senha.</p>
        {onSair && <button className="botao secundario" onClick={onSair}>Sair</button>}
      </main>
    )
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setOk(false)
    if (nova.length < 6) return setAviso('A nova senha precisa ter pelo menos 6 caracteres.')
    if (nova !== confirma) return setAviso('As senhas não coincidem.')
    if (nova === SENHA_PADRAO) return setAviso('Escolha uma senha diferente da senha padrão.')
    if (!forcada && nova === atual) return setAviso('A nova senha precisa ser diferente da atual.')
    setAviso('')
    setEnviando(true)
    try {
      if (forcada) await escolherSenhaInicial(nova)
      else await trocarMinhaSenha(atual, nova)
      setOk(true)
      setAviso('Senha trocada.')
    } catch (err) {
      setAviso(mensagemDeErroSenha(err))
    } finally {
      setEnviando(false)
    }
  }

  const formulario = (
    <form className="coluna" onSubmit={salvar}>
      {!forcada && (
        <label>Senha atual
          <input aria-label="Senha atual" type="password" required value={atual} onChange={(e) => setAtual(e.target.value)} />
        </label>
      )}
      <label>Nova senha
        <input aria-label="Nova senha" type="password" required value={nova} onChange={(e) => setNova(e.target.value)} />
      </label>
      <label>Repita a nova senha
        <input aria-label="Repita a nova senha" type="password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} />
      </label>
      {aviso && <p className={ok ? 'aviso' : 'erro'}>{aviso}</p>}
      <button className="botao" type="submit" disabled={enviando}>Salvar</button>
    </form>
  )

  if (forcada) {
    return (
      <main className="login">
        <h1>Escolha sua senha</h1>
        <p>Primeiro acesso: troque a senha padrão por uma só sua.</p>
        {formulario}
        {onSair && <button className="link" onClick={onSair}>Sair</button>}
      </main>
    )
  }

  return (
    <section className="coluna">
      <h2>Trocar minha senha</h2>
      {formulario}
    </section>
  )
}
