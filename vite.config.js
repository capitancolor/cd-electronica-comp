import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 1. Forzamos el puerto para que coincida con tauri.conf.json
  server: {
    port: 5173,
    strictPort: true, // Si el 5173 está ocupado, tira error en lugar de saltar al 5174
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // 2. Evitamos que Vite intente pre-optimizar las APIs de Tauri
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', '@tauri-apps/api'],
  },
  // 3. Importante: Tauri v1 necesita que el build sea compatible
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})