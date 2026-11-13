import { useSyncExternalStore } from 'react'
import { acaoParaVersaoNova, type OrigemConferencia } from './versao'

declare const __BUILD_ID__: string

// --- PWA: manter o app sempre na versão publicada — Android, iPhone E site, igual. ---
// Problema que isto resolve: a cópia guardada (service worker) podia ficar presa numa versão velha e "sair e entrar" continuava mostrando o antigo. A
// solução NÃO depende de o cache "soltar" sozinho: a REDE manda. O version.json (nunca cacheado) diz qual é a versão no ar; se for diferente da que está
// rodando, apagamos a cópia guardada (service worker + caches) e recarregamos a nova.
// 07/10 (pedido do Ivan): ele não pode precisar "sair e entrar" a cada ajuste. A troca é AUTOMÁTICA só na abertura; e o botão Atualizar do topo confere a versão e
// recarrega a tela na hora (o iPhone instalado não tem "puxar para atualizar").
// 13/11 (regra do dono): o app NUNCA recarrega sozinho com a pessoa trabalhando (digitando, lançando ou comprando). Ao voltar do fundo, com o app em uso, quando a
// internet volta e quando o service worker novo assume a tela, só aparece a faixa "Tem uma versão nova do app. Atualizar"; a troca só acontece no CLIQUE.
// 13/11 (revisão): nem a abertura troca às cegas. Ela só troca sozinha se a resposta do version.json chegar em até 3 s (LIMITE_ABERTURA_MS; com internet lenta a
// resposta chegaria quando a pessoa já estivesse digitando) E se a pessoa ainda NÃO mexeu na página (pointerdown, touchstart, keydown, input ou focusin desde que
// iniciarAtualizacao ligou). Passou do tempo: desiste sem erro e a conferência de 60 s mostra a faixa. Já mexeu: a abertura vira "periodica" (só a faixa).

const BASE = import.meta.env.BASE_URL
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
const JA_TENTOU = 'spazio_versao_tentada' // trava anti-loop: lembra para qual versão já tentamos trocar nesta sessão
/** Voltar ao app depois de pelo menos isto fora conta como "voltou"; menos que isso a pessoa só trocou de app por um instante ("periodica"). Desde 13/11 as duas só AVISAM (faixa), nunca recarregam. */
export const SEGUNDOS_FORA = 30
/** Na ABERTURA a pergunta ao version.json espera no máximo isto; estourou = "sem_resposta" (não troca, sem erro) e a conferência de 60 s avisa depois. Só a abertura tem limite. */
export const LIMITE_ABERTURA_MS = 3000
/** Gestos que mostram que a pessoa já está usando a página (ligados em iniciarAtualizacao, na fase de captura do document). */
export const EVENTOS_DE_USO = ['pointerdown', 'touchstart', 'keydown', 'input', 'focusin'] as const

let trocando = false
let pessoaMexeu = false // virou true no 1º gesto (EVENTOS_DE_USO) depois de iniciarAtualizacao: a abertura não troca mais sozinha
let novaVersao: string | null = null
const ouvintes = new Set<() => void>()
function avisarNovaVersao(id: string) {
  if (novaVersao === id) return
  novaVersao = id
  ouvintes.forEach((f) => f())
}
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }
/** A versão nova que já foi vista no ar mas ainda não foi aplicada (a faixa "Tem uma versão nova do app" aparece enquanto houver), ou null. */
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
 * Na abertura: a pergunta tem limite de LIMITE_ABERTURA_MS e, se a pessoa já mexeu na página quando a resposta chega, vale como "periodica" (só avisa, nunca recarrega).
 */
export async function conferirVersao(origem: OrigemConferencia): Promise<'aplicando' | 'nova' | 'igual' | 'sem_resposta'> {
  if (trocando) return 'aplicando'
  const limite = origem === 'abertura' ? new AbortController() : null
  const relogio = limite ? setTimeout(() => limite.abort(), LIMITE_ABERTURA_MS) : undefined
  try {
    const r = await fetch(`${BASE}version.json?t=${Date.now()}`, limite ? { cache: 'no-store', signal: limite.signal } : { cache: 'no-store' })
    if (!r.ok) return 'sem_resposta'
    const { id } = (await r.json()) as { id?: string }
    if (!id) return 'sem_resposta'
    let tentada: string | null = null
    try { tentada = sessionStorage.getItem(JA_TENTOU) } catch { /* sem sessionStorage */ }
    // a pessoa já mexeu na página enquanto a resposta vinha: a abertura deixa de valer (trocar agora apagaria o que ela digitou)
    const acao = acaoParaVersaoNova(origem === 'abertura' && pessoaMexeu ? 'periodica' : origem, id, BUILD, tentada)
    if (acao === 'aplicar') { await aplicarNovaVersao(id); return 'aplicando' }
    if (acao === 'avisar') { avisarNovaVersao(id); return 'nova' }
    return id === BUILD ? 'igual' : 'nova'
  } catch { return 'sem_resposta' /* offline / sem rede / passou do limite da abertura: fica na versão atual, sem erro */ }
  finally { if (relogio !== undefined) clearTimeout(relogio) }
}

/**
 * O service worker novo assumiu a tela aberta. Por padrão o plugin do PWA (registerType 'autoUpdate') RECARREGA a página nesse momento; main.tsx passa esta função em
 * `onNeedReload` para trocar a recarga sozinha por um aviso: confere a versão no ar e, havendo uma nova, mostra a faixa (a troca só no clique).
 */
export function aoServiceWorkerNovoAssumir(): void { void conferirVersao('periodica') }

/**
 * Liga as conferências automáticas: na abertura (única que troca sozinha, e só se a pessoa ainda não mexeu e a resposta vier em até 3 s), a cada minuto com o app em uso, ao voltar do fundo e quando a internet volta (estas só
 * AVISAM). A pergunta é ao version.json da rede, bem leve; a cada 60 s é mais frequente que os 10 minutos pedidos pela regra do dono de 13/11.
 */
export function iniciarAtualizacao(): void {
  // ANTES da conferência da abertura: qualquer gesto da pessoa daqui para a frente impede a troca sozinha da abertura (fase de captura: pega o gesto em qualquer campo)
  for (const evento of EVENTOS_DE_USO) document.addEventListener(evento, () => { pessoaMexeu = true }, { capture: true, passive: true })
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
