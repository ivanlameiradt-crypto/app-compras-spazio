import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const RAIZ = 'C:/dev/wt/lancando-azul'
export default defineConfig({ root: RAIZ, plugins: [react()], resolve: { alias: [{ find: /^.*\/lib\/api$/, replacement: RAIZ + '/.demo/api-stub.ts' }] }, server: { port: 5188, strictPort: true, fs: { strict: false } } })
