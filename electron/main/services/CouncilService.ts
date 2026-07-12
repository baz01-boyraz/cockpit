import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { sanitizeDiff, type SanitizedDiff } from '@shared/diff-sanitize'
import { resolveChatModel } from '@shared/chat-models'
import { redactText } from '@shared/redaction'
import type { EngineId, EngineSpec } from '@shared/engines'
import {
  CHAIRMAN,
  COUNCIL_SEATS,
  COUNCIL_RESULT_SCHEMA_VERSION,
  COUNCIL_V3_LIMITS,
  anonymizeSeats,
  computeAggregateRankings,
  computeScorecard,
  councilSpecVerdictKind,
  extractRefinedSpec,
  normalizeCouncilResult,
  parseSpecVerdict,
  type AggregateRank,
  type CouncilClarification,
  type CouncilDecisionKind,
  type CouncilIntentMode,
  type CouncilMode,
  type CouncilProgressEvent,
  type CouncilRanking,
  type CouncilResult,
  type CouncilResultArtifact,
  type CouncilResultV3,
  type CouncilSeat,
  type CouncilSeatOutput,
  type CouncilSessionSummary,
  type CouncilTone,
  type NormalizedCouncilResult,
  type ScorecardEntry,
} from '@shared/council'
import {
  buildAnalysisChairmanPrompt,
  buildAnalysisSeatPrompt,
  buildChairmanPrompt,
  buildRankingPrompt,
  buildSeatPrompt,
  buildSpecChairmanPrompt,
  renderAnalysisMemoryHooks,
} from '@shared/council-prompts'
import {
  parseCouncilAnalysisClaims,
  renderCouncilAnalysisReport,
  renderCouncilEvidencePack,
  type CouncilAnalysisEgressPolicy,
  type CouncilAnalysisEgressReceipt,
  type CouncilClaim,
  type CouncilEvidencePack,
} from '@shared/council-evidence'
import {
  COUNCIL_STAGE_BUDGETS,
  detectCouncilResponseLanguage,
  normalizeCouncilChairmanText,
  normalizeCouncilRankingText,
  normalizeCouncilSeatText,
} from '@shared/council-stages'
import { composeMemoryPointerBlock, rankNotes, MEMORY_POINTER_MAX_NOTES } from '@shared/memory-recall'
import { projectBrain } from '@shared/memory-ledger'
import type { MemoryContextEnvelope, MemoryContextProvider } from '@shared/memory-context'
import type { CouncilSessionStore } from '../db/CouncilSessionStore'
import { collectDiffInputs } from './ReviewService'
import type { AuditLogService } from './AuditLogService'
import type { EngineCallOpts, EngineRunner } from './EngineRunner'
import type { CouncilEvidenceCollector } from './CouncilEvidenceService'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryRecallService } from './MemoryRecallService'
import type { ProjectService } from './ProjectService'
import type { SentinelService } from './SentinelService'
import type { CockpitEvents } from '../events'

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

const COUNCIL_TRUNCATION = '…[truncated]'

function boundedCouncilText(value: string, cap: number): string {
  const clean = value.trim()
  if (clean.length <= cap) return clean
  return `${clean.slice(0, Math.max(0, cap - COUNCIL_TRUNCATION.length)).trimEnd()}${COUNCIL_TRUNCATION}`
}

function uniqueCouncilText(values: readonly (string | null | undefined)[], count: number): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    if (!value?.trim()) continue
    const clean = boundedCouncilText(value, COUNCIL_V3_LIMITS.findingChars)
    const key = clean.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(clean)
    if (output.length >= count) break
  }
  return output
}

function markdownSection(text: string | null, heading: RegExp): string | null {
  if (!text) return null
  const lines = text.split('\n')
  const start = lines.findIndex(
    (line) => /^#{1,6}\s+/.test(line.trim()) && heading.test(line),
  )
  if (start < 0) return null
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) break
    body.push(line)
  }
  return body.join('\n').trim() || null
}

function decisionSummary(
  verdict: string | null,
  error: string | null,
  kind: CouncilDecisionKind,
): string {
  if (error?.trim()) return boundedCouncilText(error, COUNCIL_V3_LIMITS.summaryChars)
  const verdictSection = markdownSection(verdict, /verdict/i)
  const summary = (verdictSection ?? verdict ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(APPROVED|NEEDS[_\s-]?CLARIFICATION)$/i.test(line))
    .join(' ')
  return boundedCouncilText(
    summary || `Council decision: ${kind.replace(/_/g, ' ')}.`,
    COUNCIL_V3_LIMITS.summaryChars,
  )
}

function decisionQuestions(
  verdict: CouncilResult['specVerdict'],
): CouncilClarification[] {
  const source = verdict?.clarifications?.length
    ? verdict.clarifications
    : (verdict?.questions ?? []).map((question, index) => ({
        id: `question-${index + 1}`,
        question,
        why: null,
        recommendedAnswer: null,
      }))
  return source.slice(0, COUNCIL_V3_LIMITS.questions).map((item, index) => ({
    id: boundedCouncilText(item.id || `question-${index + 1}`, 120),
    question: boundedCouncilText(item.question, COUNCIL_V3_LIMITS.questionChars),
    why: item.why
      ? boundedCouncilText(item.why, COUNCIL_V3_LIMITS.questionChars)
      : null,
    recommendedAnswer: item.recommendedAnswer
      ? boundedCouncilText(item.recommendedAnswer, COUNCIL_V3_LIMITS.questionChars)
      : null,
  }))
}

function analysisAllowedEngines(policy: CouncilAnalysisEgressPolicy): EngineId[] {
  if (policy === 'local-only') return []
  if (policy === 'account-models') return ['claude', 'codex']
  return ['claude', 'codex', 'openrouter']
}

export interface CouncilRunOpts {
  mode?: CouncilIntentMode
  dir?: string
  question?: string
  specText?: string
  cardId?: string
  /** Back-compat claude alias — overrides the model of claude-engine seats only. */
  model?: string
  /** Internal/domain override; C2c owns exposing a validated IPC/UI selector. */
  responseLanguage?: string
  /** Repository-content egress policy for analysis; defaults to zero-call local collection. */
  analysisEgress?: CouncilAnalysisEgressPolicy
  /** Required whenever analysis evidence may reach an external model provider. */
  analysisConsent?: boolean
  /** Renderer correlation id for safe live progress; never persisted. */
  clientRunId?: string
}

/**
 * The LLM-Council v3 (Karpathy's method), multi-engine. `diff` judges a card's
 * change set (read-only — the same sanitized diff the reviewer uses), while
 * `spec` gates a draft task before it reaches an autonomous builder. `analysis`
 * is an explicit intent but fails closed until C3 supplies grounded evidence. Five
 * seats run in parallel across Codex/OpenRouter primaries with ordered Claude
 * last-resort fallbacks, every OK seat ranks the anonymized responses, then a
 * chairman synthesizes one verdict. Every stage degrades gracefully — a failed
 * seat becomes a note after exhausting its engine chain, not a dead session —
 * and every completed run is persisted for the scorecard.
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
    /** Automatic task-memory gateway. Production always wires this; the legacy
     *  listHooks collaborator remains as a backwards-compatible test fallback. */
    private readonly memoryContexts?: MemoryContextProvider,
    /** C3's deterministic, read-only repository evidence boundary. */
    private readonly evidence?: CouncilEvidenceCollector,
    /** Safe public stage activity for the waiting surface. */
    private readonly events?: Pick<CockpitEvents, 'emitTyped'>,
  ) {
    this.sweepStalePending()
  }

  private emitProgress(
    projectId: string,
    opts: CouncilRunOpts,
    event: Omit<CouncilProgressEvent, 'projectId' | 'runId' | 'mode' | 'at'>,
  ): void {
    if (!opts.clientRunId || !this.events) return
    this.events.emitTyped('council:progress', {
      projectId,
      runId: opts.clientRunId,
      mode: opts.mode ?? 'diff',
      ...event,
      message: boundedCouncilText(redactText(event.message).replace(/\s+/g, ' '), 220),
      at: new Date().toISOString(),
    })
  }

  private seatProgressMessage(seat: CouncilSeatOutput): string {
    if (!seat.ok) return 'No response after the allowed fallback chain.'
    return seat.findings?.[0]?.finding ?? seat.text
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

  async run(projectId: string, opts: CouncilRunOpts = {}): Promise<NormalizedCouncilResult> {
    const started = Date.now()
    const intent: CouncilIntentMode = opts.mode ?? 'diff'
    const project = this.projects.get(projectId)
    // The question is card title+body — user-authored, so it gets the same
    // redaction as the spec/diff before it can reach a third-party engine
    // (OpenRouter seats) or the persisted council_sessions row (argos M1).
    const rawQuestion = opts.question?.trim() || null
    const question = rawQuestion ? redactText(rawQuestion) : null
    const cardId = opts.cardId ?? null

    if (intent === 'analysis') {
      return this.runAnalysis(projectId, project, question, cardId, opts, started)
    }
    const mode: CouncilMode = intent

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
    const responseLanguage = detectCouncilResponseLanguage(
      `${question ?? ''}\n${specText ?? ''}`,
      opts.responseLanguage,
    )
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'preparing',
      status: 'completed',
      message: mode === 'spec'
        ? 'Request secured and Council context prepared.'
        : 'Change set sanitized and Council context prepared.',
    })

    // A6: the early-exit guards have passed, so the run is committed — reserve a
    // durable `pending` row up front. A crash between here and the final
    // finalize() leaves this marker, which the next boot sweeps to `failed`.
    // Best-effort: if reserving fails, `pendingId` stays null and persistAndRecord
    // falls back to a single insert of the completed result.
    const pendingId = this.reservePending(projectId, cardId, mode, question)

    const baseCallOpts = { cwd: project.path, timeout: CALL_TIMEOUT_MS, maxBuffer: CALL_MAX_BUFFER }
    const seatCallOpts: EngineCallOpts = {
      ...baseCallOpts,
      maxTokens: COUNCIL_STAGE_BUDGETS.seat.maxTokens,
    }
    const rankingCallOpts: EngineCallOpts = {
      ...baseCallOpts,
      maxTokens: COUNCIL_STAGE_BUDGETS.ranking.maxTokens,
    }
    const chairmanCallOpts: EngineCallOpts = {
      ...baseCallOpts,
      maxTokens: COUNCIL_STAGE_BUDGETS.chairman.maxTokens,
    }
    const fenceTag = `====COCKPIT-UNTRUSTED-${mode.toUpperCase()}-${randomUUID()}====`
    const claudeOverride = opts.model ? resolveChatModel(opts.model).id : null

    // Memory is a task prerequisite, not an optional seat decoration. The
    // central gateway injects real bounded note content for BOTH spec and diff
    // modes. The old hook-only block remains solely for isolated legacy tests.
    const memoryQuery = this.memoryQuery(mode, question, specText, sanitized)
    const automaticMemory: MemoryContextEnvelope | null = this.memoryContexts
      ? this.memoryContexts.forTask({
          projectId,
          surface: mode === 'spec' ? 'council_spec' : 'council_diff',
          query: memoryQuery,
        })
      : null
    const memoryBlock =
      automaticMemory?.block ??
      (mode === 'spec' ? this.memoryPointerBlock(projectId, question, specText) : null)

    const seatPrompt = (seat: CouncilSeat): string =>
      buildSeatPrompt(seat, {
        mode,
        fenceTag,
        projectName: project.name,
        question,
        sanitized,
        specText,
        memoryBlock,
        responseLanguage,
      })

    // Phase 1 — every seat, in parallel, blind to the others (with fallback).
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'seats',
      status: 'started',
      message: 'Five seats are reviewing independently.',
    })
    const seats: CouncilSeatOutput[] = await Promise.all(
      COUNCIL_SEATS.map(async (seat) => {
        const output = await this.runSeat(
          seat,
          seatPrompt(seat),
          claudeOverride,
          seatCallOpts,
        )
        this.emitProgress(projectId, opts, {
          kind: 'seat',
          stage: 'seats',
          status: output.ok ? 'completed' : 'failed',
          seatId: output.id,
          seatLabel: output.label,
          message: this.seatProgressMessage(output),
        })
        return output
      }),
    )

    const okSeats = seats.filter((s) => s.ok)
    if (okSeats.length === 0) {
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'complete',
        status: 'failed',
        message: 'No Council seat returned a usable response.',
      })
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
        responseLanguage,
        memoryContext: automaticMemory,
      })
      return this.persistAndRecord(projectId, pendingId, cardId, mode, question, result)
    }

    // Phase 2 — anonymized peer rankings (needs ≥2 responses to compare).
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'ranking',
      status: 'started',
      message: 'Successful seats are comparing the room anonymously.',
    })
    const { rankings, aggregate, labelToSeat } = await this.runRankings(
      seats,
      okSeats,
      mode,
      rankingCallOpts,
      memoryBlock,
      responseLanguage,
    )
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'ranking',
      status: 'completed',
      message: `${rankings.length} peer reviews completed.`,
    })

    // Phase 3 — chairman synthesis (with fallback retry).
    const chairmanPrompt =
      mode === 'diff'
        ? buildChairmanPrompt({
            question,
            seats,
            rankings,
            aggregate,
            memoryBlock,
            responseLanguage,
          })
        : buildSpecChairmanPrompt({
            question,
            seats,
            rankings,
            aggregate,
            fenceTag,
            specText: specText ?? '',
            memoryBlock,
            responseLanguage,
          })
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'chairman',
      status: 'started',
      message: 'Chairman is compressing the strongest findings into one decision.',
    })
    const verdict = await this.runChairman(chairmanPrompt, mode, chairmanCallOpts)
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'chairman',
      status: verdict ? 'completed' : 'failed',
      message: verdict
        ? 'Chairman synthesis is ready.'
        : 'Chairman synthesis was unavailable; seat evidence remains preserved.',
    })

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
      responseLanguage,
      memoryContext: automaticMemory,
    })
    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'complete',
      status: 'completed',
      message: 'Council decision is ready.',
    })
    return this.persistAndRecord(projectId, pendingId, cardId, mode, question, result)
  }

  /** A6: reserve a durable `pending` marker; null if the store rejected it (the
   *  completed result is then persisted by persistAndRecord's fallback insert). */
  private reservePending(
    projectId: string,
    cardId: string | null,
    mode: CouncilIntentMode,
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
   * Recent persisted sessions for a project as content-free headers (E4's
   * reported gap). Delegates to the store's defensive `listRecent` (a corrupt
   * row is already dropped there) and projects each session down to ids/enums +
   * the already-redacted question — no seat prose or diff/spec text leaves main.
   * Read-only; a later card renders it.
   */
  recentSessions(projectId: string, limit = 30): CouncilSessionSummary[] {
    return this.sessions.listRecent(projectId, limit).map((s) => ({
      id: s.id,
      cardId: s.cardId,
      mode: s.mode,
      question: s.question,
      verdictKind: normalizeVerdictKind(s.verdictKind),
      status: s.status,
      ok: s.result.ok,
      seatsRun: s.result.stats.seatsRun,
      createdAt: s.createdAt,
    }))
  }

  /**
   * The full persisted `CouncilResult` for one session id — the detail read
   * behind `recentSessions`. Project-scoped: a session whose row belongs to a
   * different project reads back null (never leaks another project's verdict),
   * as does an unknown id or a row the store's defensive parse dropped. This is
   * the channel that lets a verdict + scorecard survive an unmount/restart —
   * the renderer rehydrates on demand rather than holding the heavy result.
   */
  session(projectId: string, sessionId: string): NormalizedCouncilResult | null {
    const session = this.sessions.get(sessionId)
    if (!session || session.projectId !== projectId) return null
    return session.result
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
      if (selected.length > 0) {
        void this.recalls?.record(projectBrain(projectId), selected, 'council_spec')
      }
      return composeMemoryPointerBlock(query, notes)
    } catch {
      return null
    }
  }

  private memoryQuery(
    mode: CouncilMode,
    question: string | null,
    specText: string | undefined,
    sanitized: SanitizedDiff | undefined,
  ): string {
    if (mode === 'spec') return `${question ?? ''}\n${specText ?? ''}`.trim()
    const paths = [
      ...(sanitized?.files.map((file) => file.path) ?? []),
      ...(sanitized?.summarizedFiles.map((file) => file.path) ?? []),
    ]
    return `${question ?? ''}\n${paths.join('\n')}`.trim()
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

  /** Run one seat through its ordered engine chain, then surface a failure note. */
  private async runSeat(
    seat: CouncilSeat,
    prompt: string,
    claudeOverride: string | null,
    callOpts: EngineCallOpts,
    allowedEngines?: ReadonlySet<EngineId>,
  ): Promise<CouncilSeatOutput> {
    const primary = this.withOverride(seat.engine, claudeOverride)
    const configured = [primary, ...(seat.fallbacks ?? [])]
    const chain = allowedEngines
      ? configured.filter((candidate) => allowedEngines.has(candidate.engine))
      : configured
    let primaryErr: unknown = new Error('No engine is allowed by the analysis data-egress policy.')
    for (let index = 0; index < chain.length; index += 1) {
      const engine = chain[index]
      try {
        const output = await this.engine.call(engine, prompt, callOpts)
        const raw = allowedEngines ? redactText(output) : output
        const normalized = normalizeCouncilSeatText(raw, { builder: seat.id === 'builder' })
        return {
          id: seat.id,
          label: seat.label,
          engine,
          usedFallback: configured.indexOf(engine) > 0,
          text: normalized.text,
          ok: normalized.text.length > 0,
          ...(normalized.findings.length > 0 ? { findings: normalized.findings } : {}),
          ...(normalized.builderAssessment
            ? { builderAssessment: normalized.builderAssessment }
            : {}),
        }
      } catch (err) {
        if (index === 0) primaryErr = err
      }
    }
    const failure = normalizeCouncilSeatText(
      allowedEngines
        ? 'This seat could not be reached under the selected data-sharing policy.'
        : `This seat could not be reached (${errText(primaryErr)}).`,
    )
    const failureEngine = chain[0] ?? primary
    return {
      id: seat.id,
      label: seat.label,
      engine: failureEngine,
      usedFallback: configured.indexOf(failureEngine) > 0,
      text: failure.text,
      ok: false,
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
    mode: CouncilIntentMode,
    callOpts: EngineCallOpts,
    memoryBlock?: string | null,
    responseLanguage = 'und',
    fenceTag?: string,
  ): Promise<{ rankings: CouncilRanking[]; aggregate: AggregateRank[]; labelToSeat: Record<string, CouncilTone> }> {
    if (okSeats.length < 2) return { rankings: [], aggregate: [], labelToSeat: {} }

    const { anonymized, labelToSeat } = anonymizeSeats(seats, shuffledOrder(okSeats.length))
    const rankingPrompt = buildRankingPrompt(
      anonymized,
      mode,
      memoryBlock,
      responseLanguage,
      fenceTag,
    )
    const settled = await Promise.all(
      okSeats.map(async (s): Promise<CouncilRanking | null> => {
        try {
          // A seat ranks through the engine it actually succeeded on.
          const output = await this.engine.call(s.engine, rankingPrompt, callOpts)
          const raw = mode === 'analysis' ? redactText(output) : output
          if (raw.length === 0) return null
          const normalized = normalizeCouncilRankingText(raw)
          return {
            seatId: s.id,
            text: normalized.text,
            parsed: normalized.parsed,
            strongestContribution: normalized.strongestContribution,
            collectiveGap: normalized.collectiveGap,
            factualityFlags: normalized.factualityFlags,
          }
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
    mode: CouncilMode,
    callOpts: EngineCallOpts,
  ): Promise<string | null> {
    for (const engine of [CHAIRMAN.engine, ...CHAIRMAN.fallbacks]) {
      try {
        const text = redactText(await this.engine.call(engine, prompt, callOpts))
        return text.length > 0 ? normalizeCouncilChairmanText(text, mode) : null
      } catch {
        // Try the next engine; no verdict after the chain is degraded, not fatal.
      }
    }
    return null
  }

  private async runAnalysisChairman(
    prompt: string,
    callOpts: EngineCallOpts,
    allowedEngines: ReadonlySet<EngineId>,
  ): Promise<string | null> {
    const chain = [CHAIRMAN.engine, ...CHAIRMAN.fallbacks]
      .filter((candidate) => allowedEngines.has(candidate.engine))
    for (const engine of chain) {
      try {
        const text = redactText(await this.engine.call(engine, prompt, callOpts))
        return text.trim()
          ? boundedCouncilText(text, COUNCIL_V3_LIMITS.rawChairmanChars)
          : null
      } catch {
        // Try the next allowed account engine; raw provider errors stay private.
      }
    }
    return null
  }

  private async runAnalysis(
    projectId: string,
    project: { name: string; path: string },
    question: string | null,
    cardId: string | null,
    opts: CouncilRunOpts,
    started: number,
  ): Promise<NormalizedCouncilResult> {
    const request = redactText(opts.specText?.trim() || question || '')
    const responseLanguage = detectCouncilResponseLanguage(
      `${question ?? ''}\n${request}`,
      opts.responseLanguage,
    )
    if (!request) {
      return this.earlyError(
        'analysis',
        'Repository analysis needs a concrete question or request.',
        started,
        responseLanguage,
      )
    }
    const policy = opts.analysisEgress ?? 'local-only'
    if (policy !== 'local-only' && opts.analysisConsent !== true) {
      return this.earlyError(
        'analysis',
        'Explicit consent is required before bounded repository evidence can be sent to model providers.',
        started,
        responseLanguage,
      )
    }
    if (!this.evidence) {
      return this.earlyError(
        'analysis',
        'Repository analysis requires grounded repository evidence from the evidence collector; no engine was called and no result was persisted.',
        started,
        responseLanguage,
      )
    }

    this.emitProgress(projectId, opts, {
      kind: 'stage',
      stage: 'preparing',
      status: 'started',
      message: 'Collecting a bounded, redacted repository evidence pack.',
    })

    const automaticMemory = this.memoryContexts?.forTask({
      projectId,
      surface: 'council_analysis',
      query: `${question ?? ''}\n${request}`.trim(),
    }) ?? null
    let evidencePack: CouncilEvidencePack
    try {
      evidencePack = await this.evidence.collect({
        root: project.path,
        query: request,
        ...(automaticMemory?.receipt ? { memoryReceipt: automaticMemory.receipt } : {}),
      })
    } catch {
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'complete',
        status: 'failed',
        message: 'Repository evidence could not be collected safely.',
      })
      return this.earlyError(
        'analysis',
        'Repository evidence could not be collected safely; no model was called and nothing was persisted.',
        started,
        responseLanguage,
      )
    }
    const allowedEngines = analysisAllowedEngines(policy)
    const egress: CouncilAnalysisEgressReceipt = {
      policy,
      consent: policy === 'local-only' ? false : true,
      allowedEngines,
      contentChars:
        policy === 'local-only'
          ? 0
          : evidencePack.totalChars + (automaticMemory?.block.length ?? 0),
    }
    const pendingId = this.reservePending(projectId, cardId, 'analysis', question)
    if (policy === 'local-only') {
      const report = renderCouncilAnalysisReport({
        claims: [],
        pack: evidencePack,
        responseLanguage,
        egress,
      })
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'complete',
        status: 'completed',
        message: 'Local evidence inventory is ready; no model was called.',
      })
      return this.persistAndRecord(
        projectId,
        pendingId,
        cardId,
        'analysis',
        question,
        this.buildAnalysisResult({
          ok: true,
          seats: [],
          rankings: [],
          aggregate: [],
          labelToSeat: {},
          rawChairman: null,
          claims: [],
          evidencePack,
          egress,
          report,
          error: null,
          started,
          responseLanguage,
          memoryContext: automaticMemory,
        }),
      )
    }

    let isolatedCwd: string
    try {
      isolatedCwd = await mkdtemp(join(tmpdir(), 'cockpit-council-analysis-'))
    } catch {
      const report = renderCouncilAnalysisReport({
        claims: [],
        pack: evidencePack,
        responseLanguage,
        egress,
      })
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'complete',
        status: 'failed',
        message: 'Could not create the isolated analysis workspace.',
      })
      return this.persistAndRecord(
        projectId,
        pendingId,
        cardId,
        'analysis',
        question,
        this.buildAnalysisResult({
          ok: false,
          seats: [],
          rankings: [],
          aggregate: [],
          labelToSeat: {},
          rawChairman: null,
          claims: [],
          evidencePack,
          egress,
          report,
          error: 'Council could not create an isolated prompt-only analysis workspace.',
          started,
          responseLanguage,
          memoryContext: automaticMemory,
        }),
      )
    }

    try {
      const baseCallOpts = {
        cwd: isolatedCwd,
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: CALL_MAX_BUFFER,
        evidenceOnly: true,
      }
      const seatCallOpts: EngineCallOpts = {
        ...baseCallOpts,
        maxTokens: COUNCIL_STAGE_BUDGETS.seat.maxTokens,
      }
      const rankingCallOpts: EngineCallOpts = {
        ...baseCallOpts,
        maxTokens: COUNCIL_STAGE_BUDGETS.ranking.maxTokens,
      }
      const chairmanCallOpts: EngineCallOpts = {
        ...baseCallOpts,
        maxTokens: COUNCIL_STAGE_BUDGETS.chairman.maxTokens,
      }
      const allowedSet = new Set<EngineId>(allowedEngines)
      const fenceTag = `====COCKPIT-UNTRUSTED-ANALYSIS-${randomUUID()}====`
      const claudeOverride = opts.model ? resolveChatModel(opts.model).id : null
      const seatPrompt = (seat: CouncilSeat) =>
        buildAnalysisSeatPrompt(seat, {
          question: request,
          evidencePack,
          fenceTag,
          memoryBlock: automaticMemory?.block,
          responseLanguage,
        })
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'seats',
        status: 'started',
        message: 'Five seats are reviewing the same bounded evidence independently.',
      })
      const seats = await Promise.all(
        COUNCIL_SEATS.map(async (seat) => {
          const output = await this.runSeat(
            seat,
            seatPrompt(seat),
            claudeOverride,
            seatCallOpts,
            allowedSet,
          )
          this.emitProgress(projectId, opts, {
            kind: 'seat',
            stage: 'seats',
            status: output.ok ? 'completed' : 'failed',
            seatId: output.id,
            seatLabel: output.label,
            message: this.seatProgressMessage(output),
          })
          return output
        }),
      )
      const okSeats = seats.filter((seat) => seat.ok)
      if (okSeats.length === 0) {
        const report = renderCouncilAnalysisReport({
          claims: [],
          pack: evidencePack,
          responseLanguage,
          egress,
        })
        this.emitProgress(projectId, opts, {
          kind: 'stage',
          stage: 'complete',
          status: 'failed',
          message: 'No allowed Council seat returned a usable response.',
        })
        return this.persistAndRecord(
          projectId,
          pendingId,
          cardId,
          'analysis',
          question,
          this.buildAnalysisResult({
            ok: false,
            seats,
            rankings: [],
            aggregate: [],
            labelToSeat: {},
            rawChairman: null,
            claims: [],
            evidencePack,
            egress,
            report,
            error: 'Every allowed Council seat failed to respond.',
            started,
            responseLanguage,
            memoryContext: automaticMemory,
          }),
        )
      }
      const analysisContext = [
        renderCouncilEvidencePack(evidencePack, fenceTag),
        renderAnalysisMemoryHooks(automaticMemory?.block, fenceTag),
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'ranking',
        status: 'started',
        message: 'Successful seats are comparing the evidence-backed responses anonymously.',
      })
      const { rankings, aggregate, labelToSeat } = await this.runRankings(
        seats,
        okSeats,
        'analysis',
        rankingCallOpts,
        analysisContext,
        responseLanguage,
        fenceTag,
      )
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'ranking',
        status: 'completed',
        message: `${rankings.length} peer reviews completed.`,
      })
      const chairmanPrompt = buildAnalysisChairmanPrompt({
        question: request,
        seats,
        rankings,
        aggregate,
        evidencePack,
        fenceTag,
        memoryBlock: automaticMemory?.block,
        responseLanguage,
      })
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'chairman',
        status: 'started',
        message: 'Chairman is validating claims and compressing the final report.',
      })
      const rawChairman = await this.runAnalysisChairman(
        chairmanPrompt,
        chairmanCallOpts,
        allowedSet,
      )
      const claims = rawChairman
        ? parseCouncilAnalysisClaims(rawChairman, evidencePack)
        : []
      const ok = claims.length > 0
      const error = ok ? null : 'Council could not produce any provenance-checked analysis claim.'
      const report = renderCouncilAnalysisReport({
        claims,
        pack: evidencePack,
        responseLanguage,
        egress,
      })
      this.emitProgress(projectId, opts, {
        kind: 'stage',
        stage: 'complete',
        status: ok ? 'completed' : 'failed',
        message: ok
          ? 'Source-backed repository analysis is ready.'
          : 'No provenance-checked analysis claim could be produced.',
      })
      return this.persistAndRecord(
        projectId,
        pendingId,
        cardId,
        'analysis',
        question,
        this.buildAnalysisResult({
          ok,
          seats,
          rankings,
          aggregate,
          labelToSeat,
          rawChairman,
          claims,
          evidencePack,
          egress,
          report,
          error,
          started,
          responseLanguage,
          memoryContext: automaticMemory,
        }),
      )
    } finally {
      await rm(isolatedCwd, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private buildAnalysisResult(input: {
    ok: boolean
    seats: CouncilSeatOutput[]
    rankings: CouncilRanking[]
    aggregate: AggregateRank[]
    labelToSeat: Record<string, CouncilTone>
    rawChairman: string | null
    claims: CouncilClaim[]
    evidencePack: CouncilEvidencePack
    egress: CouncilAnalysisEgressReceipt
    report: string
    error: string | null
    started: number
    responseLanguage: string
    memoryContext?: MemoryContextEnvelope | null
  }): CouncilResultV3 {
    const seatsRun = input.seats.filter((seat) => seat.ok).length
    const repositoryFiles = new Set(
      input.evidencePack.sources
        .filter((source) => source.kind === 'repository')
        .map((source) => source.path),
    ).size
    const localSummary = input.responseLanguage.toLocaleLowerCase().startsWith('tr')
      ? 'Repository kanıtları yerel olarak toplandı; model sentezi çalıştırılmadı.'
      : 'Repository evidence was collected locally; no model synthesis was run.'
    const summary = input.ok
      ? input.claims.find((claim) => claim.verified)?.text ??
        localSummary
      : input.error ?? 'Repository analysis failed.'
    return {
      schemaVersion: COUNCIL_RESULT_SCHEMA_VERSION,
      ok: input.ok,
      mode: 'analysis',
      responseLanguage: input.responseLanguage,
      decision: {
        kind: input.ok ? 'analysis_complete' : 'failed',
        summary: boundedCouncilText(summary, COUNCIL_V3_LIMITS.summaryChars),
        why: null,
        questions: [],
        keyFindings: uniqueCouncilText(
          input.claims.map((claim) => claim.text),
          COUNCIL_V3_LIMITS.keyFindings,
        ),
        dissent: uniqueCouncilText(
          input.claims.filter((claim) => !claim.verified).map((claim) => claim.text),
          COUNCIL_V3_LIMITS.dissent,
        ),
      },
      primaryArtifact: {
        kind: 'analysisReport',
        content: boundedCouncilText(input.report, COUNCIL_V3_LIMITS.primaryArtifactChars),
      },
      execution: {
        stats: {
          seatsRun,
          seatsFailed: input.seats.length - seatsRun,
          filesReviewed: repositoryFiles,
          durationMs: Date.now() - input.started,
        },
        ...(input.memoryContext?.receipt ? { memoryContext: input.memoryContext.receipt } : {}),
      },
      evidence: {
        seats: input.seats,
        rankings: input.rankings,
        aggregate: input.aggregate,
        labelToSeat: input.labelToSeat,
        rawChairman: input.rawChairman,
        analysis: {
          pack: input.evidencePack,
          claims: input.claims,
          egress: input.egress,
        },
      },
      error: input.error,
      sessionId: null,
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
    responseLanguage: string
    memoryContext?: MemoryContextEnvelope | null
  }): CouncilResultV3 {
    const seatsRun = input.seats.filter((s) => s.ok).length
    const decisionKind: CouncilDecisionKind = !input.ok
      ? 'failed'
      : input.mode === 'spec'
        ? input.specVerdict?.kind ?? 'failed'
        : input.verdict
          ? 'review_complete'
          : 'failed'
    const reliable = decisionKind !== 'failed'
    const error = input.error ?? (
      reliable ? null : 'Council could not produce a reliable chairman decision.'
    )
    const stats = {
      seatsRun,
      seatsFailed: input.seats.length - seatsRun,
      filesReviewed: input.filesReviewed,
      durationMs: Date.now() - input.started,
    }
    let primaryArtifact: CouncilResultArtifact | null = null
    if (input.verdict && input.mode === 'spec') {
      const refined = extractRefinedSpec(input.verdict)
      if (refined) {
        primaryArtifact = {
          kind: 'refinedSpec',
          content: boundedCouncilText(refined, COUNCIL_V3_LIMITS.primaryArtifactChars),
        }
      }
    } else if (input.verdict && input.mode === 'diff') {
      primaryArtifact = {
        kind: 'diffVerdict',
        content: boundedCouncilText(input.verdict, COUNCIL_V3_LIMITS.primaryArtifactChars),
      }
    }
    const consensus = markdownSection(input.verdict, /consensus|disagreement/i)
    const keyFindings = uniqueCouncilText(
      input.seats.flatMap((seat) => seat.findings?.map((finding) => finding.finding) ?? []),
      COUNCIL_V3_LIMITS.keyFindings,
    )
    const dissent = uniqueCouncilText(
      input.rankings.flatMap((ranking) => [
        ...(ranking.factualityFlags ?? []),
        ranking.collectiveGap,
      ]),
      COUNCIL_V3_LIMITS.dissent,
    )
    return {
      schemaVersion: COUNCIL_RESULT_SCHEMA_VERSION,
      ok: input.ok && reliable,
      mode: input.mode,
      responseLanguage: input.responseLanguage,
      decision: {
        kind: decisionKind,
        summary: decisionSummary(input.verdict, error, decisionKind),
        why: consensus
          ? boundedCouncilText(consensus, COUNCIL_V3_LIMITS.whyChars)
          : null,
        questions: input.mode === 'spec' ? decisionQuestions(input.specVerdict) : [],
        keyFindings,
        dissent,
      },
      primaryArtifact,
      execution: {
        stats,
        ...(input.memoryContext?.receipt ? { memoryContext: input.memoryContext.receipt } : {}),
      },
      evidence: {
        seats: input.seats,
        rankings: input.rankings,
        aggregate: input.aggregate,
        labelToSeat: input.labelToSeat,
        rawChairman: input.verdict
          ? boundedCouncilText(input.verdict, COUNCIL_V3_LIMITS.rawChairmanChars)
          : null,
      },
      error,
      sessionId: null,
    }
  }

  private earlyError(
    mode: CouncilIntentMode,
    message: string,
    started: number,
    responseLanguage = 'und',
  ): NormalizedCouncilResult {
    // An early exit (clean worktree / missing spec) is not a convened run, so it
    // is not persisted — but it is still audit-logged as a no-op outcome.
    const raw: CouncilResultV3 = {
      schemaVersion: COUNCIL_RESULT_SCHEMA_VERSION,
      ok: false,
      mode,
      responseLanguage,
      decision: {
        kind: 'failed',
        summary: boundedCouncilText(message, COUNCIL_V3_LIMITS.summaryChars),
        why: null,
        questions: [],
        keyFindings: [],
        dissent: [],
      },
      primaryArtifact: null,
      execution: {
        stats: {
          seatsRun: 0,
          seatsFailed: 0,
          filesReviewed: 0,
          durationMs: Date.now() - started,
        },
      },
      evidence: {
        seats: [],
        rankings: [],
        aggregate: [],
        labelToSeat: {},
        rawChairman: null,
      },
      error: message,
      sessionId: null,
    }
    return normalizeCouncilResult(raw)!
  }

  /** Persist a completed run (even ok:false), then audit-log stats only. A6: this
   *  finalizes the `pending` row reserved at run start; only when that reservation
   *  failed (pendingId null) does it fall back to a single insert. */
  private persistAndRecord(
    projectId: string,
    pendingId: string | null,
    cardId: string | null,
    mode: CouncilIntentMode,
    question: string | null,
    result: CouncilResultV3,
  ): NormalizedCouncilResult {
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
    const withId = normalizeCouncilResult({ ...result, sessionId })
    if (!withId) throw new Error('Council produced an invalid v3 result envelope.')
    this.record(projectId, withId)
    // Faz A: a spec gate that comes back needs_clarification is a `notice` — the
    // draft can't proceed to a builder until the author answers. Fire-and-forget;
    // report() never throws. `question` is the already-redacted card title/body.
    if (councilSpecVerdictKind(withId) === 'needs_clarification') {
      const subject = question ?? (cardId ? `card ${cardId}` : 'the draft spec')
      const questions =
        withId.decision.questions.map((item) => item.question)
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

  private record(projectId: string, result: NormalizedCouncilResult): void {
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
        responseLanguage: result.responseLanguage ?? 'und',
        ok: result.ok,
        verdictKind: councilSpecVerdictKind(result),
      },
    })
  }
}

/** Narrow a stored `verdict_kind` string to the known gate kinds; anything else
 *  (null, legacy, garbage) reads as "no gate" rather than leaking a raw value. */
function normalizeVerdictKind(kind: string | null): 'approved' | 'needs_clarification' | null {
  return kind === 'approved' || kind === 'needs_clarification' ? kind : null
}

/** Coerce a parsed spec verdict into the result's non-null shape (null kind →
 *  no gate, the session still renders its seats). */
function normalizeSpecVerdict(verdict: string): CouncilResult['specVerdict'] {
  const parsed = parseSpecVerdict(verdict)
  return parsed.kind
    ? {
        kind: parsed.kind,
        questions: parsed.questions,
        ...(parsed.clarifications ? { clarifications: parsed.clarifications } : {}),
      }
    : null
}
