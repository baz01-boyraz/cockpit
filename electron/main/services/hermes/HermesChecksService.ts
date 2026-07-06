import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import type { RunCheck } from '@shared/schemas'
import type { ProjectService } from '../ProjectService'
import { resolveBin } from '../resolveBin'

/**
 * ALLOWLIST-ONLY check runner for the Hermes `run_checks` tool.
 *
 * The single security invariant here: Hermes must never get arbitrary command
 * execution through this surface. `check` is a closed enum (validated at the
 * tool boundary before this method is ever reached) and each member maps to ONE
 * fixed, hardcoded npm command below. There is deliberately no way to pass extra
 * flags, args, or a free-form command — the map IS the allowlist.
 */
const CHECK_ARGS: Readonly<Record<RunCheck, readonly string[]>> = {
  test: ['test'],
  typecheck: ['run', 'typecheck'],
  lint: ['run', 'lint'],
}

/** Cap captured output so a runaway suite can't blow up the MCP response. */
const OUTPUT_CAP = 50_000
/** Test suites can hang — kill after this and report a timeout, never block. */
const CHECK_TIMEOUT_MS = 5 * 60_000
/** Generous stdout buffer; we truncate to OUTPUT_CAP ourselves afterwards. */
const MAX_BUFFER = 16 * 1024 * 1024

export interface CheckResult {
  check: RunCheck
  /** The exact command that ran — echoed back so Hermes can quote it. */
  command: string
  /** Process exit code, or null when it timed out / failed to spawn. */
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  /** True when stdout or stderr was clipped to the output cap. */
  truncated: boolean
}

interface RawRun {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

/** Injectable so tests never spawn a real npm process. */
export type CheckRunner = (
  bin: string,
  args: readonly string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<RawRun>

const defaultRunner: CheckRunner = (bin, args, opts) =>
  new Promise<RawRun>((resolveRun) => {
    execFile(
      bin,
      [...args],
      { cwd: opts.cwd, timeout: opts.timeout, maxBuffer: opts.maxBuffer, env: { ...process.env } },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null
        const timedOut = Boolean(e?.killed) || e?.signal === 'SIGTERM'
        // A failing check exits non-zero — that is the normal, expected path, so
        // we resolve with the exit code instead of rejecting. A string `code`
        // (e.g. ENOENT) means the process never really ran → null.
        const code = typeof e?.code === 'number' ? e.code : e ? null : 0
        resolveRun({ stdout: stdout ?? '', stderr: stderr ?? '', code, timedOut })
      },
    )
  })

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= OUTPUT_CAP) return { text, truncated: false }
  return { text: `${text.slice(0, OUTPUT_CAP)}\n… [truncated ${text.length - OUTPUT_CAP} chars]`, truncated: true }
}

export class HermesChecksService {
  constructor(
    private readonly projects: Pick<ProjectService, 'get'>,
    private readonly runner: CheckRunner = defaultRunner,
  ) {}

  /**
   * Run one allowlisted check in the project root. `check` is trusted here only
   * because the tool re-parses it with the enum schema first; `CHECK_ARGS` is a
   * closed record keyed by that same enum, so no other command is reachable.
   */
  async run(projectId: string, check: RunCheck): Promise<CheckResult> {
    const args = CHECK_ARGS[check]
    const project = this.projects.get(projectId)
    // cwd is the project ROOT itself — no sub-path is ever accepted here, so
    // there is nothing that could resolve outside it. resolve() is defensive.
    const cwd = resolve(project.path)
    const run = await this.runner(resolveBin('npm'), args, {
      cwd,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    const out = cap(run.stdout)
    const errOut = cap(run.stderr)
    const stderr = run.timedOut
      ? `${errOut.text}\n[check timed out after ${CHECK_TIMEOUT_MS / 60_000} minutes and was killed]`
      : errOut.text
    return {
      check,
      command: `npm ${args.join(' ')}`,
      exitCode: run.timedOut ? null : run.code,
      timedOut: run.timedOut,
      stdout: out.text,
      stderr,
      truncated: out.truncated || errOut.truncated,
    }
  }
}
