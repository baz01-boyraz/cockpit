import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { directAgentContractText } from '@shared/direct-agent-contract'

describe('AGENTS.md runtime scope', () => {
  it('gives interactive Codex one direct-coding role with no legacy orchestrator persona', () => {
    const agents = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8')

    expect(agents).toContain('interactive Codex terminal')
    expect(agents).toContain(directAgentContractText())
    expect(agents).toMatch(/current user message\s+explicitly requests Swarm/)

    for (const forbidden of [
      "cockpiT's background orchestrator",
      'COCKPIT_PROJECT_ID',
      'create_swarm_card',
      'propose_swarm_card',
      'Coding fallback order',
      'Never bypass a card',
    ]) {
      expect(agents).not.toContain(forbidden)
    }
  })

  it('gives Claude the same direct-terminal and app-lifecycle boundaries', () => {
    const claude = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8')

    expect(claude).toContain('## Direct terminal contract (MUST)')
    expect(claude).toContain(directAgentContractText())
    expect(claude).toMatch(/current user message\s+explicitly requests Swarm/)
    expect(claude).toContain('verification does not authorize commit, push, release, or app refresh')
  })
})
