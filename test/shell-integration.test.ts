import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareShellIntegration, shellName } from '../electron/main/services/shellIntegration'

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cockpit-si-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('shellName', () => {
  it('reduces a shell path to its bare lower-cased name', () => {
    expect(shellName('/bin/zsh')).toBe('zsh')
    expect(shellName('/usr/local/bin/bash')).toBe('bash')
    expect(shellName('/opt/homebrew/bin/fish')).toBe('fish')
    expect(shellName('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell')
  })
})

describe('prepareShellIntegration — zsh', () => {
  it('points ZDOTDIR at a cockpit dir and preserves the user’s as USER_ZDOTDIR', () => {
    const { env, args } = prepareShellIntegration('/bin/zsh', base, { HOME: '/home/tester' })
    expect(args).toBeUndefined()
    expect(env.ZDOTDIR).toBe(join(base, 'zsh'))
    expect(env.USER_ZDOTDIR).toBe('/home/tester')
  })

  it('keeps an already-set ZDOTDIR as the user directory to source', () => {
    const { env } = prepareShellIntegration('/bin/zsh', base, { HOME: '/home/tester', ZDOTDIR: '/custom/zdot' })
    expect(env.USER_ZDOTDIR).toBe('/custom/zdot')
  })

  it('writes startup files that emit the four OSC 133 marks', () => {
    prepareShellIntegration('/bin/zsh', base, { HOME: '/home/tester' })
    const zshrc = readFileSync(join(base, 'zsh', '.zshrc'), 'utf8')
    expect(zshrc).toContain('133;A')
    expect(zshrc).toContain('133;B')
    expect(zshrc).toContain('133;C')
    expect(zshrc).toContain('133;D')
    expect(zshrc).toContain('source "$ZDOTDIR/.zshrc"') // hands back to the real config
    expect(readFileSync(join(base, 'zsh', '.zshenv'), 'utf8')).toContain('USER_ZDOTDIR')
  })
})

describe('prepareShellIntegration — bash', () => {
  it('injects via a --rcfile spawn arg and leaves the environment untouched', () => {
    const baseEnv = { HOME: '/home/tester' }
    const { env, args } = prepareShellIntegration('/usr/bin/bash', base, baseEnv)
    expect(args).toEqual(['--rcfile', join(base, 'bash', 'bashrc')])
    expect(env).toBe(baseEnv) // bash needs no env changes
  })

  it('writes an rcfile that sources ~/.bashrc then emits the OSC 133 marks', () => {
    prepareShellIntegration('/usr/bin/bash', base, { HOME: '/home/tester' })
    const rc = readFileSync(join(base, 'bash', 'bashrc'), 'utf8')
    expect(rc).toContain('. "$HOME/.bashrc"') // real config sourced first
    expect(rc).toContain('trap \'__cockpit_preexec\' DEBUG') // bash 3.2 compatible C mark
    expect(rc).toContain('133;A')
    expect(rc).toContain('133;B')
    expect(rc).toContain('133;C')
    expect(rc).toContain('133;D')
  })
})

describe('prepareShellIntegration — unsupported shells & failure', () => {
  it('is a graceful no-op for fish (plain scrollback, no changes)', () => {
    const baseEnv = { HOME: '/home/tester' }
    const result = prepareShellIntegration('/opt/homebrew/bin/fish', base, baseEnv)
    expect(result).toEqual({ env: baseEnv })
  })

  it('is a graceful no-op for pwsh', () => {
    const baseEnv = { HOME: '/home/tester' }
    expect(prepareShellIntegration('/usr/bin/pwsh', base, baseEnv)).toEqual({ env: baseEnv })
  })

  it('falls back to the untouched env when the integration directory cannot be written', () => {
    // Point baseDir at a regular file so mkdirSync throws ENOTDIR — the shell must
    // still spawn, just without command blocks.
    const filePath = join(base, 'not-a-dir')
    writeFileSync(filePath, 'x', 'utf8')
    const baseEnv = { HOME: '/home/tester' }
    expect(prepareShellIntegration('/bin/zsh', filePath, baseEnv)).toEqual({ env: baseEnv })
  })
})
