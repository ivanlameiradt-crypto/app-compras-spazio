import { useEffect, useState } from 'react'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { buscarUsuario } from '../lib/api'
import { mensagemDeErro } from '../lib/regras'
import type { Usuario } from '../lib/tipos'
import { EVENTO_SAIU, esquecerUsuario, guardarUsuario, ultimoUsuario, usuarioGuardado } from './usuarioGuardado'

export type EstadoSessao =
  | { carregando: true }
  | { carregando: false; sessao: null; usuario?: undefined; offline?: undefined }
  /** Sem sessão válida e sem internet para renovar: abre com o último usuário guardado; a fila espera a sessão voltar. */
  | { carregando: false; sessao: null; usuario: Usuario; offline: true }
  | { carregando: false; sessao: Session; usuario: Usuario | null; erro?: string }

const emailDa = (s: Session) => (s.user.email ?? '').trim().toLowerCase()

export function useSessao(): EstadoSessao {
  const [estado, setEstado] = useState<EstadoSessao>({ carregando: true })
  useEffect(() => {
    let vivo = true
    let atual: EstadoSessao = { carregando: true }
    let vez = 0 // cada mudança invalida buscas de usuário ainda em andamento
    const mudar = (e: EstadoSessao) => {
      atual = e
      if (vivo) setEstado(e)
    }

    function irParaLogin() {
      vez++
      mudar({ carregando: false, sessao: null })
    }

    function semSessao(falhouPorRede: boolean) {
      vez++
      const u = ultimoUsuario()
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (u && (offline || falhouPorRede)) mudar({ carregando: false, sessao: null, usuario: u, offline: true })
      else mudar({ carregando: false, sessao: null })
    }

    /** Confirma no servidor quem é o usuário. Sem internet vale o guardado; resposta do servidor sempre manda. */
    async function confirmarUsuario(sessao: Session) {
      const minha = ++vez
      const email = emailDa(sessao)
      let proximo: EstadoSessao
      try {
        const u = await buscarUsuario(email)
        if (u?.ativo) {
          // P3: guarda também se a troca de senha obrigatória está pendente, pra reconhecer isso
          // depois mesmo sem sessão (reabrir offline não pode pular a troca — ver App.tsx)
          const meta = sessao.user.user_metadata as { trocar_senha?: boolean } | undefined
          guardarUsuario(u, { trocarSenha: meta?.trocar_senha === true })
          proximo = { carregando: false, sessao, usuario: u }
        } else {
          esquecerUsuario(email)
          proximo = { carregando: false, sessao, usuario: null }
        }
      } catch (e) {
        const guardado = usuarioGuardado(email)
        proximo = guardado
          ? { carregando: false, sessao, usuario: guardado }
          : { carregando: false, sessao, usuario: null, erro: mensagemDeErro(e) }
      }
      if (minha === vez) mudar(proximo)
    }

    /** Token renovado: já sabemos quem é — só troca a sessão, sem nova consulta. */
    function sessaoRenovada(sessao: Session) {
      const email = emailDa(sessao)
      if (!atual.carregando && atual.sessao && emailDa(atual.sessao) === email && !atual.erro) {
        vez++
        mudar({ ...atual, sessao })
        return
      }
      const guardado = usuarioGuardado(email)
      if (guardado) {
        // M-a: saindo do modo offline (sem sessão), a internet voltou: mostra já o guardado, mas
        // confirma no servidor — quem foi desativado nesse meio-tempo perde o acesso agora
        const voltouDoOffline = !atual.carregando && !atual.sessao
        vez++
        mudar({ carregando: false, sessao, usuario: guardado })
        if (voltouDoOffline) void confirmarUsuario(sessao)
      } else {
        void confirmarUsuario(sessao)
      }
    }

    // Carga inicial (equivale ao INITIAL_SESSION, mas diz também POR QUE não há sessão).
    supabase.auth.getSession().then(({ data, error }) => {
      if (!vivo) return
      if (data.session) void confirmarUsuario(data.session)
      else semSessao(!!error && isAuthRetryableFetchError(error))
    }, () => { if (vivo) semSessao(true) })

    // chamar o Supabase dentro do callback trava o cliente; por isso o setTimeout
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      setTimeout(() => {
        if (!vivo) return
        if (evento === 'SIGNED_OUT') irParaLogin()
        else if (!s) return // INITIAL_SESSION sem sessão: a carga inicial já cuidou
        else if (evento === 'SIGNED_IN' || evento === 'USER_UPDATED') void confirmarUsuario(s)
        else if (evento === 'TOKEN_REFRESHED') sessaoRenovada(s)
        // INITIAL_SESSION com sessão: a carga inicial (getSession) já confirma o usuário
      }, 0)
    })
    const saiu = () => { if (vivo) irParaLogin() }
    window.addEventListener(EVENTO_SAIU, saiu)
    return () => {
      vivo = false
      data.subscription.unsubscribe()
      window.removeEventListener(EVENTO_SAIU, saiu)
    }
  }, [])
  return estado
}
