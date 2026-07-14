import { expect, test } from '@playwright/test'
import { gotoApp } from '../support/app'

test('legacy ambient automation is absent while provider-neutral Memory stays available', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('[data-nav="automations"]')).toHaveCount(0)

  await page.locator('[data-nav="memory"]').click()
  await expect(page.getByRole('heading', { name: 'Project memory' })).toBeVisible()
  const coverage = page.getByRole('region', { name: 'Claude and Codex memory capture status' })
  await expect(coverage).toBeVisible()
  await expect(coverage.getByText('Claude', { exact: true })).toBeVisible()
  await expect(coverage.getByText('Codex', { exact: true })).toBeVisible()
})
