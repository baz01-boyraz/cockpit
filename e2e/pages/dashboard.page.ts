import type { Locator, Page } from '@playwright/test'

/** Command-center dashboard (`src/panels/DashboardPanel.tsx`). */
export class DashboardPage {
  readonly rail: Locator
  readonly hero: Locator
  readonly approvalBanner: Locator

  constructor(page: Page) {
    this.rail = page.locator('aside.rail')
    this.hero = page.locator('.dashHero')
    this.approvalBanner = page.locator('.dash__approvalBanner')
  }
}
