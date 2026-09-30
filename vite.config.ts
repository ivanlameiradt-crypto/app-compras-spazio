/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// 15.3: testes com dados reais moram no repositório PRIVADO (compra-semanal/tests/app_real) e só
// entram quando TESTES_PRIVADOS aponta para essa pasta (rodada local antes de publicar; nunca no CI
// público). Eles usam o banco de teste daqui pelo apelido '@app-db' (tests/db).
const TESTES_PRIVADOS = process.env.TESTES_PRIVADOS

// M9: build de produção sem as variáveis do Supabase compila "com sucesso" apontando pro
// localhost do dev — só falha em produção, silenciosamente. Falha cedo em vez disso. Dev e
// testes (vitest usa command 'serve') continuam funcionando sem as variáveis.
function exigirEnvDeProducao(mode: string) {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const faltando = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])
  if (faltando.length > 0) {
    throw new Error(`build de produção sem ${faltando.join(', ')} (defina em .env.local ou nas variáveis do repositório)`)
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') exigirEnvDeProducao(mode)
  return {
    base: '/app-compras-spazio/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registro do service worker é feito à mão em src/main.tsx (com checagem periódica de versão);
        // por isso desligamos a injeção automática, para não registrar duas vezes.
        injectRegister: false,
        manifest: {
          name: 'Compras Spazio',
          short_name: 'Compras',
          lang: 'pt-BR',
          start_url: '/app-compras-spazio/',
          scope: '/app-compras-spazio/',
          display: 'standalone',
          background_color: '#f6f7f5',
          theme_color: '#1f6f4a',
          icons: [{ src: 'icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        },
        workbox: { navigateFallback: '/app-compras-spazio/index.html' },
      }),
    ],
    test: {
      globals: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'app',
            include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/ui/**/*.test.{ts,tsx}'],
            environment: 'jsdom',
            setupFiles: ['tests/setup.ts'],
            testTimeout: 20000,
          },
        },
        {
          // Postgres em memória (PGlite): um banco por arquivo e um arquivo por vez — criar o banco leva segundos.
          extends: true,
          test: {
            name: 'db',
            include: ['tests/db/**/*.test.ts'],
            environment: 'node',
            testTimeout: 60000,
            hookTimeout: 60000,
            fileParallelism: false,
          },
        },
        {
          // lógica pura das Edge Functions (Deno em produção, mas sem globais do Deno): roda em node.
          extends: true,
          test: {
            name: 'functions',
            include: ['supabase/functions/**/*.test.ts'],
            environment: 'node',
          },
        },
        ...(TESTES_PRIVADOS
          ? [
              {
                extends: true,
                // '@app' = src do App, para o teste privado da mensagem do Mateus (cotacao_mensagem.test.ts)
                resolve: {
                  alias: {
                    '@app-db': fileURLToPath(new URL('./tests/db', import.meta.url)),
                    '@app': fileURLToPath(new URL('./src', import.meta.url)),
                  },
                },
                test: {
                  name: 'privado',
                  dir: TESTES_PRIVADOS,
                  include: ['*.test.ts'],
                  environment: 'node',
                  testTimeout: 60000,
                  hookTimeout: 60000,
                  fileParallelism: false,
                },
              },
            ]
          : []),
      ],
    },
  }
})
