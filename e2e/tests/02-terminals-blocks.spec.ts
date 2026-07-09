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
  await expect(terminals.blankShellButton).toBeVisible()
  await terminals.createBlankShell()

  await expect(terminals.sessionTabs).toBeVisible()
  await expect(terminals.sessionTabs.getByRole('tab')).toHaveCount(1)

  await expect(terminals.viewToggle).toBeVisible()
  await expect(terminals.streamTab()).toBeVisible()
  await expect(terminals.blocksTab()).toBeVisible()
  await expect(terminals.streamTab()).toHaveAttribute('aria-selected', 'true')
})
