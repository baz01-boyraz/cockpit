import { describe, expect, it } from 'vitest'
import {
  DIRECT_AGENT_CONTRACT_MARK,
  directAgentContractText,
} from '@shared/direct-agent-contract'
import {
  claudePromptHookCommand,
  upsertAgentsMdContract,
} from '@shared/memory-contract'

describe('directAgentContractText', () => {
  it('makes direct repository work the default and Swarm a current-turn opt-in', () => {
    const text = directAgentContractText()

    expect(text.startsWith(DIRECT_AGENT_CONTRACT_MARK)).toBe(true)
    expect(text).toMatch(/work directly in the current repository/i)
    expect(text).toMatch(/current user message explicitly requests Swarm/i)
    expect(text).toMatch(/does not authorize commit, push, release, or app refresh/i)
    expect(text).toMatch(/one-time Cockpit approval/i)
  })

  it('contains no legacy orchestrator or card-dispatch vocabulary', () => {
    const text = directAgentContractText()

    for (const forbidden of [
      'Hermes',
      'COCKPIT_PROJECT_ID',
      'create_swarm_card',
      'propose_swarm_card',
      'coding fallback',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('is compact and safe for the native Claude hook shell command', () => {
    const text = directAgentContractText()
    expect(text.length).toBeLessThan(900)
    expect(text).not.toContain("'")
    expect(text).not.toContain('\\')
    expect(text).not.toContain('\n')
  })
})

describe('standing agent contract delivery', () => {
  it('delivers direct and memory contracts together through the Claude hook', () => {
    const command = claudePromptHookCommand()
    expect(command).toContain(directAgentContractText())
    expect(command).toContain('COCKPIT MEMORY CONTRACT')
  })

  it('delivers direct and memory contracts together through the Codex managed block', () => {
    const agents = upsertAgentsMdContract(null)
    expect(agents).toContain(directAgentContractText())
    expect(agents).toContain('COCKPIT MEMORY CONTRACT')
  })
})
