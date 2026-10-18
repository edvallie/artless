/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
        branches: 91,
        functions: 96,
        lines: 98,
      },
    },
  },
})
