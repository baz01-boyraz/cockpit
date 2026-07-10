import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    // Backend/pure-logic suites live in test/; renderer store-slice suites live
    // beside their source under src/ so the web tsconfig (DOM lib) typechecks them.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/main/services/**/*.ts', 'shared/**/*.ts'],
      // Ratchet floor: measured baseline was 73.75% lines on 2026-07-08.
      // Raise these as untested services gain suites — never lower them.
      thresholds: {
        lines: 70,
        functions: 80,
        branches: 80,
        statements: 70,
      },
    },
  },
})
