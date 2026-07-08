import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { sanitizeDiff, type SanitizedDiff } from '@shared/diff-sanitize'
import { resolveChatModel } from '@shared/chat-models'
import { redactText } from '@shared/redaction'
import type { EngineSpec } from '@shared/engines'
import {
  CHAIRMAN,
  COUNCIL_SEATS,
  anonymizeSeats,
  computeAggregateRankings,
  computeScorecard,
  parseRankingFromText,
  parseSpecVerdict,
  type AggregateRank,
  type CouncilMode,
  type CouncilRanking,
  type CouncilResult,
  type CouncilSeat,
  type CouncilSeatOutput,
  type CouncilTone,
  type ScorecardEntry,
} from '@shared/council'
import { buildChairmanPrompt, buildRankingPrompt, buildSeatPrompt, buildSpecChairmanPrompt } from '@shared/council-prompts'
import type { CouncilSessionStore } from '../db/CouncilSessionStore'
import { collectDiffInputs } from './ReviewService'
import type { AuditLogService } from './AuditLogService'
import type { EngineRunner } from './EngineRunner'
import type { ProjectService } from './ProjectService'

/** One seat/ranking/chairman call: grounded in the repo, hang-guarded. */
const CALL_TIMEOUT_MS = 360_000
const CALL_MAX_BUFFER = 8 * 1024 * 1024

/** A Fisher–Yates permutation of [0..n) — used to anonymize seat order. */
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

export interface CouncilRunOpts {
  mode?: CouncilMode
  dir?: string
  question?: string
  specText?: string
  cardId?: string
  /** Back-compat claude alias — overrides the model of claude-engine seats only. */
  model?: string
}

/**
 * The LLM-Council v2 (Karpathy's method), multi-engine. Two modes: `diff` judges
 * a card's change set (read-only — the same sanitized diff the reviewer uses),
 * `spec` gates a draft task spec before it reaches an autonomous builder. Five
 * seats run in parallel across three vendors, every OK seat ranks the anonymized
 * responses, then a chairman synthesizes one verdict. Every stage degrades
 * gracefully — a failed seat becomes a note and can fall back to a second engine,
 * not a dead session — and every completed run is persisted for the scorecard.
 */
export class CouncilService {
  constructor(
    private readonly projects: ProjectService,
    private readonly audit: AuditLogService,
    private readonly engine: EngineRunner,
    private readonly sessions: CouncilSessionStore,
  ) {}

  async run(projectId: string, opts: CouncilRunOpts = {}): Promise<CouncilResult> {
    const started = Date.now()
    const mode: CouncilMode = opts.mode ?? 'diff'
    const project = this.projects.get(projectId)
    // The question is card title+body — user-authored, so it gets the same
    // redaction as the spec/diff before it can reach a third-party engine
    // (OpenRouter seats) or the persisted council_sessions row (argos M1).
    const rawQuestion = opts.question?.trim() || null
    const question = rawQuestion ? redactText(rawQuestion) : null
    const cardId = opts.cardId ?? null

    // Diff seats/chairman need the change set; spec seats need the fenced spec.
    // Each branch narrows to its own material so nothing downstream juggles a
    // union — a clean-tree diff or a missing spec is an early, un-persisted exit.
    let sanitized: SanitizedDiff | undefined
    let specText: string | undefined
    let filesReviewed = 0
    if (mode === 'diff') {
      const prep = await this.prepareDiff(project, opts)
      if ('earlyError' in prep) return this.earlyError('diff', prep.earlyError, started)
      sanitized = prep.sanitized
      filesReviewed = prep.filesReviewed
    } else {
      const prep = this.prepareSpec(opts)
      if ('earlyError' in prep) return this.earlyError('spec', prep.earlyError, started)
      specText = prep.specText
    }

    const callOpts = { cwd: project.path, timeout: CALL_TIMEOUT_MS, maxBuffer: CALL_MAX_BUFFER }
    const fenceTag = `====COCKPIT-UNTRUSTED-${mode.toUpperCase()}-${randomUUID()}====`
    const claudeOverride = opts.model ? resolveChatModel(opts.model).id : null

    const seatPrompt = (seat: CouncilSeat): string =>
      buildSeatPrompt(seat, { mode, fenceTag, projectName: project.name, question, sanitized, specText })

    // Phase 1 — every seat, in parallel, blind to the others (with fallback).
    const seats: CouncilSeatOutput[] = await Promise.all(
      COUNCIL_SEATS.map((seat) => this.runSeat(seat, seatPrompt(seat), claudeOverride, callOpts)),
    )

    const okSeats = seats.filter((s) => s.ok)
    if (okSeats.length === 0) {
      const result = this.buildResult({
        ok: false,
        mode,
        seats,
        rankings: [],
        aggregate: [],
        labelToSeat: {},
        verdict: null,
        specVerdict: null,
        error: 'Every council seat failed to respond.',
        filesReviewed,
        started,
      })
      return this.persistAndRecord(projectId, cardId, mode, question, result)
    }

    // Phase 2 — anonymized peer rankings (needs ≥2 responses to compare).
    const { rankings, aggregate, labelToSeat } = await this.runRankings(seats, okSeats, mode, callOpts)

    // Phase 3 — chairman synthesis (with fallback retry).
    const chairmanPrompt =
      mode === 'diff'
        ? buildChairmanPrompt({ question, seats, rankings })
        : buildSpecChairmanPrompt({ question, seats, rankings, fenceTag, specText: specText ?? '' })
    const verdict = await this.runChairman(chairmanPrompt, callOpts)

    const specVerdict = mode === 'spec' && verdict ? normalizeSpecVerdict(verdict) : null

    const result = this.buildResult({
      ok: true,
      mode,
      seats,
      rankings,
      aggregate,
      labelToSeat,
      verdict,
      specVerdict,
      error: null,
      filesReviewed,
      started,
    })
    return this.persistAndRecord(projectId, cardId, mode, question, result)
  }

  /**
   * Recent sessions merged into a per-seat scorecard (no IPC exposure yet — Faz
   * 2). The service only feeds rows; the merge math is the pure `computeScorecard`.
   */
  scorecard(projectId: string, limit = 30): ScorecardEntry[] {
    const rows = this.sessions.listRecent(projectId, limit).map((s) => ({ aggregate: s.result.aggregate }))
    return computeScorecard(rows)
  }

  private async prepareDiff(
    project: { name: string; path: string },
    opts: CouncilRunOpts,
  ): Promise<{ sanitized: SanitizedDiff; filesReviewed: number } | { earlyError: string }> {
    // The renderer is untrusted: a worktree dir is only used inside the project.
    let base = project.path
    if (opts.dir) {
      const target = resolve(opts.dir)
      if (!target.startsWith(resolve(project.path) + sep)) {
        throw new Error('Council dir must be inside the project.')
      }
      base = target
    }
    const sanitized = sanitizeDiff(await collectDiffInputs(base))
    if (sanitized.files.length === 0 && sanitized.summarizedFiles.length === 0) {
      return { earlyError: 'No change set to convene the council over — the worktree is clean.' }
    }
    return { sanitized, filesReviewed: sanitized.files.length }
  }

  private prepareSpec(opts: CouncilRunOpts): { specText: string } | { earlyError: string } {
    const raw = opts.specText?.trim()
    if (!raw) return { earlyError: 'Spec-mode council needs a draft spec to judge.' }
    // The spec is chat/user-authored: redact secret-shaped content before it is
    // fenced and sent to any engine (same helper the reviewer text path relies on).
    return { specText: redactText(raw) }
  }

  /** Run one seat: primary engine, then its fallback once, then a failure note. */
  private async runSeat(
    seat: CouncilSeat,
    prompt: string,
    claudeOverride: string | null,
    callOpts: { cwd: string; timeout: number; maxBuffer: number },
  ): Promise<CouncilSeatOutput> {
    const primary = this.withOverride(seat.engine, claudeOverride)
    try {
      const text = await this.engine.call(primary, prompt, callOpts)
      return { id: seat.id, label: seat.label, engine: primary, usedFallback: false, text, ok: text.length > 0 }
    } catch (primaryErr) {
      if (seat.fallback) {
        try {
          const text = await this.engine.call(seat.fallback, prompt, callOpts)
          return { id: seat.id, label: seat.label, engine: seat.fallback, usedFallback: true, text, ok: text.length > 0 }
        } catch {
          // Both engines failed — surface the primary's reason as the note.
        }
      }
      return {
        id: seat.id,
        label: seat.label,
        engine: primary,
        usedFallback: false,
        text: `This seat could not be reached (${errText(primaryErr)}).`,
        ok: false,
      }
    }
  }

  /** The claude alias override only re-points claude seats; other engines keep
   *  their spec so the vendor mix (the whole point of the roster) survives. */
  private withOverride(spec: EngineSpec, claudeOverride: string | null): EngineSpec {
    if (claudeOverride && spec.engine === 'claude') return { engine: 'claude', model: claudeOverride }
    return spec
  }

  private async runRankings(
    seats: readonly CouncilSeatOutput[],
    okSeats: readonly CouncilSeatOutput[],
    mode: CouncilMode,
    callOpts: { cwd: string; timeout: number; maxBuffer: number },
  ): Promise<{ rankings: CouncilRanking[]; aggregate: AggregateRank[]; labelToSeat: Record<string, CouncilTone> }> {
    if (okSeats.length < 2) return { rankings: [], aggregate: [], labelToSeat: {} }

    const { anonymized, labelToSeat } = anonymizeSeats(seats, shuffledOrder(okSeats.length))
    const rankingPrompt = buildRankingPrompt(anonymized, mode)
    const settled = await Promise.all(
      okSeats.map(async (s): Promise<CouncilRanking | null> => {
        try {
          // A seat ranks through the engine it actually succeeded on.
          const text = await this.engine.call(s.engine, rankingPrompt, callOpts)
          if (text.length === 0) return null
          return { seatId: s.id, text, parsed: parseRankingFromText(text) }
        } catch {
          return null // A missing ranking never blocks the aggregate or verdict.
        }
      }),
    )
    const rankings = settled.filter((r): r is CouncilRanking => r !== null)
    return { rankings, aggregate: computeAggregateRankings(rankings, labelToSeat), labelToSeat }
  }

  private async runChairman(
    prompt: string,
    callOpts: { cwd: string; timeout: number; maxBuffer: number },
  ): Promise<string | null> {
    try {
      const text = await this.engine.call(CHAIRMAN.engine, prompt, callOpts)
      return text.length > 0 ? text : null
    } catch {
      try {
        const text = await this.engine.call(CHAIRMAN.fallback, prompt, callOpts)
        return text.length > 0 ? text : null
      } catch {
        return null // No verdict is a degraded session, not a crash.
      }
    }
  }

  private buildResult(input: {
    ok: boolean
    mode: CouncilMode
    seats: CouncilSeatOutput[]
    rankings: CouncilRanking[]
    aggregate: AggregateRank[]
    labelToSeat: Record<string, CouncilTone>
    verdict: string | null
    specVerdict: CouncilResult['specVerdict']
    error: string | null
    filesReviewed: number
    started: number
  }): CouncilResult {
    const seatsRun = input.seats.filter((s) => s.ok).length
    return {
      ok: input.ok,
      mode: input.mode,
      seats: input.seats,
      rankings: input.rankings,
      aggregate: input.aggregate,
      labelToSeat: input.labelToSeat,
      verdict: input.verdict,
      specVerdict: input.specVerdict,
      error: input.error,
      stats: {
        seatsRun,
        seatsFailed: input.seats.length - seatsRun,
        filesReviewed: input.filesReviewed,
        durationMs: Date.now() - input.started,
      },
      sessionId: null,
    }
  }

  private earlyError(mode: CouncilMode, message: string, started: number): CouncilResult {
    // An early exit (clean worktree / missing spec) is not a convened run, so it
    // is not persisted — but it is still audit-logged as a no-op outcome.
    const result: CouncilResult = {
      ok: false,
      mode,
      seats: [],
      rankings: [],
      aggregate: [],
      labelToSeat: {},
      verdict: null,
      specVerdict: null,
      error: message,
      stats: { seatsRun: 0, seatsFailed: 0, filesReviewed: 0, durationMs: Date.now() - started },
      sessionId: null,
    }
    return result
  }

  /** Persist a completed run (even ok:false), then audit-log stats only. */
  private persistAndRecord(
    projectId: string,
    cardId: string | null,
    mode: CouncilMode,
    question: string | null,
    result: CouncilResult,
  ): CouncilResult {
    let sessionId: string | null = null
    try {
      sessionId = this.sessions.insert({ projectId, cardId, mode, question, result })
    } catch {
      // Persistence must not sink a verdict the user is waiting on; the result
      // returns with sessionId null and the audit line records the run anyway.
    }
    const withId: CouncilResult = { ...result, sessionId }
    this.record(projectId, withId)
    return withId
  }

  private record(projectId: string, result: CouncilResult): void {
    this.audit.record({
      projectId,
      actor: 'ai',
      actionType: 'council.run',
      summary: result.ok
        ? `Council (${result.mode}): ${result.stats.seatsRun}/${COUNCIL_SEATS.length} seats, ${result.stats.filesReviewed} file(s)`
        : `Council failed: ${result.error}`,
      // Stats only — seat prose and diff/spec content never reach the audit log.
      payload: {
        ...result.stats,
        mode: result.mode,
        ok: result.ok,
        verdictKind: result.specVerdict?.kind ?? null,
      },
    })
  }
}

/** Coerce a parsed spec verdict into the result's non-null shape (null kind →
 *  no gate, the session still renders its seats). */
function normalizeSpecVerdict(verdict: string): CouncilResult['specVerdict'] {
  const parsed = parseSpecVerdict(verdict)
  return parsed.kind ? { kind: parsed.kind, questions: parsed.questions } : null
}
