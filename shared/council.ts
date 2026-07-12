/**
 * LLM-Council v3 — roster, result shapes, and the pure ranking/verdict parsers
 * (Karpathy's method, multi-engine, wired into the swarm board).
 *
 * Five independent seats analyze the material from radically different angles,
 * every OK seat then ranks all anonymized responses, and a chairman synthesizes
 * one verdict. The execution machinery currently grounds `diff` in a change set
 * and `spec` in a draft task; `analysis` is a first-class persisted intent whose
 * repository evidence collector lands separately in C3.
 *
 * Security posture (unchanged from v1): every prompt string lives in this module
 * and its sibling `council-prompts.ts` — prompts never cross the IPC boundary.
 * Diff/spec content is fenced as UNTRUSTED DATA; only ids/labels cross the
 * bridge. This file is dependency-free (only a type import) so it unit-tests as
 * pure logic and runs identically in the browser mock.
 */
import type { EngineSpec } from './engines'
import type { MemoryContextReceipt } from './memory-context'
import {
  normalizeCouncilAnalysisEvidence,
  type CouncilAnalysisEvidence,
} from './council-evidence'

/** The five seat lenses. Tone drives the render hue; id crosses IPC. `builder`
 *  replaces v1's `executor` — the seat that will actually implement the work. */
export type CouncilTone =
  | 'contrarian'
  | 'first-principles'
  | 'expansionist'
  | 'outsider'
  | 'builder'

/** What the council is judging. `diff` = a change set, `spec` = a draft task spec. */
export type CouncilMode = 'diff' | 'spec'

/** Persisted/result intent. `analysis` is read-only and can never pass a spec gate. */
export type CouncilIntentMode = CouncilMode | 'analysis'

/**
 * One council seat: a lens (its mode-neutral core identity prompt) bound to an
 * engine. `fallbacks` are tried in order when an engine call throws, so a seat
 * can prefer the user's GPT allowance before spending Claude quota and still
 * remain alive when a provider or local CLI is unavailable.
 */
export interface CouncilSeat {
  id: CouncilTone
  label: string
  engine: EngineSpec
  /** Ordered retry path. GPT-first seats end in Claude only as a last resort. */
  fallbacks?: readonly EngineSpec[]
  /** The seat's lens — its identity, independent of diff/spec mode. */
  prompt: string
}

export type CouncilFindingBasis = 'evidence' | 'inference' | 'unknown'

/** One bounded, machine-readable seat contribution. Human values may be any language. */
export interface CouncilFinding {
  finding: string
  impact: string
  recommendation: string
  basis: CouncilFindingBasis
  evidenceRef: string | null
}

export interface CouncilBuilderAssessment {
  feasibility: string | null
  effort: string | null
  plan: string | null
  ambiguities: string | null
}

/**
 * The GPT-5.6 family is intentionally explicit rather than relying on Codex's
 * moving default. Every Codex engine call reuses the active Codex CLI login —
 * ChatGPT subscription access when the user signed in with ChatGPT, or API
 * billing when they signed in with an API key.
 */
export const GPT56_MODELS = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
} as const

/**
 * The default roster is GPT-first: Sol handles the high-judgment seats, Terra
 * the pragmatic/newcomer read, and Luna the fast expansion pass. DeepSeek keeps
 * one genuinely independent provider in the room. Claude is an emergency
 * fallback instead of the default spend path while a missing OpenRouter key
 * falls back to Terra through the same Codex login.
 */
export const COUNCIL_SEATS: readonly CouncilSeat[] = [
  {
    id: 'contrarian',
    label: 'Contrarian',
    engine: { engine: 'codex', model: GPT56_MODELS.sol },
    fallbacks: [{ engine: 'claude', model: 'opus' }],
    prompt:
      'You are The Contrarian on an LLM Council. Your job is to find what will FAIL. Assume the work under review has a fatal flaw and go find it — challenge every assumption, hunt hidden risks, second-order consequences, regressions, and what breaks at scale, under load, or in the edge cases nobody tested. Generic warnings are worthless here: every concern must point at concrete evidence in the material, or it does not count.',
  },
  {
    id: 'first-principles',
    label: 'First Principles',
    engine: { engine: 'openrouter', model: 'deepseek/deepseek-chat' },
    fallbacks: [
      { engine: 'codex', model: GPT56_MODELS.terra },
      { engine: 'claude', model: 'sonnet' },
    ],
    prompt:
      'You are The First Principles Thinker on an LLM Council. Strip away assumptions and rebuild from the ground up: what is the REAL problem being solved here? Separate what is KNOWN from what is merely ASSUMED. Challenge the framing itself, not just the details — is this optimizing the wrong variable entirely, or solving a symptom instead of the cause?',
  },
  {
    id: 'expansionist',
    label: 'Expansionist',
    engine: { engine: 'codex', model: GPT56_MODELS.luna },
    fallbacks: [{ engine: 'claude', model: 'haiku' }],
    prompt:
      'You are The Expansionist on an LLM Council. Find the UPSIDE being missed. What could this be if approached more ambitiously — a reusable abstraction, a compounding win, hidden optionality sitting right next to the work? Point at the specific bigger play, grounded in the material, never a vague "think bigger".',
  },
  {
    id: 'outsider',
    label: 'Outsider',
    engine: { engine: 'codex', model: GPT56_MODELS.terra },
    fallbacks: [{ engine: 'claude', model: 'sonnet' }],
    prompt:
      'You are The Outsider on an LLM Council. React with ZERO prior context about this codebase or its conventions. What is confusing? What would surprise a newcomer meeting this cold? Flag the curse of knowledge — things "obvious" to the author but invisible to everyone else. Ask the naive questions the experts skip; your ignorance is your superpower.',
  },
  {
    id: 'builder',
    label: 'Builder',
    engine: { engine: 'codex', model: GPT56_MODELS.sol },
    fallbacks: [{ engine: 'claude', model: 'opus' }],
    prompt:
      'You are The Builder on an LLM Council — the seat that will actually implement this. You do not critique for sport; you judge whether the work can be built well and what it will honestly cost. Be concrete about effort, and surface every place where you would be forced to guess during the build rather than papering over it.',
  },
]

export const COUNCIL_SEAT_IDS: readonly CouncilTone[] = COUNCIL_SEATS.map((s) => s.id)

/**
 * The chairman is NOT a seat — it synthesizes, it does not offer a lens. It runs
 * on the strongest tier with an ordered fallback chain so a busy/absent primary
 * never sinks the whole session's verdict.
 */
export const CHAIRMAN: { engine: EngineSpec; fallbacks: readonly EngineSpec[] } = {
  engine: { engine: 'codex', model: GPT56_MODELS.sol },
  fallbacks: [
    { engine: 'codex', model: GPT56_MODELS.terra },
    { engine: 'claude', model: 'opus' },
  ],
}

/** One seat's outcome: its reply, plus which engine produced it and whether the
 *  fallback had to step in (surfaced in the UI as a "(fallback)" chip). */
export interface CouncilSeatOutput {
  id: CouncilTone
  label: string
  engine: EngineSpec
  usedFallback: boolean
  text: string
  ok: boolean
  /** Present on new structured runs; absent on persisted legacy prose. */
  findings?: CouncilFinding[]
  builderAssessment?: CouncilBuilderAssessment | null
}

/** One seat's ranking pass over the anonymized responses. `parsed` is the
 *  machine-read order of `Response A`… labels, best first (may be empty). */
export interface CouncilRanking {
  seatId: CouncilTone
  text: string
  parsed: string[]
  /** Compact peer-judgment fields; absent on legacy ranking essays. */
  strongestContribution?: string | null
  collectiveGap?: string | null
  factualityFlags?: string[]
}

/** A seat's aggregate standing within ONE run: mean position across every peer
 *  ranking that placed it, and how many rankings that was. Lower is better. */
export interface AggregateRank {
  seatId: CouncilTone
  averageRank: number
  count: number
}

/** A seat's standing merged across many sessions (the scorecard). */
export interface ScorecardEntry {
  seatId: CouncilTone
  averageRank: number
  sessions: number
}

/** Run lifecycle status carried on each persisted session row (store V-column
 *  `status`). `final` is the honest read for any legacy/NULL row. */
export type CouncilSessionStatus = 'pending' | 'final' | 'failed'

/**
 * A persisted council session reduced to its header facts for a project's
 * session list (the `council:sessions` channel). Deliberately content-free — no
 * seat prose or diff/spec text crosses the bridge, only ids, enums, and the
 * already-redacted `question` — so the list is cheap to ship and safe to log.
 */
export interface CouncilSessionSummary {
  id: string
  cardId: string | null
  mode: CouncilIntentMode
  /** The card title/body that grounded the run, already redacted at persist. */
  question: string | null
  verdictKind: 'approved' | 'needs_clarification' | null
  status: CouncilSessionStatus
  ok: boolean
  /** Seats that answered — a quick "how convened was this run" glance. */
  seatsRun: number
  createdAt: string
}

export interface CouncilStats {
  seatsRun: number
  seatsFailed: number
  /** Files in the sanitized diff (0 in spec mode — there is no change set). */
  filesReviewed: number
  durationMs: number
}

/** One build-changing choice the author can answer directly in the Council UI. */
export interface CouncilClarification {
  /** Stable within one verdict; used to bind labels, answers, and validation. */
  id: string
  question: string
  /** Why the answer changes the build, when the chairman supplied it. */
  why: string | null
  /** A safe default the author can accept instead of inventing an answer. */
  recommendedAnswer: string | null
}

/** The author's answer to one guided clarification. */
export interface CouncilClarificationAnswer {
  id: string
  question: string
  answer: string
}

export const COUNCIL_RESULT_SCHEMA_VERSION = 3 as const

export const COUNCIL_DECISION_KINDS = [
  'approved',
  'needs_clarification',
  'changes_requested',
  'review_complete',
  'analysis_complete',
  'failed',
] as const
export type CouncilDecisionKind = (typeof COUNCIL_DECISION_KINDS)[number]

export interface CouncilDecision {
  kind: CouncilDecisionKind
  summary: string
  why: string | null
  questions: CouncilClarification[]
  keyFindings: string[]
  dissent: string[]
}

export const COUNCIL_PRIMARY_ARTIFACT_KINDS = [
  'refinedSpec',
  'analysisReport',
  'diffVerdict',
] as const
export type CouncilResultArtifactKind = (typeof COUNCIL_PRIMARY_ARTIFACT_KINDS)[number]

export interface CouncilResultArtifact {
  kind: CouncilResultArtifactKind
  content: string
}

export interface CouncilEvidenceV3 {
  seats: CouncilSeatOutput[]
  rankings: CouncilRanking[]
  aggregate: AggregateRank[]
  labelToSeat: Record<string, CouncilTone>
  /** Raw chairman output is evidence/debug material, never the primary artifact. */
  rawChairman: string | null
  /** Present only on grounded C3 repository-analysis results. */
  analysis?: CouncilAnalysisEvidence
}

export interface CouncilExecutionV3 {
  stats: CouncilStats
  memoryContext?: MemoryContextReceipt
}

/** Strict write contract introduced by Council v3. */
export interface CouncilResultV3 {
  schemaVersion: typeof COUNCIL_RESULT_SCHEMA_VERSION
  ok: boolean
  mode: CouncilIntentMode
  /** BCP-47-ish language tag; `und` means not declared/detected. */
  responseLanguage: string
  decision: CouncilDecision
  primaryArtifact: CouncilResultArtifact | null
  execution: CouncilExecutionV3
  evidence: CouncilEvidenceV3
  error: string | null
  sessionId: string | null
}

/** The full council session, rendered as seats → peer rankings → verdict. */
export interface CouncilResult {
  /** Missing means persisted v2. Normalized reads always populate 2 or 3. */
  schemaVersion?: 2 | typeof COUNCIL_RESULT_SCHEMA_VERSION
  ok: boolean
  mode: CouncilIntentMode
  responseLanguage?: string
  decision?: CouncilDecision
  primaryArtifact?: CouncilResultArtifact | null
  seats: CouncilSeatOutput[]
  rankings: CouncilRanking[]
  aggregate: AggregateRank[]
  /** Anonymization map (`"Response A"` → seat id), revealed post-hoc in the UI. */
  labelToSeat: Record<string, CouncilTone>
  /** The chairman's synthesized verdict (markdown), or null if it failed. */
  verdict: string | null
  /** Spec mode only: the parsed gate decision + guided author questions. */
  specVerdict: {
    kind: 'approved' | 'needs_clarification'
    questions: string[]
    /** Optional for backward compatibility with sessions saved before guided answers. */
    clarifications?: CouncilClarification[]
  } | null
  error: string | null
  stats: CouncilStats
  /** The persisted session's id, or null when persistence itself failed. */
  sessionId: string | null
  /** Automatic project-memory delivery receipt for this council run. */
  memoryContext?: MemoryContextReceipt
  /** Present on normalized reads so v3 raw evidence remains a named layer. */
  evidence?: CouncilEvidenceV3
  execution?: CouncilExecutionV3
}

export type CouncilResultLike = CouncilResult | CouncilResultV3

/** One safe read model shared by every v2/v3 consumer. */
export interface NormalizedCouncilResult extends CouncilResult {
  schemaVersion: 2 | typeof COUNCIL_RESULT_SCHEMA_VERSION
  responseLanguage: string
  decision: CouncilDecision
  primaryArtifact: CouncilResultArtifact | null
  evidence: CouncilEvidenceV3
  execution: CouncilExecutionV3
}

/**
 * Anonymize seat outputs into shuffled `Response A`… responses for the ranking
 * stage, and return the label→seat map so the aggregate can de-anonymize. The
 * order permutation is supplied by the caller (this pure module never calls a
 * clock or RNG) so the shuffle stays testable and deterministic per run.
 */
export function anonymizeSeats(
  seats: readonly CouncilSeatOutput[],
  order: readonly number[],
): { anonymized: { label: string; text: string }[]; labelToSeat: Record<string, CouncilTone> } {
  const letters = 'ABCDEFGHIJ'
  const usable = seats.filter((s) => s.ok)
  const picks = order.length === usable.length ? order : usable.map((_, i) => i)
  const anonymized: { label: string; text: string }[] = []
  const labelToSeat: Record<string, CouncilTone> = {}
  picks.forEach((idx, i) => {
    const label = `Response ${letters[i] ?? `#${i + 1}`}`
    anonymized.push({ label, text: usable[idx].text })
    labelToSeat[label] = usable[idx].id
  })
  return { anonymized, labelToSeat }
}

/** Drop duplicate strings while preserving first-seen order (a ranking lists
 *  each response once; a sloppy model may repeat one). */
function dedupePreserve(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * Parse a seat's ranking into an ordered list of `Response A` labels, best
 * first. Ported from Karpathy's council parser: prefer the strict block after
 * `FINAL RANKING:` (numbered `1. Response A` lines); if that yields nothing,
 * fall back to any `Response [A-Z]` mention in document order. Returns [] when
 * the text names no response at all.
 */
export function parseRankingFromText(text: string): string[] {
  const marker = /FINAL RANKING:/i.exec(text)
  const section = marker ? text.slice(marker.index + marker[0].length) : text
  const numbered = [...section.matchAll(/\d+\.\s*(Response [A-Z])/g)].map((m) => m[1])
  if (numbered.length > 0) return dedupePreserve(numbered)
  const loose = [...text.matchAll(/Response [A-Z]/g)].map((m) => m[0])
  return dedupePreserve(loose)
}

/**
 * Fold every seat's ranking into a per-seat aggregate for ONE run. Each ranking
 * contributes position (1-based) as a score per response it placed; a seat's
 * averageRank is the mean of its scores. A ranking that parsed to nothing, or
 * that names a label not in the run's map, contributes nothing. Sorted best
 * (lowest average) first.
 */
export function computeAggregateRankings(
  rankings: readonly CouncilRanking[],
  labelToSeatId: Record<string, CouncilTone>,
): AggregateRank[] {
  const acc = new Map<CouncilTone, { sum: number; count: number }>()
  for (const ranking of rankings) {
    ranking.parsed.forEach((label, i) => {
      const seatId = labelToSeatId[label]
      if (!seatId) return
      const prev = acc.get(seatId) ?? { sum: 0, count: 0 }
      acc.set(seatId, { sum: prev.sum + (i + 1), count: prev.count + 1 })
    })
  }
  return [...acc.entries()]
    .map(([seatId, { sum, count }]) => ({ seatId, averageRank: sum / count, count }))
    .sort((a, b) => a.averageRank - b.averageRank)
}

/**
 * Merge many sessions' aggregate arrays into a cross-session scorecard: per
 * seat, the mean of its per-session averageRanks and how many sessions it
 * appeared in. Pure — the service just feeds it stored rows. Sorted best first.
 */
export function computeScorecard(
  sessions: readonly { aggregate: readonly AggregateRank[] }[],
): ScorecardEntry[] {
  const acc = new Map<CouncilTone, { sum: number; sessions: number }>()
  for (const session of sessions) {
    for (const rank of session.aggregate) {
      const prev = acc.get(rank.seatId) ?? { sum: 0, sessions: 0 }
      acc.set(rank.seatId, { sum: prev.sum + rank.averageRank, sessions: prev.sessions + 1 })
    }
  }
  return [...acc.entries()]
    .map(([seatId, { sum, sessions }]) => ({ seatId, averageRank: sum / sessions, sessions }))
    .sort((a, b) => a.averageRank - b.averageRank)
}

type SpecKind = 'approved' | 'needs_clarification'

const check = (s: string): SpecKind | null => {
  // NEEDS_CLARIFICATION must be tested first — it never contains "approved".
  if (/needs[_\s-]?clarification/i.test(s)) return 'needs_clarification'
  if (/\bapproved\b/i.test(s)) return 'approved'
  return null
}

/**
 * Parse the spec chairman's gate: the `🎯 Verdict` section's first line is
 * either `APPROVED` or `NEEDS_CLARIFICATION`, and (only then) a numbered
 * `❓ Questions for the author` list follows. Tolerant of case/whitespace and
 * of the verdict token drifting off the exact first line; returns `kind: null`
 * for genuine garbage so the caller can treat it as a failed synthesis.
 */
export function parseSpecVerdict(text: string): {
  kind: SpecKind | null
  questions: string[]
  clarifications?: CouncilClarification[]
} {
  const extracted = extractQuestions(text)
  return {
    kind: detectSpecKind(text),
    questions: extracted.questions,
    ...(extracted.clarifications ? { clarifications: extracted.clarifications } : {}),
  }
}

function detectSpecKind(text: string): SpecKind | null {
  const lines = text.split('\n')
  const verdictIdx = lines.findIndex((l) => /^#{1,6}\s.*verdict/i.test(l.trim()))
  if (verdictIdx >= 0) {
    for (const raw of lines.slice(verdictIdx + 1)) {
      const line = raw.trim()
      if (!line) continue
      const kind = check(line)
      if (kind) return kind
      break // first meaningful line under the heading decides; else whole-text scan
    }
  }
  return check(text)
}

function extractQuestions(text: string): {
  questions: string[]
  clarifications?: CouncilClarification[]
} {
  const lines = text.split('\n')
  const qIdx = lines.findIndex((l) => /^#{1,6}\s.*question/i.test(l.trim()))
  if (qIdx < 0) return { questions: [] }

  const out: Array<{
    question: string
    why: string | null
    recommendedAnswer: string | null
    structured: boolean
  }> = []
  let current: (typeof out)[number] | null = null

  const flush = () => {
    if (!current?.question) return
    if (out.length < 3) out.push(current)
    current = null
  }

  for (const raw of lines.slice(qIdx + 1)) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) {
      flush()
      break // next section ends the list
    }
    const item = /^\d+[.)]\s*(.+)$/.exec(line)
    if (item) {
      flush()
      if (out.length >= 3) break
      const structured = /^QUESTION\s*:/i.test(item[1])
      current = {
        question: item[1].replace(/^QUESTION\s*:\s*/i, '').trim(),
        why: null,
        recommendedAnswer: null,
        structured,
      }
      continue
    }
    if (!current) continue
    const why = /^WHY\s*:\s*(.+)$/i.exec(line)
    if (why) {
      current.why = why[1].trim()
      current.structured = true
      continue
    }
    const recommended = /^RECOMMENDED\s*:\s*(.+)$/i.exec(line)
    if (recommended) {
      current.recommendedAnswer = recommended[1].trim()
      current.structured = true
    }
  }
  flush()

  const questions = out.map((item) => item.question)
  if (!out.some((item) => item.structured)) return { questions }
  return {
    questions,
    clarifications: out.map((item, index) => ({
      id: `question-${index + 1}`,
      question: item.question,
      why: item.why,
      recommendedAnswer: item.recommendedAnswer,
    })),
  }
}

/**
 * Pull the markdown BODY under the spec chairman's `### 📋 Refined Spec` heading
 * (up to the next markdown heading, or end of text). Tolerant: the heading is
 * matched case-insensitively, with OR without the emoji, at any heading level.
 * The UI pastes this into the card body, so the inner subsection labels
 * (bold Goal/Context/…) are preserved verbatim — only outer blank lines are
 * trimmed. Returns null when the section is absent or its body is empty.
 */
export function extractRefinedSpec(verdict: string): string | null {
  const lines = verdict.split('\n')
  const startIdx = lines.findIndex((l) => /^#{1,6}\s+.*refined spec/i.test(l.trim()))
  if (startIdx < 0) return null
  const body: string[] = []
  for (const raw of lines.slice(startIdx + 1)) {
    if (/^#{1,6}\s/.test(raw.trim())) break // the next section heading ends the body
    body.push(raw)
  }
  const text = body.join('\n').trim()
  return text.length > 0 ? text : null
}

export const COUNCIL_V3_LIMITS = {
  summaryChars: 600,
  whyChars: 1_200,
  questions: 3,
  questionChars: 600,
  keyFindings: 12,
  dissent: 5,
  findingChars: 800,
  primaryArtifactChars: 12_000,
  rawChairmanChars: 16_000,
} as const

const COUNCIL_BOUNDARY_TRUNCATION = '…[truncated]'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedText(value: unknown, cap: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text.length <= cap) return text
  return `${text.slice(0, Math.max(0, cap - COUNCIL_BOUNDARY_TRUNCATION.length))}${COUNCIL_BOUNDARY_TRUNCATION}`
}

function nullableBoundedText(value: unknown, cap: number): string | null {
  if (value === null || value === undefined) return null
  const text = boundedText(value, cap)
  return text || null
}

function councilMode(value: unknown): CouncilIntentMode | null {
  return value === 'spec' || value === 'diff' || value === 'analysis' ? value : null
}

function decisionKind(value: unknown): CouncilDecisionKind | null {
  return typeof value === 'string' && (COUNCIL_DECISION_KINDS as readonly string[]).includes(value)
    ? (value as CouncilDecisionKind)
    : null
}

function artifactKind(value: unknown): CouncilResultArtifactKind | null {
  return typeof value === 'string' &&
    (COUNCIL_PRIMARY_ARTIFACT_KINDS as readonly string[]).includes(value)
    ? (value as CouncilResultArtifactKind)
    : null
}

function tone(value: unknown): CouncilTone | null {
  return typeof value === 'string' && (COUNCIL_SEAT_IDS as readonly string[]).includes(value)
    ? (value as CouncilTone)
    : null
}

function engine(value: unknown): EngineSpec | null {
  const item = record(value)
  if (!item) return null
  if (item.engine !== 'claude' && item.engine !== 'codex' && item.engine !== 'openrouter') return null
  if (typeof item.model !== 'string') return null
  return { engine: item.engine, model: item.model }
}

function findingBasis(value: unknown): CouncilFindingBasis | null {
  return value === 'evidence' || value === 'inference' || value === 'unknown' ? value : null
}

function normalizedFindings(value: unknown): CouncilFinding[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 4).flatMap((candidate) => {
    const item = record(candidate)
    const basis = findingBasis(item?.basis)
    if (
      !item ||
      !basis ||
      typeof item.finding !== 'string' ||
      typeof item.impact !== 'string' ||
      typeof item.recommendation !== 'string' ||
      !validNullableString(item.evidenceRef)
    ) return []
    const finding = boundedText(item.finding, COUNCIL_V3_LIMITS.findingChars)
    const impact = boundedText(item.impact, COUNCIL_V3_LIMITS.findingChars)
    const recommendation = boundedText(item.recommendation, COUNCIL_V3_LIMITS.findingChars)
    if (!finding || !impact || !recommendation) return []
    return [{
      finding,
      impact,
      recommendation,
      basis,
      evidenceRef: nullableBoundedText(item.evidenceRef, 500),
    }]
  })
}

function normalizedBuilderAssessment(value: unknown): CouncilBuilderAssessment | null {
  if (value === null || value === undefined) return null
  const item = record(value)
  if (!item) return null
  const fields = ['feasibility', 'effort', 'plan', 'ambiguities'] as const
  if (fields.some((field) => !validNullableString(item[field]))) return null
  const assessment: CouncilBuilderAssessment = {
    feasibility: nullableBoundedText(item.feasibility, 500),
    effort: nullableBoundedText(item.effort, 500),
    plan: nullableBoundedText(item.plan, 800),
    ambiguities: nullableBoundedText(item.ambiguities, 800),
  }
  return Object.values(assessment).some((entry) => entry !== null) ? assessment : null
}

function seats(value: unknown): CouncilSeatOutput[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const item = record(candidate)
    const id = tone(item?.id)
    const actualEngine = engine(item?.engine)
    if (!item || !id || !actualEngine || typeof item.label !== 'string' || typeof item.text !== 'string') {
      return []
    }
    const findings = normalizedFindings(item.findings)
    const builderAssessment = normalizedBuilderAssessment(item.builderAssessment)
    return [{
      id,
      label: boundedText(item.label, 120),
      engine: actualEngine,
      usedFallback: item.usedFallback === true,
      text: boundedText(item.text, 16_000),
      ok: item.ok === true,
      ...(findings.length > 0 ? { findings } : {}),
      ...(builderAssessment ? { builderAssessment } : {}),
    }]
  })
}

function rankings(value: unknown): CouncilRanking[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const item = record(candidate)
    const seatId = tone(item?.seatId)
    if (!item || !seatId || typeof item.text !== 'string' || !Array.isArray(item.parsed)) return []
    const strongestContribution = nullableBoundedText(item.strongestContribution, 600)
    const collectiveGap = nullableBoundedText(item.collectiveGap, 800)
    const flags = boundedStringArray(item.factualityFlags, 3)
    return [{
      seatId,
      text: boundedText(item.text, 8_000),
      parsed: item.parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => boundedText(entry, 80))
        .filter(Boolean)
        .slice(0, 10),
      ...(item.strongestContribution !== undefined ? { strongestContribution } : {}),
      ...(item.collectiveGap !== undefined ? { collectiveGap } : {}),
      ...(item.factualityFlags !== undefined ? { factualityFlags: flags } : {}),
    }]
  })
}

function aggregates(value: unknown): AggregateRank[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const item = record(candidate)
    const seatId = tone(item?.seatId)
    if (
      !item ||
      !seatId ||
      typeof item.averageRank !== 'number' ||
      !Number.isFinite(item.averageRank) ||
      typeof item.count !== 'number' ||
      !Number.isFinite(item.count)
    ) return []
    return [{ seatId, averageRank: item.averageRank, count: Math.max(0, Math.floor(item.count)) }]
  })
}

function labels(value: unknown): Record<string, CouncilTone> {
  const source = record(value)
  if (!source) return {}
  const out: Record<string, CouncilTone> = {}
  for (const [label, rawTone] of Object.entries(source)) {
    const seatId = tone(rawTone)
    if (seatId && label.length <= 40) out[label] = seatId
  }
  return out
}

function normalizedStats(value: unknown): CouncilStats | null {
  const item = record(value)
  if (!item) return null
  const fields = ['seatsRun', 'seatsFailed', 'filesReviewed', 'durationMs'] as const
  if (fields.some((field) => typeof item[field] !== 'number' || !Number.isFinite(item[field]))) return null
  return {
    seatsRun: Math.max(0, Math.floor(item.seatsRun as number)),
    seatsFailed: Math.max(0, Math.floor(item.seatsFailed as number)),
    filesReviewed: Math.max(0, Math.floor(item.filesReviewed as number)),
    durationMs: Math.max(0, Math.floor(item.durationMs as number)),
  }
}

const MEMORY_CONTEXT_SURFACES = new Set([
  'claude_chat',
  'hermes_chat',
  'council_spec',
  'council_diff',
  'council_analysis',
  'swarm_worker',
  'terminal_claude',
  'terminal_codex',
  'review_diff',
  'review_text',
])

function normalizedMemoryContext(value: unknown): MemoryContextReceipt | null | undefined {
  if (value === undefined) return undefined
  const item = record(value)
  if (
    !item ||
    typeof item.contextId !== 'string' ||
    typeof item.surface !== 'string' ||
    !MEMORY_CONTEXT_SURFACES.has(item.surface) ||
    (item.status !== 'ready' && item.status !== 'empty' && item.status !== 'unavailable') ||
    (item.delivery !== 'lookup' && item.delivery !== 'inline' && item.delivery !== 'none') ||
    !Array.isArray(item.notes) ||
    typeof item.characters !== 'number' ||
    !Number.isFinite(item.characters)
  ) return null

  const notes = item.notes.flatMap((candidate) => {
    const note = record(candidate)
    if (
      !note ||
      typeof note.name !== 'string' ||
      typeof note.path !== 'string' ||
      typeof note.updatedAt !== 'string' ||
      typeof note.truncated !== 'boolean'
    ) return []
    return [{
      name: boundedText(note.name, 200),
      path: boundedText(note.path, 500),
      updatedAt: boundedText(note.updatedAt, 100),
      truncated: note.truncated,
    }]
  }).slice(0, 10)
  if (notes.length !== item.notes.length) return null

  return {
    contextId: boundedText(item.contextId, 200),
    surface: item.surface as MemoryContextReceipt['surface'],
    status: item.status,
    delivery: item.delivery,
    notes,
    characters: Math.max(0, Math.floor(item.characters)),
    ...(record(item.evidence)
      ? { evidence: item.evidence as unknown as NonNullable<MemoryContextReceipt['evidence']> }
      : {}),
  }
}

function clarification(value: unknown, index: number): CouncilClarification | null {
  if (typeof value === 'string') {
    const question = boundedText(value, COUNCIL_V3_LIMITS.questionChars)
    return question
      ? { id: `question-${index + 1}`, question, why: null, recommendedAnswer: null }
      : null
  }
  const item = record(value)
  if (!item) return null
  const question = boundedText(item.question, COUNCIL_V3_LIMITS.questionChars)
  if (!question) return null
  return {
    id: boundedText(item.id, 120) || `question-${index + 1}`,
    question,
    why: nullableBoundedText(item.why, COUNCIL_V3_LIMITS.questionChars),
    recommendedAnswer: nullableBoundedText(
      item.recommendedAnswer,
      COUNCIL_V3_LIMITS.questionChars,
    ),
  }
}

function decisionQuestions(value: unknown): CouncilClarification[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, COUNCIL_V3_LIMITS.questions)
    .map(clarification)
    .filter((item): item is CouncilClarification => item !== null)
}

function boundedStringArray(value: unknown, count: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedText(item, COUNCIL_V3_LIMITS.findingChars))
    .filter(Boolean)
    .slice(0, count)
}

function normalizedDecision(value: unknown): CouncilDecision | null {
  const item = record(value)
  const kind = decisionKind(item?.kind)
  if (!item || !kind) return null
  const summary = boundedText(item.summary, COUNCIL_V3_LIMITS.summaryChars)
  if (!summary) return null
  return {
    kind,
    summary,
    why: nullableBoundedText(item.why, COUNCIL_V3_LIMITS.whyChars),
    questions: decisionQuestions(item.questions),
    keyFindings: boundedStringArray(item.keyFindings, COUNCIL_V3_LIMITS.keyFindings),
    dissent: boundedStringArray(item.dissent, COUNCIL_V3_LIMITS.dissent),
  }
}

function normalizedArtifact(value: unknown): CouncilResultArtifact | null | undefined {
  if (value === null) return null
  const item = record(value)
  const kind = artifactKind(item?.kind)
  if (!item || !kind) return undefined
  const content = boundedText(item.content, COUNCIL_V3_LIMITS.primaryArtifactChars)
  return content ? { kind, content } : undefined
}

function legacySummary(result: CouncilResult, kind: CouncilDecisionKind): string {
  if (result.error?.trim()) return boundedText(result.error, COUNCIL_V3_LIMITS.summaryChars)
  const lines = (result.verdict ?? '')
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^(APPROVED|NEEDS[_\s-]?CLARIFICATION)$/i.test(line))
  return boundedText(lines[0] ?? kind.replace(/_/g, ' '), COUNCIL_V3_LIMITS.summaryChars)
}

function legacyDecision(result: CouncilResult): CouncilDecision {
  const specKind = result.mode === 'spec' ? result.specVerdict?.kind ?? null : null
  const kind: CouncilDecisionKind = !result.ok
    ? 'failed'
    : specKind ?? (result.mode === 'diff' ? 'review_complete' : 'analysis_complete')
  const guided = result.specVerdict?.clarifications
  const rawQuestions = guided && guided.length > 0
    ? guided
    : result.specVerdict?.questions ?? []
  return {
    kind,
    summary: legacySummary(result, kind),
    why: null,
    questions: decisionQuestions(rawQuestions),
    keyFindings: [],
    dissent: [],
  }
}

function legacyArtifact(result: CouncilResult): CouncilResultArtifact | null {
  if (!result.verdict) return null
  if (result.mode === 'spec') {
    const refined = extractRefinedSpec(result.verdict)
    return refined ? { kind: 'refinedSpec', content: boundedText(refined, COUNCIL_V3_LIMITS.primaryArtifactChars) } : null
  }
  if (result.mode === 'diff') {
    return { kind: 'diffVerdict', content: boundedText(result.verdict, COUNCIL_V3_LIMITS.primaryArtifactChars) }
  }
  return { kind: 'analysisReport', content: boundedText(result.verdict, COUNCIL_V3_LIMITS.primaryArtifactChars) }
}

function validNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function normalizeLegacy(value: Record<string, unknown>): NormalizedCouncilResult | null {
  const mode = councilMode(value.mode)
  const stats = normalizedStats(value.stats)
  if (
    typeof value.ok !== 'boolean' ||
    !mode ||
    mode === 'analysis' ||
    !Array.isArray(value.seats) ||
    !Array.isArray(value.rankings) ||
    !Array.isArray(value.aggregate) ||
    !record(value.labelToSeat) ||
    !validNullableString(value.verdict) ||
    !validNullableString(value.error) ||
    !validNullableString(value.sessionId) ||
    !stats
  ) return null

  const rawSpec = value.specVerdict
  let specVerdict: CouncilResult['specVerdict'] = null
  if (mode === 'spec' && rawSpec !== null && rawSpec !== undefined) {
    const item = record(rawSpec)
    if (!item || (item.kind !== 'approved' && item.kind !== 'needs_clarification')) return null
    const questions = Array.isArray(item.questions)
      ? item.questions
          .filter((question): question is string => typeof question === 'string')
          .map((question) => boundedText(question, COUNCIL_V3_LIMITS.questionChars))
          .filter(Boolean)
          .slice(0, COUNCIL_V3_LIMITS.questions)
      : []
    const clarifications = decisionQuestions(item.clarifications)
    specVerdict = {
      kind: item.kind,
      questions,
      ...(clarifications.length > 0 ? { clarifications } : {}),
    }
  }

  const memoryContext = normalizedMemoryContext(value.memoryContext)
  if (memoryContext === null) return null
  const base: CouncilResult = {
    ok: value.ok,
    mode,
    seats: seats(value.seats),
    rankings: rankings(value.rankings),
    aggregate: aggregates(value.aggregate),
    labelToSeat: labels(value.labelToSeat),
    verdict: nullableBoundedText(value.verdict, COUNCIL_V3_LIMITS.rawChairmanChars),
    specVerdict,
    error: nullableBoundedText(value.error, COUNCIL_V3_LIMITS.whyChars),
    stats,
    sessionId:
      typeof value.sessionId === 'string' ? boundedText(value.sessionId, 200) : null,
    ...(memoryContext ? { memoryContext } : {}),
  }
  const decision = legacyDecision(base)
  const primaryArtifact = legacyArtifact(base)
  const evidence: CouncilEvidenceV3 = {
    seats: base.seats,
    rankings: base.rankings,
    aggregate: base.aggregate,
    labelToSeat: base.labelToSeat,
    rawChairman: base.verdict,
  }
  const execution: CouncilExecutionV3 = {
    stats,
    ...(base.memoryContext ? { memoryContext: base.memoryContext } : {}),
  }
  return {
    ...base,
    schemaVersion: 2,
    responseLanguage:
      typeof value.responseLanguage === 'string' && value.responseLanguage.trim()
        ? boundedText(value.responseLanguage, 32)
        : 'und',
    decision,
    primaryArtifact,
    evidence,
    execution,
  }
}

function normalizeV3(value: Record<string, unknown>): NormalizedCouncilResult | null {
  const mode = councilMode(value.mode)
  const decisionRaw = record(value.decision)
  const decision = normalizedDecision(decisionRaw)
  const artifact = normalizedArtifact(value.primaryArtifact)
  const executionRaw = record(value.execution)
  const evidenceRaw = record(value.evidence)
  const stats = normalizedStats(executionRaw?.stats)
  const analysisEvidence = normalizeCouncilAnalysisEvidence(evidenceRaw?.analysis)
  if (
    value.schemaVersion !== COUNCIL_RESULT_SCHEMA_VERSION ||
    typeof value.ok !== 'boolean' ||
    !mode ||
    typeof value.responseLanguage !== 'string' ||
    !value.responseLanguage.trim() ||
    !decisionRaw ||
    !decision ||
    !validNullableString(decisionRaw.why) ||
    !Array.isArray(decisionRaw.questions) ||
    !Array.isArray(decisionRaw.keyFindings) ||
    !Array.isArray(decisionRaw.dissent) ||
    artifact === undefined ||
    (artifact !== null &&
      ((mode === 'spec' && artifact.kind !== 'refinedSpec') ||
        (mode === 'diff' && artifact.kind !== 'diffVerdict') ||
        (mode === 'analysis' && artifact.kind !== 'analysisReport'))) ||
    !executionRaw ||
    !evidenceRaw ||
    !stats ||
    !Array.isArray(evidenceRaw.seats) ||
    !Array.isArray(evidenceRaw.rankings) ||
    !Array.isArray(evidenceRaw.aggregate) ||
    !record(evidenceRaw.labelToSeat) ||
    !validNullableString(evidenceRaw.rawChairman) ||
    (mode === 'analysis' && evidenceRaw.analysis !== undefined && !analysisEvidence) ||
    (mode !== 'analysis' && evidenceRaw.analysis !== undefined) ||
    (executionRaw.memoryContext !== undefined && !record(executionRaw.memoryContext)) ||
    !validNullableString(value.error) ||
    !validNullableString(value.sessionId)
  ) return null

  const normalizedEvidence: CouncilEvidenceV3 = {
    seats: seats(evidenceRaw.seats),
    rankings: rankings(evidenceRaw.rankings),
    aggregate: aggregates(evidenceRaw.aggregate),
    labelToSeat: labels(evidenceRaw.labelToSeat),
    rawChairman: nullableBoundedText(
      evidenceRaw.rawChairman,
      COUNCIL_V3_LIMITS.rawChairmanChars,
    ),
    ...(analysisEvidence ? { analysis: analysisEvidence } : {}),
  }
  const memoryContext = normalizedMemoryContext(executionRaw.memoryContext)
  if (memoryContext === null) return null
  const execution: CouncilExecutionV3 = {
    stats,
    ...(memoryContext ? { memoryContext } : {}),
  }
  const specVerdict: CouncilResult['specVerdict'] =
    mode === 'spec' && (decision.kind === 'approved' || decision.kind === 'needs_clarification')
      ? {
          kind: decision.kind,
          questions: decision.questions.map((question) => question.question),
          ...(decision.questions.length > 0 ? { clarifications: decision.questions } : {}),
        }
      : null
  const verdict = normalizedEvidence.rawChairman ?? artifact?.content ?? null

  return {
    schemaVersion: COUNCIL_RESULT_SCHEMA_VERSION,
    ok: value.ok,
    mode,
    responseLanguage: boundedText(value.responseLanguage, 32),
    decision,
    primaryArtifact: artifact,
    seats: normalizedEvidence.seats,
    rankings: normalizedEvidence.rankings,
    aggregate: normalizedEvidence.aggregate,
    labelToSeat: normalizedEvidence.labelToSeat,
    verdict,
    specVerdict,
    error: nullableBoundedText(value.error, COUNCIL_V3_LIMITS.whyChars),
    stats,
    sessionId:
      typeof value.sessionId === 'string' ? boundedText(value.sessionId, 200) : null,
    ...(memoryContext ? { memoryContext } : {}),
    evidence: normalizedEvidence,
    execution,
  }
}

/** Parse and normalize either an unversioned/v2 blob or the strict v3 envelope. */
export function normalizeCouncilResult(value: unknown): NormalizedCouncilResult | null {
  const item = record(value)
  if (!item) return null
  if (
    item.schemaVersion !== undefined &&
    item.schemaVersion !== 2 &&
    item.schemaVersion !== COUNCIL_RESULT_SCHEMA_VERSION
  ) return null
  return item.schemaVersion === COUNCIL_RESULT_SCHEMA_VERSION
    ? normalizeV3(item)
    : normalizeLegacy(item)
}

/** Only a real spec-mode decision can enter the Swarm/outcome spec-gate path. */
export function councilSpecVerdictKind(
  value: unknown,
): 'approved' | 'needs_clarification' | null {
  const result = normalizeCouncilResult(value)
  if (!result || result.mode !== 'spec') return null
  return result.decision.kind === 'approved' || result.decision.kind === 'needs_clarification'
    ? result.decision.kind
    : null
}

export function isApprovedCouncilSpec(value: unknown): boolean {
  return councilSpecVerdictKind(value) === 'approved'
}

/**
 * A worker "was in the meeting" — the total brief is hard-capped so a runaway
 * verdict or seat reply can never balloon the pty opening prompt (the same
 * diff-review budget lesson the worker prompt itself obeys).
 */
const COUNCIL_BRIEF_CAP = 6_000
const COUNCIL_BRIEF_TRUNCATION = '…[truncated]'

/**
 * The meeting minutes a swarm worker reads before it builds. In order: a fixed
 * preface, the refined spec (or the raw chairman verdict when no Refined Spec
 * section parsed), the Builder seat's notes, and the Contrarian's sharpest
 * objection. Only OK seats contribute. Returns null when there is nothing to say
 * — neither a verdict nor a single OK seat. Pure: the caller feeds it a stored
 * CouncilResult.
 */
export function composeCouncilBrief(value: unknown): string | null {
  const result = normalizeCouncilResult(value)
  if (!result || !isApprovedCouncilSpec(result)) return null
  const okSeats = result.seats.filter((s) => s.ok)
  if (!result.verdict && okSeats.length === 0) return null

  const parts: string[] = [
    "COUNCIL BRIEF — this task's spec was reviewed by an LLM council; build with these conclusions in mind.",
  ]

  const conclusions =
    (result.primaryArtifact?.kind === 'refinedSpec'
      ? result.primaryArtifact.content
      : result.verdict
        ? extractRefinedSpec(result.verdict)
        : null) ?? result.verdict?.trim() ?? null
  if (conclusions) parts.push('', conclusions)

  const seatText = (id: CouncilTone): string | null => {
    const seat = okSeats.find((s) => s.id === id)
    const text = seat?.text.trim()
    return text ? text : null
  }

  const builder = seatText('builder')
  if (builder) parts.push('', 'Builder seat notes:', builder)

  const contrarian = seatText('contrarian')
  if (contrarian) parts.push('', 'Sharpest objection (Contrarian):', contrarian)

  const brief = parts.join('\n')
  if (brief.length <= COUNCIL_BRIEF_CAP) return brief
  return brief.slice(0, COUNCIL_BRIEF_CAP - COUNCIL_BRIEF_TRUNCATION.length) + COUNCIL_BRIEF_TRUNCATION
}
