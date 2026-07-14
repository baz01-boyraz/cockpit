import { expect, test } from '@playwright/test'
import { gotoApp } from '../support/app'
import { SentinelPage } from '../pages/sentinel.page'

/**
 * Journey 5 — Sentinel: the bell shows the unseen count for the seeded
 * per-project feed (`sentinelFor` in `src/lib/mock.ts` seeds one alert + one
 * notice), the mock replays that feed as toasts once on boot
 * (`SentinelToasts`), and the popover lists the same signals.
 */
test('bell shows unseen count, replays a toast, and opens the full signal center', async ({
  page,
}) => {
  await gotoApp(page)
  const sentinel = new SentinelPage(page)

  // The mock-only replay effect stands in for a real push (see SentinelToasts).
  // Each toast carries an explicit `role="alert"` or `role="status"` (severity
  // contract), which overrides its implicit `<article>` role — so match both.
  await expect(sentinel.toastHost).toBeVisible()
  const toasts = sentinel.toastHost.getByRole('alert').or(sentinel.toastHost.getByRole('status'))
  await expect(toasts).toHaveCount(2)

  await expect(sentinel.bellButton).toBeVisible()
  await expect(sentinel.bellButton).toHaveAccessibleName(/2 unseen signals/i)

  await sentinel.open()
  await expect(sentinel.popover).toBeVisible()
  await expect(sentinel.popover.getByText('Approval needed: Force-push rewrites main')).toBeVisible()
  await expect(sentinel.popover.getByText('Cannot find module "@shared/schemas"')).toBeVisible()

  // Passive update/signal cards yield while the actionable bell surface is
  // open, so translucent layers never visually collide or block decisions.
  const floatingCorner = page.locator('.floatingCorner')
  await expect(floatingCorner).toHaveCSS('opacity', '0')
  await expect(floatingCorner).toHaveCSS('pointer-events', 'none')

  await expect(sentinel.openSignalCenter).toBeVisible()
  await sentinel.openSignalCenter.click()
  await expect(page.getByRole('heading', { name: 'Sentinel' })).toBeVisible()
  await expect(sentinel.popover).toBeHidden()
  await expect(floatingCorner).toHaveCSS('opacity', '1')
})

test('signal cards explain urgency and restart impact, then hand off to a chosen agent', async ({
  page,
}) => {
  await gotoApp(page)
  const sentinel = new SentinelPage(page)

  await sentinel.open()
  const approval = sentinel.popover.locator('.sentinelRow').filter({
    hasText: 'Approval needed: Force-push rewrites main',
  })
  const logError = sentinel.popover.locator('.sentinelRow').filter({
    hasText: 'Cannot find module "@shared/schemas"',
  })

  await expect(approval.getByText('Importance 96%')).toBeVisible()
  await expect(approval.getByText('No restart')).toBeVisible()
  await expect(logError.getByText('Importance 73%')).toBeVisible()
  await expect(logError.getByText('Restart unknown')).toBeVisible()
  await expect(logError.getByRole('button', { name: 'Ask Claude' })).toBeVisible()
  await expect(logError.getByRole('button', { name: 'Ask Codex' })).toBeVisible()
  const dismissButton = logError.getByRole('button', { name: 'Dismiss' })
  await expect(dismissButton).toBeVisible()
  const dismissAffordance = await dismissButton.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderTopColor }
  })
  expect(dismissAffordance.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(dismissAffordance.border).not.toBe('rgba(0, 0, 0, 0)')

  await logError.getByRole('button', { name: 'Ask Claude' }).click()
  await expect(page.getByRole('tablist', { name: 'Terminal sessions' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Claude Code.*Signal review/i })).toBeVisible()
  await expect(page.getByText('Signal review', { exact: true }).first()).toBeVisible()
})
