/**
 * Swarm completion report (Faz 2.5) — the decision-ready readout produced when a
 * worker finishes and its card lands in In review. Pure + runtime-dependency-free
 * so it works on both sides of the IPC boundary and in the browser mock: the main
 * process computes the report (card row + git diff stat), and this module derives
 * the human-facing pieces (acceptance criteria pulled from the card body, and the
 * notification-sized one-liner).
 */

/** A worktree's line/file delta — the same shape as `review.DiffStat`, inlined
 *  to keep this module free of any cross-import. */
export interface CompletionDiffStat {
  files: number
  insertions: number
  deletions: number
}

export interface CompletionReport {
  cardId: string
  title: string
  branch: string | null
  /** Cheap `+N −M · K files` delta over the card's worktree, or null when the
   *  card has no worktree (or the tree could not be read). */
  diffStat: CompletionDiffStat | null
  /** Acceptance criteria pulled from the card body's refined-spec section. */
  acceptance: string[]
  /** Whether the card was gated by the LLM council's spec meeting. */
  hasCouncilSpec: boolean
  finishedAt: string
}

// The council's refined spec renders acceptance criteria under a bold label
// (`**Acceptance criteria**`) or a markdown heading (`### Acceptance criteria`),
// followed by a testable list. These matchers stay deliberately tolerant — the
// label text comes from an LLM chairman, so casing and markers vary.
const ACCEPTANCE_LABEL = /^\s*(?:#{1,6}\s*)?(?:[*_]{1,2}\s*)?acceptance\s+criteria\b/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/
const HEADING = /^\s*#{1,6}\s+/
const BOLD_LABEL = /^\s*\*\*[^*]+\*\*/

/**
 * Pull the list items under an "Acceptance criteria" heading/bold-label from a
 * card body. Tolerates `###`/`**…**` labels, a case-insensitive match, and
 * `-`/`*`/`+`/`1.`/`1)` item markers. Returns `[]` when the section is absent or
 * carries no list items. The section ends at the first blank line after an item,
 * the next heading, or the next bold sub-label (e.g. `**Out of scope**`).
 */
export function extractAcceptanceCriteria(body: string): string[] {
  if (!body) return []
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => ACCEPTANCE_LABEL.test(line))
  if (start === -1) return []

  const items: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const item = LIST_ITEM.exec(line)
    if (item) {
      items.push(item[1])
      continue
    }
    // A blank line ends the section once items have started; before the first
    // item it is just spacing between the label and the list.
    if (line.trim() === '') {
      if (items.length > 0) break
      continue
    }
    // A new heading or bold sub-label always ends the section.
    if (HEADING.test(line) || BOLD_LABEL.test(line)) break
    // Prose after the list means the list is over; before the first item it is
    // a label description we skip past to reach the items.
    if (items.length > 0) break
  }
  return items
}

/** Pluralize with an irregular singular form. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * A single notification-sized line, e.g.
 * `"Add the widget" ready for review — +42 −7 across 3 files · 4 acceptance criteria · council-spec’d`.
 * Segments that carry no information (a null diff stat, zero criteria, an
 * un-gated card) are dropped so a quiet card reads short rather than padded.
 */
export function formatCompletionSummary(report: CompletionReport): string {
  const head = `"${report.title}" ready for review`
  const segments: string[] = []
  if (report.diffStat) {
    const { files, insertions, deletions } = report.diffStat
    segments.push(`+${insertions} −${deletions} across ${count(files, 'file', 'files')}`)
  }
  if (report.acceptance.length > 0) {
    segments.push(count(report.acceptance.length, 'acceptance criterion', 'acceptance criteria'))
  }
  if (report.hasCouncilSpec) segments.push('council-spec’d')
  return segments.length > 0 ? `${head} — ${segments.join(' · ')}` : head
}
