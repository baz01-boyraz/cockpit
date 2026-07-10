import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'
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

  await openView(page, 'usage')
  await expect(page.getByRole('heading', { name: 'Usage dashboard' })).toBeVisible()
  await page.getByRole('button', { name: /Hermes engine/i }).click()

  for (const width of [1280, 1512, 1728, 2000]) {
    await page.setViewportSize({ width, height: 945 })
    await page.waitForTimeout(350)

    const layout = await page.locator('.capacity').evaluate((capacity) => {
      const root = capacity.getBoundingClientRect()
      const modules = Array.from(capacity.querySelectorAll<HTMLElement>('.capEngine')).map(
        (module) => module.getBoundingClientRect(),
      )
      const rings = Array.from(capacity.querySelectorAll<HTMLElement>('.capRing__dial')).map(
        (ring) => ({
          rect: ring.getBoundingClientRect(),
          module: ring.closest('.capEngine')?.getBoundingClientRect() ?? null,
        }),
      )
      return {
        viewportWidth: window.innerWidth,
        scrollFits: capacity.scrollWidth <= capacity.clientWidth,
        modulesFit: modules.every(
          (module) => module.left >= root.left - 1 && module.right <= root.right + 1,
        ),
        ringsFit: rings.every(({ rect, module }) => {
          return Boolean(module && rect.left >= module.left - 1 && rect.right <= module.right + 1)
        }),
        moduleRows: new Set(modules.map((module) => Math.round(module.top))).size,
        maxRing: Math.max(...rings.map(({ rect }) => rect.width)),
      }
    })

    expect(layout, `Usage layout at ${width}px with Hermes docked`).toMatchObject({
      viewportWidth: width,
      scrollFits: true,
      modulesFit: true,
      ringsFit: true,
      moduleRows: 1,
    })
    expect(layout.maxRing).toBeLessThanOrEqual(104)
  }
})
