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
import { composeMemoryPointerBlock, rankNotes, MEMORY_POINTER_MAX_NOTES } from '@shared/memory-recall'
import { projectBrain } from '@shared/memory-ledger'
import type { CouncilSessionStore } from '../db/CouncilSessionStore'
import { collectDiffInputs } from './ReviewService'
import type { AuditLogService } from './AuditLogService'
import type { EngineRunner } from './EngineRunner'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryRecallService } from './MemoryRecallService'
import type { ProjectService } from './ProjectService'
import type { SentinelService } from './SentinelService'

/** The narrow sentinel slice this service feeds — structural so tests pass
 *  `undefined` (no-op). Sentinel never depends on CouncilService. */
type SentinelReporter = Pick<SentinelService, 'report'>

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
    /** Optional Faz A collaborator — a spec gate that returns
     *  needs_clarification raises a `notice` signal. Undefined in tests (no-op);
     *  sentinel never depends on this service. */
    private readonly sentinel?: SentinelReporter,
    /** Optional Faz D collaborator — the project memory hub. In `spec` mode the
     *  seats gain an inline, relevance-ranked "Project memory pointers" block so
     *  file-blind OpenRouter seats still see the hub. Undefined → no block; tests
     *  pass nothing and are unaffected. */
    private readonly memory?: Pick<MemoryHubService, 'listHooks'>,
    /** Optional Track G2 collaborator — records which hub notes were selected
     *  into the spec seats' memory-pointer block (recall telemetry). Best-effort;
     *  undefined in tests (no-op). `record` never throws by contract. */
    private readonly recalls?: Pick<MemoryRecallService, 'record'>,
  ) {
    this.sweepStalePending()
  }

  /**
   * A6: at construction, mark any council session still `pending` as `failed`.
   * Such a row can only be residue of a previous process that crashed mid-run —
   * this process has reserved none yet — so a stuck `pending` marker becomes an
   * honest `failed` trace. Best-effort: a sweep failure (or a store fake without
   * the method, in tests) must never block the DI root's construction.
   */
  private sweepStalePending(): void {
    try {
      const swept = this.sessions.sweepStalePending()
      if (swept > 0) {
        this.audit.record({
          projectId: null,
          actor: 'system',
          actionType: 'council.pending_swept',
          summary: `Marked ${swept} interrupted council run(s) as failed`,
          payload: { swept },
        })
      }
    } catch {
      // A lingering `pending` marker is cosmetic, never a boot blocker.
    }
  }

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

    // A6: the early-exit guards have passed, so the run is committed — reserve a
    // durable `pending` row up front. A crash between here and the final
    // finalize() leaves this marker, which the next boot sweeps to `failed`.
    // Best-effort: if reserving fails, `pendingId` stays null and persistAndRecord
    // falls back to a single insert of the completed result.
    const pendingId = this.reservePending(projectId, cardId, mode, question)

    const callOpts = { cwd: project.path, timeout: CALL_TIMEOUT_MS, maxBuffer: CALL_MAX_BUFFER }
    const fenceTag = `====COCKPIT-UNTRUSTED-${mode.toUpperCase()}-${randomUUID()}====`
    const claudeOverride = opts.model ? resolveChatModel(opts.model).id : null

    // Spec mode only: an inline, relevance-ranked memory-pointer block for the
    // seats (file-blind OpenRouter seats have no other view of the hub). Ranked
    // against the spec + the author's summary; any failure degrades to no block.
    const memoryBlock = mode === 'spec' ? this.memoryPointerBlock(projectId, question, specText) : null

    const seatPrompt = (seat: CouncilSeat): string =>
      buildSeatPrompt(seat, { mode, fenceTag, projectName: project.name, question, sanitized, specText, memoryBlock })

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
      return this.persistAndRecord(projectId, pendingId, cardId, mode, question, result)
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
    return this.persistAndRecord(projectId, pendingId, cardId, mode, question, result)
  }

  /** A6: reserve a durable `pending` marker; null if the store rejected it (the
   *  completed result is then persisted by persistAndRecord's fallback insert). */
  private reservePending(
    projectId: string,
    cardId: string | null,
    mode: CouncilMode,
    question: string | null,
  ): string | null {
    try {
      return this.sessions.insertPending({ projectId, cardId, mode, question })
    } catch {
      return null
    }
  }

  /**
   * Recent sessions merged into a per-seat scorecard (no IPC exposure yet — Faz
   * 2). The service only feeds rows; the merge math is the pure `computeScorecard`.
   */
  scorecard(projectId: string, limit = 30): ScorecardEntry[] {
    const rows = this.sessions.listRecent(projectId, limit).map((s) => ({ aggregate: s.result.aggregate }))
    return computeScorecard(rows)
  }

  /**
   * The inline "Project memory pointers" block for the spec seats, or null. Ranks
   * the hub notes against the spec (plus the author's already-redacted summary)
   * and renders the top few as `name — hook`, TOTAL-capped. A missing collaborator,
   * an empty hub, or any read error yields null — the council runs unchanged.
   */
  private memoryPointerBlock(
    projectId: string,
    question: string | null,
    specText: string | undefined,
  ): string | null {
    if (!this.memory) return null
    try {
      const notes = this.memory.listHooks(projectId) // newest-first
      const query = `${question ?? ''}\n${specText ?? ''}`
      // Track G2: the top-N ranked notes ARE the recall event — record them, then
      // compose the block from the same deterministic ranking. Best-effort and
      // structurally no-throw; recall telemetry never breaks a council run.
      const selected = rankNotes(query, notes, MEMORY_POINTER_MAX_NOTES).map((n) => n.name)
      void this.recalls?.record(projectBrain(projectId), selected, 'council_spec')
      return composeMemoryPointerBlock(query, notes)
    } catch {
      return null
    }
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

  /** Persist a completed run (even ok:false), then audit-log stats only. A6: this
   *  finalizes the `pending` row reserved at run start; only when that reservation
   *  failed (pendingId null) does it fall back to a single insert. */
  private persistAndRecord(
    projectId: string,
    pendingId: string | null,
    cardId: string | null,
    mode: CouncilMode,
    question: string | null,
    result: CouncilResult,
  ): CouncilResult {
    let sessionId: string | null = pendingId
    try {
      if (pendingId) {
        this.sessions.finalize(pendingId, result)
      } else {
        sessionId = this.sessions.insert({ projectId, cardId, mode, question, result })
      }
    } catch {
      // Persistence must not sink a verdict the user is waiting on. If finalize
      // threw, the row stays `pending` and the next boot sweeps it to `failed`;
      // sessionId still points at it. If the fallback insert threw, sessionId is
      // null. Either way the audit line records the run.
    }
    const withId: CouncilResult = { ...result, sessionId }
    this.record(projectId, withId)
    // Faz A: a spec gate that comes back needs_clarification is a `notice` — the
    // draft can't proceed to a builder until the author answers. Fire-and-forget;
    // report() never throws. `question` is the already-redacted card title/body.
    if (mode === 'spec' && withId.specVerdict?.kind === 'needs_clarification') {
      const subject = question ?? (cardId ? `card ${cardId}` : 'the draft spec')
      const questions = withId.specVerdict.questions
      this.sentinel?.report({
        projectId,
        severity: 'notice',
        source: 'council',
        title: `Council needs clarification on '${subject}'`,
        summary:
          questions.length > 0
            ? `${questions.length} open question(s) before a builder can start.`
            : 'The spec gate needs more detail before a builder can start.',
        context: questions.join('\n'),
      })
    }
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
