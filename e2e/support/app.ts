import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Rail nav targets by `data-nav` (see `src/components/LeftRail.tsx`). Kept as
 * a typed map so a renamed view breaks the type check here instead of a
 * silent selector miss inside a spec.
 */
export const NAV = {
  dashboard: '[data-nav="dashboard"]',
  terminals: '[data-nav="terminals"]',
  swarm: '[data-nav="swarm"]',
  memory: '[data-nav="memory"]',
  usage: '[data-nav="usage"]',
} as const

/**
 * Navigate to the app root and wait past the `.splash` boot screen
 * (`src/App.tsx` renders it while `!ready`, then swaps in `AppShell`). Every
 * journey starts here so a slow `init()` never races the first assertion.
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator(NAV.dashboard)).toBeVisible()
}

/** Click a rail nav item and wait for its panel to take over the main view. */
export async function openView(page: Page, view: keyof typeof NAV): Promise<void> {
  await page.locator(NAV[view]).click()
}
