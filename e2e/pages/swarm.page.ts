import type { Locator, Page } from '@playwright/test'

/** Swarm board (`src/panels/SwarmPanel.tsx`, `src/components/swarm/*`). */
export class SwarmPage {
  readonly page: Page
  /** The "To do" lane — the only column wired with a create composer. */
  readonly todoColumn: Locator
  readonly newCardButton: Locator
  readonly titleInput: Locator
  readonly addCardButton: Locator

  constructor(page: Page) {
    this.page = page
    this.todoColumn = page.getByRole('region', { name: 'To do column' })
    this.newCardButton = this.todoColumn.getByRole('button', { name: /new card/i })
    this.titleInput = page.getByLabel('New card title')
    this.addCardButton = page.getByRole('button', { name: /add card/i })
  }

  async createCard(title: string): Promise<void> {
    await this.newCardButton.click()
    await this.titleInput.fill(title)
    await this.addCardButton.click()
  }

  /** Matches `SwarmCard`'s `aria-label="Edit card: {title}"` on the card button. */
  cardByTitle(title: string): Locator {
    return this.todoColumn.getByRole('button', { name: `Edit card: ${title}` })
  }
}
