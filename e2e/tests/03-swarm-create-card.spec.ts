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
