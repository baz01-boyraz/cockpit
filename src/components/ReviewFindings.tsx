import { useState } from 'react'
import type { ReviewFinding, ReviewResult, ReviewSeverity } from '@shared/review'
import { IconCheck, IconChevron, IconWarning } from './icons'

/**
 * Shared renderer for AI review results (VISION 4.5/4.6). Used by the Git
 * panel's "Review before ship" card and the per-block review bridge in
 * BlocksView, so both surfaces present findings identically.
 */

const SEVERITY_RANK: Record<ReviewSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  critical: 'chip--danger',
  high: 'chip--danger',
  medium: 'chip--warning',
  low: '',
}

/** Sanitizer-flagged prompt-injection findings get a distinct warning look. */
function isInjectionFinding(finding: ReviewFinding): boolean {
  return finding.title.toLowerCase().includes('prompt-injection')
}

/** Wrap a thrown IPC/renderer error into a renderable ReviewResult. */
export function reviewFailure(err: unknown): ReviewResult {
  return {
    ok: false,
    findings: [],
    raw: null,
    model: '',
    error: err instanceof Error ? err.message : String(err),
    stats: {
      filesReviewed: 0,
      filesBlocked: 0,
      filesSummarized: 0,
      injectionSuspects: 0,
      truncated: false,
      durationMs: 0,
    },
  }
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
  const [open, setOpen] = useState(false)
  const injection = isInjectionFinding(finding)
  const hasDetail = finding.detail.trim().length > 0
  const location = finding.file
    ? `${finding.file}${finding.line !== null ? `:${finding.line}` : ''}`
    : null

  return (
    <li className={`revfind ${open ? 'revfind--open' : ''} ${injection ? 'revfind--injection' : ''}`}>
      <button
        className="revfind__row"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        title={hasDetail ? (open ? 'Collapse detail' : 'Expand detail') : undefined}
      >
        <IconChevron
          width={12}
          height={12}
          className={`revfind__chevron ${open ? 'revfind__chevron--open' : ''}`}
        />
        <span className={`chip revfind__sev ${SEVERITY_CHIP[finding.severity]}`}>
          {finding.severity}
        </span>
        {injection ? (
          <IconWarning width={13} height={13} className="revfind__flag" aria-label="Prompt-injection suspect" />
        ) : null}
        {location ? <span className="revfind__loc mono">{location}</span> : null}
        <span className="revfind__title">{finding.title}</span>
      </button>
      {open && hasDetail ? <div className="revfind__detail">{finding.detail}</div> : null}
    </li>
  )
}

function StatsLine({ result }: { result: ReviewResult }) {
  const s = result.stats
  const parts: { text: string; warn?: boolean }[] = []
  if (s.filesReviewed > 0) {
    parts.push({ text: `${s.filesReviewed} file${s.filesReviewed === 1 ? '' : 's'} reviewed` })
  }
  if (s.filesBlocked > 0) {
    parts.push({ text: `${s.filesBlocked} sensitive excluded` })
  }
  if (s.filesSummarized > 0) {
    parts.push({ text: `${s.filesSummarized} summarized` })
  }
  if (s.injectionSuspects > 0) {
    parts.push({
      text: `${s.injectionSuspects} injection suspect${s.injectionSuspects === 1 ? '' : 's'}`,
      warn: true,
    })
  }
  if (parts.length === 0 && !s.truncated && !result.model) return null

  return (
    <div className="revstats">
      {parts.map((part, i) => (
        <span key={part.text} className={`revstats__part ${part.warn ? 'revstats__part--warn' : ''}`}>
          {i > 0 ? <span className="revstats__sep" aria-hidden>·</span> : null}
          {part.text}
        </span>
      ))}
      {s.truncated ? <span className="chip chip--warning">truncated</span> : null}
      {result.model ? <span className="chip revstats__model">{result.model}</span> : null}
    </div>
  )
}

interface ReviewFindingsProps {
  result: ReviewResult
  /** Tighter spacing for the inline per-block surface. */
  compact?: boolean
}

export function ReviewFindings({ result, compact = false }: ReviewFindingsProps) {
  if (result.error) {
    return (
      <div className="review__notice">
        <IconWarning width={14} height={14} /> {result.error}
      </div>
    )
  }

  const s = result.stats
  const nothingToReview =
    s.filesReviewed === 0 &&
    s.filesBlocked === 0 &&
    s.filesSummarized === 0 &&
    result.findings.length === 0 &&
    !result.raw
  if (nothingToReview) {
    return <div className="review__empty">Nothing to review — working tree is clean.</div>
  }

  const sorted = [...result.findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  )

  return (
    <div className={`review__result ${compact ? 'review__result--compact' : ''}`}>
      <StatsLine result={result} />
      {sorted.length > 0 ? (
        <ul className="revfinds">
          {sorted.map((finding, i) => (
            <FindingRow key={`${finding.file ?? 'global'}:${finding.line ?? i}:${finding.title}`} finding={finding} />
          ))}
        </ul>
      ) : result.raw === null ? (
        // "Ship it" is only honest when something was actually reviewed. A
        // blocked-only change set (e.g. a lone .env edit) never reaches the
        // model — found by this feature reviewing its own code (Gate 4).
        s.filesReviewed === 0 && s.filesBlocked > 0 ? (
          <div className="review__notice">
            <IconWarning width={14} height={14} /> Nothing could be reviewed — {s.filesBlocked}{' '}
            sensitive file{s.filesBlocked === 1 ? '' : 's'} excluded by the sanitizer.
          </div>
        ) : s.filesReviewed === 0 ? (
          <div className="review__empty">
            Only summarized files (lockfiles/binaries) in this change set — nothing to deep-review.
          </div>
        ) : (
          <div className="review__clean">
            <IconCheck width={14} height={14} /> No findings — ship it.
          </div>
        )
      ) : null}
      {result.raw !== null ? <pre className="review__raw mono">{result.raw}</pre> : null}
    </div>
  )
}
