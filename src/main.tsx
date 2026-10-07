import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { iniciarAtualizacao } from './lib/atualizacao'
import './styles.css'

// --- PWA: o app se mantém na versão publicada (src/lib/atualizacao.ts): troca sozinho na abertura e ao voltar do fundo, avisa com uma faixa quando está em uso e tem o
// botão Atualizar no topo. Com clientsClaim no service worker (vite.config), o caminho rápido (o SW novo assumir a tela aberta) também funciona.
registerSW({ immediate: true })
iniciarAtualizacao()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
