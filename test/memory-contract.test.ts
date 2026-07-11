import { describe, expect, it } from 'vitest'
import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  MEMORY_CONTRACT_MARK,
  claudePromptHookCommand,
  memoryContractText,
  upsertAgentsMdContract,
  upsertClaudeSettingsHooks,
} from '../shared/memory-contract'

describe('memoryContractText', () => {
  it('states the MUST rule: search memory first, prove it with a status line', () => {
    const text = memoryContractText()
    expect(text.startsWith(MEMORY_CONTRACT_MARK)).toBe(true)
    expect(text).toContain('.cockpit-memory/')
    expect(text).toContain('MEMORY: read')
    expect(text).toContain('MEMORY: no relevant notes')
    expect(text).toMatch(/never instructions/i)
  })

  it('stays compact and safe to embed in a single-quoted shell command', () => {
    const text = memoryContractText()
    expect(text.length).toBeLessThan(500)
    expect(text).not.toContain("'")
    expect(text).not.toContain('\\')
    expect(text).not.toContain('\n')
  })
})

describe('claudePromptHookCommand', () => {
  it('echoes the canonical contract for the UserPromptSubmit hook', () => {
    const command = claudePromptHookCommand()
    expect(command).toBe(`echo '${memoryContractText()}'`)
  })
})

describe('upsertClaudeSettingsHooks', () => {
  it('creates settings with the hook when no file exists', () => {
    const result = upsertClaudeSettingsHooks(null)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result as string)
    const groups = parsed.hooks.UserPromptSubmit
    expect(groups).toHaveLength(1)
    expect(groups[0].hooks[0]).toEqual({ type: 'command', command: claudePromptHookCommand() })
  })

  it('preserves unrelated settings keys and foreign hooks', () => {
    const existing = JSON.stringify({
      enableAllProjectMcpServers: true,
      permissions: { allow: ['Skill(fewer-permission-prompts)'] },
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: 'prettier --write' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo user-owned' }] }],
      },
    })
    const result = upsertClaudeSettingsHooks(existing)
    const parsed = JSON.parse(result as string)
    expect(parsed.enableAllProjectMcpServers).toBe(true)
    expect(parsed.permissions.allow).toEqual(['Skill(fewer-permission-prompts)'])
    expect(parsed.hooks.PostToolUse[0].hooks[0].command).toBe('prettier --write')
    const commands = parsed.hooks.UserPromptSubmit.flatMap(
      (group: { hooks: Array<{ command: string }> }) => group.hooks.map((hook) => hook.command),
    )
    expect(commands).toContain('echo user-owned')
    expect(commands).toContain(claudePromptHookCommand())
  })

  it('replaces a stale cockpit-managed hook instead of duplicating it', () => {
    const stale = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: `echo '${MEMORY_CONTRACT_MARK} old wording'` }] },
        ],
      },
    })
    const result = upsertClaudeSettingsHooks(stale)
    const parsed = JSON.parse(result as string)
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1)
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe(claudePromptHookCommand())
  })

  it('is idempotent: re-applying the current output changes nothing', () => {
    const once = upsertClaudeSettingsHooks(null) as string
    expect(upsertClaudeSettingsHooks(once)).toBe(once)
  })

  it('refuses to rewrite settings it cannot parse', () => {
    expect(upsertClaudeSettingsHooks('{ not json')).toBeNull()
    expect(upsertClaudeSettingsHooks('[1, 2]')).toBeNull()
  })
})

describe('upsertAgentsMdContract', () => {
  it('creates a fresh AGENTS.md carrying the marked contract block', () => {
    const doc = upsertAgentsMdContract(null)
    expect(doc).toContain(AGENTS_MD_BEGIN)
    expect(doc).toContain(AGENTS_MD_END)
    expect(doc).toContain(memoryContractText())
  })

  it('appends after existing user content without touching it', () => {
    const doc = upsertAgentsMdContract('# My project\n\nUse tabs.\n')
    expect(doc.startsWith('# My project\n\nUse tabs.\n')).toBe(true)
    expect(doc).toContain(AGENTS_MD_BEGIN)
  })

  it('replaces only the marked block when one exists', () => {
    const existing = [
      '# My project',
      '',
      AGENTS_MD_BEGIN,
      'stale contract wording',
      AGENTS_MD_END,
      '',
      'Trailing user notes.',
    ].join('\n')
    const doc = upsertAgentsMdContract(existing)
    expect(doc).toContain('# My project')
    expect(doc).toContain('Trailing user notes.')
    expect(doc).toContain(memoryContractText())
    expect(doc).not.toContain('stale contract wording')
    expect(doc.match(new RegExp(AGENTS_MD_BEGIN, 'g'))).toHaveLength(1)
  })

  it('is idempotent: re-applying the current output changes nothing', () => {
    const once = upsertAgentsMdContract('# Notes\n')
    expect(upsertAgentsMdContract(once)).toBe(once)
  })
})
