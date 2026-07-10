import type { Locator, Page } from '@playwright/test'

/** Sentinel bell + popover (`src/components/SentinelBell.tsx`) and toast host
 *  (`src/components/SentinelToasts.tsx`). */
export class SentinelPage {
  readonly page: Page
  readonly bellButton: Locator
  readonly popover: Locator
  readonly openSignalCenter: Locator
  readonly toastHost: Locator

  constructor(page: Page) {
    this.page = page
    // Accessible name is dynamic ("N unseen signals" / "Signals — all quiet")
    // but always contains "signals" — match on that instead of exact text.
    this.bellButton = page.getByRole('button', { name: /signals/i })
    this.popover = page.getByRole('dialog', { name: 'Recent signals' })
    this.openSignalCenter = this.popover.getByRole('button', { name: 'Open signal center' })
    // `SentinelToasts` renders a plain `<div aria-label="Signal notifications">`
    // with no ARIA role, so `getByLabel` (which targets labelable form
    // controls) won't match it — use the aria-label attribute directly.
    this.toastHost = page.locator('[aria-label="Signal notifications"]')
  }

  async open(): Promise<void> {
    await this.bellButton.click()
  }
}
