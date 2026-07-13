import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const hook = resolve('.claude/hooks/guard-high-impact-command.mjs')

function runClaudeHook(command: string) {
  return spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
  })
}

describe('native high-impact lifecycle guards', () => {
  it.each([
    'npm run app:refresh',
    'npm run app:install-release',
    'bash scripts/release/refresh-local-app.sh',
    'osascript -e \'tell application "cockpiT" to quit\'',
    'pkill -f /Applications/cockpiT.app/',
    'rm -rf /Applications/cockpiT.app',
  ])('blocks Claude Bash command: %s', (command) => {
    const result = runClaudeHook(command)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/blocked.*lifecycle/i)
  })

  it('allows ordinary verification commands', () => {
    const result = runClaudeHook('npm test -- --runInBand')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('ships project-local Codex rules for the same lifecycle entry points', () => {
    const rules = readFileSync(resolve('.codex/rules/cockpit-safety.rules'), 'utf8')
    expect(rules).toContain('npm", "run", "app:refresh')
    expect(rules).toContain('npm", "run", "app:install-release')
    expect(rules).toContain('scripts/release/refresh-local-app.sh')
    expect(rules).toContain('decision = "forbidden"')
  })
})
