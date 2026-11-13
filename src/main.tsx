import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/archivo/wdth.css' // letra Archivo embutida no app (peso e largura variáveis): funciona sem internet
import App from './App'
import { aoServiceWorkerNovoAssumir, iniciarAtualizacao } from './lib/atualizacao'
import './lib/instalar' // guarda o convite de instalação do navegador assim que ele chega
import './styles.css'

// --- PWA: o app se mantém na versão publicada (src/lib/atualizacao.ts): troca sozinho SÓ na abertura (nada digitado a perder); ao voltar do fundo e com o app em uso
// apenas avisa com a faixa "Tem uma versão nova do app. Atualizar", e o botão Atualizar (do topo e da faixa) troca no clique. Regra do dono (13/11): nunca recarrega sozinho
// com a pessoa trabalhando. Com clientsClaim no service worker (vite.config), o SW novo assume a tela aberta; o plugin (registerType 'autoUpdate') recarregaria a página
// nessa hora, então `onNeedReload` troca a recarga por um aviso (aoServiceWorkerNovoAssumir).
registerSW({ immediate: true, onNeedReload: aoServiceWorkerNovoAssumir })
iniciarAtualizacao()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
