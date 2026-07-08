import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import {
  buildTriagePrompt,
  parseTriageResponse,
  type SentinelSignal,
  type SentinelTriage,
} from '@shared/sentinel'
import { resolveBin } from '../resolveBin'

const execFileAsync = promisify(execFile)

/**
 * The cheap seat that judges a signal. DeepSeek's chat model is fast + inexpensive
 * — exactly right for a fire-and-forget enrichment that must never cost the owner
 * real money or block the spine. Passed as `-m <model>` via buildHermesArgs.
 */
export const HERMES_TRIAGE_MODEL = 'deepseek/deepseek-chat'

/** A triage is a one-shot judgement, not a tool-using conversation — 45s is plenty. */
const HERMES_TRIAGE_TIMEOUT_MS = 45 * 1000
/** Triage output is a tiny JSON blob; a modest ceiling caps a runaway response. */
const MAX_OUTPUT_BYTES = 512 * 1024
/** At most this many triages run at once; excess signals skip triage entirely. */
const MAX_IN_FLIGHT = 2

/**
 * Injectable so unit tests never spawn a real `hermes` binary. Mirrors
 * HermesChatService's runner shape (cwd, args, opts) and its execFile hygiene:
 * the prompt is a single discrete argv entry (never a shell string), so the
 * fenced untrusted signal text can't break out into the command line.
 */
export type HermesTriageRunner = (
  cwd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: HermesTriageRunner = (cwd, args, opts) =>
  execFileAsync(resolveBin('hermes'), args, { cwd, ...opts })

/**
 * Faz B triage seat: a cheap Hermes oneshot (DeepSeek) that judges a persisted
 * sentinel signal and returns a {@link SentinelTriage}, or null. It is a pure
 * enrichment collaborator — the SentinelService has already persisted, emitted,
 * and (for alerts) notified before this ever runs.
 *
 * Contract: {@link triage} NEVER throws and NEVER retries. Timeout, spawn failure
 * (no `hermes` binary), and unparseable output all degrade to null; a missed
 * triage costs nothing because the spine already surfaced the signal. It runs
 * with `ignoreRules: true` (no orchestrator persona, no MCP tools) — a mechanical
 * judgement, not a conversation — so it never touches a project's cwd/context.
 */
export class HermesTriageService {
  private inFlight = 0

  constructor(
    private readonly runner: HermesTriageRunner = defaultRunner,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async triage(signal: SentinelSignal): Promise<SentinelTriage | null> {
    // Concurrency guard: the check-then-increment is atomic (no await between
    // them on JS's single thread), so at most MAX_IN_FLIGHT are ever running.
    // An excess signal simply skips triage — the spine already notified.
    if (this.inFlight >= MAX_IN_FLIGHT) return null
    this.inFlight += 1
    try {
      const fenceTag = `====COCKPIT-UNTRUSTED-SIGNAL-${randomUUID()}====`
      const prompt = buildTriagePrompt(signal, fenceTag)
      const args = buildHermesArgs(prompt, { model: HERMES_TRIAGE_MODEL, ignoreRules: true })
      const { stdout } = await this.runner(homedir(), args, {
        timeout: HERMES_TRIAGE_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      return parseTriageResponse(stdout, this.now())
    } catch {
      // Timeout / spawn-fail / anything: a missed triage is fine, so we swallow
      // and return null. We deliberately build NO error string from the argv (the
      // raw-argv leak lesson) — nothing here surfaces the prompt to a user.
      return null
    } finally {
      this.inFlight -= 1
    }
  }
}
