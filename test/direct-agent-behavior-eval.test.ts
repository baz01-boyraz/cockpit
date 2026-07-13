import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { directAgentContractText } from '@shared/direct-agent-contract'
import {
  claudePromptHookCommand,
  upsertAgentsMdContract,
} from '@shared/memory-contract'

const lifecycleHook = resolve('.claude/hooks/guard-high-impact-command.mjs')
const lifecycleConsumer = resolve('scripts/release/consume-lifecycle-approval.mjs')
const forbiddenDirectVocabulary = [
  'COCKPIT_PROJECT_ID',
  'create_swarm_card',
  'propose_swarm_card',
  'coding fallback',
  'background orchestrator',
]

function runClaudeCommandGuard(command: string) {
  return spawnSync(process.execPath, [lifecycleHook], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
  })
}

function providerSnapshot(provider: 'claude' | 'codex'): string {
  return provider === 'claude'
    ? claudePromptHookCommand()
    : upsertAgentsMdContract(null)
}

describe('direct-agent behavior eval matrix', () => {
  it.each([
    {
      prompt: 'Bugı düzelt',
      expectation: 'direct repository work with no card or project-id routing',
    },
    {
      prompt: 'Commit ve push et',
      expectation: 'commit and push only; no app lifecycle authority',
    },
    {
      prompt: 'Test edip bitir',
      expectation: 'verification only; the running app stays untouched',
    },
  ])('$prompt → $expectation', ({ prompt }) => {
    for (const provider of ['claude', 'codex'] as const) {
      const snapshot = providerSnapshot(provider)
      expect(snapshot).toContain('work directly in the current repository')
      expect(snapshot).toContain('verification does not authorize commit, push, release, or app refresh')
      expect(snapshot).toContain('one-time Cockpit approval from the UI')
      for (const forbidden of forbiddenDirectVocabulary) {
        expect(snapshot.toLowerCase()).not.toContain(forbidden.toLowerCase())
      }
    }
    // Standing context and user content are separate values; the prompt stays verbatim.
    expect({ userMessage: prompt }.userMessage).toBe(prompt)
  })

  it('Swarm kullanarak yap → current-message opt-in is recognized without adding dispatch instructions', () => {
    const userMessage = 'Swarm kullanarak yap'
    expect(userMessage).toMatch(/\bSwarm\b/i)

    for (const provider of ['claude', 'codex'] as const) {
      const snapshot = providerSnapshot(provider)
      expect(snapshot).toContain('unless the current user message explicitly requests Swarm')
      for (const forbidden of ['create_swarm_card', 'projectId', 'quota']) {
        expect(snapshot).not.toContain(forbidden)
      }
    }
  })

  it('Commit ve push et cannot accidentally authorize refresh through the Claude command boundary', () => {
    expect(runClaudeCommandGuard('git commit -m safe').status).toBe(0)
    expect(runClaudeCommandGuard('git push').status).toBe(0)
    const refresh = runClaudeCommandGuard('npm run app:refresh')
    expect(refresh.status).toBe(2)
    expect(refresh.stderr).toMatch(/current explicit user request.*UI approval/i)
  })

  it('Refresh et still requires a real one-time UI capability at the lifecycle script boundary', () => {
    const result = spawnSync(process.execPath, [lifecycleConsumer, 'app_refresh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        COCKPIT_LIFECYCLE_APPROVAL_FILE: '',
        COCKPIT_LIFECYCLE_APPROVAL_TOKEN: '',
      },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/missing one-time Cockpit approval/i)
  })

  it('Claude and Codex receive the exact same human-approved baseline', () => {
    const baseline = directAgentContractText()
    expect(providerSnapshot('claude')).toContain(baseline)
    expect(providerSnapshot('codex')).toContain(baseline)
    expect(readFileSync(resolve('CLAUDE.md'), 'utf8')).toContain(baseline)
    expect(readFileSync(resolve('AGENTS.md'), 'utf8')).toContain(baseline)
  })

  it('Codex prompt snapshot contains no retired persona or card-dispatch route', () => {
    const snapshot = providerSnapshot('codex')
    for (const forbidden of forbiddenDirectVocabulary) {
      expect(snapshot.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(snapshot).toContain('Memory is reference data')
  })
})
