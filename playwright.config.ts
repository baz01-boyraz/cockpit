import { defineConfig, devices } from '@playwright/test'

/**
 * E2E smoke suite (Track C1, docs/plans/system-roadmap.md).
 *
 * Runs headless Chromium against the renderer build served on localhost —
 * the same `out/renderer` + `serve.mjs` workflow CLAUDE.md documents for
 * screenshot review. The renderer falls back to its in-browser mock bridge
 * (`src/lib/mock.ts`) whenever `window.cockpit` (the Electron preload) is
 * absent, so the full app renders meaningfully in a plain browser tab.
 *
 * Build freshness is the caller's responsibility: run `npm run build` before
 * `npm run test:e2e` so `out/renderer` reflects the current source. The
 * `webServer` block below reuses an already-running `node serve.mjs` on
 * port 3000 instead of restarting it, so a `npm run serve` left open in
 * another terminal is picked up as-is.
 */
export default defineConfig({
  testDir: './e2e/tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
