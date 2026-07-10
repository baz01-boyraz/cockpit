import { expect, test } from '@playwright/test'
import { gotoApp } from '../support/app'

/**
 * Journey 6 — Navigation hierarchy: daily work stays directly reachable in the
 * rail, while lower-frequency accountability/configuration views live in one
 * discoverable control-center menu. Sentinel remains reachable from its bell.
 */
test('rail keeps daily work visible and groups utilities in the control center', async ({ page }) => {
  await gotoApp(page)

  const primaryNav = page.getByRole('navigation')
  await expect(primaryNav.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(primaryNav.getByRole('button', { name: 'Memory', exact: true })).toBeVisible()
  await expect(primaryNav.getByRole('button', { name: 'Audit', exact: true })).toHaveCount(0)
  await expect(primaryNav.getByRole('button', { name: 'Sentinel', exact: true })).toHaveCount(0)
  await expect(primaryNav.getByRole('button', { name: 'Usage', exact: true })).toHaveCount(0)
  await expect(primaryNav.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)

  const trigger = page.getByRole('button', { name: 'Open control center' })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const menu = page.getByRole('menu', { name: 'Control center' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Audit & approvals/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Engine usage/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Settings/ })).toBeVisible()

  await menu.getByRole('menuitem', { name: /Audit & approvals/ }).click()
  await expect(page.getByRole('heading', { name: 'Audit & approvals' })).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-current', 'page')

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
