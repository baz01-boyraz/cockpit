import { expect, test } from '@playwright/test'
import { gotoApp } from '../support/app'
import { DashboardPage } from '../pages/dashboard.page'

/**
 * Journey 1 — the app boots straight to the dashboard: rail, command-center
 * hero, and (since the default seed project has a pending push approval,
 * see `src/lib/mockData.ts`) the approval banner are all visible.
 */
test('boots to the dashboard with rail, hero, and approval banner', async ({ page }) => {
  await gotoApp(page)
  const dashboard = new DashboardPage(page)

  await expect(dashboard.rail).toBeVisible()
  await expect(page.getByRole('navigation')).toBeVisible()

  await expect(dashboard.hero).toBeVisible()
  await expect(dashboard.hero.getByText('command center')).toBeVisible()
  await expect(dashboard.hero.getByRole('heading', { level: 2 })).toContainText('Cockpit')

  await expect(dashboard.approvalBanner).toBeVisible()
  await expect(dashboard.approvalBanner).toContainText('Awaiting your approval')
})
