import type { Locator, Page } from '@playwright/test'

/** Terminals view (`src/panels/TerminalsPanel.tsx`, `src/components/TerminalView.tsx`). */
export class TerminalsPage {
  readonly page: Page
  readonly blankShellButton: Locator
  readonly sessionTabs: Locator
  readonly viewToggle: Locator
  readonly composer: Locator
  readonly historyButton: Locator
  readonly sendButton: Locator

  constructor(page: Page) {
    this.page = page
    this.blankShellButton = page.getByRole('button', { name: /blank shell/i })
    this.sessionTabs = page.getByRole('tablist', { name: 'Terminal sessions' })
    // The stream/blocks toggle lives inside the active terminal pane.
    this.viewToggle = page.getByRole('tablist', { name: 'Terminal view' })
    this.composer = page.getByRole('textbox', { name: 'Terminal composer' })
    this.historyButton = page.getByRole('button', { name: 'Search terminal history' })
    this.sendButton = page.getByRole('button', { name: 'Send terminal input' })
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
