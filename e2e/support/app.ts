import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Primary rail targets by `data-nav` (see `src/components/LeftRail.tsx`). Kept
 * as a typed map so a renamed daily-work view breaks the type check here
 * instead of a silent selector miss inside a spec. Utility views are routed
 * through the labelled control center below.
 */
export const NAV = {
  dashboard: '[data-nav="dashboard"]',
  automations: '[data-nav="automations"]',
  terminals: '[data-nav="terminals"]',
  swarm: '[data-nav="swarm"]',
  council: '[data-nav="council"]',
  memory: '[data-nav="memory"]',
} as const

type AppView = keyof typeof NAV | 'usage'

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
export async function openView(page: Page, view: AppView): Promise<void> {
  if (view === 'usage') {
    await page.getByRole('button', { name: 'Open control center' }).click()
    await page.getByRole('menuitem', { name: /Engine usage/ }).click()
    return
  }
  await page.locator(NAV[view]).click()
}
