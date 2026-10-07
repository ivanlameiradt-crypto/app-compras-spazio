import { useSyncExternalStore } from 'react'
import { acaoParaVersaoNova, type OrigemConferencia } from './versao'

declare const __BUILD_ID__: string

// --- PWA: manter o app sempre na versão publicada — Android, iPhone E site, igual. ---
// Problema que isto resolve: a cópia guardada (service worker) podia ficar presa numa versão velha e "sair e entrar" continuava mostrando o antigo. A
// solução NÃO depende de o cache "soltar" sozinho: a REDE manda. O version.json (nunca cacheado) diz qual é a versão no ar; se for diferente da que está
// rodando, apagamos a cópia guardada (service worker + caches) e recarregamos a nova.
// 07/10 (pedido do Ivan): ele não pode precisar "sair e entrar" a cada ajuste. A troca é AUTOMÁTICA na abertura e quando ele volta ao app depois de um tempo
// fora (nada digitado a perder); com o app em uso aparece só uma faixa "Atualizar agora"; e o botão Atualizar do topo confere a versão e recarrega a tela
// na hora (o iPhone instalado não tem "puxar para atualizar").

const BASE = import.meta.env.BASE_URL
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
const JA_TENTOU = 'spazio_versao_tentada' // trava anti-loop: lembra para qual versão já tentamos trocar nesta sessão
/** Voltar ao app depois de pelo menos isto fora conta como "voltou" (troca já); menos que isso o Ivan só trocou de app por um instante (aparece a faixa). */
export const SEGUNDOS_FORA = 30

let trocando = false
let novaVersao: string | null = null
const ouvintes = new Set<() => void>()
function avisarNovaVersao(id: string) {
  if (novaVersao === id) return
  novaVersao = id
  ouvintes.forEach((f) => f())
}
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }
/** A versão nova que já foi vista no ar mas ainda não foi aplicada (a faixa "Atualizar agora" aparece enquanto houver), ou null. */
export const useNovaVersao = (): string | null => useSyncExternalStore(assinar, () => novaVersao, () => null)

/** Recarrega a tela (a rota fica, o endereço tem o # da tela). Separado para os testes poderem trocar. */
export function recarregarPagina(): void { location.reload() }

/** Apaga a cópia guardada (service worker + caches) e abre a versão nova. ?v= fura o cache de HTML do servidor; o # mantém a tela atual. */
export async function aplicarNovaVersao(id: string): Promise<void> {
  if (trocando) return
  trocando = true
  try { sessionStorage.setItem(JA_TENTOU, id) } catch { /* sem sessionStorage: segue */ }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})))
  } catch { /* sem service worker: segue */ }
  try {
    if ('caches' in globalThis) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))) }
  } catch { /* sem Cache API: segue */ }
  location.replace(`${location.pathname}?v=${encodeURIComponent(id)}${location.hash}`)
}

/**
 * Pergunta ao servidor qual versão está no ar. 'aplicando' = vai trocar (a página recarrega); 'nova' = há versão nova e só foi avisada (faixa);
 * 'igual' = já está na versão do ar; 'sem_resposta' = offline / servidor não respondeu (nada muda, sem erro).
 */
export async function conferirVersao(origem: OrigemConferencia): Promise<'aplicando' | 'nova' | 'igual' | 'sem_resposta'> {
  if (trocando) return 'aplicando'
  try {
    const r = await fetch(`${BASE}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return 'sem_resposta'
    const { id } = (await r.json()) as { id?: string }
    if (!id) return 'sem_resposta'
    let tentada: string | null = null
    try { tentada = sessionStorage.getItem(JA_TENTOU) } catch { /* sem sessionStorage */ }
    const acao = acaoParaVersaoNova(origem, id, BUILD, tentada)
    if (acao === 'aplicar') { await aplicarNovaVersao(id); return 'aplicando' }
    if (acao === 'avisar') { avisarNovaVersao(id); return 'nova' }
    return id === BUILD ? 'igual' : 'nova'
  } catch { return 'sem_resposta' /* offline / sem rede: fica na versão atual, sem erro */ }
}

/** Liga as conferências automáticas: na abertura, a cada minuto com o app em uso, ao voltar do fundo e quando a internet volta. */
export function iniciarAtualizacao(): void {
  void conferirVersao('abertura')
  setInterval(() => { if (document.visibilityState === 'visible') void conferirVersao('periodica') }, 60_000)
  let saiuEm = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saiuEm = Date.now(); return }
    const ficouFora = saiuEm > 0 ? (Date.now() - saiuEm) / 1000 : 0
    saiuEm = 0
    void conferirVersao(ficouFora >= SEGUNDOS_FORA ? 'voltou' : 'periodica')
  })
  window.addEventListener('online', () => { void conferirVersao('periodica') })
}
