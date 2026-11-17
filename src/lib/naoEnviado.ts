// "Tenho dados não enviados" (reanálise de 13/11/2026, B4): a tela que tem coisa digitada e ainda não enviada (compra avulsa em preenchimento, correção de cupom em andamento)
// marca aqui; o botão "Atualizar" do topo e as abas da barra perguntam antes de sair, porque recarregar ou trocar de aba joga fora o que foi digitado.
// Sem nada marcado, ninguém pergunta nada: o comportamento de sempre não muda. Isto NÃO mexe na regra "o app nunca recarrega sozinho" (lib/atualizacao): só segura um toque da pessoa.
import { useEffect, useSyncExternalStore } from 'react'

export const PERGUNTA_NAO_ENVIADO = 'Você tem dados não enviados nesta tela. Sair mesmo assim?'

/** Quem tem dados pendentes agora (uma chave por tela ou por cupom em correção). */
const pendentes = new Set<string>()

/** Quem quer saber quando isto muda (a janela de versão nova espera a pessoa enviar o que digitou). */
const ouvintes = new Set<() => void>()
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }

/** A tela diz se tem (true) ou não tem mais (false) dados não enviados. */
export function marcarNaoEnviado(chave: string, tem: boolean): void {
  const antes = pendentes.size > 0
  if (tem) pendentes.add(chave)
  else pendentes.delete(chave)
  if ((pendentes.size > 0) !== antes) ouvintes.forEach((f) => f())
}

export const temNaoEnviado = (): boolean => pendentes.size > 0

/** Para a tela reagir: verdadeiro enquanto houver dados digitados e ainda não enviados em qualquer tela. */
export const useTemNaoEnviado = (): boolean => useSyncExternalStore(assinar, temNaoEnviado, () => false)

/** Pode sair da tela (recarregar, trocar de aba)? Sem dados pendentes, sim, sem perguntar. Com dados, pergunta: "Cancelar" mantém tudo como está. */
export function podeSair(): boolean {
  return !temNaoEnviado() || window.confirm(PERGUNTA_NAO_ENVIADO)
}

/** Para a tela: marca enquanto `tem` for verdadeiro e desmarca sozinha quando deixa de ser ou quando a tela sai (enviou, limpou, foi fechada). */
export function useNaoEnviado(chave: string, tem: boolean): void {
  useEffect(() => {
    marcarNaoEnviado(chave, tem)
    return () => marcarNaoEnviado(chave, false)
  }, [chave, tem])
}
