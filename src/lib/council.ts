/**
 * Reviewer-council merge (pure — VISION 6.5).
 *
 * The panel runs `review.run` once per persona lens, sequentially; this module
 * owns the deterministic part: tagging each lens's findings with its persona
 * label and folding the per-lens outcomes into ONE renderable ReviewResult.
 * One lens failing must never sink the others — failures become error lines,
 * the surviving findings still render.
 */
import type { ReviewFinding, ReviewResult } from '@shared/review'

/** A finding that remembers which council lens raised it. */
export interface LensTaggedFinding extends ReviewFinding {
  lens?: string
}

/** What one persona lens produced: a result, or the reason it failed. */
export interface CouncilLensOutcome {
  /** Persona label the lens ran under (e.g. "Security veteran"). */
  label: string
  /** The lens's review result — null when the call itself threw. */
  result: ReviewResult | null
  /** Failure message when the call threw; null on a completed call. */
  error: string | null
}

export interface CouncilMerge {
  /** One merged ReviewResult: concatenated tagged findings, last success's stats. */
  result: ReviewResult
  /** One human line per failed lens — rendered above the findings, never silently dropped. */
  lensErrors: string[]
}

const EMPTY_STATS: ReviewResult['stats'] = {
  filesReviewed: 0,
  filesBlocked: 0,
  filesSummarized: 0,
  injectionSuspects: 0,
  truncated: false,
  durationMs: 0,
}

/** Copy a lens's findings, each stamped with the persona label that raised it. */
export function tagFindings(findings: readonly ReviewFinding[], label: string): LensTaggedFinding[] {
  return findings.map((finding) => ({ ...finding, lens: label }))
}

function lensFailureLine(label: string, message: string): string {
  return `${label} lens failed — ${message}`
}

/**
 * Fold the per-lens outcomes into one renderable result. A lens counts as
 * successful when its call completed without an error payload; its findings
 * are tagged and concatenated in council order. Stats and model come from the
 * LAST successful lens (each lens reviewed the same change set, so the counts
 * describe the diff, not the sum of runs). Unparsed raw output is kept,
 * prefixed per lens — degraded output stays visible, never silent.
 */
export function mergeCouncil(outcomes: readonly CouncilLensOutcome[]): CouncilMerge {
  const lensErrors: string[] = []
  const findings: LensTaggedFinding[] = []
  const raws: string[] = []
  let lastSuccess: ReviewResult | null = null

  for (const outcome of outcomes) {
    if (outcome.result === null || outcome.result.error) {
      const message = outcome.result?.error ?? outcome.error ?? 'unknown error'
      lensErrors.push(lensFailureLine(outcome.label, message))
      continue
    }
    findings.push(...tagFindings(outcome.result.findings, outcome.label))
    if (outcome.result.raw !== null) {
      raws.push(`[${outcome.label}]\n${outcome.result.raw}`)
    }
    lastSuccess = outcome.result
  }

  if (lastSuccess === null) {
    return {
      result: {
        ok: false,
        findings: [],
        raw: null,
        model: '',
        error: `All ${outcomes.length} council lenses failed.`,
        stats: EMPTY_STATS,
      },
      lensErrors,
    }
  }

  return {
    result: {
      ok: lensErrors.length === 0 && lastSuccess.ok,
      findings,
      raw: raws.length > 0 ? raws.join('\n\n') : null,
      model: lastSuccess.model,
      error: null,
      stats: lastSuccess.stats,
    },
    lensErrors,
  }
}
