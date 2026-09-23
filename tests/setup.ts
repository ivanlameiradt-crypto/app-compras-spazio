import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { configure } from '@testing-library/react'

// suíte completa sob carga (muitos arquivos em paralelo) pode deixar promessas encadeadas
// (useSessao/Comprar) mais lentas que o padrão de 1s do findBy*/waitFor — sem isso a suíte fica
// instável (passa isolado, falha ocasionalmente no `npx vitest run` completo).
configure({ asyncUtilTimeout: 5000 })
