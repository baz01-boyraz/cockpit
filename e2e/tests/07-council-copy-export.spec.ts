import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'

test('Council report is selectable, copyable, exportable, and rendered once', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:3000',
  })
  await gotoApp(page)
  await openView(page, 'council')

  await page.getByRole('button', {
    name: /Cache the gateway read responses to cut repeat latency/,
  }).click()
  await expect(page.getByText('Your brief is ready. Nothing has started yet.')).toBeVisible()

  const reportSurface = page.locator('.councilSelectable')
  await expect(reportSurface).toBeVisible()
  expect(await reportSurface.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text')

  const canonicalSentence = 'Applies to the shared request/response layer both sides already import.'
  await expect(page.getByText(canonicalSentence, { exact: true })).toHaveCount(1)

  const fullCopy = page.getByRole('button', { name: 'Copy full report' })
  await fullCopy.click()
  await expect(page.getByRole('button', { name: 'Copy full report copied' })).toBeVisible()
  const fullReport = await page.evaluate(() => navigator.clipboard.readText())
  expect(fullReport).toContain('# Council Report')
  expect(fullReport).toContain('## Refined Spec')
  expect(fullReport).toContain('## Seat Perspectives')
  expect(fullReport).toContain('- Engine: `codex · gpt-5.6-sol`')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('council-report-mock-council-spec-approved.md')

  await page.getByText('How Council reached this').click()
  await page.getByText('Refined spec', { exact: true }).click()
  await page.getByRole('button', { name: 'Copy refined spec' }).click()
  await expect(page.getByRole('button', { name: 'Copy refined spec copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(canonicalSentence)

  await reportSurface.locator('.councilDecision__why').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Council text actions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Select all report' }).click()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toContain('APPROVED')
  expect(selected).toContain('Your brief is ready')

  await reportSurface.dispatchEvent('contextmenu', { clientX: 360, clientY: 260 })
  await menu.getByRole('menuitem', { name: 'Copy selection' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Your brief is ready')
})
