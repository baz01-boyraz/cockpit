import type { Locator, Page } from '@playwright/test'

/** Terminals view (`src/panels/TerminalsPanel.tsx`, `src/components/TerminalView.tsx`). */
export class TerminalsPage {
  readonly page: Page
  readonly blankShellButton: Locator
  readonly sessionTabs: Locator
  readonly viewToggle: Locator

  constructor(page: Page) {
    this.page = page
    this.blankShellButton = page.getByRole('button', { name: /blank shell/i })
    this.sessionTabs = page.getByRole('tablist', { name: 'Terminal sessions' })
    // The stream/blocks toggle lives inside the active terminal pane.
    this.viewToggle = page.getByRole('tablist', { name: 'Terminal view' })
  }

  async createBlankShell(): Promise<void> {
    await this.blankShellButton.click()
  }

  streamTab(): Locator {
    return this.viewToggle.getByRole('tab', { name: /stream/i })
  }

  blocksTab(): Locator {
    return this.viewToggle.getByRole('tab', { name: /blocks/i })
  }
}
