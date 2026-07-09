/**
 * LLM-Council v2 — roster, result shapes, and the pure ranking/verdict parsers
 * (Karpathy's method, multi-engine, wired into the swarm board).
 *
 * Five independent seats analyze the material from radically different angles,
 * every OK seat then ranks all anonymized responses, and a chairman synthesizes
 * one verdict. Two modes share this machinery: `diff` judges a change set,
 * `spec` judges whether a draft task spec is buildable before it reaches an
 * autonomous builder.
 *
 * Security posture (unchanged from v1): every prompt string lives in this module
 * and its sibling `council-prompts.ts` — prompts never cross the IPC boundary.
 * Diff/spec content is fenced as UNTRUSTED DATA; only ids/labels cross the
 * bridge. This file is dependency-free (only a type import) so it unit-tests as
 * pure logic and runs identically in the browser mock.
 */
import type { EngineSpec } from './engines'

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

/**
 * One council seat: a lens (its mode-neutral core identity prompt) bound to an
 * engine. `fallback` is tried once when the primary engine call throws, so a
 * seat whose primary needs a key (OpenRouter) or a second CLI (Codex) is never
 * a dead seat on a machine that lacks it.
 */
export interface CouncilSeat {
  id: CouncilTone
  label: string
  engine: EngineSpec
  fallback?: EngineSpec
  /** The seat's lens — its identity, independent of diff/spec mode. */
  prompt: string
}

/**
 * The default roster. The engine mix is the point: three vendors and three
 * Claude tiers, so the council is genuinely diverse rather than one model
 * arguing with itself. Seats whose primary engine can be unavailable carry a
 * Claude fallback.
 */
export const COUNCIL_SEATS: readonly CouncilSeat[] = [
  {
    id: 'contrarian',
    label: 'Contrarian',
    engine: { engine: 'claude', model: 'opus' },
    prompt:
      'You are The Contrarian on an LLM Council. Your job is to find what will FAIL. Assume the work under review has a fatal flaw and go find it — challenge every assumption, hunt hidden risks, second-order consequences, regressions, and what breaks at scale, under load, or in the edge cases nobody tested. Generic warnings are worthless here: every concern must point at concrete evidence in the material, or it does not count.',
  },
  {
    id: 'first-principles',
    label: 'First Principles',
    engine: { engine: 'openrouter', model: 'deepseek/deepseek-chat' },
    fallback: { engine: 'claude', model: 'sonnet' },
    prompt:
      'You are The First Principles Thinker on an LLM Council. Strip away assumptions and rebuild from the ground up: what is the REAL problem being solved here? Separate what is KNOWN from what is merely ASSUMED. Challenge the framing itself, not just the details — is this optimizing the wrong variable entirely, or solving a symptom instead of the cause?',
  },
  {
    id: 'expansionist',
    label: 'Expansionist',
    engine: { engine: 'claude', model: 'haiku' },
    prompt:
      'You are The Expansionist on an LLM Council. Find the UPSIDE being missed. What could this be if approached more ambitiously — a reusable abstraction, a compounding win, hidden optionality sitting right next to the work? Point at the specific bigger play, grounded in the material, never a vague "think bigger".',
  },
  {
    id: 'outsider',
    label: 'Outsider',
    engine: { engine: 'claude', model: 'sonnet' },
    prompt:
      'You are The Outsider on an LLM Council. React with ZERO prior context about this codebase or its conventions. What is confusing? What would surprise a newcomer meeting this cold? Flag the curse of knowledge — things "obvious" to the author but invisible to everyone else. Ask the naive questions the experts skip; your ignorance is your superpower.',
  },
  {
    id: 'builder',
    label: 'Builder',
    engine: { engine: 'codex', model: '' },
    fallback: { engine: 'claude', model: 'opus' },
    prompt:
      'You are The Builder on an LLM Council — the seat that will actually implement this. You do not critique for sport; you judge whether the work can be built well and what it will honestly cost. Be concrete about effort, and surface every place where you would be forced to guess during the build rather than papering over it.',
  },
]

export const COUNCIL_SEAT_IDS: readonly CouncilTone[] = COUNCIL_SEATS.map((s) => s.id)

/**
 * The chairman is NOT a seat — it synthesizes, it does not offer a lens. It runs
 * on the strongest tier with a fallback so a busy/absent primary never sinks the
 * whole session's verdict.
 */
export const CHAIRMAN: { engine: EngineSpec; fallback: EngineSpec } = {
  engine: { engine: 'claude', model: 'opus' },
  fallback: { engine: 'claude', model: 'sonnet' },
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
}

/** One seat's ranking pass over the anonymized responses. `parsed` is the
 *  machine-read order of `Response A`… labels, best first (may be empty). */
export interface CouncilRanking {
  seatId: CouncilTone
  text: string
  parsed: string[]
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
  mode: CouncilMode
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

/** The full council session, rendered as seats → peer rankings → verdict. */
export interface CouncilResult {
  ok: boolean
  mode: CouncilMode
  seats: CouncilSeatOutput[]
  rankings: CouncilRanking[]
  aggregate: AggregateRank[]
  /** Anonymization map (`"Response A"` → seat id), revealed post-hoc in the UI. */
  labelToSeat: Record<string, CouncilTone>
  /** The chairman's synthesized verdict (markdown), or null if it failed. */
  verdict: string | null
  /** Spec mode only: the parsed gate decision + author questions. */
  specVerdict: { kind: 'approved' | 'needs_clarification'; questions: string[] } | null
  error: string | null
  stats: CouncilStats
  /** The persisted session's id, or null when persistence itself failed. */
  sessionId: string | null
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
export function parseSpecVerdict(text: string): { kind: SpecKind | null; questions: string[] } {
  return { kind: detectSpecKind(text), questions: extractQuestions(text) }
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

function extractQuestions(text: string): string[] {
  const lines = text.split('\n')
  const qIdx = lines.findIndex((l) => /^#{1,6}\s.*question/i.test(l.trim()))
  if (qIdx < 0) return []
  const out: string[] = []
  for (const raw of lines.slice(qIdx + 1)) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) break // next section ends the list
    const item = /^\d+[.)]\s*(.+)$/.exec(line)
    if (item) out.push(item[1].trim())
  }
  return out
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
export function composeCouncilBrief(result: CouncilResult): string | null {
  const okSeats = result.seats.filter((s) => s.ok)
  if (!result.verdict && okSeats.length === 0) return null

  const parts: string[] = [
    "COUNCIL BRIEF — this task's spec was reviewed by an LLM council; build with these conclusions in mind.",
  ]

  const conclusions = (result.verdict ? extractRefinedSpec(result.verdict) : null) ?? result.verdict?.trim() ?? null
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
