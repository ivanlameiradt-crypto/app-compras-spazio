import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { configure } from '@testing-library/react'

// suíte completa sob carga (muitos arquivos em paralelo) pode deixar promessas encadeadas
// (useSessao/Comprar) mais lentas que o padrão de 1s do findBy*/waitFor — sem isso a suíte fica
// instável (passa isolado, falha ocasionalmente no `npx vitest run` completo).
configure({ asyncUtilTimeout: 5000 })

// Isolamento: cada teste começa com o localStorage limpo. Sem isto, um teste que grava
// 'cache-comprar'/'compra-aberta' e não limpa depois vaza para o próximo ARQUIVO (passava isolado,
// falhava às vezes no `npx vitest run` completo). Só o projeto app (jsdom) usa este setup.
beforeEach(() => { try { localStorage.clear() } catch { /* jsdom sempre tem; não arrisca */ } })
