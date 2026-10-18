/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// GitHub Pages has no fallback to index.html, so a reload or a link to /about would get its 404 page. It serves
// 404.html for any unknown path instead, so make that the app and let the router take it from there.
function spaFallback(): Plugin {
  return {
    name: 'artless:spa-fallback',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html']
      if (index?.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), spaFallback()],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      reporter: ['text-summary', 'text'],
      // Floors just under today's numbers, so coverage can only go up. Raise them as tests land;
      // never lower them to get a run passing, and never set one below 90.
      thresholds: {
        statements: 97,
        branches: 92,
        functions: 96,
        lines: 99,
      },
    },
  },
})
