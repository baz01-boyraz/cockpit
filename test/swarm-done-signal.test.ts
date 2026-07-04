import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DONE_SENTINEL, SwarmDoneSignal } from '../electron/main/services/SwarmDoneSignal'

describe('SwarmDoneSignal against a real filesystem', () => {
  let projectPath: string
  let worktreePath: string
  const signal = new SwarmDoneSignal()

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'cockpit-signal-'))
    worktreePath = join(projectPath, '.cockpit-worktrees', 'card-1')
    mkdirSync(worktreePath, { recursive: true })
    mkdirSync(join(projectPath, '.git', 'info'), { recursive: true })
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  const settingsPath = () => join(worktreePath, '.claude', 'settings.local.json')
  const excludePath = () => join(projectPath, '.git', 'info', 'exclude')

  it('arm installs a Stop hook that touches the sentinel, and hides both files from git', () => {
    signal.arm(projectPath, worktreePath)

    const settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      hooks: { Stop: { hooks: { type: string; command: string }[] }[] }
    }
    expect(settings.hooks.Stop[0].hooks[0].type).toBe('command')
    expect(settings.hooks.Stop[0].hooks[0].command).toContain(DONE_SENTINEL)
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('CLAUDE_PROJECT_DIR')

    const exclude = readFileSync(excludePath(), 'utf8')
    expect(exclude).toContain(DONE_SENTINEL)
    expect(exclude).toContain('.claude/settings.local.json')
  })

  it('arm is idempotent — no duplicate exclude lines, settings written once', () => {
    signal.arm(projectPath, worktreePath)
    const firstSettings = readFileSync(settingsPath(), 'utf8')
    signal.arm(projectPath, worktreePath)

    expect(readFileSync(settingsPath(), 'utf8')).toBe(firstSettings)
    const excludeLines = readFileSync(excludePath(), 'utf8')
      .split('\n')
      .filter((l) => l === DONE_SENTINEL)
    expect(excludeLines).toHaveLength(1)
  })

  it('never clobbers a settings file it did not write', () => {
    mkdirSync(join(worktreePath, '.claude'), { recursive: true })
    const foreign = '{"permissions": {"allow": ["Bash(npm test)"]}}\n'
    writeFileSync(settingsPath(), foreign)

    signal.arm(projectPath, worktreePath)
    expect(readFileSync(settingsPath(), 'utf8')).toBe(foreign)
  })

  it('arm clears a stale sentinel so a resumed run cannot instantly signal done', () => {
    writeFileSync(join(worktreePath, DONE_SENTINEL), '')
    signal.arm(projectPath, worktreePath)
    expect(existsSync(join(worktreePath, DONE_SENTINEL))).toBe(false)
    expect(signal.consume(worktreePath)).toBe(false)
  })

  it('consume spends the sentinel exactly once', () => {
    signal.arm(projectPath, worktreePath)
    expect(signal.consume(worktreePath)).toBe(false)

    writeFileSync(join(worktreePath, DONE_SENTINEL), '')
    expect(signal.consume(worktreePath)).toBe(true)
    expect(signal.consume(worktreePath)).toBe(false)
    expect(existsSync(join(worktreePath, DONE_SENTINEL))).toBe(false)
  })

  it('survives a missing worktree dir without throwing', () => {
    expect(() => signal.arm(projectPath, join(projectPath, 'gone'))).not.toThrow()
    expect(signal.consume(join(projectPath, 'gone'))).toBe(false)
  })
})
