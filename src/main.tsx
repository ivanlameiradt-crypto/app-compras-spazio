import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// PWA — manter o app sempre na versão publicada.
// O app guarda uma cópia de si mesmo (service worker) para abrir rápido e funcionar offline. Sem os
// dois cuidados abaixo, uma cópia velha pode ficar "presa" e telas novas não aparecem, mesmo depois
// de publicar (foi o que aconteceu com a tela de Cadastros).
//   1) registerType 'autoUpdate' (vite.config): quando o service worker novo assume, a página recarrega
//      sozinha na versão nova.
//   2) o intervalo abaixo faz o app PROCURAR versão nova a cada minuto mesmo ficando aberto (instalado
//      como app), não só quando é recarregado à mão. É isso que fecha o buraco do "preso na versão velha".
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registro) {
    if (registro) setInterval(() => { registro.update().catch(() => {}) }, 60_000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
