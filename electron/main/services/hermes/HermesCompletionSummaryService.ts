import { execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import { HERMES_MAIN_MODEL } from '@shared/hermes-model-policy'
import { assertHermesRuntimeEnabled } from '@shared/hermes-runtime'
import {
  buildCompletionManagerPrompt,
  parseCompletionManagerResponse,
  type CompletionEvidence,
} from '@shared/swarm-completion'
import type { SentinelTriage } from '@shared/sentinel'
import { resolveBin } from '../resolveBin'

const execFileAsync = promisify(execFile)

/** Completion interpretation is managerial judgment, so it belongs on Pro. */
export const HERMES_COMPLETION_MODEL = HERMES_MAIN_MODEL

const TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = 512 * 1024

export type HermesCompletionRunner = (
  cwd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: HermesCompletionRunner = (cwd, args, opts) => {
  assertHermesRuntimeEnabled()
  return execFileAsync(resolveBin('hermes'), args, { cwd, ...opts })
}

/**
 * Tool-less Pro seat for one already-persisted completion. It never searches,
 * runs checks, or reads the repository: deterministic evidence is assembled
 * first, then this seat only explains it. Every failure degrades to null so the
 * steward can publish its deterministic fallback.
 */
export class HermesCompletionSummaryService {
  /** Paid Pro work is queued, never fanned out and never silently skipped. */
  private queue: Promise<void> = Promise.resolve()
  private stopped = false
  private readonly children = new Set<ChildProcess>()

  constructor(
    private readonly runner: HermesCompletionRunner = defaultRunner,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly fenceId: () => string = randomUUID,
  ) {}

  summarize(evidence: CompletionEvidence): Promise<SentinelTriage | null> {
    const result = this.queue.then(() =>
      this.stopped ? null : this.runOnce(evidence),
    )
    // Keep the queue alive even if a future refactor lets runOnce reject.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async runOnce(evidence: CompletionEvidence): Promise<SentinelTriage | null> {
    try {
      const fence = `====COCKPIT-COMPLETION-${this.fenceId()}====`
      const prompt = buildCompletionManagerPrompt(evidence, fence)
      const args = buildHermesArgs(prompt, {
        model: HERMES_COMPLETION_MODEL,
        ignoreRules: true,
      })
      const running = this.runner(homedir(), args, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      this.track(running)
      const { stdout } = await running
      return parseCompletionManagerResponse(stdout, this.now())
    } catch {
      return null
    }
  }

  private track(running: Promise<{ stdout: string }>): void {
    const child = (running as { child?: ChildProcess }).child
    if (!child) return
    this.children.add(child)
    child.once('close', () => this.children.delete(child))
  }

  /** App-quit cleanup for the fire-and-forget Pro child. */
  killAll(): void {
    this.stopped = true
    for (const child of this.children) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Already exited.
      }
    }
    this.children.clear()
  }
}
