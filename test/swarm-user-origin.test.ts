import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { swarmStartCardSchema } from '../shared/schemas'

describe('Swarm user-origin gate', () => {
  it('requires the explicit Swarm panel marker at the renderer boundary', () => {
    expect(
      swarmStartCardSchema.safeParse({ projectId: 'p1', cardId: 'c1' }).success,
    ).toBe(false)
    expect(
      swarmStartCardSchema.safeParse({
        projectId: 'p1',
        cardId: 'c1',
        userOrigin: 'swarm-panel',
      }).success,
    ).toBe(true)
  })

  it('maps the validated UI marker to a service-level user origin', () => {
    const ipc = readFileSync(resolve('electron/main/ipc/registerIpc.ts'), 'utf8')
    expect(ipc).toMatch(/origin:\s*'user-ui'/)
    expect(ipc).not.toMatch(/swarm\.startCard\(swarmStartCardSchema\.parse\(p\)\)/)
  })
})
