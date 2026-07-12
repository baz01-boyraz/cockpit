import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'

test('Council composer labels intent honestly and exposes output language', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'council')

  await expect(page.getByRole('button', { name: /Refine request/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Analyze repository/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Review change/ })).toBeDisabled()
  await expect(page.getByText(/Use Council from a Swarm card/)).toBeVisible()

  const language = page.getByLabel('Output language')
  await expect(language).toHaveValue('auto')
  await language.selectOption('tr')
  await expect(language).toHaveValue('tr')

  await page.getByRole('button', { name: /Analyze repository/ }).click()
  const egress = page.getByLabel('Repository data sharing')
  await expect(egress).toHaveValue('local-only')
  await expect(page.getByText(/No repository content leaves this device/)).toBeVisible()
  await egress.selectOption('account-models')
  await expect(page.getByRole('checkbox', { name: /I consent to sending bounded/ })).toBeVisible()
})

test('local repository analysis discloses zero egress and cited-source metadata', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'council')

  await page.getByRole('button', { name: /Analyze repository/ }).click()
  await page
    .locator('#council-spec')
    .fill('Assess the Council persistence and renderer boundaries')
  await page.getByRole('button', { name: 'Collect local evidence' }).click()

  await expect(page.getByText(/Local repository evidence inventory is ready/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy analysis report' })).toBeVisible()
  await page.getByText('How Council reached this').click()
  const provenance = page.getByLabel('Analysis evidence provenance')
  await expect(provenance.getByRole('heading', { name: 'Sources used' })).toBeVisible()
  await expect(provenance.getByText('Local evidence only')).toBeVisible()
  await expect(provenance.getByText('electron/main/services/CouncilService.ts')).toBeVisible()
  await expect(provenance).not.toContainText('Bounded browser-preview evidence excerpt.')
})

test('Council report is selectable, copyable, exportable, and rendered once', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:3000',
  })
  await gotoApp(page)
  await openView(page, 'council')

  await page.getByRole('button', {
    name: /Cache the gateway read responses to cut repeat latency/,
  }).click()
  await expect(page.locator('.councilView__result')).toBeInViewport()
  await expect(page.getByRole('button', {
    name: /Cache the gateway read responses to cut repeat latency/,
  })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByText('Your brief is ready. Nothing has started yet.')).toBeVisible()

  const reportSurface = page.locator('.councilSelectable')
  await expect(reportSurface).toBeVisible()
  expect(await reportSurface.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text')

  const canonicalSentence = 'Applies to the shared request/response layer both sides already import.'
  await expect(page.locator('.council__p').filter({ hasText: canonicalSentence })).toHaveCount(1)

  await page.getByRole('button', { name: 'Copy primary brief' }).click()
  const primaryBrief = await page.evaluate(() => navigator.clipboard.readText())
  expect(primaryBrief).toContain(canonicalSentence)
  expect(primaryBrief).not.toContain('# Council Report')

  const fullCopy = page.getByRole('button', { name: 'Copy full report' })
  await fullCopy.click()
  await expect(page.getByRole('button', { name: 'Copy full report copied' })).toBeVisible()
  const fullReport = await page.evaluate(() => navigator.clipboard.readText())
  expect(fullReport).toContain('# Council Report')
  expect(fullReport).toContain('## Refined Spec')
  expect(fullReport).toContain('## Seat Perspectives')
  expect(fullReport).toContain('- Engine: `codex · default`')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('council-report-mock-council-spec-approved.md')

  await page.getByText('How Council reached this').click()
  await page.getByText('Refined spec', { exact: true }).click()
  await page.getByRole('button', { name: 'Copy refined spec' }).click()
  await expect(page.getByRole('button', { name: 'Copy refined spec copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(canonicalSentence)

  const contrarian = page.locator('.councilAdvisor').filter({ hasText: 'Contrarian' }).first()
  await contrarian.locator('summary').click()
  await contrarian.getByRole('button', { name: 'Copy Contrarian perspective' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'never states what to cache or the invalidation rule',
  )

  await expect(page.locator('.councilEvidence').getByLabel('Council seat standings')).toHaveCount(0)
  await page.locator('.councilHistoryScore > summary').click()
  await expect(page.locator('.councilHistoryScore').getByLabel('Council seat standings')).toBeVisible()

  await reportSurface.locator('.councilDecision__why').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Council text actions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Select all report' }).click()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toContain('APPROVED')
  expect(selected).toContain('Your brief is ready')
  await page.keyboard.press('ControlOrMeta+C')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Your brief is ready')

  await reportSurface.dispatchEvent('contextmenu', { clientX: 360, clientY: 260 })
  await menu.getByRole('menuitem', { name: 'Copy selection' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Your brief is ready')
})
