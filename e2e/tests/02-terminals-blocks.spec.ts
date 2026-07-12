import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'
import { TerminalsPage } from '../pages/terminals.page'

/**
 * Journey 2 — the Terminals view renders on nav click, and spinning up a
 * shell mounts the terminal surface: the session tab strip and the
 * stream/blocks toggle inside `TerminalView` (`src/components/TerminalView.tsx`).
 */
test('opens Terminals and mounts a session with the stream/blocks surface', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'terminals')

  // `exact` avoids a substring match against the empty state's own
  // "No terminals yet" heading.
  await expect(page.getByRole('heading', { name: 'Terminals', exact: true })).toBeVisible()

  const terminals = new TerminalsPage(page)
  await page.getByRole('button', { name: /^resume$/i }).click()
  await expect(page.getByRole('heading', { name: 'Resume a session' })).toBeVisible()
  await expect(page.getByText('Claude', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Codex', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.resumecard__datetime').first()).toContainText(/\d{1,2}.+·\s\d{2}:\d{2}/)
  await page.getByRole('button', { name: 'Close resume sessions' }).click()

  await expect(terminals.blankShellButton).toBeVisible()
  await terminals.createBlankShell()

  await expect(terminals.sessionTabs).toBeVisible()
  await expect(terminals.sessionTabs.getByRole('tab')).toHaveCount(1)

  await expect(terminals.viewToggle).toBeVisible()
  await expect(terminals.streamTab()).toBeVisible()
  await expect(terminals.blocksTab()).toBeVisible()
  await expect(terminals.streamTab()).toHaveAttribute('aria-selected', 'true')
  await expect(terminals.composer).toBeVisible()
  await expect(terminals.historyButton).toBeVisible()
  await expect(terminals.sendButton).toBeVisible()
})

test('edits, sends, and recalls text through the terminal composer', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'terminals')

  const terminals = new TerminalsPage(page)
  await terminals.createBlankShell()
  await expect(terminals.composer).toBeVisible()

  await terminals.composer.fill('echo old text')
  await terminals.composer.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 8))
  await terminals.composer.pressSequentially('new')
  await expect(terminals.composer).toHaveValue('echo new text')

  await terminals.composer.press('Enter')
  await expect(terminals.composer).toHaveValue('')

  await terminals.composer.press('Control+r')
  await expect(page.getByRole('listbox', { name: 'Terminal history' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'echo new text' })).toBeVisible()

  await terminals.composer.press('Escape')
  await terminals.composer.fill('echo first')
  await terminals.composer.press('Shift+Enter')
  await terminals.composer.pressSequentially('echo second')
  await expect(terminals.composer).toHaveValue('echo first\necho second')
})
