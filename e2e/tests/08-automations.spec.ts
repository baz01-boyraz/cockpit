import { expect, test } from '@playwright/test'
import { gotoApp } from '../support/app'

test('owner can create and pause a friendly Hermes watch without cron syntax', async ({ page }) => {
  await gotoApp(page)
  await page.locator('[data-nav="automations"]').click()

  await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(page.getByText('Daily briefing', { exact: true })).toBeVisible()
  await expect(page.getByText('Daily at 09:00', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'New watch' }).click()
  await page.getByLabel('Watch name').fill('Queue pulse')
  await page.getByLabel('What should Hermes watch?').fill('Tell me when the project needs attention.')
  await page.getByLabel('Rhythm').selectOption('360')
  await page.getByRole('button', { name: 'Create watch' }).click()

  const card = page.locator('[data-automation-id]').filter({ hasText: 'Queue pulse' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Every 6 hours')).toBeVisible()
  await card.getByRole('button', { name: 'Pause' }).click()
  await expect(card.getByRole('button', { name: 'Resume' })).toBeVisible()
})
