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
  // Simulate an upgrade from the renderer-only trust setting. M1a must adopt it
  // once into main/mock policy and delete the legacy key.
  await page.addInitScript(() => {
    localStorage.setItem('cockpit.memory.trust.prj_serbest', 'manual')
  })
  await gotoApp(page)
  await openView(page, 'memory')

  await expect(page.getByRole('heading', { name: 'Project memory' })).toBeVisible()

  // Trust policy comes from the app bridge (main-process SQLite in Electron,
  // in-memory service state in the browser mock), not renderer localStorage.
  const projectTrust = page.getByRole('group', {
    name: 'How much the brain saves on its own',
    exact: true,
  })
  await expect(projectTrust.getByRole('button', { name: 'Manual' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(
    await page.evaluate(() => localStorage.getItem('cockpit.memory.trust.prj_serbest')),
  ).toBeNull()

  await openView(page, 'dashboard')
  await openView(page, 'memory')
  await expect(
    page
      .getByRole('group', { name: 'How much the brain saves on its own', exact: true })
      .getByRole('button', { name: 'Manual' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Baz brain' }).click()
  const globalTrust = page.getByRole('group', {
    name: 'How much the global Baz brain saves on its own',
  })
  await expect(globalTrust.getByRole('button', { name: 'Assisted' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Verification preference' }).click()
  const globalProvenance = page.getByRole('region', { name: 'Baz brain memory provenance' })
  await expect(globalProvenance).toContainText('Created from Claude')
  await expect(globalProvenance).toContainText('mock-claude-session')
  await expect(globalProvenance).toContainText('Last changed by Codex')
  await expect(globalProvenance).toContainText('mock-codex-session')
  await page.getByRole('button', { name: 'Baz brain' }).click()

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
