/**
 * The memory write gate (docs/MEMORY-CHARTER.md, "Faz C"). Pure, runtime-
 * dependency-free rules that decide whether an AGENT-initiated memory write may
 * land directly, must go to human review, or must be refused outright.
 *
 * Precedence: reject > review > accept. Every failing rule contributes a
 * human-actionable reason; a caller surfaces them to the agent (tool error) or
 * records them (audit stats). Direct human writes from the UI never pass through
 * here — the gate holds the engines to the charter, never the owner.
 */
import { looksLikeSecret } from './redaction'
import { normalizeNoteName } from './wikilink'

/**
 * What an engine must attach to a write to clear the gate. It is the charter's
 * 7-day test made structural: name the concrete future scenario, declare the
 * dedup check you performed, and cite the evidence the fact rests on.
 */
export interface MemoryWriteJustification {
  /** The concrete situation, within ~7+ days, in which someone needs this fact. */
  sevenDayScenario: string
  /** Dedup-first: did you fold this into an existing note, or is there truly no overlap? */
  dedupChecked: 'updates-existing' | 'no-overlap'
  /** The note this updates/relates to, when known (a slug). */
  targetNote?: string
  /** What the fact rests on — the transcript, the error, the decision. */
  evidence: string
}

export type GateVerdict = 'accept' | 'review' | 'reject'

export interface GateInput {
  name: string
  content: string
  /** Absent/null is a soft failure (review), never a hard reject — a human may be terse. */
  justification?: MemoryWriteJustification | null
  /** The note slugs already present in the target hub (for the twin check). */
  existingNames: readonly string[]
}

export interface GateResult {
  verdict: GateVerdict
  reasons: string[]
}

/** A 7-day scenario shorter than this is too vague to be a real scenario. */
export const MIN_SCENARIO_CHARS = 20

/** Above this size an agent write is split-worthy — route it to review, not disk. */
export const GATE_OVERSIZE_CHARS = 6_000

/**
 * Filler phrases that are the OPPOSITE of a concrete 7-day scenario. Small and
 * deliberate — this catches the honest-but-lazy justification, not every possible
 * evasion (the human reviewer is the backstop for the rest).
 */
export const GENERIC_SCENARIO_PHRASES = [
  'might be useful',
  'maybe useful',
  'could be useful',
  'good to know',
  'good to remember',
  'just in case',
  'for reference',
  'for future reference',
  'could be helpful',
  'might be helpful',
  'nice to have',
  'might need it',
  'might need this',
] as const

const RANK: Record<GateVerdict, number> = { accept: 0, review: 1, reject: 2 }

function raise(current: GateVerdict, next: GateVerdict): GateVerdict {
  return RANK[next] > RANK[current] ? next : current
}

function isGenericScenario(scenario: string): boolean {
  const lower = scenario.toLowerCase()
  return GENERIC_SCENARIO_PHRASES.some((phrase) => lower.includes(phrase))
}

/**
 * Decide the fate of an agent memory write. Deterministic and side-effect-free;
 * all applicable rules run so the caller sees every reason at once.
 */
export function gateMemoryWrite(input: GateInput): GateResult {
  const reasons: string[] = []
  let verdict: GateVerdict = 'accept'

  // Hard floor: never persist a secret to a note. Refused, citing the charter.
  if (looksLikeSecret(input.content)) {
    verdict = raise(verdict, 'reject')
    reasons.push(
      'content contains a secret-shaped value — secrets never go in memory (see the redaction rule in the charter)',
    )
  }

  // The 7-day test, made structural. A missing justification is a soft failure:
  // route to review, never hard-reject — a human may write tersely.
  const j = input.justification
  if (!j) {
    verdict = raise(verdict, 'review')
    reasons.push(
      'no justification: state the concrete 7-day scenario and cite evidence (docs/MEMORY-CHARTER.md — the 7-day test)',
    )
  } else {
    const scenario = j.sevenDayScenario.trim()
    if (scenario.length < MIN_SCENARIO_CHARS) {
      verdict = raise(verdict, 'review')
      reasons.push(
        `7-day scenario is too vague (< ${MIN_SCENARIO_CHARS} chars) — name the concrete situation in which this fact is needed`,
      )
    } else if (isGenericScenario(scenario)) {
      verdict = raise(verdict, 'review')
      reasons.push(
        '7-day scenario is a generic filler phrase — it fails the 7-day test; describe a specific situation',
      )
    }
    if (j.evidence.trim().length === 0) {
      verdict = raise(verdict, 'review')
      reasons.push('justification is missing evidence — cite what the fact rests on')
    }
  }

  // Oversize: one note should be one fact. Split-worthy content goes to review.
  if (input.content.length > GATE_OVERSIZE_CHARS) {
    verdict = raise(verdict, 'review')
    reasons.push(
      `note is oversized (> ${GATE_OVERSIZE_CHARS} chars) — split it into focused single-fact notes`,
    )
  }

  // Dedup-first: a "no-overlap" claim against a name that already exists is
  // almost always a twin. Route it to review so the existing note is updated.
  const slug = normalizeNoteName(input.name)
  if (slug && j?.dedupChecked === 'no-overlap') {
    const existing = new Set(
      input.existingNames.map((n) => normalizeNoteName(n) ?? n),
    )
    if (existing.has(slug)) {
      verdict = raise(verdict, 'review')
      reasons.push(
        `a note named "${slug}" already exists but dedup was marked "no-overlap" — update the existing note ([[${slug}]]) instead of creating a twin`,
      )
    }
  }

  return { verdict, reasons }
}
