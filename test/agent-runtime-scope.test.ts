import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AGENTS.md runtime scope', () => {
  it('routes interactive Codex sessions away from Hermes Swarm instructions', () => {
    const agents = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8')
    const codexGuard = agents.indexOf('If you are **Codex** running in an interactive terminal')
    const hermesRole = agents.indexOf('## Who you are here')

    expect(codexGuard).toBeGreaterThanOrEqual(0)
    expect(codexGuard).toBeLessThan(hermesRole)
    expect(agents).toContain('work directly in the repository')
    expect(agents).toContain('do not create or propose a Swarm card')
  })
})
