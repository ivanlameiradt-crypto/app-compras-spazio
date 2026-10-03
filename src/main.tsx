import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { precisaAtualizar } from './lib/versao'
import './styles.css'

declare const __BUILD_ID__: string

// --- PWA: manter o app sempre na versão publicada — Android, iPhone E site, igual. ---
// Problema que isto resolve: a cópia guardada (service worker) podia ficar presa numa versão velha e "sair e entrar"
// continuava mostrando o antigo. A solução NÃO depende de o cache "soltar" sozinho: a REDE manda. O version.json
// (nunca cacheado) diz qual é a versão no ar; se for diferente da que está rodando, apagamos a cópia guardada
// (service worker + caches) e recarregamos a nova. Com clientsClaim no service worker (vite.config), o caminho
// rápido (o SW novo assumir a tela aberta e recarregar) também passa a funcionar.
registerSW({ immediate: true })

const BASE = import.meta.env.BASE_URL
const JA_TENTOU = 'spazio_versao_tentada' // trava anti-loop: lembra para qual versão já tentamos trocar nesta sessão
let trocando = false

async function trocarDeVersao(id: string) {
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
  // ?v= fura o cache de HTML do servidor (senão poderia reabrir a mesma versão velha); o # mantém a tela atual
  location.replace(`${location.pathname}?v=${encodeURIComponent(id)}${location.hash}`)
}

async function conferirVersao() {
  if (trocando) return
  try {
    const r = await fetch(`${BASE}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const { id } = (await r.json()) as { id?: string }
    if (!id) return
    let tentada: string | null = null
    try { tentada = sessionStorage.getItem(JA_TENTOU) } catch { /* sem sessionStorage */ }
    if (precisaAtualizar(id, __BUILD_ID__, tentada)) await trocarDeVersao(id)
  } catch { /* offline / sem rede: fica na versão atual, sem erro */ }
}

conferirVersao() // já na abertura
setInterval(() => { void conferirVersao() }, 60_000) // e a cada minuto com o app aberto
// voltar pra frente (app instalado volta do fundo sem recarregar a página), reganhar foco, voltar a ter rede: confere
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void conferirVersao() })
window.addEventListener('focus', () => { void conferirVersao() })
window.addEventListener('online', () => { void conferirVersao() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
