import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { sanitizeDiff } from '@shared/diff-sanitize'
import { resolveChatModel } from '@shared/chat-models'
import { buildClaudeArgs } from '@shared/claude-run'
import {
  COUNCIL_ADVISORS,
  anonymize,
  buildAdvisorPrompt,
  buildChairmanPrompt,
  buildPeerPrompt,
  type CouncilAdvisorOutput,
  type CouncilResult,
} from '@shared/council'
import { collectDiffInputs } from './ReviewService'
import type { AuditLogService } from './AuditLogService'
import type { ProjectService } from './ProjectService'
import { resolveBin } from './resolveBin'

const execFileAsync = promisify(execFile)

/** Injectable so tests never spawn a real CLI (mirrors ReviewService). */
export type ClaudeRunner = (
  bin: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: ClaudeRunner = (bin, args, opts) =>
  execFileAsync(bin, args, { ...opts, env: { ...process.env } })

/** A single advisor/peer/chairman call: grounded in the repo, hang-guarded. */
const CALL_TIMEOUT_MS = 360_000
const CALL_MAX_BUFFER = 8 * 1024 * 1024

/** A Fisher–Yates permutation of [0..n) — used to anonymize advisor order. */
function shuffledOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function errText(err: unknown): string {
  const e = err as { stderr?: string; message?: string; killed?: boolean; signal?: string }
  if (e.killed === true || e.signal === 'SIGTERM') return 'timed out'
  return e.stderr?.trim() || e.message || 'call failed'
}

/**
 * The LLM-Council (Karpathy's method) over a card's change set. Read-only:
 * collects the same sanitized diff the reviewer uses, runs five advisors in
 * parallel through the local `claude` CLI, has an anonymous peer reviewer
 * critique them, then a chairman synthesize one verdict. Every stage degrades
 * gracefully — a failed advisor becomes an error note, not a dead session —
 * and each run is audit-logged with stats only, never content.
 */
export class CouncilService {
  constructor(
    private readonly projects: ProjectService,
    private readonly audit: AuditLogService,
    private readonly runner: ClaudeRunner = defaultRunner,
  ) {}

  async run(
    projectId: string,
    opts: { model?: string; dir?: string; question?: string } = {},
  ): Promise<CouncilResult> {
    const started = Date.now()
    const project = this.projects.get(projectId)

    // The renderer is untrusted: a worktree dir is only used inside the project.
    let base = project.path
    if (opts.dir) {
      const target = resolve(opts.dir)
      if (!target.startsWith(resolve(project.path) + sep)) {
        throw new Error('Council dir must be inside the project.')
      }
      base = target
    }

    const model = resolveChatModel(opts.model)
    const sanitized = sanitizeDiff(await collectDiffInputs(base))
    const question = opts.question?.trim() || null

    if (sanitized.files.length === 0 && sanitized.summarizedFiles.length === 0) {
      const result: CouncilResult = {
        ok: false,
        advisors: [],
        peerReview: null,
        verdict: null,
        model: model.label,
        error: 'No change set to convene the council over — the worktree is clean.',
        stats: { advisorsRun: 0, advisorsFailed: 0, filesReviewed: 0, durationMs: Date.now() - started },
      }
      this.record(projectId, result)
      return result
    }

    const fenceTag = `====COCKPIT-UNTRUSTED-DIFF-${randomUUID()}====`
    const call = (prompt: string): Promise<string> =>
      this.runner(resolveBin('claude'), buildClaudeArgs(prompt, { model: model.id }), {
        cwd: project.path,
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: CALL_MAX_BUFFER,
      }).then((r) => r.stdout.trim())

    // Phase 1 — five advisors, in parallel, each blind to the others.
    const advisors: CouncilAdvisorOutput[] = await Promise.all(
      COUNCIL_ADVISORS.map(async (advisor) => {
        try {
          const text = await call(
            buildAdvisorPrompt(advisor, { sanitized, fenceTag, question, projectName: project.name }),
          )
          return { id: advisor.id, label: advisor.label, text, ok: text.length > 0 }
        } catch (err) {
          return {
            id: advisor.id,
            label: advisor.label,
            text: `This advisor could not be reached (${errText(err)}).`,
            ok: false,
          }
        }
      }),
    )

    const okAdvisors = advisors.filter((a) => a.ok)
    if (okAdvisors.length === 0) {
      const result: CouncilResult = {
        ok: false,
        advisors,
        peerReview: null,
        verdict: null,
        model: model.label,
        error: 'All five advisors failed to respond.',
        stats: {
          advisorsRun: 0,
          advisorsFailed: advisors.length,
          filesReviewed: sanitized.files.length,
          durationMs: Date.now() - started,
        },
      }
      this.record(projectId, result)
      return result
    }

    // Phase 2 — anonymous peer review (needs ≥2 responses to compare).
    let peerReview: string | null = null
    if (okAdvisors.length >= 2) {
      try {
        peerReview = await call(buildPeerPrompt(anonymize(advisors, shuffledOrder(okAdvisors.length))))
      } catch {
        peerReview = null // A missing peer review never blocks the verdict.
      }
    }

    // Phase 3 — chairman synthesis into one verdict.
    let verdict: string | null = null
    try {
      verdict = await call(buildChairmanPrompt({ question, advisors, peerReview }))
    } catch {
      verdict = null
    }

    const result: CouncilResult = {
      ok: true,
      advisors,
      peerReview,
      verdict,
      model: model.label,
      error: null,
      stats: {
        advisorsRun: okAdvisors.length,
        advisorsFailed: advisors.length - okAdvisors.length,
        filesReviewed: sanitized.files.length,
        durationMs: Date.now() - started,
      },
    }
    this.record(projectId, result)
    return result
  }

  private record(projectId: string, result: CouncilResult): void {
    this.audit.record({
      projectId,
      actor: 'ai',
      actionType: 'council.run',
      summary: result.ok
        ? `Council: ${result.stats.advisorsRun}/${COUNCIL_ADVISORS.length} advisors, ${result.stats.filesReviewed} file(s)`
        : `Council failed: ${result.error}`,
      // Stats only — advisor prose and diff content never reach the audit log.
      payload: { ...result.stats, model: result.model, ok: result.ok },
    })
  }
}
