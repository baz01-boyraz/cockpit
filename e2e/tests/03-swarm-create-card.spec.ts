import { expect, test } from '@playwright/test'
import { gotoApp, openView } from '../support/app'
import { SwarmPage } from '../pages/swarm.page'

/**
 * Journey 3 — Swarm: open the board (the default seed project ships with a
 * few cards already, see `src/lib/mockData.ts`), create a new card through
 * the To-do column's inline composer, and see it land on the board.
 */
test('creates a card through the composer and sees it on the board', async ({ page }) => {
  await gotoApp(page)
  await openView(page, 'swarm')

  await expect(page.getByRole('heading', { name: 'Swarm board' })).toBeVisible()

  const swarm = new SwarmPage(page)
  await expect(swarm.todoColumn).toBeVisible()

  const title = `E2E swarm card ${Date.now()}`
  await swarm.createCard(title)

  await expect(swarm.cardByTitle(title)).toBeVisible()
})

test('keeps the council gate action readable inside the narrow To do card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await gotoApp(page)
  await openView(page, 'swarm')

  const swarm = new SwarmPage(page)
  const title = `E2E gated card ${Date.now()}`
  await swarm.createCard(title)

  const card = swarm.todoColumn.locator('.swarmCard').filter({ hasText: title })
  await card.getByRole('button', { name: 'Start', exact: true }).click()

  const prompt = card.getByRole('note')
  const convene = prompt.getByRole('button', { name: 'Convene council' })
  await expect(prompt).toBeVisible()
  await expect(convene).toBeVisible()

  const [cardBox, promptBox, buttonBox] = await Promise.all([
    card.boundingBox(),
    prompt.boundingBox(),
    convene.boundingBox(),
  ])
  expect(cardBox).not.toBeNull()
  expect(promptBox).not.toBeNull()
  expect(buttonBox).not.toBeNull()
  expect(promptBox!.x + promptBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width)
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(promptBox!.x + promptBox!.width)
  expect(
    await convene.evaluate((button) => {
      const style = getComputedStyle(button)
      return style.whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth
    }),
  ).toBe(true)
})
