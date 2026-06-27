import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Runs a constrained allowlist of safe, read-only local commands. This is the
 * "local command layer" the router can use without an approval gate. Anything
 * not on the allowlist is rejected — arbitrary command execution never flows
 * through here.
 */
const ALLOWED: Record<string, { bin: string; args: string[] }> = {
  'git status': { bin: 'git', args: ['status', '-sb'] },
  'git diff': { bin: 'git', args: ['diff', '--stat'] },
  'git branch': { bin: 'git', args: ['branch', '--show-current'] },
  'git log': { bin: 'git', args: ['log', '--oneline', '-10'] },
  node: { bin: 'node', args: ['--version'] },
  npm: { bin: 'npm', args: ['--version'] },
}

export interface CommandResult {
  command: string
  ok: boolean
  stdout: string
  stderr: string
}

export class LocalCommandRunner {
  /** Whether a command key is in the safe allowlist. */
  isAllowed(key: string): boolean {
    return key in ALLOWED
  }

  async run(key: string, cwd: string): Promise<CommandResult> {
    const spec = ALLOWED[key]
    if (!spec) {
      return { command: key, ok: false, stdout: '', stderr: `Command not allowed: ${key}` }
    }
    try {
      const { stdout, stderr } = await execFileAsync(spec.bin, spec.args, {
        cwd,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      })
      return { command: key, ok: true, stdout, stderr }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      return {
        command: key,
        ok: false,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? 'command failed',
      }
    }
  }
}
