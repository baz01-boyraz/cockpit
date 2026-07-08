import { councilRefineSpecSchema } from '@shared/schemas'
import {
  COUNCIL_SEATS,
  extractRefinedSpec,
  type AggregateRank,
  type CouncilResult,
  type CouncilTone,
} from '@shared/council'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * `council_refine_spec` (Faz 3) — the spec gate Hermes runs BEFORE it creates or
 * proposes a swarm card. It convenes the LLM council in `spec` mode over a draft
 * task spec and hands the model back a COMPACT verdict: the gate decision, any
 * author questions, the refined spec body to use as the card, a one-line peer
 * ranking, and the sessionId to thread onto the card. It deliberately never
 * returns the full seat prose — Hermes pays per token, and the seat texts are
 * already persisted for the scorecard.
 *
 * The tool DESCRIPTION is the load-bearing teaching surface: it encodes the whole
 * interview → draft → gate → clarify → approve protocol, so the workflow holds
 * even where a project's AGENTS.md/playbook was not loaded.
 */
export function createCouncilTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'council_refine_spec',
      description:
        "Run a draft task spec through the LLM council's spec gate BEFORE creating or proposing a swarm card. Protocol: (1) Interview the user first — ask 2-4 targeted questions ONLY where the answer changes what gets built (scope, done-criteria, behavior); batch them in ONE message and attach your default assumption to each so a bare 'ok' is a complete answer. Skip the interview for trivial or deterministic tasks. (2) Draft a spec with sections Goal / Context / Acceptance criteria / Out of scope / Constraints. (3) Call this tool. (4) If the verdict is NEEDS_CLARIFICATION, relay the returned questions to the user verbatim, fold their answers into the spec, and re-run this tool. (5) When APPROVED, use the returned refinedSpec as the card body and pass the returned sessionId as `councilSessionId` when you create or propose the card. A `synthesis-failed` verdict means the council could not reach a decision — say so plainly and proceed with your own judgement rather than looping. Returns a compact object: { verdictKind, questions, refinedSpec, ranking, sessionId } — never the full seat texts.",
      inputShape: councilRefineSpecSchema.shape,
      run: async (raw) => {
        const { projectId, spec, cardId } = councilRefineSpecSchema.parse(raw)
        const result = await ctx.council.run(projectId, { mode: 'spec', specText: spec, cardId })
        return compactCouncilPayload(result)
      },
    },
  ]
}

/** The gate decision Hermes acts on, mapped from the parsed spec verdict. A run
 *  that produced no parseable gate (chairman failed, or every seat failed) is
 *  `synthesis-failed` — a degraded run, not a NEEDS_CLARIFICATION. */
type CouncilVerdictKind = 'APPROVED' | 'NEEDS_CLARIFICATION' | 'synthesis-failed'

interface CompactCouncilPayload {
  verdictKind: CouncilVerdictKind
  /** Populated only on NEEDS_CLARIFICATION — the author questions, verbatim. */
  questions: string[]
  /** The refined spec body to paste as the card, or the raw verdict as fallback. */
  refinedSpec: string | null
  /** One-line peer ranking (best first), or a note when there were too few seats. */
  ranking: string
  /** The persisted council session id to thread onto the card as councilSessionId. */
  sessionId: string | null
  /** Present only when the run itself degraded, so the model can explain why. */
  error?: string
}

/**
 * Fold a full CouncilResult into the compact payload the model reads. This is the
 * ONE place seat prose is dropped — only the gate decision, questions, refined
 * spec, a ranking one-liner, and the sessionId cross back to Hermes.
 */
function compactCouncilPayload(result: CouncilResult): CompactCouncilPayload {
  const verdictKind = councilVerdictKind(result)
  const refinedSpec = result.verdict ? (extractRefinedSpec(result.verdict) ?? result.verdict.trim()) : null
  const base: CompactCouncilPayload = {
    verdictKind,
    questions: result.specVerdict?.kind === 'needs_clarification' ? result.specVerdict.questions : [],
    refinedSpec,
    ranking: formatCouncilRanking(result.aggregate),
    sessionId: result.sessionId,
  }
  return result.error ? { ...base, error: result.error } : base
}

function councilVerdictKind(result: CouncilResult): CouncilVerdictKind {
  if (result.specVerdict?.kind === 'approved') return 'APPROVED'
  if (result.specVerdict?.kind === 'needs_clarification') return 'NEEDS_CLARIFICATION'
  return 'synthesis-failed'
}

const SEAT_LABELS: Record<CouncilTone, string> = Object.fromEntries(
  COUNCIL_SEATS.map((seat) => [seat.id, seat.label]),
) as Record<CouncilTone, string>

/** Compact peer standings for one run, best (lowest average) first — e.g.
 *  "Builder 1.3 · Contrarian 1.8 · Outsider 2.5". Empty when <2 seats ranked. */
function formatCouncilRanking(aggregate: readonly AggregateRank[]): string {
  if (aggregate.length === 0) return 'No peer ranking (needs at least two responding seats).'
  return aggregate.map((rank) => `${SEAT_LABELS[rank.seatId] ?? rank.seatId} ${rank.averageRank.toFixed(1)}`).join(' · ')
}
