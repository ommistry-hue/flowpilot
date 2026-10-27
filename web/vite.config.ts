import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const backend = process.env.FLOWPILOT_API_URL ?? 'http://localhost:5080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/hooks': backend,
      '/health': backend,
      '/hubs': { target: backend, ws: true },
    },
  },
  build: {
    outDir: '../src/FlowPilot.Server/wwwroot',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    // Timing diagnostics are noise in CI output, not a problem with the build.
    rolldownOptions: { checks: { bundlerTimings: false } },
  },
})
