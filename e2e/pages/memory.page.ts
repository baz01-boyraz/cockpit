import type { Locator, Page } from '@playwright/test'

/** Memory hub (`src/panels/MemoryPanel.tsx`, `src/components/memory/*`). */
export class MemoryPage {
  readonly page: Page
  readonly newNoteNameInput: Locator
  readonly createButton: Locator
  readonly saveButton: Locator

  constructor(page: Page) {
    this.page = page
    // `NoteNameInput` — shared by the empty state and the note list's own
    // "+ new note" row, so scope to the first (empty-state) instance.
    this.newNoteNameInput = page.getByLabel('New note name').first()
    this.createButton = page.getByRole('button', { name: /^create$/i }).first()
    this.saveButton = page.getByRole('button', { name: /^save$/i })
  }

  /** `MemoryReader`'s editor textarea carries `aria-label="Edit {slug}"`. */
  editorFor(slug: string): Locator {
    return this.page.getByLabel(`Edit ${slug}`)
  }

  async createNote(slug: string): Promise<void> {
    await this.newNoteNameInput.fill(slug)
    await this.createButton.click()
  }
}
