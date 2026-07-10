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

  await expect(sentinel.openSignalCenter).toBeVisible()
  await sentinel.openSignalCenter.click()
  await expect(page.getByRole('heading', { name: 'Sentinel' })).toBeVisible()
  await expect(sentinel.popover).toBeHidden()
})
