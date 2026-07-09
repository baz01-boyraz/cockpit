import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'
import { MemoryPage } from '../pages/memory.page'

/**
 * Journey 4 — Memory: the default seed project's hub is empty (the seeded
 * knowledge hub in `src/lib/mockData.ts` only covers `prj_cockpit`, and the
 * app boots into `prj_serbest` — see `src/store/slices/projectSlice.ts`), so
 * this journey creates a note through the empty-state composer, edits it,
 * and saves — the documented fallback for an empty hub.
 */
test('creates and saves a note through the empty-state composer', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'memory')

  await expect(page.getByRole('heading', { name: 'Project memory' })).toBeVisible()

  const memory = new MemoryPage(page)
  const slug = `e2e-note-${Date.now()}`
  await expect(memory.newNoteNameInput).toBeVisible()
  await memory.createNote(slug)

  const editor = memory.editorFor(slug)
  await expect(editor).toBeVisible()
  await editor.fill(`# E2E Note\n\nWritten by the Playwright smoke suite.`)

  await memory.saveButton.click()

  // Save exits edit mode (Save/Cancel are replaced by Edit/Rename/Trash) and
  // the reader shows the note's title, sourced from its first markdown heading.
  await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'E2E Note' })).toBeVisible()
})
