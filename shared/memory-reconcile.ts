/**
 * Reconciliation (docs/memory-imp.md Phase 3.1) — the "organized like a brain"
 * stage. Pure: given a distilled observation and the current hub, decide whether
 * it is a new note, a merge into an existing one, a duplicate to skip, or a
 * collision that must be asked about.
 *
 * Scope note: mechanical decisions only (slug match + textual similarity).
 * SEMANTIC contradiction ("the note says X, the fact says not-X") is not
 * detectable by text overlap — that judgment stays with the model (which sets
 * `decision: 'ask'`) and with the human review gate. What we catch here is the
 * name collision (model thinks it is new, but the slug already exists) and
 * near-duplicates, so the brain never grows twins.
 */
import { normalizeNoteName } from './wikilink'
import { parseNote } from './memory-note-schema'
import type { MemoryDoc } from './memory-hub'
import type { Observation } from './memory-observation'

export const RECONCILE_DECISIONS = ['new', 'merge', 'duplicate', 'conflict'] as const
export type ReconcileDecision = (typeof RECONCILE_DECISIONS)[number]

export interface Reconciled {
  decision: ReconcileDecision
  /** The slug the change applies to (normalized). */
  targetSlug: string
  /** Highest similarity (0..1) to the matched note or one atomic fact inside it. */
  similarity: number
  /** The existing note's full content, when a match was found. */
  existingContent: string | null
}

/** At or above this fact similarity, an observation is treated as already known. */
export const DUPLICATE_SIMILARITY = 0.82

/** Tokenize into a lowercase word set for Jaccard similarity. */
function tokenSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
  return new Set(words)
}

/** Jaccard similarity of two token sets (0..1); empty vs empty is 0. */
export function textSimilarity(a: string, b: string): number {
  const sa = tokenSet(a)
  const sb = tokenSet(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter += 1
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Compare against just the note body (drop frontmatter) for a fair measure. */
function bodyOf(content: string): string {
  return parseNote(content).body
}

const LIST_ITEM_RE = /^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/
const DATED_BULLET_RE = /^\(\d{4}-\d{2}-\d{2}\)\s*/
const RELATED_RE = /^related\s*:/i
const HEADING_RE = /^#{1,6}\s+/

/**
 * Split a note into atomic comparison candidates. Each prose paragraph and
 * every Markdown list item are independent facts; wrapped lines stay
 * with their fact. `Related:` is navigation, not knowledge. A combined candidate
 * preserves the old whole-body behavior for short prose notes, while the atomic
 * candidates prevent a large history from diluting one repeated bullet.
 */
export function noteFactSegments(content: string): string[] {
  const atomic: string[] = []
  let current: string[] = []

  const flush = (): void => {
    const fact = current.join(' ').replace(DATED_BULLET_RE, '').trim()
    if (fact) atomic.push(fact)
    current = []
  }

  for (const rawLine of bodyOf(content).replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (RELATED_RE.test(line)) {
      flush()
      continue
    }
    if (HEADING_RE.test(line)) {
      flush()
      continue
    }
    const item = LIST_ITEM_RE.exec(line)
    if (item) {
      flush()
      current.push(item[1])
      continue
    }
    current.push(line)
  }
  flush()

  const combined = atomic.join(' ').trim()
  return [...new Set([combined, ...atomic].filter(Boolean))]
}

/** Highest observation similarity across a note's whole and atomic fact candidates. */
export function noteFactSimilarity(observationBody: string, noteContent: string): number {
  let best = 0
  for (const fact of noteFactSegments(noteContent)) {
    best = Math.max(best, textSimilarity(observationBody, fact))
  }
  return best
}

/**
 * Decide how an observation lands in the hub. Deterministic; does not mutate.
 */
export function reconcile(
  obs: Observation,
  docs: MemoryDoc[],
  opts: { duplicateSimilarity?: number } = {},
): Reconciled {
  const dupThreshold = opts.duplicateSimilarity ?? DUPLICATE_SIMILARITY
  const targetSlug = normalizeNoteName(obs.targetSlug) ?? obs.targetSlug
  const bySlug = docs.find((d) => normalizeNoteName(d.name) === targetSlug)

  if (bySlug) {
    const similarity = noteFactSimilarity(obs.body, bySlug.content)
    if (similarity >= dupThreshold) {
      return { decision: 'duplicate', targetSlug, similarity, existingContent: bySlug.content }
    }
    // The model proposed this as a brand-new note, yet the slug is taken and the
    // content differs — a collision the human should resolve, not an auto-merge.
    if (obs.isNew) {
      return { decision: 'conflict', targetSlug, similarity, existingContent: bySlug.content }
    }
    return { decision: 'merge', targetSlug, similarity, existingContent: bySlug.content }
  }

  // No slug match — but guard against a near-duplicate filed under another slug.
  let best: { doc: MemoryDoc; sim: number } | null = null
  for (const doc of docs) {
    const sim = noteFactSimilarity(obs.body, doc.content)
    if (!best || sim > best.sim) best = { doc, sim }
  }
  if (best && best.sim >= dupThreshold) {
    return {
      decision: 'duplicate',
      targetSlug: normalizeNoteName(best.doc.name) ?? best.doc.name,
      similarity: best.sim,
      existingContent: best.doc.content,
    }
  }

  return { decision: 'new', targetSlug, similarity: 0, existingContent: null }
}
